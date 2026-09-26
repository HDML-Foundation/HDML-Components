/**
 * probe-sentinel.mjs — measure, per registered `--hdml-*` property,
 * whether a declarative change actually schedules a frame.
 *
 * WHY THIS EXISTS. The runtime notices a declarative style change
 * with one instrument: a 1 ms CSS transition over every registered
 * property, caught by a capturing `transitionrun` listener on the
 * view (§5.6, R24). **A transition only runs on an interpolable
 * property**, so a registered property whose syntax is a keyword
 * list or `*` fires nothing and its change repaints nothing until an
 * interpolable neighbour happens to move. `ua.test.ts` asserts the
 * sentinel *lists* every registered property and never that being
 * listed works; this is the instrument that checks the second thing
 * (017 R6).
 *
 * WHAT IT MEASURES, per property, on a live page with real data:
 * whether `transitionrun` fired **and** whether a frame ran. Both,
 * never one — the sentinel firing is the mechanism, a frame running
 * is the claim. A frame is counted as an `hdml-render` event, which
 * the view dispatches once per painted frame after PAINT (§5.11).
 *
 * THE PROPERTY LIST IS READ FROM THE REGISTRY SOURCE, never typed
 * here, for the same reason `SENTINEL_PROPERTIES` is built from it:
 * a thirty-sixth registered property must not be able to become
 * silently unobserved — including from the instrument that looks.
 * Probe values are derived from each property's **syntax**, so a new
 * property in an existing syntax class needs no edit at all.
 *
 * It is a **dev instrument, not a gate**: nothing in `npm test` calls
 * it, it needs a live HDIO server, and its output is for a human to
 * read. The gate for this behaviour is the per-syntax-class sentinel
 * tests in `schedule.test.ts`.
 *
 * USAGE
 *
 *   HDIO_TENANT_TOKEN=$TT node scripts/probe-sentinel.mjs
 *   HDIO_TENANT_TOKEN=$TT PROBE_BROWSER=webkit node scripts/probe-sentinel.mjs
 *   HDIO_TENANT_TOKEN=$TT node scripts/probe-sentinel.mjs html/hdvl-live/03-bar.html
 *
 * ENVIRONMENT. `HDIO_TENANT_TOKEN`, `HDIO_HOST`, `HDIO_TENANT`,
 * `HDIO_ROLE` and `PROBE_ORIGIN` behave exactly as in
 * `render-live.mjs` — see docs/development.md. Additionally:
 *
 *   PROBE_BROWSER      chromium (default) | firefox | webkit
 *   PROBE_TIMEOUT_MS   default 30000, for the page to settle
 *   PROBE_STABLE_MS    default 750, the settle window at load
 *   PROBE_QUIESCE_MS   default 250, no-frame window between probes
 *   PROBE_WAIT_MS      default 400, how long one probe watches
 *   PROBE_LOADS        default 0. When > 0 the script does NOT sweep
 *                      the registry: it loads every page that many
 *                      times and reports the frames each one runs
 *                      from navigation to settle. That is the other
 *                      half of the measurement — `allow-discrete`
 *                      can make discrete properties transition from
 *                      their INITIAL values, and a view holds dozens
 *                      of elements each carrying 35 of them, so a
 *                      load-time frame storm is the risk the
 *                      per-change measurement cannot see.
 *
 * EXIT CODE. Non-zero if the page could not be measured at all. A
 * silent property is a finding, not an error, so it does not fail
 * the run — read the table.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, firefox, webkit } from "playwright";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));

const HOST = process.env.HDIO_HOST ?? "http://127.0.0.1:8888";
const TENANT = process.env.HDIO_TENANT ?? "tenant-a";
const ROLE = process.env.HDIO_ROLE ?? "admin";
const ORIGIN = process.env.PROBE_ORIGIN ?? "http://127.0.0.1:8000";
const TIMEOUT = Number(process.env.PROBE_TIMEOUT_MS ?? 30_000);
const STABLE_MS = Number(process.env.PROBE_STABLE_MS ?? 750);
const QUIESCE_MS = Number(process.env.PROBE_QUIESCE_MS ?? 250);
const WAIT_MS = Number(process.env.PROBE_WAIT_MS ?? 400);
const BROWSERS = { chromium, firefox, webkit };
const BROWSER = process.env.PROBE_BROWSER ?? "chromium";
const LOADS = Number(process.env.PROBE_LOADS ?? 0);
const PAGE = process.argv[2] ?? "html/hdvl-live/01-line.html";
const LIVE = "html/hdvl-live";

const TOKEN = process.env.HDIO_TENANT_TOKEN;

/**
 * The registry, read out of its own source.
 *
 * ★ Parsed, not imported: `properties.ts` is TypeScript and this
 * script is plain ESM run by node with no build step, exactly like
 * `render-live.mjs`. The shape it reads is `name:` / `syntax:` pairs
 * in declaration order, with an identifier syntax (`CURVE_TYPES`)
 * resolved against the `const` above it.
 *
 * @returns One `{ name, syntax }` per registered property.
 */
async function registry() {
  const src = await readFile(
    resolve(REPO, "src/hdvl/properties.ts"),
    "utf8",
  );
  const consts = new Map();
  const cre = /^const (\w+) =\s*([\s\S]*?);$/gm;
  for (const m of src.matchAll(cre)) {
    const joined = [...m[2].matchAll(/"([^"]*)"/g)]
      .map((s) => s[1])
      .join("");
    if (joined !== "") {
      consts.set(m[1], joined);
    }
  }
  const out = [];
  const pre = /name:\s*"([^"]+)",\s*\n\s*syntax:\s*("([^"]+)"|\w+),/g;
  for (const m of src.matchAll(pre)) {
    const raw = m[3] ?? consts.get(m[2]);
    if (raw === undefined) {
      throw new Error(`unresolved syntax for ${m[1]}: ${m[2]}`);
    }
    out.push({ name: m[1], syntax: raw });
  }
  if (out.length === 0) {
    throw new Error("parsed no properties out of properties.ts");
  }
  return out;
}

/**
 * A pair of values that differ, derived from a syntax.
 *
 * ★ A PAIR, not one value. The probe sets A, lets the page quiesce,
 * then sets B — so the measured change is A→B and is the same change
 * whatever the live page's own CSS happens to declare for that
 * property. Reading the computed value and "picking something else"
 * would make every row's change page-dependent.
 *
 * @param syntax - The registered syntax.
 * @returns `{ klass, a, b }`, or `null` when nothing is derivable.
 */
function values(syntax) {
  const s = syntax.trim();
  if (s === "*") {
    return { klass: "*", a: "alpha", b: "beta" };
  }
  if (s === "<length>") {
    return { klass: "<length>", a: "3px", b: "9px" };
  }
  if (s === "<color>") {
    return { klass: "<color>", a: "rgb(1, 2, 3)", b: "rgb(9, 8, 7)" };
  }
  if (s === "<number>") {
    return { klass: "<number>", a: "0.25", b: "0.75" };
  }
  if (s === "<angle>") {
    return { klass: "<angle>", a: "10deg", b: "50deg" };
  }
  if (s === "<length-percentage>") {
    return { klass: "<length-percentage>", a: "10%", b: "40%" };
  }
  if (s === "<color>+") {
    return {
      klass: "<color>+",
      a: "rgb(1, 2, 3) rgb(4, 5, 6)",
      b: "rgb(9, 8, 7) rgb(6, 5, 4)",
    };
  }
  // A keyword list, possibly mixed (`normal | bold | <integer>`).
  // The two branches a keyword list can take are measured
  // separately, and the discrete one is the property's own row: a
  // property that moves only when two integers are interpolated is
  // exactly as blind to `normal → bold` as a pure keyword list.
  const words = s.split("|").map((w) => w.trim());
  const keys = words.filter((w) => !w.startsWith("<"));
  if (keys.length >= 2) {
    return { klass: "keyword", a: keys[0], b: keys[1] };
  }
  return null;
}

/**
 * Supplementary probes — the rows the syntax class alone does not
 * predict, each named so it is a measurement and not a footnote.
 */
const EXTRA = [
  {
    name: "--hdml-font-weight",
    klass: "mixed → <integer>",
    a: "400",
    b: "700",
    why: "the interpolable branch of normal | bold | <integer>",
  },
  {
    name: "--hdml-palette",
    klass: "<color>+ (length change)",
    a: "rgb(1, 2, 3) rgb(4, 5, 6)",
    b: "rgb(9, 8, 7)",
    why: "list interpolation is defined only at equal lengths",
  },
  {
    name: "--hdml-color-interpolate",
    klass: "<color>+ (length change)",
    a: "rgb(1, 2, 3) rgb(4, 5, 6)",
    b: "rgb(9, 8, 7) rgb(6, 5, 4) rgb(3, 2, 1)",
    why: "list interpolation is defined only at equal lengths",
  },
];

/**
 * Mints one single-use handoff code for one page load.
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
      `POST ${url} -> ${res.status}. Is HDIO_TENANT_TOKEN fresh?`,
    );
  }
  const body = await res.json();
  if (typeof body.handoff !== "string" || body.handoff === "") {
    throw new Error(`POST ${url} returned no handoff`);
  }
  return body.handoff;
}

/**
 * Installed before any page script: counts every `hdml-render` from
 * navigation onward.
 *
 * ★ It must be an init script. `hdml-render` bubbles and is
 * composed, so one capturing document listener sees every view's
 * frames — but only the ones dispatched after it was added, and the
 * load burst this exists to measure starts before `evaluate` could
 * possibly run.
 */
const COUNTER = `
  window.__hdmlFrames = 0;
  document.addEventListener(
    "hdml-render",
    () => { window.__hdmlFrames++; },
    true,
  );
`;

/** The settle predicate — settled, never merely painted. */
const SETTLE = `(async () => {
  const views = [...document.querySelectorAll("hdml-view")];
  const svgOf = (v) => v.shadowRoot && v.shadowRoot.querySelector("svg");
  const counts = () => views.map((v) => {
    const s = svgOf(v);
    return s === null ? 0 : s.querySelectorAll("g[data-w] *").length;
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
      now.every((n) => n > 0) &&
      Date.now() - since >= ${STABLE_MS}
    ) {
      settled = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  const view = views[0];
  const cls = customElements.get("hdml-view");
  const target =
    view && (view.querySelector("hdml-cartesian-plane") ||
             view.querySelector("hdml-polar-plane") ||
             view.firstElementChild);
  return {
    settled,
    pathname: location.pathname,
    views: views.length,
    upgraded: view !== undefined && cls !== undefined &&
      view instanceof cls,
    // ★ If the fallback MutationObserver is on, EVERY inline
    // setProperty schedules a frame and every row below reads
    // "revived" for a reason that has nothing to do with the
    // sentinel. W5 turns it on; so does HDML_CONFIG.paranoidObserver.
    fallback: view !== undefined && view.observingFallback === true,
    target: target ? target.tagName.toLowerCase() : null,
    loadFrames: window.__hdmlFrames,
  };
})()`;

/**
 * One property's measurement, run inside the page.
 *
 * @param name - The custom property.
 * @param a - The before value.
 * @param b - The after value.
 * @returns `{ ran, fired, changed }` for the A→B change.
 */
function probeSource(name, a, b) {
  return `(async () => {
  const view = document.querySelector("hdml-view");
  const el = view.querySelector("hdml-cartesian-plane") ||
             view.querySelector("hdml-polar-plane") ||
             view.firstElementChild;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const quiesce = async () => {
    let n = window.__hdmlFrames;
    for (let i = 0; i < 40; i++) {
      await sleep(${QUIESCE_MS});
      if (window.__hdmlFrames === n) { return true; }
      n = window.__hdmlFrames;
    }
    return false;
  };

  el.style.setProperty(${JSON.stringify(name)}, ${JSON.stringify(a)});
  await quiesce();
  const before = getComputedStyle(el)
    .getPropertyValue(${JSON.stringify(name)}).trim();

  let fired = 0;
  const onRun = (e) => {
    if (e.propertyName === ${JSON.stringify(name)}) { fired++; }
  };
  view.addEventListener("transitionrun", onRun, true);
  const at = window.__hdmlFrames;
  el.style.setProperty(${JSON.stringify(name)}, ${JSON.stringify(b)});
  await sleep(${WAIT_MS});
  const ran = window.__hdmlFrames - at;
  view.removeEventListener("transitionrun", onRun, true);
  const after = getComputedStyle(el)
    .getPropertyValue(${JSON.stringify(name)}).trim();

  el.style.removeProperty(${JSON.stringify(name)});
  await quiesce();
  return { fired, ran, changed: before !== after, before, after };
})()`;
}

/** Strips a handoff code out of anything about to be printed. */
function redact(s) {
  return String(s).replace(/handoff=[^&\s"']+/g, "handoff=<redacted>");
}

/**
 * Loads one page once and returns the frames it ran to settle.
 *
 * @param ctx - The browser context (it carries the init counter).
 * @param path - Repo-relative page path.
 * @returns `{ frames, views }`, or `null` if the page did not settle.
 */
async function loadOnce(ctx, path) {
  const tab = await ctx.newPage();
  try {
    const code = await handoff();
    await tab.goto(`${ORIGIN}/${path}?handoff=${code}`, {
      waitUntil: "load",
      timeout: TIMEOUT,
    });
    const g = await tab.evaluate(SETTLE);
    if (g.pathname !== `/${path}` || !g.upgraded || !g.settled) {
      return null;
    }
    return { frames: g.loadFrames, views: g.views };
  } finally {
    await tab.close();
  }
}

/**
 * The load-time frame count, every live page, {@link LOADS} times.
 *
 * @param ctx - The browser context.
 */
async function loadSweep(ctx) {
  const argv = process.argv.slice(2);
  const paths =
    argv.length > 0
      ? argv
      : (await readdir(join(REPO, LIVE)))
          .filter((n) => n.endsWith(".html"))
          .sort()
          .map((n) => `${LIVE}/${n}`);

  console.log(
    `\n${BROWSER} · frames from navigation to settle · ` +
      `${LOADS} load(s) per page\n`,
  );
  console.log("| page | views | frames |");
  console.log("|---|---|---|");
  let totalViews = 0;
  let totalFrames = 0;
  for (const p of paths) {
    const runs = [];
    let views = 0;
    for (let i = 0; i < LOADS; i++) {
      const r = await loadOnce(ctx, p);
      if (r === null) {
        runs.push("—");
        continue;
      }
      views = r.views;
      runs.push(r.frames);
      totalFrames += r.frames;
    }
    totalViews += views;
    console.log(`| ${p.replace(`${LIVE}/`, "")} | ${views} | ` +
      `${runs.join(", ")} |`);
  }
  console.log(
    `\n${paths.length} page(s), ${totalViews} view(s) · ` +
      `${totalFrames} frames over ${LOADS} load(s) each · ` +
      `${(totalFrames / (totalViews * LOADS)).toFixed(2)} per view`,
  );
}

async function main() {
  if (TOKEN === undefined || TOKEN === "") {
    console.error(
      "HDIO_TENANT_TOKEN is not set. See docs/development.md " +
        "§ The live-render harness for the three-call recipe.",
    );
    process.exitCode = 2;
    return;
  }
  if (!(BROWSER in BROWSERS)) {
    console.error(`PROBE_BROWSER=${BROWSER} — chromium|firefox|webkit`);
    process.exitCode = 2;
    return;
  }

  const props = await registry();
  const browser = await BROWSERS[BROWSER].launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await ctx.addInitScript(COUNTER);

  if (LOADS > 0) {
    await loadSweep(ctx);
    await browser.close();
    return;
  }

  const tab = await ctx.newPage();
  const errors = [];
  tab.on("pageerror", (e) => errors.push(String(e)));

  const want = `/${PAGE}`;
  const code = await handoff();
  await tab.goto(`${ORIGIN}${want}?handoff=${code}`, {
    waitUntil: "load",
    timeout: TIMEOUT,
  });
  const guard = await tab.evaluate(SETTLE);

  // ── THE GUARD. Nothing below is believed before this passes. ──
  // A page that lost its handoff navigates to a login and reports,
  // cleanly and plausibly, that all 35 properties are broken. It has
  // happened once already (017 step 01).
  const bad = [];
  if (guard.pathname !== want) {
    bad.push(`NAVIGATED AWAY: at ${guard.pathname}, wanted ${want}`);
  }
  if (guard.views === 0) {
    bad.push("no <hdml-view> in the document");
  }
  if (!guard.upgraded) {
    bad.push("<hdml-view> did not upgrade — run `npm run compile_bin`");
  }
  if (!guard.settled) {
    bad.push(`never settled after ${TIMEOUT} ms — no data reached it`);
  }
  if (guard.fallback) {
    bad.push(
      "the MutationObserver FALLBACK is on for this view — every " +
        "inline change would schedule a frame and every row below " +
        "would be meaningless",
    );
  }
  if (bad.length > 0) {
    console.error(`\n✗ ${PAGE} (${BROWSER})`);
    for (const r of bad) {
      console.error(`    ${redact(r)}`);
    }
    await browser.close();
    process.exitCode = 1;
    return;
  }

  const support = await tab.evaluate(
    `CSS.supports("transition-behavior", "allow-discrete")`,
  );

  console.log(
    `\n${BROWSER} · ${PAGE} · target <${guard.target}> · ` +
      `allow-discrete supported: ${support} · ` +
      `frames at load: ${guard.loadFrames} (${guard.views} view(s))`,
  );
  console.log(
    "\n| # | property | syntax class | `transitionrun` | frames |",
  );
  console.log("|---|---|---|---|---|");

  let i = 0;
  let silent = 0;
  const rows = [];
  for (const p of props) {
    const v = values(p.syntax);
    i++;
    if (v === null) {
      console.log(`| ${i} | \`${p.name}\` | ${p.syntax} | — | NO PROBE |`);
      continue;
    }
    const r = await tab.evaluate(probeSource(p.name, v.a, v.b));
    if (!r.changed) {
      throw new Error(
        `${p.name}: ${v.a} -> ${v.b} did not change the computed ` +
          `value (${r.before} -> ${r.after}); the probe pair is wrong`,
      );
    }
    if (r.ran === 0) {
      silent++;
    }
    rows.push({ name: p.name, klass: v.klass, ...r });
    console.log(
      `| ${i} | \`${p.name}\` | \`${v.klass}\` | ` +
        `${r.fired > 0 ? `**fires** (${r.fired})` : "silent"} | ` +
        `${r.ran === 0 ? "**0**" : r.ran} |`,
    );
  }

  console.log("\nSupplementary probes:\n");
  console.log("| property | probe | `transitionrun` | frames | why |");
  console.log("|---|---|---|---|---|");
  for (const e of EXTRA) {
    const r = await tab.evaluate(probeSource(e.name, e.a, e.b));
    console.log(
      `| \`${e.name}\` | ${e.klass} | ` +
        `${r.fired > 0 ? `**fires** (${r.fired})` : "silent"} | ` +
        `${r.ran === 0 ? "**0**" : r.ran} | ${e.why} |`,
    );
  }

  console.log(
    `\n${props.length} registered · ${props.length - silent} schedule ` +
      `a frame · ${silent} SILENT`,
  );
  for (const e of errors) {
    console.log(`  ! page: ${redact(e)}`);
  }

  await browser.close();
}

main().catch((e) => {
  console.error(redact(e && e.stack ? e.stack : e));
  process.exitCode = 1;
});
