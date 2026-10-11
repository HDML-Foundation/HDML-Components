/**
 * cdp-diagnostics-probe.mjs — does `HDML.diagnostics()` survive the
 * channel it was designed for?
 *
 * WHY THIS EXISTS. Item 11 (RFC 019/002 §5) exists so that **022
 * reads the validator over CDP**, and §9.2's caveat is that the
 * 2026-09-28 spike measured **Playwright** while the box ships
 * **chromedp**. `JSON.stringify` in the page is **not** the same
 * serialisation as `Runtime.evaluate`'s `returnByValue`: that has
 * its own depth limits, its own treatment of an `undefined` member,
 * and its own behaviour on a getter. The browser suite cannot ask
 * the question — `@web/test-runner` drives Playwright but hands a
 * test no CDP session — so this is a **documented manual gate**, the
 * same shape RFC 019/002 §11 gives item 12's `wasmtime` probes and
 * `probe-sentinel.mjs` gives R6.
 *
 * WHAT IT MEASURED, 019 step 32, chromium via playwright-core's
 * `newCDPSession` (= raw CDP, no Playwright value marshalling):
 *
 *   1. ★ The projection crosses intact. `returnByValue: true`
 *      returns all **eleven** keys and the result is **byte-equal**
 *      to the in-page `JSON.stringify` (probe 3: `true`). The
 *      anchor arrives whole:
 *      `hdml-view[0]/hdml-cartesian-plane[0]/hdml-axis[0]`.
 *
 *   2. ★★★ The INTERNAL shape fails HARDER here than in the page,
 *      and differently. In-page `JSON.stringify(diagnosticsOf(v))`
 *      throws a catchable cyclic-structure `TypeError`. The same
 *      value over `returnByValue` yields
 *      **`Protocol error (Runtime.evaluate): Object reference chain
 *      is too long`** — a transport failure of the CDP call, with
 *      `exceptionDetails: null`. So a chromedp caller gets an error
 *      from `chromedp.Run`, indistinguishable at that layer from a
 *      dropped connection, and **no page-side diagnostic at all**.
 *      ⓘ Chrome's serialiser gives up on reference-chain DEPTH
 *      before it ever reaches the cycle, so the plan row's reading
 *      — *"`element`/`unit` are live `HTMLElement`s"* — understates
 *      the failure twice.
 *
 *   3. ★★★ An ABSENT OPTIONAL **vanishes**, exactly as it does
 *      through `JSON.stringify`: a key whose value is `undefined`
 *      is **not in the result's key set**, at the top level and
 *      nested. It does not arrive as `null`, and it does not arrive
 *      as a present key. ⇒ had `channel?` / `source?` / `unit?`
 *      been spelled optional (RFC §5.2's sketch), 022 would have
 *      received a payload whose key set varied row to row, with
 *      *"this emitter has no such field"* and *"this finding names
 *      none"* indistinguishable — and a Go unmarshal into a pointer
 *      field would give `nil` for both. **This is the measurement
 *      behind `SerialisableDiagnostic` having no optional member
 *      and an explicit `null` everywhere.**
 *
 *   4. ⓘ An enumerable **getter** IS evaluated and its computed
 *      value crosses. The projection uses none; it did not have to
 *      avoid them.
 *
 * HOW TO RUN. `node scripts/cdp-diagnostics-probe.mjs` from the repo
 * root, after `npm run compile_all` (it loads `bin/index.min.js`
 * through the page's own `<script>`). It serves the repo on an
 * ephemeral 127.0.0.1 port — never `localhost`, which stalls ~20 s
 * per request behind the VS Code port forward — and needs no HDIO
 * server: `02-area` is a literal-only page.
 *
 * It is a dev instrument, not a gate: nothing in `npm test` calls
 * it and its output is for a human to read.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const ROOT = path.resolve(import.meta.dirname ?? new URL(".", import.meta.url).pathname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript",
  ".map": "application/json", ".css": "text/css" };

const srv = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    res.writeHead(404); return res.end("nope");
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(p)] ?? "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const port = srv.address().port;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${port}/html/hdvl/02-area.html`);
await page.waitForFunction("!!globalThis.HDML && !!customElements.get('hdml-view')");
await page.waitForTimeout(600);

// Make ONE real V13, the same recipe the suite uses.
await page.evaluate(() => {
  const v = document.querySelector("hdml-view");
  const plane = v.querySelector("hdml-cartesian-plane");
  plane.appendChild(document.createElement("hdml-axis"));
  v.reindex();
});

const cdp = await page.context().newCDPSession(page);
const ev = async (expression, opts = {}) => {
  try {
    return await cdp.send("Runtime.evaluate", { expression, ...opts });
  } catch (e) {
    return { protocolError: String(e.message ?? e) };
  }
};

const out = {};

// 1. returnByValue on the projection — the channel 022 uses.
const byValue = await ev("HDML.diagnostics()", { returnByValue: true });
out["1_returnByValue"] = {
  exception: byValue.exceptionDetails?.text ?? null,
  type: byValue.result?.type,
  value: byValue.result?.value,
};

// 2. the in-page JSON.stringify, for comparison.
const asText = await ev("JSON.stringify(HDML.diagnostics())");
out["2_json_stringify_in_page"] = {
  exception: asText.exceptionDetails?.text ?? null,
  value: asText.result?.value,
};
out["3_identical"] =
  JSON.stringify(out["1_returnByValue"].value) ===
  JSON.stringify(JSON.parse(out["2_json_stringify_in_page"].value ?? "null"));

// 4. the INTERNAL shape over the same channel — a live DOM node
//    inside the returned value.
const live = await ev(
  "(() => { const v = document.querySelector('hdml-view');" +
  " return [{ element: v, unit: v }]; })()",
  { returnByValue: true });
out["4_live_node_returnByValue"] = {
  protocolError: live.protocolError ?? null,
  exception: live.exceptionDetails?.text ?? null,
  type: live.result?.type ?? null,
};
// …and the same value stringified IN the page, for contrast.
const liveText = await ev(
  "JSON.stringify([{ element: document.querySelector('hdml-view')," +
  " unit: document.querySelector('hdml-view') }])");
out["4b_live_node_json_stringify"] = {
  protocolError: liveText.protocolError ?? null,
  exception: liveText.exceptionDetails?.text ?? null,
  value: liveText.result?.value ?? null,
};

// 5. ★ The question the row points at: how does returnByValue report
//    an ABSENT OPTIONAL vs an explicit null? Measured side by side.
const optProbe = await ev(
  "({ explicitNull: null, absentOptional: undefined," +
  "   nested: { a: null, b: undefined }," +
  "   fromGetter: Object.defineProperty({}, 'g'," +
  "     { get: () => 'computed', enumerable: true }) })",
  { returnByValue: true });
out["5_optional_vs_null"] = {
  exception: optProbe.exceptionDetails?.text ?? null,
  value: optProbe.result?.value,
  keys: Object.keys(optProbe.result?.value ?? {}),
  nestedKeys: Object.keys(optProbe.result?.value?.nested ?? {}),
};
const optText = await ev(
  "JSON.stringify({ explicitNull: null, absentOptional: undefined })");
out["5b_json_stringify_same"] = optText.result?.value;

// 6. key set of every row, as CDP delivers it.
out["6_keysets_over_cdp"] = (out["1_returnByValue"].value ?? []).map((d) =>
  Object.keys(d).sort().join(","));

// 7. depth: the projection is an array of flat objects.
out["7_depth"] = "array<object<scalar|null>> — max depth 2";

await browser.close();
srv.close();
console.log(JSON.stringify(out, null, 2));
