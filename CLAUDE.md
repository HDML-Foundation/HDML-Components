# HDML-Components

Lit-based **TypeScript web components** that let an author declare an HDML document in plain
HTML — `<hdml-connection>`, `<hdml-model>`, `<hdml-frame>`, etc. — and a sibling `<hdml-io>`
component that serializes that DOM to FlatBuffers (via `@hdml/*` libraries running in a Web
Worker) and uploads it to an HDIO server. Published to npm as **`@hdml/components`**
(Apache-2.0). Built with Lit 3 + `@web/dev-server` + `@web/test-runner` (Playwright,
chromium/firefox/webkit). Ships **four artifacts** from one source tree: `cjs/`, `esm/`,
`dts/`, and a minified IIFE `bin/index.min.js` (worker inlined as a string).

## Where to find what

| Looking for… | Open |
|---|---|
| End-to-end data flow, the `hdom-changed` event bus, main-thread ↔ Worker boundary, build pipeline diagram | [docs/architecture.md](docs/architecture.md) |
| Install / build / lint / test / dev-server / release commands (verified against `package.json`) | [docs/development.md](docs/development.md) |
| Reference for every `hdml-*` custom element: tag, attributes, allowed children, attribute enums | [docs/components.md](docs/components.md) |
| `<hdml-io>` host/tenant/token props, Worker message protocol, `HdioClient` HTTP endpoints | [docs/hdio-client.md](docs/hdio-client.md) |
| How downstream consumers (apps, HDIO-Server) use this package; entry points, exports, dist variants, `@hdml/*` version pins | [docs/integration.md](docs/integration.md) |
| Non-obvious design choices: document-level event bus, esbuild Worker-inlining plugin, `_script` sentinel, dev/prod export conditions, `docs/` collision with typedoc | [docs/decisions.md](docs/decisions.md) |

## Quickstart

```bash
npm install
npm run compile_esm        # TS → esm/ (dev iteration)
npm run test               # compile_tst + wtr (Playwright, ~60s timeout)
npm run dev                # tsc --watch + web-dev-server, opens html/index.html
npm run build              # clear + lint + test + compile_all + typedoc → docs/
```

Full detail in [docs/development.md](docs/development.md).

## Repo layout

| Path | What it is |
|---|---|
| [src/index.ts](src/index.ts) | The `.` entry — the compatibility root. Side-effect imports register the 11 HDQL elements + `<hdml-io>`. Its import list is **frozen**: `check-dist.mjs` fails the build if it drifts from the union of the two sub-entries. |
| [src/bundle.ts](src/bundle.ts) | The entry of the IIFE bundle only — imports all three sub-entries. Not a published entry point; excluded from CEM. |
| [src/hdvl/](src/hdvl/) | The display half. Currently [`vocabulary.ts`](src/hdvl/vocabulary.ts) (the sole `@hdml/types` importer down here: `HDVL_TAG_NAMES` + the 20 display `*_ATTRS_LIST` enums) and the `./hdvl` entry, which registers no tag yet. |
| [src/hdql/](src/hdql/) | The 11 declarative HDML elements (`HdmlConnection`, `HdmlModel`, `HdmlTable`, `HdmlField`, `HdmlJoin`, `HdmlConnective`, `HdmlFilter`, `HdmlFrame`, `HdmlFilterBy`, `HdmlGroupBy`, `HdmlSortBy`) + the shared [`HdqlElement`](src/hdql/HdqlElement.ts) base + `.test.ts` peers. |
| [src/hdio/](src/hdio/) | `<hdml-io>` host element, its Web Worker entry, `onmessage` router, `parse()` (HTML → FlatBuffers via `@hdml/*`), `HdioClient` (HTTP). |
| [src/testing/](src/testing/) | Test doubles. [`FakeIo`](src/testing/FakeIo.ts) is a page-level D8 provider double (**not** a custom element — `cem analyze` globs all of `src/`); [`conformance.ts`](src/testing/conformance.ts) is the D8 provider contract as fourteen clauses, run against `FakeIo` **and** the real `<hdml-io>`. **Excluded from `cjs`/`esm`/`dts`** and compiled only by `tst.json` — anything under `src/` that is not `*.test.ts` otherwise ships. |
| [html/](html/) | Static test pages served by the dev server — one per element under `html/hdql/`, four for `hdml-io` under `html/hdio/` (`.esm`/`.bin` build variants plus the `-token`/`-oidc` live-server auth pages), the thirteen HDVL corpus pages under `html/hdvl/` (byte copies of the project-folder originals — a fix must land in both), index at `html/index.html`. |
| [tsconfig/](tsconfig/) | `base.json` + four targets: `cjs.json`, `esm.json`, `dts.json`, `tst.json`. The three published targets each `exclude` **both** `../src/**/*.test.ts` and `../src/testing/**` — a child's `exclude` *replaces* its parent's, so naming only one pattern would start publishing the other. `tst.json`'s `"exclude": []` is what compiles everything into the browser run. |
| [.esbuildrc.mjs](.esbuildrc.mjs) | Builds the `bin/index.min.js` IIFE. Includes a custom `buildWorkerPlugin` that bundles `*.worker.js` and inlines it as `const _script = "...";`. |
| [.devrc.js](.devrc.js) · [.testrc.js](.testrc.js) | `@web/dev-server` and `@web/test-runner` configs (legacy plugin, Playwright launchers, dev/prod export conditions via `MODE` env). |
| [.devcontainer/](.devcontainer/) · [.github/workflows/](.github/workflows/) | Dev image (Node 18, Go 1.22, flatc v24.3.25 — flatc/Go are vestigial; this repo does not run `flatc` itself) + CI (`main.yml` builds the devcontainer image then `npm ci && npm run build`). |
| [scripts/init.sh](scripts/init.sh) · [scripts/release.sh](scripts/release.sh) | Devcontainer attach hook (git identity + SSH key). `release.sh` is fully commented out — `TODO(confirm: release process)`. |
| [scripts/check-dist.mjs](scripts/check-dist.mjs) | The build assertion `npm run build` runs after `compile_all`: derives the `exports` map and the `sideEffects` list from one array and fails if `package.json` disagrees, if a named path is missing, if `src/index.ts`'s import list drifts, or if `src/hdvl/` imports an `hdio` module it may not. |

## External contracts

This repo *promises* the following to its consumers; any change here is a cross-repo change.

- **Custom-element registry** — registers ~12 `hdml-*` tag names at module-load time (defined in [`@hdml/types`](https://www.npmjs.com/package/@hdml/types) as `HDML_TAG_NAMES`). Importing `@hdml/components` has side effects. See [docs/components.md](docs/components.md).
- **`hdom-changed` DOM event** — every HDQL element dispatches a non-bubbling `CustomEvent<HdqlElement>` on `document` whenever it is connected, disconnected, or has an observed attribute change. `<hdml-io>` is the canonical listener. See [docs/architecture.md](docs/architecture.md).
- **D8 discovery bus** — three `document` events (`bubbles`/`composed`, names configurable via `window.HDML_CONFIG`) are how a **separate-repo** data-binding consumer talks to `<hdml-io>`: it dispatches **`hdml-io-request`** carrying a `RequestDetail` `{id, ref, column, raw?, signal?, deliver}` — **`deliver` is required**, and a detail without a function one is rejected outright; `<hdml-io>` announces **`hdml-io-ready`** when it can receive (the symmetric handshake, de-duped by `id`) and **`hdml-io-gone`** at disconnect (the generation space has ended). Delivery is **callback-only**: [`Delivery`](src/hdio/delivery.ts) is the consumer-facing union (`data` / `absent` / `error`, each with a `DeliveryCode` where it can fail), re-exported from [`HdmlIo.ts`](src/hdio/HdmlIo.ts) for external consumers and imported **type-only** from `./delivery` in-repo. Consumers adopt by the **stamp** (`generation >= latest`), not the kind. See [docs/hdio-client.md](docs/hdio-client.md#the-discovery-bus--subscription-registry-step-08-d7d8).
- **HDIO HTTP client** — `<hdml-io host tenant token>` targets the post-006 tenant routes at one base (`host`). There is **no** `sessions` bootstrap: in token mode the `token` attribute is a single-use **handoff code** that `HdioClient` redeems at `POST {host}/{tenant}/api/v1/auth/token` `{token}` for the `{access_token, refresh_token}` pair, held **in memory only** (silently refreshed via `POST …/auth/token/refresh`). It then `POST {host}/{tenant}/api/v1/documents/dynamic` with an `application/octet-stream` body of the `DocumentFilesStruct` FlatBuffers (the whole document, re-sent every change — no dedup) carrying a real `Authorization: Bearer <access>`; the **201** `{ stored[], ddl[] }` response is folded into the ref→key→stored registry. See [docs/hdio-client.md](docs/hdio-client.md).
- **Four entry points** — `.` (the compatibility root: 11 HDQL elements + `<hdml-io>`, exactly what it always registered), `./hdio`, `./hdql` and `./hdvl`, declared in an `exports` map. The three sub-entries are purely additive; `./hdvl` registers no tag yet. `exports` is a resolution **fence**, so deep paths like `@hdml/components/esm/hdql/HdmlFrame.js` no longer resolve — that break is intended. See [docs/integration.md](docs/integration.md#entry-points).
- **npm package shape** — `main: cjs/index.js`, `module: esm/index.js`, `types: dts/index.d.ts`, `customElements: custom-elements.json` (CEM, generated by `npm run manifest`), plus the `exports` map and a `sideEffects` array covering both module formats of all four entries; plus an unreferenced IIFE bundle at `bin/index.min.js`, built from `src/bundle.ts` and carrying all three layers. See [docs/integration.md](docs/integration.md).

## Cross-repo dependencies

| Needed from | What | Pinned at |
|---|---|---|
| `@hdml/common` | `throdeb` (debounce) | `0.0.2-alpha.24` |
| `@hdml/hash` | `bytesToBase64`, `hashify`, `uid` | `0.0.2-alpha.24` |
| `@hdml/parser` | `parseHDML` | `0.0.2-alpha.24` |
| `@hdml/buffer` | `serialize`, `fileifize`, `StructType` | `0.0.2-alpha.24` |
| `@hdml/types` | `HDOM`, `HDML_TAG_NAMES`, `*_ATTRS_LIST` enums | `0.0.2-alpha.24` |
| `lit` | reactive web-component base | `^3.2.1` |
| `whatwg-fetch` | `fetch` polyfill for older browsers (legacy plugin) | `^3.6.20` |

**Lockstep.** All `@hdml/*` ship at **one version per release**; this repo is aligned at
`0.0.2-alpha.24` (the HDVL display-vocabulary release). The five deps are pinned
**exactly**, not by caret range, so the lockfile can never resolve a stale tree behind a
current manifest. Bump the five `@hdml/*` deps together when realigning. See
[docs/integration.md](docs/integration.md#version-alignment).

## Conventions

- **No source comments unless they explain *why*.** TypeDoc `@tagname` / `@attribute` /
  `@event` JSDoc on the class is the public-facing reference — keep it accurate; CEM analysis
  reads it.
- **Attribute property keys are `*_ATTRS_LIST` enums**, not literals — e.g.
  `[CONN_ATTRS_LIST.NAME]: null | string = null` (see [src/hdql/HdmlConnection.ts:159](src/hdql/HdmlConnection.ts#L159)). The enum lives in `@hdml/types`; do not hardcode attribute strings here.
- **Display tag names and attribute keys come from [`src/hdvl/vocabulary.ts`](src/hdvl/vocabulary.ts)** — never a direct `@hdml/types` import in a display element file, and never a literal. That module is the only importer of the display vocabulary, so the 21 tags and 20 attribute enums are auditable in one place. (`src/hdql/` keeps importing its eight data enums directly, as it always has; and `@customElement("hdml-io")` stays a literal, because `HDML_TAG_NAMES` has no `IO` member — `hdml-io` is neither a data nor a display tag.) See [docs/decisions.md](docs/decisions.md).
- **All HDQL elements extend [`HdqlElement`](src/hdql/HdqlElement.ts#L8)**. Subclasses *do not* override the lifecycle hooks — the base hooks `connected`/`disconnected`/`attributeChanged` already dispatch `hdom-changed`. Subclasses only declare `@property` fields.
- **Worker code path:** `src/hdio/HdmlIo.worker.ts` exports `const _script = "_script"` as a build-time sentinel. The custom esbuild plugin in [.esbuildrc.mjs:8-45](.esbuildrc.mjs#L8-L45) bundles the worker and rewrites this constant to the bundled source string in the IIFE build only. In `esm/`/`cjs/` builds the sentinel survives, and `HdmlIo` falls back to running the message handler on the main thread (`globalThis.self`). See [docs/decisions.md](docs/decisions.md#why-_script).
- **Lint/format rule that bites:** `max-len: 70`, `printWidth: 70` (ESLint + Prettier). Wrap aggressively.
- **TypeDoc output is isolated under `docs/api/`.** `npm run docs` writes generated HTML to `./docs/api` and `npm run clear` removes only `docs/api` — so the hand-written agent docs (`docs/*.md`) survive a `clear`/`build`. The [.gitignore](.gitignore) ignores `docs/*` and re-includes `!docs/*.md`, so `docs/api/` stays untracked while the `.md` are committed. (Previously `clear` did `rm -rf docs`, deleting the tracked `.md` from the working tree; that TODO is now resolved.)
- **Tests use TDD-style globals.** `.testrc.js` sets `ui: "tdd"` — write `suite` / `test`, not `describe` / `it`. See an example at [src/hdql/HdmlConnection.test.ts:11](src/hdql/HdmlConnection.test.ts#L11).
- **Two export conditions.** `MODE=prod` selects the `prod` package export condition (both dev server and test runner); the default uses `development`. `TODO(confirm: which @hdml/* package actually publishes both conditions and what the dev one swaps in.)`
- **License header.** Every TS source carries the four-line `@author / @copyright / @license Apache-2.0` JSDoc preamble. Preserve it.
