/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

const path = require("path");
const esbuild = require("esbuild");
const { legacyPlugin } = require("@web/dev-server-legacy");
const { playwrightLauncher } = require("@web/test-runner-playwright");

// `@hdml/parser` does `import { parse } from "node-html-parser"`, but
// `node-html-parser` is CommonJS (with `css-select` / `he` CJS deps).
// `@web/dev-server` serves modules verbatim, and a browser cannot bind
// a named import from a CJS file (SyntaxError: "does not provide an
// export named 'parse'"), which blocks every hdio test that touches
// the parser. On the fly, esbuild-bundle the package into an ESM shim
// that re-exports the two named bindings the parser needs; the browser
// then imports a real ESM module. esbuild is already this repo's
// bundler (the `bin` build), so no new dependency is added. (The
// rollup CommonJS plugin does not work here: its proxy scheme never
// rewrites the ESM importer, so the named export stays invisible.)
function nodeHtmlParserEsm() {
  const entry = require.resolve("node-html-parser");
  let bundled = null;
  return {
    name: "node-html-parser-esm",
    async serve(context) {
      if (!context.path.endsWith("/node-html-parser/dist/index.js")) {
        return undefined;
      }
      if (bundled === null) {
        const shim = [
          `import mod from ${JSON.stringify(entry)};`,
          "export const parse = mod.parse;",
          "export const HTMLElement = mod.HTMLElement;",
          "export default mod;",
        ].join("\n");
        const result = await esbuild.build({
          stdin: {
            contents: shim,
            resolveDir: path.dirname(entry),
            loader: "js",
          },
          bundle: true,
          format: "esm",
          write: false,
          platform: "browser",
          logLevel: "silent",
        });
        bundled = result.outputFiles[0].text;
      }
      return { body: bundled, type: "js" };
    },
  };
}

const browsers = {
  chromium: playwrightLauncher({ product: "chromium" }),
  firefox: playwrightLauncher({ product: "firefox" }),
  webkit: playwrightLauncher({ product: "webkit" }),
};

// The token pair returned by the two-step handoff exchange and the
// refresh route (server `domain.TokenResponse`).
function tokenResponse(access, refresh) {
  return {
    access_token: access,
    refresh_token: refresh,
    expires_in: 900,
    token_type: "Bearer",
  };
}

// A real mock HDIO server on the wtr dev-server (RFC §7 Test
// strategy). A Worker's `fetch` cannot be monkey-patched from a test,
// but a localhost route is reached identically from the main-thread
// fallback and a Worker, and exercises the real `fetch` path (status
// codes, content-type branching, AbortController). Per-test variation
// is by the `tenant` path segment, kept stateless per route:
//   ok            → token 200, doc 201 (echoes the seen Authorization)
//   stale-handoff → token 401 (redeem rejects, no `Bearer null`)
//   expired-access→ doc 401 until a refresh mints "fresh-access"
//   always-401    → doc always 401 (persistent, survives the retry)
//   slow          → doc hangs (abort target for close())
//   err-html      → doc 502 with a text/html body (no JSON parse)
//   oidc-ok       → GET /auth/callback 200 (OIDC exchange succeeds)
//   stale-state   → GET /auth/callback 401 (spent state → re-nav)
//   q-ok          → /queries 202 completed; result = 2 IPC batches
//   q-fail        → GET /queries/{id} 200 {status:failed, error}
//   q-pending     → GET /queries/{id} 202 {status:pending}
//   q-cancel      → DELETE /queries/{id} 409 (ErrJobTerminal, swallowed)
function mockHdio() {
  return async (ctx, next) => {
    const parts = ctx.path.split("/").filter(Boolean);
    if (
      parts.length < 4 ||
      parts[1] !== "api" ||
      parts[2] !== "v1"
    ) {
      return next();
    }
    const tenant = parts[0];
    const route = "/" + parts.slice(3).join("/");
    const post = ctx.method === "POST";

    // Issuance step 2 — redeem the handoff for the token pair.
    if (post && route === "/auth/token") {
      if (tenant === "stale-handoff") {
        ctx.status = 401;
        ctx.body = { error: "handoff invalid or reused" };
        return;
      }
      if (tenant === "expired-access") {
        ctx.body = tokenResponse("stale-access", "refresh-0");
        return;
      }
      ctx.body = tokenResponse(
        "access-" + tenant,
        "refresh-" + tenant,
      );
      return;
    }

    // Silent refresh — always mints "fresh-access".
    if (post && route === "/auth/token/refresh") {
      ctx.body = tokenResponse("fresh-access", "refresh-1");
      return;
    }

    // OIDC exchange — a plain GET returning the token pair as JSON.
    // A spent single-use `state` is a 401 (the stale-`?code` reload).
    if (!post && route === "/auth/callback") {
      if (tenant === "stale-state") {
        ctx.status = 401;
        ctx.body = { error: "state invalid or reused" };
        return;
      }
      ctx.body = tokenResponse(
        "access-" + tenant,
        "refresh-" + tenant,
      );
      return;
    }

    // Dynamic-doc save — the Bearer is asserted (echoed back as
    // `seen_auth`) and the 201 stored[] folds into the registry.
    if (post && route === "/documents/dynamic") {
      const auth = ctx.get("authorization");
      if (tenant === "err-html") {
        ctx.status = 502;
        ctx.type = "text/html";
        ctx.body = "<html><body>502 Bad Gateway</body></html>";
        return;
      }
      if (tenant === "always-401") {
        ctx.status = 401;
        ctx.body = { error: "unauthorized" };
        return;
      }
      if (
        tenant === "expired-access" &&
        auth !== "Bearer fresh-access"
      ) {
        ctx.status = 401;
        ctx.body = { error: "access token expired" };
        return;
      }
      if (tenant === "slow") {
        // Hold the response so close() can abort the in-flight fetch,
        // but end promptly when the client drops the connection so no
        // request lingers past the test. The 201 below is then written
        // to a closed socket (a Koa no-op) — falling through keeps the
        // status off the dev-server's 404 report.
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 2000);
          ctx.req.on("close", () => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
      ctx.status = 201;
      ctx.body = {
        stored: [
          {
            key: "hdml-model=m@abc.hdml",
            type: "model",
            stored: true,
          },
        ],
        ddl: [],
        seen_auth: auth,
      };
      return;
    }

    // Query submit — 202 with the job id + its (maybe-terminal)
    // status. The D2 `{doc_path, columns}` body shape is asserted at
    // the worker level (a captured `submitQuery` arg); here the route
    // only needs to accept the POST and return a job.
    if (post && route === "/queries") {
      ctx.status = 202;
      ctx.body = { job_id: "job-1", status: "completed" };
      return;
    }

    // Query status — 200 terminal / 202 pending (both `ok`); a failed
    // job carries its `error` string (D6, poll status not result).
    if (
      ctx.method === "GET" &&
      parts[3] === "queries" &&
      parts.length === 5
    ) {
      const jobId = parts[4];
      if (tenant === "q-fail") {
        ctx.status = 200;
        ctx.body = { job_id: jobId, status: "failed", error: "boom" };
        return;
      }
      if (tenant === "q-pending") {
        ctx.status = 202;
        ctx.body = { job_id: jobId, status: "pending" };
        return;
      }
      ctx.status = 200;
      ctx.body = { job_id: jobId, status: "completed" };
      return;
    }

    // Query result — the 4-byte big-endian length-prefixed Arrow IPC
    // stream (two batches here) the client de-frames into one
    // ArrayBuffer per batch.
    if (
      ctx.method === "GET" &&
      parts[3] === "queries" &&
      parts.length === 6 &&
      parts[5] === "result"
    ) {
      const frame = (bytes) => {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(bytes.length, 0);
        return Buffer.concat([len, Buffer.from(bytes)]);
      };
      ctx.status = 200;
      ctx.type = "application/octet-stream";
      ctx.body = Buffer.concat([
        frame([1, 2, 3]),
        frame([4, 5, 6, 7]),
      ]);
      return;
    }

    // Query cancel — 204, or a 409 (ErrJobTerminal) the client
    // swallows (cancel is best-effort, never load-bearing).
    if (
      ctx.method === "DELETE" &&
      parts[3] === "queries" &&
      parts.length === 5
    ) {
      if (tenant === "q-cancel") {
        ctx.status = 409;
        ctx.body = { error: "job terminal" };
        return;
      }
      ctx.status = 204;
      return;
    }

    return next();
  };
}

module.exports = {
  rootDir: ".",
  files: ["./tst/**/*.test.js"],
  nodeResolve: {
    exportConditions: process.env.MODE === "dev"
      ? ["development"]
      : ["prod"]},
  preserveSymlinks: true,
  browsers: Object.values(browsers),
  middleware: [mockHdio()],
  testFramework: {
    config: {
      ui: "tdd",
      timeout: "60000",
    },
  },
  plugins: [
    nodeHtmlParserEsm(),
    legacyPlugin({
      polyfills: {
        webcomponents: true,
        custom: [{
          name: "lit-polyfill-support",
          path: "node_modules/lit/polyfill-support.js",
          test: "!('attachShadow' in Element.prototype) || !('getRootNode' in Element.prototype) || window.ShadyDOM && window.ShadyDOM.force",
          module: false,
        }],
      },
    }),
  ],
};
