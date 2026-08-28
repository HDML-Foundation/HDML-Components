# Development

**Scope:** the exact commands and configs a contributor uses to install, build, test, lint,
and run the dev server. Every command below is verified against
[package.json](../package.json), [.devrc.js](../.devrc.js), [.testrc.js](../.testrc.js),
[.esbuildrc.mjs](../.esbuildrc.mjs), [.eslintrc.js](../.eslintrc.js), and the
[tsconfig/](../tsconfig/) files.

Adjacent reading: [docs/architecture.md](architecture.md) for what each `compile_*` step
produces.

## Toolchain

| Tool | Version (image) | Purpose |
|---|---|---|
| Node | 18 (from [.devcontainer/Dockerfile:25](../.devcontainer/Dockerfile#L25)) | TS / Lit / dev server |
| TypeScript | `^5.5.0` ([package.json:40](../package.json#L40)) | All four `compile_*` steps |
| esbuild | `^0.24.0` | Minified IIFE bundle + worker inlining |
| `@web/dev-server` | `^0.4.6` | `npm run srv` / `npm run dev` |
| `@web/test-runner` + Playwright | `^0.19.0` / `^0.11.0` | `npm test`, three browsers |
| ESLint + Prettier | `^8.51.0` / `^2.6.2` | `npm run lint` |
| TypeDoc | `^0.26.11` | API docs into `./docs/` *(see warning below)* |
| `@custom-elements-manifest/analyzer` | `^0.10.3` | `custom-elements.json` |

Also present in the dev image but **unused by this repo**: Go 1.22, `flatc` v24.3.25, Python.
These are vestigial from a shared base image; do not assume this repo runs `flatc` — it
consumes generated bindings via the `@hdml/*` npm packages.

## Install

```bash
npm install                      # devcontainer postCreate also runs this
npx playwright install           # if outside the devcontainer; the devcontainer adds install-deps
```

## Build matrix

`npm run build` is the release pipeline; the lower-level scripts are useful day-to-day.

| Script | What it does | Output |
|---|---|---|
| `npm run clear` | `rm -rf bin tst cjs dts esm coverage docs` + `tsconfig/*.tsbuildinfo` | — |
| `npm run lint` | ESLint with `--fix`, project rooted at `./tsconfig` | — |
| `npm run compile_cjs` | `tsc -b tsconfig/cjs.json` | `cjs/` |
| `npm run compile_esm` | `tsc -b tsconfig/esm.json` | `esm/` |
| `npm run compile_dts` | `tsc -b tsconfig/dts.json` | `dts/` |
| `npm run compile_tst` | `tsc -b tsconfig/tst.json` | `tst/` |
| `npm run compile_bin` | `node ./.esbuildrc.mjs` → bundles `esm/bundle.js` into IIFE with worker inlined | `bin/index.min.js` |
| `npm run compile_all` | cjs + esm + dts + bin | all four |
| `npm run check_dist` | `node ./scripts/check-dist.mjs` — the build assertion; **needs a completed `compile_all`** | — |
| `npm run docs` | TypeDoc on the four entry points against `tsconfig/esm.json` | `docs/api/` (HTML) |
| `npm run manifest` | `cem analyze --litelement --globs 'src/**/*.ts' --exclude 'src/index.ts' 'src/bundle.ts'` (`--exclude` takes multiple values under one flag) | `custom-elements.json` |
| `npm run build` | `clear && lint && test && compile_all && check_dist && docs` | release-shaped tree |

**`check_dist`.** It asserts six things browser tests cannot reach, because wtr runs
`./tst/**/*.test.js` and never sees `package.json` or the emitted trees: that the `exports`
map and the `sideEffects` list both match the ones derived from its single `ENTRIES` array;
that every path `exports` names exists on disk; that every `exports` target is covered by
`sideEffects`; that `src/index.ts`'s import list is still exactly the union of the `hdio`
and `hdql` sub-entries; and that `src/hdvl/` imports no `hdio` module other than `config`
(as a value) and `delivery` (**type-only** — a value import would pull the worker,
`@hdml/parser` and Arrow into every page, and would compile silently). It sits after
`compile_all` because two of those checks read the built trees.

**TypeDoc warnings are expected.** `npm run docs` reports ~24 `Encountered an unknown block
tag @copyright` warnings — one per source file carrying the license preamble, plus the
`@hdml/types` enum `.d.ts` files the `./hdvl` entry re-exports. Warnings do not fail the
build; a TypeDoc **error**, or a warning that is not `@copyright`, does.

**`docs/` collision.** `npm run docs` and `npm run clear` both target this directory, which
also holds the agent docs you're reading. The repo `.gitignore` was updated with
`!docs/*.md` so the markdown survives `git add .`, but `npm run clear` will still delete
these files from disk. Re-create them from git after `clear` if needed. `TODO(confirm:
move typedoc output to ./docs/api/ and adjust the npm scripts so the conflict goes away.)`

## Test

```bash
export PLAYWRIGHT_BROWSERS_PATH=/ms-playwright   # REQUIRED — see below
npm test                    # compile_tst + wtr --coverage (defaults: dev export condition)
MODE=prod npm run tst_prd   # same suites against prod export condition
npx wtr --config .testrc.js --files "tst/hdvl/*.test.js"   # scoped, still 3 engines
```

**`PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` must be exported.** The devcontainer image
ships the browsers there, **read-only**, and *nothing in this repo sets the variable* — no
`.env`, no npm script, no CI step. Without it Playwright looks in `~/.cache/ms-playwright`,
finds nothing, and every test on all three engines fails with *"Executable doesn't exist"*.
It is the single most common way a fresh session fails at step one. (Related: never delete
`package-lock.json` — `playwright` is held at the version whose browser revisions match that
read-only directory, and floating it fails every test with the same message.)

**Use `127.0.0.1`, never `localhost`,** in any test that reaches a local server — behind the
VS Code port forwarder `localhost` resolves to `::1` first and each request stalls ~20 s.
Same trap as the [dev server](#dev-server) below. Same-origin `fixture(html\`…\`)` avoids it
entirely; prefer it.

**There is no single-engine run.** `.testrc.js` defines `browsers` manually, so `--playwright`
and `--browsers` are both rejected by the CLI. Scoping `--files` to one `tst/` path is the
fast loop, and it still runs all three engines. `npx tsc -p tsconfig/tst.json --noEmit` is the
*real* fast feedback loop, since `npm run test` runs `compile_tst` first and a type error in a
`.test.ts` fails the gate before a browser starts.

Configured in [.testrc.js](../.testrc.js):

- **Three browsers** via Playwright: chromium, firefox, webkit. All three run for every test.
- **TDD globals.** `testFramework.config.ui = "tdd"` — write `suite(...)` / `test(...)`. See
  [src/hdql/HdmlConnection.test.ts:11](../src/hdql/HdmlConnection.test.ts#L11) as the canonical
  shape (uses `@open-wc/testing`'s `fixture` + `assert.shadowDom`).
- **Timeout:** 60 000 ms (six seconds × ten — Playwright spin-up is slow on first run).
- **Legacy polyfills:** webcomponentsjs + a custom Lit polyfill via `@web/dev-server-legacy`.
- **Mock HDIO server.** A `middleware` in [.testrc.js](../.testrc.js) answers the tenant
  routes (`…/auth/token`, `…/auth/token/refresh`, `…/documents/dynamic`) so the HTTP-touching
  hdio suites hit a real localhost server (reached identically from the Worker build and the
  main-thread fallback) rather than a `fetch` stub. Scenarios are selected by the `tenant`
  path segment, stateless per route (`ok`, `stale-handoff`, `expired-access`, `always-401`,
  `slow`, `err-html`). See [docs/hdio-client.md](hdio-client.md).
- **`node-html-parser` ESM shim.** `@hdml/parser` does `import { parse } from
  "node-html-parser"`, but that package is CommonJS and a browser cannot bind a named import
  from a CJS file. A small `@web/dev-server` plugin in [.testrc.js](../.testrc.js)
  esbuild-bundles it into an ESM shim on the fly (esbuild is already the `bin` bundler — no new
  dependency). Without it, every hdio suite that touches the parser fails to import.

Tests live next to source as `*.test.ts` in [src/hdql/](../src/hdql/),
[src/hdio/](../src/hdio/) (`endpoint` / `onmessage` / `parse` / `HdioClient`),
[src/hdvl/](../src/hdvl/) and [src/testing/](../src/testing/).

### `FakeIo` — the page-level D8 double

[src/testing/FakeIo.ts](../src/testing/FakeIo.ts) is a **page-level double of the D8
provider**: it listens for the configured request event on `document`, announces ready, and
answers with canned `Delivery` objects. It is what every HDVL test binds against.

```ts
import { mountFakeIo } from "../testing/FakeIo";

const io = mountFakeIo({
  "?hdml-frame=sales": {
    generation: 1,
    rows: 3,
    columns: {
      month: { values: ["a", "b", "c"], domain: {…}, type: {…} },
    },
  },
});
io.feed("?hdml-frame=sales", { generation: 2, rows: 0, columns: {} });
io.fail("?hdml-frame=sales", "boom", "query-failed", 2);
io.announceGone();          // provider restart, without unmounting
io.subscriptions;           // what the consumer actually asked for
```

`mountFakeIo` registers its own teardown, so a test never unmounts by hand.

Six things it produces on demand that a **real** server cannot: supersession (feed G2 then
G1), an `absent` column, a zero-row result, a classified `error`, the gone event, and a
late-join replay.

**`FakeIo` and `mockHdio` are orthogonal, and both stay.** `mockHdio` (the `.testrc.js`
middleware above) is an **HTTP route double** for the *real* `<hdml-io>` — reach for it when
the thing under test is `HdioClient`, the worker, or the auth flow. `FakeIo` **replaces**
`<hdml-io>` and makes no HTTP request at all — reach for it when the thing under test is a
consumer of the seam.

**`FakeIo` is deliberately not a custom element.** `npm run manifest` globs all of `src/` and
`custom-elements.json` is a declared package field, so a registered double would be
advertised in the *published* manifest — and the tsconfig exclusion below cannot stop that,
because CEM reads source, not the emitted trees.

### The provider-conformance suite

The D8 provider contract is written **once**, as the fourteen clauses of
[src/testing/conformance.ts](../src/testing/conformance.ts), and
[conformance.test.ts](../src/testing/conformance.test.ts) runs it against **both** providers —
`FakeIo` and the real `<hdml-io>` — from one `assertProviderConformance(harness)` call each.
A second, hand-written `FakeIo` suite that agreed with the `<hdml-io>` one would prove only
that the same author wrote both.

**A new provider behaviour belongs in `conformance.ts`, not in a second suite.** Implement a
`ProviderHarness` (`name` / `mount` / `unmount` / `feed` / `fail`) and the clauses come free.
The clauses assert behaviour, never a registry accessor — that is what keeps the harness
interface to four methods and applicable to a real custom element.

One gotcha the clauses encode: **every provider teardown dispatches the gone event on
`document`**, so a suite that counts the *default* name counts its neighbours. Each harness
suite configures its own name (`window.HDML_CONFIG = { goneEvent: "x-gone-…" }`) and asserts
**zero** under the default.

### Why `src/testing/` is excluded from `cjs`/`esm`/`dts`

Anything under `src/` that is **not** `*.test.ts` ships in the published package. A test
double added under `src/` therefore reaches npm unless a tsconfig says otherwise, so
`tsconfig/{cjs,esm,dts}.json` each carry:

```json
"exclude": ["../src/**/*.test.ts", "../src/testing/**"],
```

**Both patterns, in every config that declares one.** A child tsconfig's `exclude`
**replaces** its parent's — it does not merge — so naming only the new directory would
silently un-exclude every `*.test.ts` and start publishing the whole suite. `dts.json`
extends `esm.json` and would inherit it, and declares it anyway: an inherited exclusion is
invisible at the file a reader opens, and this is the mechanism that must not be subtle.
`tsconfig/tst.json`'s `"exclude": []` is untouched — it is what keeps `src/testing/`
compiling into `tst/` and reaching the browser.

Check it with:

```bash
npm run clear && npm run compile_all
ls esm/testing cjs/testing dts/testing   # expect: No such file × 3
find cjs esm dts -name "*.test.*"        # expect: no output
```

### The platform probe

[src/hdvl/platform.test.ts](../src/hdvl/platform.test.ts) asserts, on all three engines and
before one display element exists, the eight platform capabilities the HDVL runtime is built
out of: no ShadyCSS/ShadyDOM; a constructed `CSSStyleSheet` adopted into a shadow root; a
`:host(...)`-qualified rule in that sheet; `::slotted(...)`; `CSS.registerProperty` (including
that **re-registration throws `InvalidModificationError`**, which is why the property registry
needs a *per-property* try/catch); `:state()` via `ElementInternals.states`; `ResizeObserver`'s
first callback; and `transitionrun` on a registered custom property, changed inline **and** via
a stylesheet.

The legacy plugin's `webcomponents` polyfill is **on** for every run; if it ever activates
ShadyCSS, three of those capabilities change meaning underneath everything built on them.

**A red probe is a stop-and-ask, not a fix-forward.** Do not weaken an assertion, skip an
engine, or add a polyfill — a failure changes what the display elements can be built out of.

### Writing a scene assertion

HDVL assertions are **scene descriptions, never pixels** — a regression then names the number
that moved, which a screenshot baseline cannot. The conventions:

- `deepEqual` against a golden scene committed as a **TS literal**, obtained through a
  precision-quantized `sceneOf(view, { precision: 6 })`. The scene itself is never quantized;
  that would be a rendering decision.
- `closeTo(…, 1e-9)` for anything that went through `Math.log/pow/sin/cos/exp` — ECMAScript
  does not require correctly-rounded transcendentals and the three engines differ in the last
  ulp. Exact `deepEqual` is for rational arithmetic only.
- `Intl` **output strings** are asserted on chromium only (ICU version and data differ by
  engine and OS). The cross-engine contract is the skeleton → option-bag mapping.
- `getComputedStyle` fixtures run on all three engines, mandatory — that is precisely where
  engines differ.

`sceneOf` / `assertRenders` do not exist yet; they arrive with the scene itself.

### Writing a kernel fixture table

[src/hdvl/kernel/](../src/hdvl/kernel/) is pure maths and parsing — no DOM, no
`getComputedStyle`, no import side effect — so its tests look nothing like the rest of
the suite. A kernel test **imports `assert` and the module under test and nothing
else**: no `fixture`, no `setup`, no element, no `await`, and no `PLAYWRIGHT`-specific
anything. If you find yourself reaching for a fixture, the module is not pure and the
directory invariant has already been broken.

The shape:

- A `const` table of `[input, …, expected]` tuples at suite scope, with the **reason
  for each row in a comment** — the boundary it pins, the branch it reaches. A row
  whose reason is "it was what the code returned" is not a fixture, it is a snapshot.
- A `for … of` over the table emitting one `test()` per row, so a failure names the
  row rather than the tenth assertion in a wall of them.
- The purity invariant restated in the file's header JSDoc, naming the grep that
  enforces it: `grep -rn "document\.\|window\." src/hdvl/kernel/`.

**Which cross-engine rule applies to which number** — this is the part that is easy to
get wrong, and getting it wrong in the *lenient* direction throws away the reason the
code was hand-written:

| The value went through… | Assert with | Why |
|---|---|---|
| Rational arithmetic only — `i / divisor`, `i * step` at a non-negative power, a `{1, 2, 5}` multiplier, an identity transform, a projection over an exactly-representable domain, the band formula | **exact `deepEqual` / `strictEqual`** | IEEE-754 `+ − × ÷` are exactly specified, so all three engines agree bit-for-bit. A `closeTo` here would hide a real defect — and, for the tick ladder, would discard the whole point of the integer-reciprocal step form |
| `Math.log`, `Math.log10`, `Math.log1p`, `Math.pow`, `Math.exp`, `Math.expm1`, `Math.sin`, `Math.cos` | **`closeTo(…, 1e-9)`** | ECMAScript does not require correctly-rounded transcendentals; V8, SpiderMonkey and JavaScriptCore differ in the last ulp |
| `Math.pow(base, p)` for a small integer `p` | **exact — but say so in the test** | An integer result at these magnitudes is exactly representable and every engine returns it. This is the one place the two rules touch, so a bare exact assertion reads as an oversight unless the comment explains it |
| `measureText` | **`closeTo(…, 1e-2)`** | Text extents are deterministic *per engine*, not *across* them: `"North"` at `11px system-ui` measures 30.765625 on chromium and webkit and 30.766666412353516 on firefox |
| `Intl` **output strings** | chromium only | ICU version and data differ by engine and OS. The cross-engine contract is the skeleton → option-bag mapping, which *is* asserted on all three |

**The `Intl` row is the suite's only engine-scoped rule, so it is the only one that
has to be *declared*.** Keep the scoped assertions in one suite, guard them with an
explicit engine predicate, and **assert the predicate itself on all three engines** —
otherwise an engine-detection change makes the whole suite silently assert nothing and
the build stays green. `format-skeleton.test.ts` is the worked example. Two traps
measured there: a structural claim compares labels **to each other**, or to a value
read from the *same* `Intl` call, and therefore is **not** engine-scoped; and a bare
locale tag is not a numbering system — `"ar"` resolves to `latn` on chromium and
firefox and to `arab` on webkit, so a test that reads digits must spell
`"ar-u-nu-arab"`.

**A sign, and a `-0`, are asserted exactly even on a transcendental path.** Use
`Object.is(x, 0)` or wrap in an array and `deepEqual` — `assert.strictEqual(x, 0)`
**passes for `-0`** and is the single easiest way to land a silent cross-engine split.
Any kernel function that can produce a signed zero normalises it at the source; the
known producers are `Math.sign(-0)`, `Math.ceil(x)` for `x ∈ (−1, 0)`, and a
difference or product of equal coordinates.

### The HDVL corpus pages

[html/hdvl/](../html/hdvl/) holds the thirteen corpus pages (`00-minimal` … `12-coverage`),
linked from [html/index.html](../html/index.html). They are **byte copies** of the originals
in the project folder (`016. HDVL Elements/002. Product Discovery/examples/`), and they double
as the acceptance suite.

**No test can assert the two copies agree** — this repo cannot reach the project folder — so a
corpus fix must land in **both** locations, by hand, in the same change.

They are **executed**, not only served. [src/hdvl/corpus/](../src/hdvl/corpus/) is one
`*.test.ts` per page; [src/testing/corpus.ts](../src/testing/corpus.ts) is the shared harness.
**Since step 33 the corpus is complete**: all thirteen pages are mounted and gated —
**thirteen pages, twenty-nine views** — and `page-11.test.ts` asserts the completeness
mechanically, fetching each page and each suite's own **source** and matching the
`mountCorpus` call that names it. (What it cannot do is discover a *fourteenth* page: the
runner serves no directory index, measured, so the list of thirteen is a literal there
exactly as it is a count here.)

**`validator.test.ts` is the fourteenth file and the odd one out** (step 34): it is not a
page's gate but SPEC §11's, mounting all thirteen and asserting that every rule is silent
on every view — plus the **absences that are claims**, which no per-page gate can state.
It mounts **no data provider**, because §8.2's structural pass is data-independent and the
binding pass's delivered half is what the thirteen page suites already assert; and it
proves its own silence is a result rather than a vacuum by taking two mutations per view
(strip the accessible name → W2; append a bare `hdml-axis` under a plane → V13), asserting
each red, then restoring and re-asserting clean. `assertRenders` gained R20's node budget in
the same step, so **W4** — which is warned to the console and never filed as a `Finding` —
is asserted on all twenty-nine gated views against `validate.ts`'s own constant.

SPEC §11's **V11 and V12 are not runtime-applicable** and live in
[scripts/check-dist.mjs](../scripts/check-dist.mjs) instead, over the same thirteen pages'
source. `npm run check_dist` reports them in its summary line, which grew a clause for it.

**`11-multi-plane` is the only page whose subject is the view rather than a widget.** Every
other page has one plane per view; this one has **three** side by side in A and **two
overlapping** in B, which is the only way SPEC §4.8 — *"scales never cross a plane boundary;
data and domains do"* — becomes observable. It is also the corpus's **one query-coalescing
page**: both views declare `source` on the `hdml-view` and no plane repeats it, so A's twelve
binding sites name **one** ref. Two things are true only here — the three panels share a
**domain** (`values="series_max"`) and not a range, and B's two planes are two **plot
regions** rather than `07-mixed`'s two coordinate systems on one, so the same month projects
to two different x positions. **A is the corpus's one view quantized to two decimals rather
than rule 3's six**: `width: 33.333%` is snapped to the engine's own layout unit (1/64 px in
Blink and WebKit, 1/60 px in Gecko), so the whole scene disagrees by at most
**2.1 × 10⁻³ px** across engines and agrees exactly at two. `06-bubble` is Slice H's own page: it is the only
page in the corpus that runs the **`size` channel** (`--hdml-size-min`/`-max` on a `sqrt`
scale with `nice`, the combination step 25's ladder correction was made for and which nothing
under `html/hdvl/` had ever executed), and its ordinal colour domain is **derived from a
column** against a four-colour palette — so its fixture seeds exactly four regions, one short
of §9's `palette-exhausted`.

Four of the twelve were **double-gated**, and C3 says what a slice gate may claim: *"every slice
gate is expressed as named scene-`deepEqual` assertions over the groups **that slice owns**;
a double-gated page's whole-page render assertion belongs to the **later** slice."* **All four
`08` views** and `09` A carry an `hdml-legend`, which is Slice H's, so their goldens were taken
over `withoutDeferred(scene, DEFERRED_TO_SLICE_H)` until step 32 re-ran those pages whole.
**All five views of `04` declare one**, so the whole page was scoped that way; `12` has four
views and is gated **per view**, and **four slices took one page** — step 28 took B (the
gauge), step 30 C (the `hdml-stack`), step 32 **A** (the ramp legend) and step 33 **D** (the
`symlog` day), each asserting its own scope from the document rather than trusting an index,
which is what kept the four gates independent while three slices landed between them. `12-D`
is where `type="symlog"` with a `constant`, an `hdml-datetime-scale` with an IANA `zone` and
literal ISO strings first meet markup an author wrote: the zone is load-bearing for the
**ticks** and not for the domain (a date-only ISO string is UTC by specification, so the
domain is the same either way, while every tick boundary is computed in the scale's zone and
the New York and UTC ladders share no instant at all), and it is the first *golden* whose
numbers come through `temporal-polyfill` on all three engines.

**`DEFERRED_TO_SLICE_H` is now empty**, and the constant and `withoutDeferred` are both kept:
the mechanism outlives its first argument, and step 33's `11-multi-plane` may need it again.
The exclusion was a **filter by tag name**, deliberately, not an omission that happened to
hold while `hdml-legend` emitted nothing: a golden that merely lacked legend groups would have
become a whole-page golden the moment the legend gained a body. **It did at step 31, and not
one golden literal moved**; at step 32 the eleven scoped goldens grew by exactly one
`hdml-legend` group each — 1 794 inserted lines and **not one deleted line** in any of them,
which is the emptying's own proof. Two of the eleven also settle the *position* claim: a
legend's group sits where document order puts it, which in `04` E is index 10 of 11 and in
`08` D is index **1 of 3**, between the two rings. What the filter never covered is a
hand-written assertion over an unfiltered scene, and there was exactly one: `page-08.test.ts`'s
pie↔arc **group tag list**, widened at step 31 to name the legend rather than to filter it out,
so it survived step 32 untouched.

**`12-C` is the one corpus assertion that runs a second frame.** Its caption is a claim about
a live interaction — *"the stack rebases over rendered children; the y ceiling stays put"* —
which a static golden cannot make, so the gate removes the third bar's `hidden`, re-runs the
frame, and restores it: two bands become three at the derived baseline, the golden returns
byte-for-byte, and every scale's `domain()` is identical in all three states. `hidden` is
`HTMLElement.hidden`, so nothing HDVL-specific is toggled.

Per view the gate is: `assertRenders` (not `:state(error)`, not `:state(loading)`, at least
one **mark** node, `diagnosticsOf` empty), one whole-`Scene` golden as a committed TS literal,
a `structuredClone` round-trip, and the 20 000-node budget.

Seven decisions the harness takes once, because five gate steps inherit them:

| | |
|---|---|
| **A page is fetched, never inlined** | `mountCorpus` `fetch`es `/html/hdvl/<name>.html` off the runner's own static serving. Inlining the markup into a test would be a **third** copy that no `cmp` covers |
| **The page's `hdml-io` is removed first** | **Ten of the thirteen** gated pages declare one against a host that does not exist, and it would both hit the network and register as a **second** D8 provider — `subscribe.ts` de-dupes by `id`, not by provider. `FakeIo` replaces it outright (RFC §10.3). The count removed is asserted, and so is the absence of any `hdml-io` in the mounted page |
| **The page's `<style>` is adopted verbatim** | Injected into `document.head` before the fixture mounts, removed at teardown. The bare tag selectors are what SPEC §7 makes placement out of, so they must reach the light DOM exactly as on the served page |
| **The layout viewport is pinned at 800 px** | Twelve of the thirteen gated pages size their view `width: 100%`. The runner's window is a Playwright default, not a corpus fact; 800 is wider than every page's own `max-width` (760, 760, 760, **760**, 720, **760**, 780, 480, 480, 520, **780**, 480), so each page keeps its author's dimensions and none is capped by the harness. It is also what makes `11`'s thirds a *fractional* number of pixels — 33.333 % of 780 — and so the one place a used width is engine-dependent |
| **Geometry is asserted everywhere, `text` on chromium only** | Cross-engine rule 4. `stripText` blanks every `text` field for the three-engine `deepEqual`; the strings are a second assertion behind an engine guard whose classification is itself asserted on all three, so an engine-detection change cannot make the scoped half silently pass |
| **A deferred element is excluded by name** | C3, as `DEFERRED_TO_SLICE_H` + `withoutDeferred` rather than as an omission. Added at step 28, the first gate to meet a double-gated page; **emptied at step 32**, which is what widened those goldens. Both are kept — an empty list is also an assertion, and a later page may need a different tag in it |
| **`-0` is swept, not assumed** | `negativeZeros` returns the dotted paths of every signed zero in a scene. Added at step 28 because polar pages are where one becomes reachable — `sin(180deg)` is `-1.2e-16` and a coordinate times a zero radius carries the sign |

`FakeIo` is seeded **by ref string**, so an in-page `?hdml-frame=…` and a static
`/warehouse/….html?hdml-frame=…` are answered the same way and no `/warehouse/*` document is
ever invented. `00-minimal`, `02-area` and `12-coverage` mount with **no provider at all** —
that is SPEC §4's literal-only conformance class, proved rather than asserted, since a page
that needed one would sit in `:state(loading)` and fail `assertRenders`. It is also why V7's
order-pinning clause is silent on `12-C`: with no effective `source` there is no frame to
resolve. `04-grouped-stacked` reaches the same silence from the other side, by declaring an
`hdml-sort-by` — and the gate confirms both from the document rather than assuming them.

## Lint

```bash
npm run lint
```

[.eslintrc.js](../.eslintrc.js) configures `@typescript-eslint/recommended` +
`recommended-requiring-type-checking` + Prettier. Notable rules:

- `max-len: 70`, `printWidth: 70`. This is aggressive — most existing files wrap at 70 cols.
- `@typescript-eslint/no-explicit-any: error`.
- `@typescript-eslint/explicit-module-boundary-types: error` — exported functions must
  declare return types.

ESLint uses `tst.json` as its TS project (the only tsconfig that includes the `*.test.ts`
files). If a new file is added in a directory not covered by `tst.json`'s `include`, the lint
will fail with a TS-project error before any rule fires.

## Dev server

```bash
npm run srv                 # web-dev-server, --open html/index.html, --watch
npm run dev                 # tsc -b tsconfig/esm.json --watch  &  wds (same as srv)
npm run dev_bin             # tsc esm --watch  &  esbuild --watch  &  wds
```

[.devrc.js](../.devrc.js) sets `preserveSymlinks: true` and selects the `development` (or
`prod` if `MODE=prod`) export condition for `nodeResolve`. The `legacyPlugin` is enabled with
`polyfills: { webcomponents: false }` (full polyfilling is only in tests).

[html/index.html](../html/index.html) is the demo hub; sub-pages under
[html/hdql/](../html/hdql/) load `../../esm/index.js` directly (so they require a fresh
`compile_esm`), while [html/hdio/hdml-io.bin.html](../html/hdio/hdml-io.bin.html) loads the
IIFE bundle for testing the Worker-spawning code path.

The two auth-mode manual pages —
[html/hdio/hdml-io-token.bin.html](../html/hdio/hdml-io-token.bin.html) and
[html/hdio/hdml-io-oidc.bin.html](../html/hdio/hdml-io-oidc.bin.html) — drive a live HDIO
server rather than the test middleware. Each declares an inline `<hdml-frame>` and queries it
by same-document ref (`?hdml-frame=<name>`), so they exercise the dynamic-document save path
end to end, not just a static server artifact. Two things to know:

- **Use `127.0.0.1`, not `localhost`, in `host`.** Behind the VS Code port forwarder
  `localhost` resolves to `::1` first and each request stalls for ~20 s before falling back
  to IPv4. It looks like a server, CORS, or Worker-thread hang; it is neither.
- **The `token` attribute is a single-use handoff code** minted per run (see
  [docs/hdio-client.md](hdio-client.md)) — the value committed in the page is a spent
  dev-tenant code kept only as a shape example. Replace it with a fresh one before use.

## Release

[scripts/release.sh](../scripts/release.sh) is **entirely commented out** — it appears to be
a stale plan inherited from a monorepo template. `TODO(confirm: the actual release flow.
Likely manual: bump version, npm publish, git tag, push.)` The
[.github/workflows/main.yml](../.github/workflows/main.yml) CI only validates `npm ci && npm
run build` inside the devcontainer image; it does not publish.

## CI

- **`devcontainer.yml`** — `TODO(confirm: not read in this audit.)`
- **`main.yml`** — on push/PR to `main` touching `src/**`, `.devcontainer/**`, configs, or
  the workflow itself: rebuilds the devcontainer image (only if `Dockerfile` changed) and
  runs `npm ci && npm run build` inside it. No publish step.

## Devcontainer

[.devcontainer/devcontainer.json](../.devcontainer/devcontainer.json) bind-mounts
`~/.ssh → /home/.ssh` read-only and runs `npm install && npx playwright install &&
npx playwright install-deps` on create, then `scripts/init.sh` on attach (git identity +
SSH-command). VS Code extensions include `runem.lit-plugin`,
`matsuuu.custom-elements-language-server-project`, `dbaeumer.vscode-eslint`.
