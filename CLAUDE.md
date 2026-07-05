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
| [src/index.ts](src/index.ts) | Module entry. Side-effect imports register every custom element on load. |
| [src/hdom/](src/hdom/) | The 11 declarative HDML elements (`HdmlConnection`, `HdmlModel`, `HdmlTable`, `HdmlField`, `HdmlJoin`, `HdmlConnective`, `HdmlFilter`, `HdmlFrame`, `HdmlFilterBy`, `HdmlGroupBy`, `HdmlSortBy`) + the shared [`HdomElement`](src/hdom/HdomElement.ts) base + `.test.ts` peers. |
| [src/hdio/](src/hdio/) | `<hdml-io>` host element, its Web Worker entry, `onmessage` router, `parse()` (HTML → FlatBuffers via `@hdml/*`), `HdioClient` (HTTP). |
| [html/](html/) | Static test pages served by the dev server — one per element under `html/hdom/`, two for `hdml-io` under `html/hdio/`, index at `html/index.html`. |
| [tsconfig/](tsconfig/) | `base.json` + four targets: `cjs.json`, `esm.json`, `dts.json`, `tst.json`. |
| [.esbuildrc.mjs](.esbuildrc.mjs) | Builds the `bin/index.min.js` IIFE. Includes a custom `buildWorkerPlugin` that bundles `*.worker.js` and inlines it as `const _script = "...";`. |
| [.devrc.js](.devrc.js) · [.testrc.js](.testrc.js) | `@web/dev-server` and `@web/test-runner` configs (legacy plugin, Playwright launchers, dev/prod export conditions via `MODE` env). |
| [.devcontainer/](.devcontainer/) · [.github/workflows/](.github/workflows/) | Dev image (Node 18, Go 1.22, flatc v24.3.25 — flatc/Go are vestigial; this repo does not run `flatc` itself) + CI (`main.yml` builds the devcontainer image then `npm ci && npm run build`). |
| [scripts/init.sh](scripts/init.sh) · [scripts/release.sh](scripts/release.sh) | Devcontainer attach hook (git identity + SSH key). `release.sh` is fully commented out — `TODO(confirm: release process)`. |

## External contracts

This repo *promises* the following to its consumers; any change here is a cross-repo change.

- **Custom-element registry** — registers ~12 `hdml-*` tag names at module-load time (defined in [`@hdml/types`](https://www.npmjs.com/package/@hdml/types) as `HDML_TAG_NAMES`). Importing `@hdml/components` has side effects. See [docs/components.md](docs/components.md).
- **`hdom-changed` DOM event** — every HDOM element dispatches a non-bubbling `CustomEvent<HdomElement>` on `document` whenever it is connected, disconnected, or has an observed attribute change. `<hdml-io>` is the canonical listener. See [docs/architecture.md](docs/architecture.md).
- **HDIO HTTP client** — `<hdml-io host tenant token>` issues `GET {host}/public/api/v1/{tenant}/sessions?tenant=…&token=…` to obtain a session bearer token, then `POST {host}/{tenant}/api/v1/documents/dynamic` with an `application/octet-stream` body of the `DocumentFilesStruct` FlatBuffers (the whole document, re-sent every change — no dedup); the **201** `{ stored[], ddl[] }` response is folded into the ref→key→stored registry. See [docs/hdio-client.md](docs/hdio-client.md).
- **npm package shape** — `main: cjs/index.js`, `module: esm/index.js`, `types: dts/index.d.ts`, `customElements: custom-elements.json` (CEM, generated by `npm run manifest`); plus an unreferenced IIFE bundle at `bin/index.min.js`. See [docs/integration.md](docs/integration.md).

## Cross-repo dependencies

| Needed from | What | Pinned at |
|---|---|---|
| `@hdml/common` | `throdeb` (debounce) | `^0.0.2-alpha.15` |
| `@hdml/hash` | `bytesToBase64`, `hashify`, `uid` | `^0.0.2-alpha.15` |
| `@hdml/parser` | `parseHDML` | `^0.0.2-alpha.15` |
| `@hdml/buffer` | `serialize`, `fileifize`, `StructType` | `^0.0.2-alpha.15` |
| `@hdml/types` | `HDOM`, `HDML_TAG_NAMES`, `*_ATTRS_LIST` enums | `^0.0.2-alpha.15` |
| `lit` | reactive web-component base | `^3.2.1` |
| `whatwg-fetch` | `fetch` polyfill for older browsers (legacy plugin) | `^3.6.20` |

**Lockstep.** All `@hdml/*` ship at **one version per release**; this repo is aligned at
`0.0.2-alpha.15` (the `hdml-include` removal release). Bump the five `@hdml/*` deps together
when realigning. See [docs/integration.md](docs/integration.md#version-alignment).

## Conventions

- **No source comments unless they explain *why*.** TypeDoc `@tagname` / `@attribute` /
  `@event` JSDoc on the class is the public-facing reference — keep it accurate; CEM analysis
  reads it.
- **Attribute property keys are `*_ATTRS_LIST` enums**, not literals — e.g.
  `[CONN_ATTRS_LIST.NAME]: null | string = null` (see [src/hdom/HdmlConnection.ts:159](src/hdom/HdmlConnection.ts#L159)). The enum lives in `@hdml/types`; do not hardcode attribute strings here.
- **All HDOM elements extend [`HdomElement`](src/hdom/HdomElement.ts#L8)**. Subclasses *do not* override the lifecycle hooks — the base hooks `connected`/`disconnected`/`attributeChanged` already dispatch `hdom-changed`. Subclasses only declare `@property` fields.
- **Worker code path:** `src/hdio/HdmlIo.worker.ts` exports `const _script = "_script"` as a build-time sentinel. The custom esbuild plugin in [.esbuildrc.mjs:8-45](.esbuildrc.mjs#L8-L45) bundles the worker and rewrites this constant to the bundled source string in the IIFE build only. In `esm/`/`cjs/` builds the sentinel survives, and `HdmlIo` falls back to running the message handler on the main thread (`globalThis.self`). See [docs/decisions.md](docs/decisions.md#why-_script).
- **Lint/format rule that bites:** `max-len: 70`, `printWidth: 70` (ESLint + Prettier). Wrap aggressively.
- **TypeDoc output is isolated under `docs/api/`.** `npm run docs` writes generated HTML to `./docs/api` and `npm run clear` removes only `docs/api` — so the hand-written agent docs (`docs/*.md`) survive a `clear`/`build`. The [.gitignore](.gitignore) ignores `docs/*` and re-includes `!docs/*.md`, so `docs/api/` stays untracked while the `.md` are committed. (Previously `clear` did `rm -rf docs`, deleting the tracked `.md` from the working tree; that TODO is now resolved.)
- **Tests use TDD-style globals.** `.testrc.js` sets `ui: "tdd"` — write `suite` / `test`, not `describe` / `it`. See an example at [src/hdom/HdmlConnection.test.ts:11](src/hdom/HdmlConnection.test.ts#L11).
- **Two export conditions.** `MODE=prod` selects the `prod` package export condition (both dev server and test runner); the default uses `development`. `TODO(confirm: which @hdml/* package actually publishes both conditions and what the dev one swaps in.)`
- **License header.** Every TS source carries the four-line `@author / @copyright / @license Apache-2.0` JSDoc preamble. Preserve it.
