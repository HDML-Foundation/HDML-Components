# Design decisions

**Scope:** non-obvious choices in this repo, each in one short paragraph, with the
*why* (or the limit of what I could confirm). For broad architectural narrative see
[docs/architecture.md](architecture.md).

## A single `document`-level event bus

Every `Hdml*` element fires `hdom-changed` on the **`document`** (not on itself, not
`bubbles: true`). The `detail` is the element instance. This is set once in
[`HdqlElement`](../src/hdql/HdqlElement.ts) and never overridden. Why: it gives `<hdml-io>` a
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

## The display vocabulary reaches elements through one module

The display half of HDML — twenty-one tag names and twenty `*_ATTRS_LIST` enums — lives
in `@hdml/types`, exactly as the data half above does, and reaches every display element
through a single re-export module, [`src/hdvl/vocabulary.ts`](../src/hdvl/vocabulary.ts).
No display element imports `@hdml/types` directly, and no display tag or attribute string
is ever written as a literal.

*Why the enums live in `@hdml/types` rather than here:* they are a **published
cross-repo contract**, so a tag renamed upstream becomes a compile error in this repo
rather than a silently unregistered element. *Why the single re-export module rather than
twenty-one direct imports:* the 21/20 counts are then auditable in one file instead of
twenty-one, and it is one place to assert that no data tag has leaked into the display
set. `HDVL_TAG_NAMES` is built by reading members off `HDML_TAG_NAMES`, so the values
cannot drift from the published enum even by a typo.

This is the same rule as *Subclasses have no logic* above, one layer out: that entry keeps
attribute **keys** schema-driven for the data family; this one keeps tag **names** and
attribute keys schema-driven for the display family, through an indirection the data
family does not need because it has no second consumer.

## One `<svg>` per view, and the scene is data

Every display element owns a CSS box and paints nothing. **One `<svg>`, in the
`hdml-view`'s shadow root, owns all pixels**, and each widget hands the renderer a
plain-data [`SceneGroup`](../src/hdvl/scene.ts) describing what it wants drawn. See
[docs/architecture.md](architecture.md#the-render-pipeline) for the shape.

*Why one surface rather than one per widget:* twenty-one nested SVGs would put paint
order at the mercy of CSS stacking rules, when SPEC's rule is simply *document order is
paint order*. One surface makes that exact — the view concatenates groups in document
order and array order is paint order — and it costs one `viewBox` instead of
twenty-one coordinate systems to reconcile.

*Why data rather than a drawing API:* three prototype shapes were rejected, all of them
from the PoC. Widgets holding **d3 selections into the view's SVG** makes every widget a
DOM writer, so paint order depends on who ran last and two widgets can fight over the
same node. A **per-element `CSSStyleSheet` pushed into the view** inverts the cascade the
UA sheet depends on. And recovering a datum by **inverting a scale** at hit time is
wrong for any non-injective scale and rounds for the rest — so a node carries the source
row index `i` it was built from, and `resolve()` returns that, never a re-derived value.

The payoff is testing. A scene is immutable and `structuredClone`-serializable, so a
widget test constructs no page and reads back no attributes: it compares one plain
object. The renderer is asserted never to write to what it is handed, which is what
keeps that comparison meaningful.

*Why the renderer is behind an interface when SVG is the only one:* neutrality is kept
only where it is free or simplifying. Parameterised `arc` nodes hit-test and clip more
simply than pre-serialized paths; `resolve()` needs nearest-vertex maths the SVG
renderer requires anyway, because `isPointInStroke` answers *whether* a point is on a
stroke and never *which row*. Where neutrality would cost — the device-pixel mapping,
and collapsing `line` into a degenerate cubic — the cheaper form wins. The recording
renderer under [src/testing/](../src/testing/) is a **test double, not a second
renderer**: it records the scene and draws nothing.

## No d3 — the geometry kernel is hand-written

[src/hdvl/kernel/](../src/hdvl/kernel/) is the display half's maths, and it has **no
dependency**. Not d3-scale, not d3-array, not d3-shape — and not as a reference
implementation copied by hand either. This is a decision about *divergence*, not about
bundle size, and it was taken before a line of the kernel existed.

**Where the model differs from d3, specifically:**

- **The tick ladder.** SPEC's `tickStep` rounds the raw step **up** to the next
  `{1, 2, 5} × 10ⁿ` rung, so `count` is a target that round values beat. d3's
  `tickIncrement` rounds to the **geometric nearest** (`√50`, `√10`, `√2`). The two
  disagree about how many ticks a chart has for the same domain and target.
- **The step's representation.** At a negative power our step is an **integer
  divisor**, not a multiplied `10^power`: the ladder generates `i / 10`, never
  `i * 0.1`. That is the difference between `0.3` and `0.30000000000000004` at index 3
  of `ticks(0, 1, 10)` — and, at a domain endpoint, the difference between a tick that
  is inside the domain and one that is 4 ulp outside it. A tick that exists on one
  engine and not another is a chart with a different number of labels per browser, not
  a rounding difference.
- **The band formula.** `step = W / (n − 1 + b)` with every non-band-filling lookup
  resolving to the band **centre**, which is what makes a line's vertices sit on its
  bars' centrelines at any `--hdml-bandwidth`. Deliberately not d3's
  `paddingInner`/`paddingOuter` model.
- **Three of the eight `--hdml-curve-type` values** do not correspond to a
  `d3.curve*` as registered.

Adopting d3 and then overriding those would mean shipping four packages to use a
fraction of one of them, while the parts that matter most are the parts we replace.
The whole kernel is on the order of a few hundred lines, every function is pure, and
every one has a fixture table asserted on all three engines — which is the other half
of the argument: a hand-written ladder we can assert **exactly** is worth more here
than a borrowed one we would have to assert approximately.

## `temporal-polyfill` behind a four-operation seam

The kernel has exactly **one** runtime dependency, and it is the only one this package
adds for the display half: [`temporal-polyfill`](https://www.npmjs.com/package/temporal-polyfill),
pinned **exactly**, imported from [src/hdvl/kernel/zone.ts](../src/hdvl/kernel/zone.ts)
and from nowhere else.

*Why a dependency at all, given the entry above:* because `Temporal` is a **standard**,
not a library. The *No d3* decision is not "write everything ourselves" — it is that we
will not ship a library whose model contradicts the spec we implement. Here the
situation is the opposite: the model we want *is* the platform's, and the polyfill is
the platform's own semantics delivered early. Taking it **is** the
standards-over-libraries rule rather than an exception to it. The alternative —
hand-rolling IANA zone arithmetic, DST gap and overlap resolution, and a leap-year-aware
calendar — is the one place in the kernel where "a few hundred lines of pure functions
we can assert exactly" stops being true.

*Why a ponyfill value and never a global patch:* `import "temporal-polyfill/global"`
would make the whole embedding page's `Temporal` ours. A charting library has no
business deciding that for the application that loaded it, and a page that also loads
its own polyfill would get whichever import ran last. We import the value by name and
nothing observable outside this package changes.

*Why the module reads no ambient binding, ever:* the native `Temporal` is present on
chromium and firefox and **absent on webkit** (measured). An implementation that
feature-detected would therefore run *different calendar code on different engines*,
which would turn every calendar assertion in the suite into a claim about three
implementations that happen to agree today. That is asserted against `zone.ts`'s
**source text**, not its behaviour, because no behavioural test can tell a polyfilled
implementation from a native one — which is the whole failure mode.

*Why four operations and not `Temporal` objects passed around:* the seam is `floorTo`,
`ceilTo`, `addUnits` and `fieldsOf`, and **only epoch milliseconds cross it**. No
library object escapes the module, so no call site anywhere in the package names a type
from the package. Every boundary the calendar ladder emits is therefore an exact
integer, assertable bit-for-bit on all three engines rather than through a tolerance.

*The removal condition:* the day `Temporal` ships everywhere we support, the swap is
**one import line** and no call site changes. That is the property the four-operation
surface exists to buy, and it is the test of whether the seam is still doing its job —
if a fifth operation ever looks necessary, the seam has started leaking and that is a
design change, not a convenience.

## `transitionrun` replaces the document-wide `MutationObserver`

A chart has to repaint when its **CSS** changes, not only when its markup or its data
does — a class flip, a stylesheet swap or a container-query breakpoint can change a
`--hdml-*` value, a colour, or an element's position with nothing in the DOM moving.
The PoC answered that with a **document-wide `MutationObserver`**, watching every
`style`/`class` attribute and every `<style>`/`<link>` node in the page. That is
rejected here: it costs every page that embeds a chart, it fires on mutations that
change no computed value, and — the fatal part — it still cannot see a rule that
*already existed* and merely started matching.

What replaces it is a **1 ms UA transition** declared in the element sheet over every
registered `--hdml-*` property plus `color`, `inset`, `margin`, `padding`, `width` and
`height`. The platform then answers the question directly: a declarative change to any
of those fires `transitionrun` on the element, and one capturing listener on the view
turns that into one frame. It was measured on all three engines for **inline**,
**inherited** and **stylesheet-driven** changes before anything was built on it.
Combined with a `ResizeObserver` over the view *and every descendant*, that is the whole
of CSS-driven invalidation, at zero cost to pages that never change a style.

**It is written as longhands, and that is not a style preference.** `transition` is a
shorthand, so any later rule of ours that used the shorthand form would replace the
sentinel wholesale and silently kill detection for that family — the hardest class of
bug to attribute, because the CSS is visibly correct in DevTools. The sheet declares
`transition-property` + `transition-duration`, and every rule added to it must keep
doing so.

**The hole is stated rather than hidden.** An *author* `transition` shorthand on a
display element removes the sentinel the same way:

```css
hdml-line { transition: none }              /* detection off */
hdml-line { transition: opacity 200ms }     /* also off */
hdml-line { transition-duration: 300ms }    /* still on */
```

MEASURE already reads a computed-style block per element, so it also reads
`transition-property` back and records whether the sentinel survived. The fallback
`MutationObserver` is not deleted — it stays available, **off by default**, as the
manual `HDML_CONFIG.paranoidObserver` opt-in and as the automatic self-heal for pages
that actually override.

## `HDML.supports()` answers from the registry, not from a feature list

`HDML.supports("hdml-stack")` is specified as answering what the runtime
**implements**, not what the vocabulary names — and during v1 the two genuinely
differ: all twenty-one display tags are registered with their attributes, but
most of them still have no body. The obvious reading of "implements" is a
per-element completeness flag, and that is the option this rejects.

A hand-maintained list of which elements are "done" is stale the moment a slice
lands, and it is stale *silently* — nothing fails, `supports()` just starts
lying. That is precisely the drift the same specification closes one sentence
later by requiring the answer to come from the published enums. So the
implemented rule is the one that is mechanically true: **a tag is supported if
this build registered it, and an attribute is supported if it is in that tag's
published `*_ATTRS_LIST`.**

That answers the question a host app is actually asking. `supports()` lives in
the display half, so a page that never imports `@hdml/components/hdvl` gets
`false` for all twenty-one — which is the real feature-detection case — and a
page that does gets an answer that cannot disagree with `customElements`. The
residual gap is honest and bounded: during v1, `supports("hdml-pie")` is `true`
before `hdml-pie` draws anything. The alternative was a flag that would report
`false` for an element whose tag, attributes and CSS surface all work.

Registration is **additive**. The namespace object is reused, never replaced, so
a page that loads two builds — or a host app that already owns `window.HDML` —
keeps everything else on it.

## `<hdml-io>` is **not** a `HdqlElement`

It extends `LitElement` directly. `<hdml-io>` observes the document, it does not
*participate* in it. Routing it through `HdqlElement` would dispatch `hdom-changed` on itself
(infinite loop) or require a special case. The separation also splits the dependency graph:
the HDQL elements never import the hdio layer.

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

## CI builds the devcontainer image, not a release

[main.yml](../.github/workflows/main.yml) only `npm ci && npm run build`s the
package inside the devcontainer; no `npm publish`. [`scripts/release.sh`](../scripts/release.sh)
is entirely commented out — looks inherited from a monorepo template. The publish flow is
manual. `TODO(confirm: the actual release procedure.)`
