/**
 * render-live.mjs — render the live HDVL pages headlessly, with real
 * data, and write one PNG per `hdml-view`.
 *
 * WHY THIS EXISTS. The acceptance corpus asserts whole-`Scene`
 * goldens — computed geometry — and never looks at a pixel, so
 * overflow, clipping, misplacement and font-metric drift are
 * invisible to it by construction (017 O1). This is the instrument
 * that looks. It is a **dev instrument, not a gate**: nothing in
 * `npm test` calls it, it needs a live HDIO server, and its output is
 * for a human to read.
 *
 * AUTH. The `html/hdvl-live/` pages are `mode="oidc"` and redirect to
 * a login no headless driver can complete. The way in is 006's
 * **handoff**, which `<hdml-io>` reads from `?handoff=` and which
 * **wins over `mode`** (`HdmlIo.ts` — `#handoff ?? token`). The caller
 * supplies a **tenant token in the environment**; this script mints
 * one single-use handoff per page. No credential is ever written to
 * disk, and neither the token nor the handoff is ever printed.
 *
 * USAGE
 *
 *   HDIO_TENANT_TOKEN=$TT node scripts/render-live.mjs
 *   HDIO_TENANT_TOKEN=$TT node scripts/render-live.mjs html/hdvl-live/03-bar.html
 *   HDIO_TENANT_TOKEN=$TT RENDER_BROWSER=firefox node scripts/render-live.mjs
 *
 * ENVIRONMENT
 *
 *   HDIO_TENANT_TOKEN  required. A tenant token — see docs/development.md
 *                      for the three-call recipe. Never a file path.
 *   HDIO_HOST          default http://127.0.0.1:8888
 *   HDIO_TENANT        default tenant-a
 *   HDIO_ROLE          default admin  (tenant-a's access.yml: admin, guest)
 *   RENDER_ORIGIN      default http://127.0.0.1:8000 — on tenant-a's origin
 *                      allowlist. Any other origin is 403 "origin not in
 *                      tenant allowlist", delivered as the NAVIGATION
 *                      response, which looks like a broken page server.
 *   RENDER_BROWSER     chromium (default) | firefox | webkit
 *   RENDER_OUT         default .render-live  (gitignored)
 *   RENDER_VIEWPORT    default 1280x900
 *   RENDER_TIMEOUT_MS  default 30000, per page
 *   RENDER_STABLE_MS   default 750 — how long every view's node count
 *                      must hold still before the page counts as settled
 *
 * EXIT CODE. Non-zero if any page failed to render, any view stayed
 * empty, or any console error, page error or HTTP >= 400 was seen.
 */

import { mkdir, readdir, rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, firefox, webkit } from "playwright";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));

const HOST = process.env.HDIO_HOST ?? "http://127.0.0.1:8888";
const TENANT = process.env.HDIO_TENANT ?? "tenant-a";
const ROLE = process.env.HDIO_ROLE ?? "admin";
const ORIGIN = process.env.RENDER_ORIGIN ?? "http://127.0.0.1:8000";
const OUT = resolve(REPO, process.env.RENDER_OUT ?? ".render-live");
const TIMEOUT = Number(process.env.RENDER_TIMEOUT_MS ?? 30_000);
const STABLE_MS = Number(process.env.RENDER_STABLE_MS ?? 750);
const BROWSERS = { chromium, firefox, webkit };
const BROWSER = process.env.RENDER_BROWSER ?? "chromium";

const [VW, VH] = (process.env.RENDER_VIEWPORT ?? "1280x900")
  .split("x")
  .map((n) => Number(n));

/**
 * The tenant token, read once and never echoed.
 *
 * ★ An env var, not a flag and not a file. A flag lands in the
 * process table; a file lands on disk. Both outlive the run.
 */
const TOKEN = process.env.HDIO_TENANT_TOKEN;

/**
 * Pages to render, defaulting to the whole live corpus.
 *
 * @returns Repo-relative page paths, sorted.
 */
async function pages() {
  const argv = process.argv.slice(2);
  if (argv.length > 0) {
    return argv.map((p) => relative(REPO, resolve(REPO, p)));
  }
  const dir = "html/hdvl-live";
  const names = await readdir(join(REPO, dir));
  return names
    .filter((n) => n.endsWith(".html"))
    .sort()
    .map((n) => `${dir}/${n}`);
}

/**
 * Mints one single-use handoff code for one page load.
 *
 * Two calls deep on purpose: the tenant token is a PRIVATE-namespace
 * credential and never reaches the browser — only the handoff does,
 * and `<hdml-io>` strips it from the URL as its first act.
 *
 * @returns The handoff code.
 */
async function handoff() {
  const url = `${HOST}/private/${TENANT}/auth/token`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ role: ROLE }),
  });
  if (!res.ok) {
    throw new Error(
      `POST ${url} -> ${res.status}. Is HDIO_TENANT_TOKEN fresh, ` +
        `and is "${ROLE}" a role in ${TENANT}'s access.yml?`,
    );
  }
  const body = await res.json();
  if (typeof body.handoff !== "string" || body.handoff === "") {
    throw new Error(`POST ${url} returned no handoff`);
  }
  return body.handoff;
}

/**
 * Runs inside the page. Waits until every `hdml-view` has **settled**,
 * then reports one record per view.
 *
 * ★ SETTLED, NOT PAINTED. A view paints its first frame long before
 * its data arrives — an empty `<g data-w>` per widget and nothing
 * inside it — so *"the `<svg>` has a child"* is true within a few
 * milliseconds of load and screenshots a blank box. It cost this
 * script's first run: 13 pages, 29 views, zero errors, and every PNG
 * white. The predicate is therefore **every view has at least one
 * painted node AND no view's node count has moved for
 * {@link STABLE_MS}** — engine-neutral, and it needs no read of
 * `:state(loading)`, which is not exposed to script.
 *
 * ★ Nothing it returns is believed until the caller has checked
 * `upgraded` and `pathname`. See the guard in {@link render}.
 */
const PROBE = `(async () => {
  const views = [...document.querySelectorAll("hdml-view")];
  const svgOf = (v) => v.shadowRoot && v.shadowRoot.querySelector("svg");
  // A "painted" node is a leaf under a widget group. <defs>, the
  // widget groups themselves and the <svg> are scaffolding: a view
  // with only those has rendered nothing.
  const counts = () => views.map((v) => {
    const s = svgOf(v);
    return s === null ? [0, 0] : [
      s.querySelectorAll("*").length,
      s.querySelectorAll("g[data-w] *").length,
    ];
  });

  const deadline = Date.now() + ${TIMEOUT};
  let last = "";
  let since = Date.now();
  let settled = false;
  while (Date.now() < deadline) {
    const now = counts();
    const key = JSON.stringify(now);
    if (key !== last) {
      last = key;
      since = Date.now();
    } else if (
      views.length > 0 &&
      now.every(([, painted]) => painted > 0) &&
      Date.now() - since >= ${STABLE_MS}
    ) {
      settled = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  return {
    settled,
    pathname: location.pathname,
    upgraded:
      views.length > 0 &&
      customElements.get("hdml-view") !== undefined &&
      views[0] instanceof customElements.get("hdml-view"),
    views: views.map((v, i) => {
      const s = svgOf(v);
      const r = v.getBoundingClientRect();
      return {
        i,
        label: v.getAttribute("aria-labelledby") || v.id || String(i),
        nodes: s === null ? 0 : s.querySelectorAll("*").length,
        painted: s === null ? 0 : s.querySelectorAll("g[data-w] *").length,
        box: { width: r.width, height: r.height },
      };
    }),
  };
})()`;

/**
 * Renders one page and writes its PNGs.
 *
 * @param ctx - The browser context.
 * @param page - Repo-relative page path.
 * @returns Whether the page rendered cleanly.
 */
async function render(ctx, path) {
  const tab = await ctx.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const httpErrors = [];

  tab.on("console", (m) => {
    if (m.type() === "error") {
      consoleErrors.push(m.text());
    }
  });
  tab.on("pageerror", (e) => pageErrors.push(String(e)));
  tab.on("response", (r) => {
    if (r.status() >= 400) {
      httpErrors.push(`${r.status()} ${redact(r.url())}`);
    }
  });

  const want = `/${path}`;
  let probe;
  let failure = null;
  try {
    const code = await handoff();
    await tab.goto(`${ORIGIN}${want}?handoff=${code}`, {
      waitUntil: "load",
      timeout: TIMEOUT,
    });
    probe = await tab.evaluate(PROBE);
  } catch (e) {
    failure = String(e);
  }

  // ─────────────────────────────────────────────────────────────
  // ★ THE GUARD. Nothing above is reported before this passes.
  //
  // A live page loaded without a usable handoff does NOT fail
  // loudly: `<hdml-io mode="oidc">` navigates away, and the probe
  // then measures the server's login or error page. Every `hdml-*`
  // selector returns nothing, no property is registered, and the
  // result is clean, plausible and completely wrong. It cost one
  // full "35 of 35 properties are broken" run during 017's
  // sequencing. A stale or missing `bin/` does the same thing by a
  // different route: un-upgraded elements measure `1200x0`.
  // ─────────────────────────────────────────────────────────────
  const reasons = [];
  if (failure !== null) {
    reasons.push(failure);
  } else {
    if (probe.pathname !== want) {
      reasons.push(
        `NAVIGATED AWAY: at ${probe.pathname}, expected ${want}. ` +
          `The handoff was not redeemed — mode="oidc" took over.`,
      );
    }
    if (probe.views.length === 0) {
      reasons.push("no <hdml-view> in the document");
    } else if (!probe.upgraded) {
      reasons.push(
        "<hdml-view> did not upgrade — bin/index.min.js is stale or " +
          "missing. It is gitignored: run `npm run compile_bin`.",
      );
    } else if (!probe.settled) {
      const blank = probe.views
        .filter((v) => v.painted === 0)
        .map((v) => v.label);
      reasons.push(
        blank.length > 0
          ? `NEVER PAINTED after ${TIMEOUT} ms: ${blank.join(", ")}. ` +
              `The scene is scaffolding only — no data reached it.`
          : `NEVER SETTLED after ${TIMEOUT} ms — the scene was still ` +
              `changing. Raise RENDER_TIMEOUT_MS.`,
      );
    }
  }

  if (reasons.length > 0) {
    console.log(`\n✗ ${path}`);
    for (const r of reasons) {
      console.log(`    ${r}`);
    }
    for (const e of httpErrors) {
      console.log(`    HTTP ${e}`);
    }
    await tab.close();
    return false;
  }

  const dir = join(OUT, BROWSER, path.replace(/\.html$/, ""));
  await mkdir(dir, { recursive: true });
  const handles = await tab.locator("hdml-view").all();

  console.log(`\n${path}  —  ${probe.views.length} view(s)`);
  let ok = true;
  for (const v of probe.views) {
    const png = join(dir, `${String(v.i).padStart(2, "0")}-${slug(v.label)}.png`);
    await handles[v.i].screenshot({ path: png });
    const empty =
      v.painted === 0 || v.box.width === 0 || v.box.height === 0;
    ok = ok && !empty;
    console.log(
      `  ${empty ? "✗" : "·"} ${v.label.padEnd(20)} ` +
        `${Math.round(v.box.width)}x${Math.round(v.box.height)}`.padEnd(10) +
        `${String(v.nodes).padStart(5)} svg` +
        `${String(v.painted).padStart(5)} painted  ` +
        `${relative(REPO, png)}`,
    );
  }
  for (const e of consoleErrors) {
    console.log(`  ! console: ${redact(e)}`);
  }
  for (const e of pageErrors) {
    console.log(`  ! page:    ${redact(e)}`);
  }
  for (const e of httpErrors) {
    console.log(`  ! http:    ${e}`);
  }

  await tab.close();
  return (
    ok &&
    consoleErrors.length === 0 &&
    pageErrors.length === 0 &&
    httpErrors.length === 0
  );
}

/**
 * Strips a handoff code out of anything about to be printed.
 *
 * @param s - The text.
 * @returns The text, with any handoff value replaced.
 */
function redact(s) {
  return s.replace(/handoff=[^&\s"']+/g, "handoff=<redacted>");
}

/**
 * @param s - A view label.
 * @returns A filename-safe form of it.
 */
function slug(s) {
  return s.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-|-$/g, "") || "view";
}

/** Renders every requested page. */
async function main() {
  if (TOKEN === undefined || TOKEN === "") {
    console.error(
      "HDIO_TENANT_TOKEN is not set. See docs/development.md " +
        "§ The live-render harness for the three-call recipe. " +
        "Keep it in the environment — never in a file.",
    );
    process.exitCode = 2;
    return;
  }
  if (!(BROWSER in BROWSERS)) {
    console.error(`RENDER_BROWSER=${BROWSER} — want chromium|firefox|webkit`);
    process.exitCode = 2;
    return;
  }

  const paths = await pages();
  await rm(join(OUT, BROWSER), { recursive: true, force: true });

  const browser = await BROWSERS[BROWSER].launch();
  const ctx = await browser.newContext({
    viewport: { width: VW, height: VH },
    deviceScaleFactor: 2,
  });

  console.log(
    `${BROWSER} ${VW}x${VH} @2x  ·  ${ORIGIN}  ·  ` +
      `${HOST} ${TENANT}/${ROLE}  ·  ${paths.length} page(s)`,
  );

  const failed = [];
  for (const p of paths) {
    if (!(await render(ctx, p))) {
      failed.push(p);
    }
  }

  await ctx.close();
  await browser.close();

  console.log(
    `\n${paths.length - failed.length}/${paths.length} page(s) clean  ·  ` +
      `PNGs under ${relative(REPO, join(OUT, BROWSER))}/`,
  );
  if (failed.length > 0) {
    console.log(`FAILED: ${failed.join(", ")}`);
    process.exitCode = 1;
  }
}

await main();
