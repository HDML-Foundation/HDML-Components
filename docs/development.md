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

### The HDVL corpus pages

[html/hdvl/](../html/hdvl/) holds the thirteen corpus pages (`00-minimal` … `12-coverage`),
linked from [html/index.html](../html/index.html). They are **byte copies** of the originals
in the project folder (`016. HDVL Elements/002. Product Discovery/examples/`), and they double
as the acceptance suite.

**No test can assert the two copies agree** — this repo cannot reach the project folder — so a
corpus fix must land in **both** locations, by hand, in the same change.

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
