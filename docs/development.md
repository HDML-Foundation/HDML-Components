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
| `npm run compile_bin` | `node ./.esbuildrc.mjs` → bundles `esm/index.js` into IIFE with worker inlined | `bin/index.min.js` |
| `npm run compile_all` | cjs + esm + dts + bin | all four |
| `npm run docs` | TypeDoc on `src/index.ts` against `tsconfig/esm.json` | `docs/` (HTML) |
| `npm run manifest` | `cem analyze --litelement --globs 'src/**/*.ts' --exclude 'src/index.ts'` | `custom-elements.json` |
| `npm run build` | `clear && lint && test && compile_all && docs` | release-shaped tree |

**`docs/` collision.** `npm run docs` and `npm run clear` both target this directory, which
also holds the agent docs you're reading. The repo `.gitignore` was updated with
`!docs/*.md` so the markdown survives `git add .`, but `npm run clear` will still delete
these files from disk. Re-create them from git after `clear` if needed. `TODO(confirm:
move typedoc output to ./docs/api/ and adjust the npm scripts so the conflict goes away.)`

## Test

```bash
npm test                    # compile_tst + wtr --coverage (defaults: dev export condition)
MODE=prod npm run tst_prd   # same suites against prod export condition
```

Configured in [.testrc.js](../.testrc.js):

- **Three browsers** via Playwright: chromium, firefox, webkit. All three run for every test.
- **TDD globals.** `testFramework.config.ui = "tdd"` — write `suite(...)` / `test(...)`. See
  [src/hdom/HdmlConnection.test.ts:11](../src/hdom/HdmlConnection.test.ts#L11) as the canonical
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

Tests live next to source as `*.test.ts` in both [src/hdom/](../src/hdom/) and
[src/hdio/](../src/hdio/) (`endpoint` / `onmessage` / `parse` / `HdioClient`).

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
[html/hdom/](../html/hdom/) load `../../esm/index.js` directly (so they require a fresh
`compile_esm`), while [html/hdio/hdml-io.bin.html](../html/hdio/hdml-io.bin.html) loads the
IIFE bundle for testing the Worker-spawning code path.

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
