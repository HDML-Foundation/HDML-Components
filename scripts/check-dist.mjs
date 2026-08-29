/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

// The build assertion behind RFC 016/001 R39 and the §2.1 edge
// invariant. Nothing in `.testrc.js` can express these: wtr runs
// `./tst/**/*.test.js` in a browser and never sees `package.json`,
// the emitted trees, or the source graph.
//
// Everything below derives from ONE array, `ENTRIES`. That is the
// whole point of R39: a new entry point cannot silently skip its
// side-effect declaration, because the declaration is generated, not
// hand-written.
//
// Checks 3 and 4 read the emitted trees, so this must run AFTER
// `compile_all` — which is where it sits in the `build` chain.

import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";
import * as esbuild from "esbuild";
import {
  CONNECTIVE_ATTRS_LIST,
  CONN_ATTRS_LIST,
  FIELD_ATTRS_LIST,
  FILTER_ATTRS_LIST,
  FRAME_ATTRS_LIST,
  HDML_TAG_NAMES,
  JOIN_ATTRS_LIST,
  MODEL_ATTRS_LIST,
  TABLE_ATTRS_LIST,
} from "@hdml/types";
// The eight data enums above are named because check 7's map is
// deliberately explicit. The display half is the opposite case: check
// 8 looks a vocabulary up **by derived name** (`${key}_ATTRS_LIST`),
// which no named import can express — that is what makes a
// twenty-second display tag unable to enter without either an enum or
// a stated exemption.
import * as HDML_TYPES from "@hdml/types";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** The published entry points. The single source for both lists. */
const ENTRIES = [
  { subpath: ".", dir: "" },
  { subpath: "./hdio", dir: "hdio/" },
  { subpath: "./hdql", dir: "hdql/" },
  { subpath: "./hdvl", dir: "hdvl/" },
];

/**
 * ★ RFC §9.5's bundle budget — **the only place a ceiling is
 * written**, and re-baselined at step 35 with the user (option C).
 *
 * Values are kilobytes (1024 B), minified and gzip-9, and the rule
 * that produced every one of them is stated so a reader can
 * recompute it: **ceiling = measured × 1.05, rounded up to the whole
 * kB.** Five per cent absorbs a widget; it does not absorb a
 * dependency, which is the only regression this check exists to
 * catch.
 *
 * The RFC's original `./hdvl` ceiling was **120 / 40** and the entry
 * measures **409.2 / 116.2**. Both halves of that gap were measured
 * at step 35 rather than assumed:
 *
 * 1. `apache-arrow` is **194.6 kB, 47.6 %** of it, and no line of
 *    `src/hdvl/` renders with it. The path is `uid()` →
 *    `@hdml/hash` → `@hdml/common`, whose `index.js` is a
 *    `globalThis` barrel that unconditionally does
 *    `import * as arrow from "apache-arrow"`. This is check 6's leak
 *    class arriving through a package boundary instead of a relative
 *    path.
 * 2. **Removing it would not have been enough.** Measured with
 *    `@hdml/hash` stubbed out, `./hdvl` is **194.4 / 62.2** — still
 *    1.62× the ceiling, because §9.5's own component estimate
 *    under-counted the local source (108.4 kB against a budgeted 60)
 *    and `temporal-polyfill` (54.6 kB against 40).
 *
 * And the decisive measurement: a consumer importing **both** `.`
 * and `./hdvl` bundles **949.2 kB / 270.1 kB either way, byte for
 * byte**, because `src/hdio/decode.ts` imports `arrow` deliberately
 * — it decodes Arrow IPC. So the leak costs a full-package consumer
 * *nothing*, and costs a `./hdvl`-alone consumer everything. That
 * consumer shape is coherent (HDVL binds only through `document`
 * events, and `HdmlConfig` is documented as shared with a separate
 * consumer repo) but is not one this project targets, so the
 * ceilings below are a **regression guard rather than a target**.
 * Detail in `docs/integration.md` and `docs/decisions.md`.
 */
const BUDGET = {
  ".": { min: 825, gzip: 228 },
  "./hdio": { min: 819, gzip: 227 },
  "./hdql": { min: 38, gzip: 11 },
  "./hdvl": { min: 430, gzip: 123 },
};

/** The IIFE artifact's own ceiling, same rule, same units. */
const IIFE = { file: "bin/index.min.js", min: 1264, gzip: 345 };

/** The generated custom-elements manifest (`package.json` names it). */
const MANIFEST = "custom-elements.json";

/**
 * Display tags exempt from check 8's attribute comparison, with the
 * reason. `hdml-fallback` publishes **no** attributes and so has no
 * `*_ATTRS_LIST` in `@hdml/types` (§9.6 says twenty enums for
 * twenty-one tags). Listing it here rather than treating a missing
 * enum as "expect none" is what stops a twenty-second tag from
 * passing silently because nobody wrote its vocabulary.
 */
const NO_ATTRS_LIST = new Set(["FALLBACK"]);

/**
 * `hdml-split-by` is in the published `HDML_TAG_NAMES` and **no
 * module registers it** — `src/hdql/` has eleven elements, not
 * twelve, and `src/index.ts` imports eleven. Found at step 35 by
 * check 8. It is a **pre-016 gap in the data half**, out of this
 * project's scope, and `html/hdml/index.html` writes the tag twice
 * where it is inert. Named here rather than skipped, so the day an
 * element lands the constant empties and the check tightens by
 * itself.
 */
const UNREGISTERED_TAGS = new Set([HDML_TAG_NAMES.SPLIT_BY]);

/**
 * `src/hdvl/` may import exactly two `../hdio/` modules: `config`
 * as a value, `delivery` as a TYPE ONLY. A non-`type` import of
 * `Delivery` pulls the worker, `@hdml/parser` and Arrow into every
 * chart page and compiles silently — this is the guard for that.
 * `delivery.ts` does not exist until step 06; the guard is landed
 * ahead of its first importer on purpose.
 */
const HDIO_EDGE = { config: "value", delivery: "type" };

const failures = [];

function fail(check, message) {
  failures.push(`[${check}] ${message}`);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf-8");
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function derivedExports() {
  const map = {};
  for (const { subpath, dir } of ENTRIES) {
    map[subpath] = {
      types: `./dts/${dir}index.d.ts`,
      import: `./esm/${dir}index.js`,
      require: `./cjs/${dir}index.js`,
    };
  }
  return map;
}

// `sideEffects` is a WHITELIST, not a hint: every file NOT matched is
// asserted pure, and a bundler drops bare imports of it. The
// registration lives in the element module, not in the entry that
// imports it — so listing only the four entry files strips every
// `customElements.define` (measured at step 05: the IIFE bundle fell
// from 1 058 169 bytes to 136). Each entry therefore contributes a
// per-directory glob, still one pair per entry per format.
function derivedSideEffects() {
  const list = [];
  for (const { dir } of ENTRIES) {
    const leaf = dir === "" ? "index.js" : `${dir}*.js`;
    list.push(`./esm/${leaf}`);
    list.push(`./cjs/${leaf}`);
  }
  return list;
}

/** Minimal `*`-in-one-segment glob match, as bundlers apply it. */
function globMatches(pattern, target) {
  const re = new RegExp(
    "^" +
      pattern
        .split("*")
        .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^/]*") +
      "$",
  );
  return re.test(target);
}

/** Every module specifier a source file imports or re-exports. */
function specifiersOf(rel) {
  const re =
    /(?:^|\n)\s*(?:import|export)\b[^\n;]*?["']([^"']+)["']/g;
  const out = [];
  let m;
  while ((m = re.exec(read(rel))) !== null) {
    out.push(m[1]);
  }
  return out;
}

function tsFilesUnder(rel) {
  const dir = path.join(root, rel);
  if (!fs.existsSync(dir)) {
    return [];
  }
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) {
      out.push(...tsFilesUnder(path.join(rel, name)));
    } else if (name.endsWith(".ts")) {
      out.push(path.join(rel, name));
    }
  }
  return out;
}

const pkg = JSON.parse(read("package.json"));

// ---------------------------------------------------------------
// 1. `exports` is exactly the derived map.
// ---------------------------------------------------------------
const wantExports = derivedExports();
const gotExports = pkg.exports ?? {};
for (const subpath of Object.keys(wantExports)) {
  const want = wantExports[subpath];
  const got = gotExports[subpath];
  if (!got) {
    fail("exports", `missing entry "${subpath}"`);
    continue;
  }
  for (const cond of ["types", "import", "require"]) {
    if (got[cond] !== want[cond]) {
      fail(
        "exports",
        `"${subpath}"."${cond}" is ${JSON.stringify(got[cond])}, ` +
          `derived value is ${JSON.stringify(want[cond])}`,
      );
    }
  }
  for (const cond of Object.keys(got)) {
    if (!["types", "import", "require"].includes(cond)) {
      fail("exports", `"${subpath}" has extra condition "${cond}"`);
    }
  }
}
for (const subpath of Object.keys(gotExports)) {
  if (!(subpath in wantExports)) {
    fail("exports", `undeclared entry "${subpath}" (not in ENTRIES)`);
  }
}

// ---------------------------------------------------------------
// 2. `sideEffects` is exactly the derived eight-path list — BOTH
//    module formats for EVERY entry (R39's actual clause).
// ---------------------------------------------------------------
const wantSide = derivedSideEffects();
const gotSide = Array.isArray(pkg.sideEffects) ? pkg.sideEffects : null;
if (gotSide === null) {
  fail(
    "sideEffects",
    "package.json has no `sideEffects` array; expected " +
      `${wantSide.length} paths`,
  );
} else {
  for (const p of wantSide) {
    if (!gotSide.includes(p)) {
      fail("sideEffects", `missing path "${p}"`);
    }
  }
  for (const p of gotSide) {
    if (!wantSide.includes(p)) {
      fail("sideEffects", `undeclared path "${p}" (not in ENTRIES)`);
    }
  }
  if (gotSide.length !== wantSide.length) {
    fail(
      "sideEffects",
      `has ${gotSide.length} paths, derived list has ` +
        `${wantSide.length}`,
    );
  }
}

// ---------------------------------------------------------------
// 3. Every path named in `exports` exists on disk after a build.
// ---------------------------------------------------------------
for (const subpath of Object.keys(wantExports)) {
  for (const target of Object.values(wantExports[subpath])) {
    if (!exists(target)) {
      fail(
        "dist",
        `"${subpath}" names ${target}, which does not exist ` +
          "(run `npm run compile_all` first)",
      );
    }
  }
}

// ---------------------------------------------------------------
// 4. Every `exports` module target is declared side-effectful.
// ---------------------------------------------------------------
if (gotSide !== null) {
  for (const subpath of Object.keys(gotExports)) {
    const entry = gotExports[subpath];
    for (const cond of ["import", "require"]) {
      const target = entry?.[cond];
      const covered =
        target !== undefined &&
        gotSide.some((p) => globMatches(p, target));
      if (target && !covered) {
        fail(
          "sideEffects",
          `"${subpath}"."${cond}" target ${target} is absent from ` +
            "`sideEffects`; a bundler would strip its registrations",
        );
      }
    }
  }
}

// ---------------------------------------------------------------
// 5. R11 drift guard — `src/index.ts` imports exactly the union of
//    the `hdio` and `hdql` sub-entries. This is what makes the
//    deliberate duplication in those three files safe.
// ---------------------------------------------------------------
const rootImports = specifiersOf("src/index.ts");
const subImports = [];
for (const { dir } of ENTRIES) {
  if (dir === "" || dir === "hdvl/") {
    continue;
  }
  for (const spec of specifiersOf(`src/${dir}index.ts`)) {
    subImports.push(spec.replace(/^\.\//, `./${dir}`));
  }
}
const rootSet = new Set(rootImports);
const subSet = new Set(subImports);
for (const spec of subSet) {
  if (!rootSet.has(spec)) {
    fail(
      "R11",
      `sub-entry imports "${spec}", which src/index.ts does not; ` +
        "the root surface has drifted",
    );
  }
}
for (const spec of rootSet) {
  if (!subSet.has(spec)) {
    fail(
      "R11",
      `src/index.ts imports "${spec}", which no sub-entry does; ` +
        "the root surface has drifted",
    );
  }
}

// ---------------------------------------------------------------
// 6. The §2.1 edge invariant.
// ---------------------------------------------------------------
for (const file of tsFilesUnder("src/hdvl")) {
  // The clause may contain neither `from` NOR `;`, so the match
  // cannot run backwards over a PRECEDING import. Without the
  // lookahead the non-greedy `[\s\S]*?` swallows every earlier
  // import statement in the file, and a perfectly correct
  // `import type { Delivery }` is reported as a value import unless
  // it happens to be the first import in the module (measured at
  // step 13). The `;` half is step 29's: a SIDE-EFFECT import
  // (`import "./index";`) carries no `from` at all, so the `from`
  // lookahead alone still let the match start there and swallow it.
  const re =
    /(?:^|\n)\s*import\s+((?:(?!\bfrom\b|;)[\s\S])*?)from\s+["']\.\.\/hdio\/([^"']+)["']/g;
  const source = read(file);
  let m;
  while ((m = re.exec(source)) !== null) {
    const clause = m[1].trim();
    const mod = m[2].replace(/\.js$/, "");
    const kind = HDIO_EDGE[mod];
    if (!kind) {
      fail(
        "§2.1",
        `${file} imports ../hdio/${mod}; HDVL may import only ` +
          `${Object.keys(HDIO_EDGE).join(" and ")}`,
      );
      continue;
    }
    const named = clause.match(/\{([\s\S]*)\}/);
    const typeOnly =
      /^type\b/.test(clause) ||
      (named !== null &&
        named[1]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .every((s) => /^type\s/.test(s)));
    if (kind === "type" && !typeOnly) {
      fail(
        "§2.1",
        `${file} imports ../hdio/${mod} as a VALUE; it must be ` +
          "type-only, or the worker, @hdml/parser and Arrow are " +
          "pulled into every chart page",
      );
    }
  }
}

// ---------------------------------------------------------------
// 7. V11 and V12 over the CORPUS PAGE SOURCE (SPEC §11, RFC §10.2).
//
// Both rules are **not runtime-applicable** (R23), and neither is
// a matter of opinion about it:
//
//   V11 — "data elements use their real, current grammar". A data
//   element is inert in the display half; nothing under
//   `src/hdvl/` ever reads one, so no runtime check could exist.
//
//   V12 — "only registered `--hdml-*` properties appear in page
//   CSS". An unregistered custom property is perfectly legal to
//   the platform and simply never reaches an element, so it is
//   invisible from inside the element too.
//
// They are therefore enforced HERE, over the thirteen committed
// acceptance pages, which is the only place either rule has a
// subject. Landed at step 34.
// ---------------------------------------------------------------

/** The corpus pages, in name order. */
const CORPUS_DIR = "html/hdvl";

/** Global HTML attributes any element may carry. */
const GLOBAL_ATTRS = [
  "class",
  "id",
  "style",
  "hidden",
  "slot",
  "title",
  "lang",
  "dir",
  "role",
];

/** The data tags, and the attribute vocabulary each publishes. */
const DATA_ATTRS = {
  [HDML_TAG_NAMES.CONNECTION]: CONN_ATTRS_LIST,
  [HDML_TAG_NAMES.MODEL]: MODEL_ATTRS_LIST,
  [HDML_TAG_NAMES.TABLE]: TABLE_ATTRS_LIST,
  [HDML_TAG_NAMES.JOIN]: JOIN_ATTRS_LIST,
  [HDML_TAG_NAMES.CONNECTIVE]: CONNECTIVE_ATTRS_LIST,
  [HDML_TAG_NAMES.FILTER]: FILTER_ATTRS_LIST,
  [HDML_TAG_NAMES.FRAME]: FRAME_ATTRS_LIST,
  [HDML_TAG_NAMES.FIELD]: FIELD_ATTRS_LIST,
  // The three "by" containers publish no attributes at all — they
  // are pure grouping elements, which is itself part of V11's
  // grammar and is asserted by the empty list rather than by
  // leaving them out of the map.
  [HDML_TAG_NAMES.FILTER_BY]: {},
  [HDML_TAG_NAMES.GROUP_BY]: {},
  [HDML_TAG_NAMES.SPLIT_BY]: {},
  [HDML_TAG_NAMES.SORT_BY]: {},
};

/** Every tag name this package may legally register or serve. */
const KNOWN_TAGS = new Set([
  ...Object.values(HDML_TAG_NAMES),
  // Neither a data nor a display tag: `HDML_TAG_NAMES` has no `IO`
  // member, exactly as `@customElement("hdml-io")` is a literal.
  "hdml-io",
]);

/**
 * Every `hdml-*` start tag in a document, with its attributes.
 *
 * A regex over `<hdml-…>` cannot be used directly: a `clause`
 * attribute is free SQL and may hold a `>`. This walks the text and
 * respects quoting, which is enough for hand-written pages and adds
 * no dependency.
 */
function hdmlTags(source) {
  const out = [];
  const re = /<(hdml-[a-z-]+)/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    let i = re.lastIndex;
    let quote = null;
    while (i < source.length) {
      const c = source[i];
      if (quote !== null) {
        if (c === quote) {
          quote = null;
        }
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === ">") {
        break;
      }
      i++;
    }
    const attrs = {};
    const body = source.slice(re.lastIndex, i);
    const ar = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'))?/g;
    let a;
    while ((a = ar.exec(body)) !== null) {
      if (a[0].trim() === "") {
        continue;
      }
      attrs[a[1]] = a[3] ?? a[4] ?? "";
    }
    out.push({ tag: m[1], attrs, end: i });
  }
  return out;
}

/** Every `<style>` body in a document, CSS comments stripped. */
function styleText(source) {
  let css = "";
  const re = /<style[^>]*>([\s\S]*?)<\/style>/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    css += m[1].replace(/\/\*[\s\S]*?\*\//g, " ");
  }
  // Inline `style="…"` is page CSS too, and V12 says "page CSS".
  const inline = /\sstyle\s*=\s*"([^"]*)"/g;
  while ((m = inline.exec(source)) !== null) {
    css += `\n${m[1]}`;
  }
  return css;
}

/**
 * SPEC §9's registry, read off `src/hdvl/properties.ts`.
 *
 * The registry itself, never a second list: a property added there
 * is usable in a page the moment it lands, and one removed fails
 * every page still writing it.
 */
function registeredProperties() {
  const src = read("src/hdvl/properties.ts");
  const out = new Set();
  const re = /name:\s*"(--hdml-[a-zA-Z0-9_-]+)"/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    out.add(m[1]);
  }
  return out;
}

const REGISTERED = registeredProperties();
if (REGISTERED.size === 0) {
  fail("V12", "src/hdvl/properties.ts registers no --hdml-* names");
}

const pages = fs.existsSync(path.join(root, CORPUS_DIR))
  ? fs
      .readdirSync(path.join(root, CORPUS_DIR))
      .filter((n) => n.endsWith(".html"))
      .sort()
  : [];
if (pages.length === 0) {
  fail("V11", `${CORPUS_DIR} serves no pages`);
}

for (const name of pages) {
  const rel = `${CORPUS_DIR}/${name}`;
  const source = read(rel);

  // --- V11 -----------------------------------------------------
  for (const { tag, attrs } of hdmlTags(source)) {
    if (!KNOWN_TAGS.has(tag)) {
      fail(
        "V11",
        `${rel} writes <${tag}>, which is not an HDML element; ` +
          "the vocabulary is @hdml/types' HDML_TAG_NAMES",
      );
      continue;
    }
    const vocabulary = DATA_ATTRS[tag];
    if (vocabulary === undefined) {
      // A display tag. V11's subject is the data half; an
      // unrecognised attribute on a display element is W1's, and
      // W1 is a runtime warning.
      continue;
    }
    const allowed = new Set([
      ...Object.values(vocabulary),
      ...GLOBAL_ATTRS,
    ]);
    for (const attr of Object.keys(attrs)) {
      if (attr.startsWith("aria-") || attr.startsWith("data-")) {
        continue;
      }
      if (!allowed.has(attr)) {
        fail(
          "V11",
          `${rel}: <${tag} ${attr}="…"> — ${tag} publishes ` +
            `${Object.values(vocabulary).join(", ") || "no"} ` +
            "attributes",
        );
      }
    }
  }

  // A **model**-sourced frame reads its parent's fields by the
  // `{table}_{field}` compound; a **frame**-sourced one reads bare
  // names. The systematic bug the first verification pass found
  // was exactly this distinction collapsed — every model-sourced
  // frame used bare parent column names — so the corpus README's
  // Mechanical verification log records it and this guards it.
  const frames = source.matchAll(
    /<hdml-frame\b([\s\S]*?)>([\s\S]*?)<\/hdml-frame>/g,
  );
  for (const frame of frames) {
    const head = frame[1];
    const src = /source\s*=\s*"([^"]*)"/.exec(head);
    if (src === null || !/\?hdml-model=/.test(src[1])) {
      continue;
    }
    const compound = /\s(origin|field)\s*=\s*"([^"]*)"/g;
    let ref;
    while ((ref = compound.exec(frame[2])) !== null) {
      if (!ref[2].includes("_")) {
        fail(
          "V11",
          `${rel}: ${ref[1]}="${ref[2]}" in a model-sourced ` +
            "frame — a parent field surfaces as {table}_{field}",
        );
      }
    }
  }

  // --- V12 -----------------------------------------------------
  const css = styleText(source);
  const used = new Set(
    [...css.matchAll(/--hdml-[a-zA-Z0-9_-]+/g)].map((m) => m[0]),
  );
  for (const property of [...used].sort()) {
    if (!REGISTERED.has(property)) {
      fail(
        "V12",
        `${rel} writes ${property}, which SPEC §9 does not ` +
          "register (src/hdvl/properties.ts)",
      );
    }
  }
}

// ---------------------------------------------------------------
// 8. The custom-elements manifest is COMPLETE (RFC §9.3).
//
// `package.json` declares `"customElements": "custom-elements.json"`
// — a published contract that, until step 35, pointed at a file that
// did not exist in the repo at all. `npm run manifest` now runs
// inside `build`, immediately before this check, so what is asserted
// is always what the build just produced.
//
// Everything below is derived. The display tags come from
// `src/hdvl/vocabulary.ts`'s own `HDVL_TAG_NAMES` block, the root
// registrations from `src/index.ts`'s import list, and each display
// tag's attribute vocabulary from `@hdml/types` **by derived name**.
// A twenty-second display tag therefore cannot be added without a
// manifest entry AND an attribute enum (or a stated exemption).
// ---------------------------------------------------------------

/** The display tag KEYS, read off `vocabulary.ts`'s own block. */
function displayTagKeys() {
  const src = read("src/hdvl/vocabulary.ts");
  const block = /HDVL_TAG_NAMES\s*=\s*\{([\s\S]*?)\n\}/.exec(src);
  if (block === null) {
    fail("CEM", "src/hdvl/vocabulary.ts has no HDVL_TAG_NAMES block");
    return [];
  }
  const re = /^\s*([A-Z_]+):\s*HDML_TAG_NAMES\.([A-Z_]+),/gm;
  const out = [];
  let m;
  while ((m = re.exec(block[1])) !== null) {
    out.push(m[2]);
  }
  return out;
}

let manifestTags = new Map();
const DISPLAY_KEYS = displayTagKeys();

if (!exists(MANIFEST)) {
  fail(
    "CEM",
    `package.json declares "customElements": "${MANIFEST}", which ` +
      "does not exist (run `npm run manifest`)",
  );
} else {
  const manifest = JSON.parse(read(MANIFEST));
  const modules = manifest.modules ?? [];

  for (const mod of modules) {
    for (const decl of mod.declarations ?? []) {
      if (decl.tagName) {
        manifestTags.set(decl.tagName, {
          path: mod.path,
          attrs: (decl.attributes ?? [])
            .map((a) => a.name)
            .filter(Boolean)
            .sort(),
        });
      }
    }
  }

  // (a0) The module list is sorted by path. `cem analyze` emits
  //      filesystem-traversal order, which is not stable between
  //      runs — three consecutive runs over an unchanged `src/` gave
  //      three different orders — so a COMMITTED manifest would show
  //      as modified after every build and hide a real drift in the
  //      noise. `scripts/normalize-manifest.mjs` sorts it; this is
  //      what fails if that step is skipped or the file hand-edited.
  const order = modules.map((m) => m.path);
  const sorted = [...order].sort();
  for (let i = 0; i < order.length; i++) {
    if (order[i] !== sorted[i]) {
      fail(
        "CEM",
        `${MANIFEST} is not sorted by path (${order[i]} where ` +
          `${sorted[i]} belongs); run \`npm run manifest\``,
      );
      break;
    }
  }

  // (a) The analyzer globs ALL of `src/`, so the exclusions are the
  //     only thing keeping non-elements out. `src/testing/`'s
  //     `binder.ts` and `probe.ts` name their tag through a
  //     CONSTANT, which the analyzer cannot resolve — before step 35
  //     the manifest published two elements called `BINDER_TAG` and
  //     `PROBE_TAG`. `FakeIo` is deliberately not a custom element.
  for (const mod of modules) {
    if (
      mod.path.startsWith("src/testing/") ||
      mod.path.endsWith(".test.ts") ||
      mod.path === "src/index.ts" ||
      mod.path === "src/bundle.ts"
    ) {
      fail(
        "CEM",
        `${mod.path} is in the manifest; package.json's \`manifest\` ` +
          "script must exclude it",
      );
    }
  }
  for (const [tag, { path: where }] of manifestTags) {
    if (!KNOWN_TAGS.has(tag)) {
      fail(
        "CEM",
        `the manifest declares <${tag}> (${where}), which is not an ` +
          "HDML element — the analyzer could not resolve its tag name",
      );
    }
  }

  // (b) Every display tag is present, with its attributes.
  for (const key of DISPLAY_KEYS) {
    const tag = HDML_TAG_NAMES[key];
    const got = manifestTags.get(tag);
    if (got === undefined) {
      fail("CEM", `<${tag}> is registered but has no manifest entry`);
      continue;
    }
    const list = HDML_TYPES[`${key}_ATTRS_LIST`];
    if (list === undefined) {
      if (!NO_ATTRS_LIST.has(key)) {
        fail(
          "CEM",
          `<${tag}> has no ${key}_ATTRS_LIST in @hdml/types and is ` +
            "not a stated no-attribute tag",
        );
      }
      if (got.attrs.length > 0) {
        fail(
          "CEM",
          `<${tag}> publishes no attributes, but the manifest lists ` +
            `${got.attrs.join(", ")}`,
        );
      }
      continue;
    }
    const want = Object.values(list).sort();
    for (const attr of want) {
      if (!got.attrs.includes(attr)) {
        fail(
          "CEM",
          `<${tag}> publishes ${attr}, which its manifest entry ` +
            "omits — the class JSDoc @attribute block has drifted " +
            `from ${key}_ATTRS_LIST`,
        );
      }
    }
    for (const attr of got.attrs) {
      if (!want.includes(attr)) {
        fail(
          "CEM",
          `the manifest gives <${tag}> an attribute ${attr}, which ` +
            `${key}_ATTRS_LIST does not publish`,
        );
      }
    }
  }

  // (c) Every module the ROOT entry registers has an entry too —
  //     derived from `src/index.ts`, so it is the twelve the `.`
  //     entry actually imports rather than a count.
  const declared = new Set([...manifestTags.values()].map((v) => v.path));
  for (const spec of rootImports) {
    const target = `src/${spec.replace(/^\.\//, "")}.ts`;
    if (!declared.has(target)) {
      fail(
        "CEM",
        `src/index.ts registers ${spec}, but ${target} declares no ` +
          "custom element in the manifest",
      );
    }
  }

  // (d) And the vocabulary as a whole: a published tag with no
  //     element is either a gap or a lie. `UNREGISTERED_TAGS` holds
  //     the one that is a known gap.
  for (const tag of Object.values(HDML_TAG_NAMES)) {
    if (!manifestTags.has(tag) && !UNREGISTERED_TAGS.has(tag)) {
      fail(
        "CEM",
        `HDML_TAG_NAMES publishes <${tag}>, which no module in this ` +
          "package registers",
      );
    }
  }
}

// ---------------------------------------------------------------
// 9. The bundle budget (RFC §9.5) — "checked in Slice I as a build
//    assertion, not a review habit".
//
// Each entry is bundled the way a consumer's bundler would: esbuild,
// `--bundle --minify --format=esm`, no plugins. For `.` and `./hdio`
// that legitimately includes the whole `@hdml/parser` graph, because
// the checked-in `endpoint.ts` is the same-thread `MessageChannel`
// form and only the IIFE build swaps in the `Worker`-spawning one —
// so the number IS what an ESM consumer pays.
// ---------------------------------------------------------------

const sizes = [];

function measure(label, bytes, ceiling) {
  const gz = zlib.gzipSync(bytes, { level: 9 });
  const min = bytes.length / 1024;
  const gzip = gz.length / 1024;
  sizes.push({ label, min, gzip, ceiling });
  if (min > ceiling.min) {
    fail(
      "budget",
      `${label} is ${min.toFixed(1)} kB minified, over its ` +
        `${ceiling.min} kB ceiling (RFC §9.5)`,
    );
  }
  if (gzip > ceiling.gzip) {
    fail(
      "budget",
      `${label} is ${gzip.toFixed(1)} kB gzipped, over its ` +
        `${ceiling.gzip} kB ceiling (RFC §9.5)`,
    );
  }
}

for (const { subpath, dir } of ENTRIES) {
  const entry = `esm/${dir}index.js`;
  if (!exists(entry)) {
    fail("budget", `${entry} does not exist (run \`compile_all\`)`);
    continue;
  }
  const built = esbuild.buildSync({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    minify: true,
    format: "esm",
    write: false,
    outfile: "out.js",
    logLevel: "silent",
  });
  measure(subpath, built.outputFiles[0].contents, BUDGET[subpath]);
}

if (exists(IIFE.file)) {
  measure(IIFE.file, fs.readFileSync(path.join(root, IIFE.file)), IIFE);
} else {
  fail("budget", `${IIFE.file} does not exist (run \`compile_bin\`)`);
}

// ---------------------------------------------------------------

for (const s of sizes) {
  console.log(
    `  ${s.label.padEnd(18)} ${s.min.toFixed(1).padStart(7)} kB min ` +
      `(${String(s.ceiling.min).padStart(4)})  ` +
      `${s.gzip.toFixed(1).padStart(6)} kB gzip ` +
      `(${String(s.ceiling.gzip).padStart(3)})`,
  );
}

if (failures.length > 0) {
  console.error("check-dist FAILED:");
  for (const f of failures) {
    console.error(`  ${f}`);
  }
  process.exit(1);
}

// The summary line is quoted verbatim in every landed step note
// from 05 on, so it is extended DELIBERATELY and only once per step:
// step 34 added the two source-time V-rules, and step 35 adds the
// manifest tag count and the budget. A note comparing against an
// older quote should read the difference as this line growing a
// clause rather than as a check having changed.
console.log(
  `check-dist OK — ${ENTRIES.length} entries, ` +
    `${derivedSideEffects().length} sideEffects paths, ` +
    `${rootSet.size} root registrations, ` +
    `${pages.length} corpus pages (V11, V12), ` +
    `${manifestTags.size} manifest tags ` +
    `(${DISPLAY_KEYS.length} display), ` +
    `${sizes.length} bundles within budget.`,
);
