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

## <a name="the-endpointts-seam"></a>The `endpoint.ts` seam (was the `_script` sentinel)

**Superseded by RFC 014/001 Slice A.** The old boundary branched *inside* `HdmlIo.ts` on a
build-time sentinel: [`HdmlIo.worker.ts`](../src/hdio/HdmlIo.worker.ts) exported `const
_script = "_script"`, the element compared `_script === "_script"` and, when true, ran the
handler on the main thread via `#messagable = globalThis.self`. On the main thread
`globalThis.self` **is** `window`, so the element installed `window.onmessage` and was
reachable by any cross-origin frame's `postMessage` — an isolation bug.

The branch now lives in a seam module, [`endpoint.ts`](../src/hdio/endpoint.ts), exporting
`createEndpoint()` / `closeEndpoint()`. `HdmlIo.ts` holds `#endpoint: null | Endpoint`
(`Worker | MessagePort`) and never inspects the build. Two forms:

- **Fallback (checked-in, esm/cjs).** `createEndpoint` builds a private `MessageChannel`,
  wires `createHandler(post)` onto `port2.onmessage`, and hands `port1` to the element. No
  global slot is touched (A1). It is same-thread async message passing — a
  correctness/isolation fix, not parallelism; the fallback still parses on the main thread.
  The gotcha baked into the seam: a port delivers nothing until started, and assigning
  `.onmessage` starts it implicitly (`addEventListener("message", …)` would need
  `port.start()`).
- **IIFE (`bin`).** The esbuild plugin in [`.esbuildrc.mjs`](../.esbuildrc.mjs) matches
  **`endpoint.js`** (re-pointed from `*.worker.js`), bundles `HdmlIo.worker.js` as a minified
  IIFE, and replaces the whole module with a `createEndpoint` that Blob-URL-spawns it as a
  real `Worker`.

**Why invert onto `endpoint.js` and not import the handler directly (A2).** If the element
imported `createHandler` for the fallback, esbuild would pull `onmessage.ts` (and
`@hdml/parser`, `@hdml/buffer`, `@hdml/hash`, flatbuffers) into the **main** bundle *as well
as* the inlined worker string — shipping that payload twice. Swapping the whole `endpoint.js`
module keeps the worker graph off the main graph — the property the old `*.worker.js` swap
already had and must not lose. (Verified: in `bin/index.min.js` the `@hdml/parser` graph
appears only inside the bundled worker string, ahead of the `new Worker(` call.)

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
