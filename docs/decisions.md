# Design decisions

**Scope:** non-obvious choices in this repo, each in one short paragraph, with the
*why* (or the limit of what I could confirm). For broad architectural narrative see
[docs/architecture.md](architecture.md).

## A single `document`-level event bus

Every `Hdml*` element fires `hdom-changed` on the **`document`** (not on itself, not
`bubbles: true`). The `detail` is the element instance. This is set once in
[`HdomElement`](../src/hdom/HdomElement.ts) and never overridden. Why: it gives `<hdml-io>` a
single, position-independent hook to detect *any* declarative change anywhere in the page
without traversing or observing per-element. The trade-off is that a single page should host
only one `<hdml-io>` per tenant — multiple listeners would each rebuild and POST. *Why not
MutationObserver?* It would also catch text-node noise; targeting Lit's own lifecycle is
cheaper and more deterministic. `TODO(confirm: this is the deliberate design rationale and
not just incidental.)`

## Subclasses have no logic

`HdmlConnection`, `HdmlModel`, etc. each declare only `@property` fields keyed by
`*_ATTRS_LIST` enums from `@hdml/types`. No `render()` override (the base renders
`<slot></slot>`), no lifecycle override. This keeps element behavior 100% data-driven by the
shared schema — if `@hdml/types` adds a new attribute, the change is one line per affected
component. It also keeps the JSDoc-only API the source of truth for both TypeDoc and CEM.

## `<hdml-io>` is **not** a `HdomElement`

It extends `LitElement` directly. `<hdml-io>` observes the document, it does not
*participate* in it. Routing it through `HdomElement` would dispatch `hdom-changed` on itself
(infinite loop) or require a special case. The separation also splits the dependency graph:
the hdom elements never import the hdio layer.

## <a name="why-_script"></a>The `_script === "_script"` sentinel

[`HdmlIo.worker.ts`](../src/hdio/HdmlIo.worker.ts) ends with `const _script = "_script";
export default _script;`. In ESM/CJS builds this literal survives, and `HdmlIo` runs the
worker's `onmessage` handler on the main thread (`#messagable = globalThis.self`). In the
IIFE build, [`.esbuildrc.mjs`](../.esbuildrc.mjs#L8-L45) registers a custom plugin that
matches `\.worker\.js$`, bundles that file as a minified IIFE, then *rewrites* the module to
`const _script = "<bundled-source>"; export default _script;` — so the same `import` now
yields a JS source string, which `HdmlIo` turns into a Blob URL and a real `Worker`.

Why a sentinel rather than two builds? It keeps a single source tree producing both
single-file (drop-in `<script>`) and bundled-app (ESM tree-shaking) variants without
duplicate code paths. The cost is the dance documented here, and a `_script === "_script"`
string comparison that looks unusual.

## Debounce of 5 ms

Both property and HTML posts are debounced at 5 ms (`throdeb.debounce` from `@hdml/common`).
This is short enough to feel synchronous but long enough to coalesce the burst of
`attributeChangedCallback` events Lit emits when multiple `@property` setters fire in the
same microtask (e.g. when the page first parses an `<hdml-connection>` with ten attributes).
The Worker only sees one message per change, not ten.

## Dev / prod export conditions

Both [.devrc.js](../.devrc.js) and [.testrc.js](../.testrc.js) pick `nodeResolve`'s
`exportConditions` from `process.env.MODE`: `dev` ↔ `["development"]`, anything else ↔
`["prod"]`. This expects the `@hdml/*` packages to publish both conditions. `TODO(confirm:
which dep actually exports a "development" condition and what it swaps in — e.g. debug
logging, looser type guards, source-map-preserving builds.)`

## TDD-style test globals

[.testrc.js](../.testrc.js) sets `testFramework.config.ui: "tdd"`. Tests use
`suite(...)`/`test(...)`. Why TDD rather than the default BDD `describe`/`it`? Unverified,
but the rest of the codebase uses an imperative style and the TDD globals match. If you mix
in BDD style by accident the runner will silently ignore those blocks.

## 70-column line width

[.eslintrc.js](../.eslintrc.js#L31-L36) sets `max-len: 70` and Prettier `printWidth: 70`.
Aggressive, but the JSDoc on these elements is long and 70 cols keeps it readable in
TypeDoc's HTML. Match the existing wrap when editing or the lint will fail.

## `docs/` collides with TypeDoc

[package.json:46](../package.json#L46): `typedoc --out ./docs`. [package.json:44](../package.json#L44): `npm run clear` does `rm -rf docs`. These agent docs live in `docs/*.md`. We work around it via [`.gitignore`](../.gitignore) (`!docs/*.md` keeps them tracked), but `npm run clear` will still delete them from disk. `TODO(confirm: move typedoc out-dir to ./docs/api/ and update both scripts so the tooling and these docs stop colliding.)`

## Vestigial toolchain in the dev image

[.devcontainer/Dockerfile](../.devcontainer/Dockerfile) installs Go 1.22, `flatc` v24.3.25,
and Python. This repo runs none of them — its FlatBuffers contract is consumed via the
`@hdml/buffer` / `@hdml/types` packages. The image is shared across the HDML workspace, so
removing them is a workspace-level decision, not local cleanup.

## No `src/hdio/*.test.ts`

The hdom layer has full per-attribute tests; the hdio layer (`HdmlIo`, `HdioClient`,
`onmessage`, `parse`) has none. The unit shape is awkward — `HdmlIo` requires a DOM, a
Worker, and an HDIO server simultaneously. `TODO(confirm: hdio tests are intentionally
deferred to integration tests in HDIO-Server, not absent by oversight.)`

## CI builds the devcontainer image, not a release

[main.yml](../.github/workflows/main.yml) only `npm ci && npm run build`s the
package inside the devcontainer; no `npm publish`. [`scripts/release.sh`](../scripts/release.sh)
is entirely commented out — looks inherited from a monorepo template. The publish flow is
manual. `TODO(confirm: the actual release procedure.)`
