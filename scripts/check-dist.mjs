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
import { fileURLToPath } from "url";

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

if (failures.length > 0) {
  console.error("check-dist FAILED:");
  for (const f of failures) {
    console.error(`  ${f}`);
  }
  process.exit(1);
}

console.log(
  `check-dist OK — ${ENTRIES.length} entries, ` +
    `${derivedSideEffects().length} sideEffects paths, ` +
    `${rootSet.size} root registrations.`,
);
