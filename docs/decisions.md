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
  `d3.curve*` as registered, and [src/hdvl/kernel/curves.ts](../src/hdvl/kernel/curves.ts)
  now says which. `--hdml-curve-cubic-monotonicity` is a `<number>` 0..1 — a *blend*
  between the Catmull–Rom tangent and the Fritsch–Carlson limited one, applied **per
  component** rather than along a chosen axis — where d3 ships `curveMonotoneX`/`Y`
  and no parameter at all. `--hdml-curve-basis-beta` maps to `curveBundle`, which is
  **open-curve only**, while SPEC allows curves on `hdml-area` and on `closed` radar
  lines. And `--hdml-curve-bezier-tangents` has an **"auto" initial** that picks the
  dominant axis per *segment*, where `curveBumpX`/`Y` are axis-fixed for the whole
  path.

Adopting d3 and then overriding those would mean shipping four packages to use a
fraction of one of them, while the parts that matter most are the parts we replace.
The whole kernel is on the order of a few hundred lines, every function is pure, and
every one has a fixture table asserted on all three engines — which is the other half
of the argument: a hand-written ladder we can assert **exactly** is worth more here
than a borrowed one we would have to assert approximately.

## `curve()` takes runs, not a flat list with a sentinel

[`kernel/curves.ts`](../src/hdvl/kernel/curves.ts) is
`(runs, type, options) → Subpath[]` — the **caller** splits a series at its missing
values, and the kernel curves each run independently. The alternative reads just as
naturally from the call site (`(points: (Point | null)[], …)`, splitting inside), so
this is written down rather than left to be re-litigated.

Two reasons, and the second is the load-bearing one:

- **What "missing" means is data-space knowledge.** It is a `Delivery`'s nulls plus a
  non-finite check, and it belongs to the mark that read the column. A kernel that
  owned a sentinel would be encoding a data contract in a module whose entire input is
  view-coordinate geometry.
- **Splitting first is what §4.7 actually requires.** *"Never bridged by
  interpolation"* is not satisfied by curving across a gap and slicing the result
  afterwards: `natural`'s tridiagonal solve is **global over its run**, so a bridged
  gap bends the whole curve around data that is not there — including the parts either
  side of the gap that *are* real. Curving each run separately is the only construction
  where the gap changes nothing about its neighbours, and the test suite asserts
  exactly that for all eight values.

**A run of fewer than two points is dropped.** It has no segment on any of the eight,
and a zero-segment `Subpath` would put a pen-down that strokes nothing into every
scene, which the renderer's diff and `hdml-area`'s forward/reversed edge assembly
would each have to special-case. A lone point that must be *visible* is
`hdml-point`'s job, not a line's.

## The plane supplies the `Projection`; a mark never names a channel

A mark's geometry is *"a pure function from (adopted data ⊗ resolved scales ⊗ own box
⊗ computed style)"*, and the piece that differs between a cartesian chart and a polar
one is exactly one function: how two projected channel positions become a point. So
that is the only piece a plane supplies.

[`mark.ts`](../src/hdvl/mark.ts) declares `Projection` — `channels`, `scale`,
`element`, `at`, `outOfDomain`, `point` — and `createProjection` implements all of it
except the composition, which arrives as an argument.
[`plane-cartesian.ts`](../src/hdvl/plane-cartesian.ts) passes the identity pair;
[`plane-polar.ts`](../src/hdvl/plane-polar.ts) passes `polarPoint` about the pole. A
mark reads `projection.channels[0]`, never the string `"x"`, so **the polar
composition arrived without a widget-level branch in any of the six marks** — the
prediction the seam was built on, and it held on contact: adding it changed
`plane-polar.ts` and nothing else.

**The pole is resolved per widget, not per plane**, because §4.6 puts it at the centre
of *the radius-channel scale's* content box (the plane's, where no radius scale
exists) and the widget's own chain is what says which radius scale serves it. It is
read off the MEASURE snapshot's content box, never a `getBoundingClientRect()` in
COMPUTE.

The rejected alternative is the one that writes itself: `chainScaleOf(ctx, this, "x")`
and `"y"` inside each mark, with a `TODO: polar` beside it. It is smaller today and it
costs six edits and six chances to disagree later — and the disagreements would be
silent, because a mark that projects polar coordinates cartesianly still draws
*something*.

Two consequences worth stating, because both look like accidents from outside:

- **The cartesian composition is the identity pair, and that is not a placeholder.** A
  cartesian scale's range is taken from its own content box, and a box is measured in
  view coordinates — so a projected `x` already *is* a view `x`. There is nothing left
  to compose.
- **§4.7's three clauses collapse into one `null`.** Missing, non-finite, and
  outside-an-ordinal-domain all make `Projection.at` return `null`, so no widget
  re-implements the drop rule and the two planes cannot disagree about when a row
  drops. What the widget still owns is what a drop *means* for its own shape: a path
  breaks, a discrete mark is omitted.

## Every reader is keyed by slot, never by `x` and `y`

The ranged forms (`x0`/`x1`, `y0`/`y1`, `a0`/`a1`, `r0`/`r1`) are spellings of their
base channel, not channels of their own — and a layout container *compiles into* the
ranged form rather than into a special case. So the mark base is written against
**slots**: `CHANNEL_SLOTS` carries each channel's simple attribute *and* its ranged
pair, `slotValuesOf` reads one slot, and `rowCountOf` takes a list of them.

`hdml-line` and `hdml-rule` use the simple form only, and could have been written
against a one-value-per-channel base in half the lines. They were not, because
`hdml-area` and `hdml-bar` need two values per channel per row and `hdml-stack` needs
to supply the lower one — and a base that assumed one value would have to be rewritten
by the first of those, with both marks rewritten along with it.

## The sugar is desugared once, into a synthetic scalar

`y` is sugar for `y0="0"`; polar `radius` is sugar for `r0="0"`. The obvious
implementation reads `y`, computes a geometry, and puts an `if (y0 !== null)` branch
beside it. That is the thing this codebase most wants to avoid: two code paths that
agree today, one of which a later change will forget.

So `rangedValuesOf(el, channel)` resolves *both* spellings into one `(low, high)` pair
before any geometry exists, and the sugar's lower edge is a **synthetic scalar**
`SlotValues` — byte-identical to what the literal `y0="0"` actually produces, because
SPEC §5 classifies `0` as a scalar broadcast and a scalar's `at()` ignores the row.
From the moment the resolver returns, nothing below it can tell which form the author
wrote, and `y="v"` and `y0="0" y1="v"` produce byte-identical scenes. `RangedValues`
does carry a `sugar` flag, and no geometry may branch on it: it exists so a test can
assert the desugaring happened.

The payoff is a slice away. `hdml-stack`'s per-row baseline is neither a literal nor a
column, but `low` is an ordinary `SlotValues` — so the container builds one over its
own derived array and the resolver consults that override before it reads attributes.
Nothing inside `hdml-bar` or `hdml-area` changes.

## An area region is one closed subpath, and the lower edge is reversed first

§6.1 says *the upper edge forward then the lower edge reversed, both curved*. That is
two `curve()` calls and a join, and the order matters twice.

**Reverse, then curve — not curve, then reverse.** A curve fitted to a reversed point
list is not the reverse of the curve fitted to the forward one: `natural`'s tridiagonal
solve is global over its run and `bezier` picks the dominant axis per segment, so a
curve-then-reverse implementation puts the lower edge somewhere the data is not. It
looks right on a flat baseline — which is every simple area — and is wrong on every
floating or stacked one, so it is asserted with a deliberately asymmetric lower edge.

**One closed subpath per region, not two subpaths.** A `Subpath` boundary means a GAP
(§4.7), and a renderer must never draw between two of them; an area's two edges are the
opposite — they are joined. So each contiguous stretch of rows becomes one subpath —
upper forward, a `line` across, lower reversed — and `closed: true` supplies the
left-hand cap. That reading does not collide with `hdml-line`'s `closed` (its polar
radar loop): both mean "this subpath closes", on different elements' geometry.

## A varying `color` on a path widget is an error

SPEC §7 grants `hdml-line` and `hdml-area` the `color` channel with no scalar-only
qualifier, while a `path` node carries **one** `Paint` for the whole series. Something
has to give, and painting the series in whichever row happened to survive first is
exactly the silent wrong chart the strict semantics exist to prevent. So it is an error
— `varying-path-color`, the twenty-second `DiagnosticCode`, reported as **V3**, whose
rule is §5's channel-attribute grammar and which this narrows on two tags.

Two scoping decisions worth keeping:

- **`hdml-bar` is not in it.** A bar emits one node per row and resolves a colour per
  row, so a per-row colour is honest there. "Path widget" is not "mark", and a rule
  written over marks would forbid something that works.
- **"Varying" is a statement about the document, not the data.** The test is that the
  `color` slot is not a scalar — the author wrote a column or a JSON array. A column
  that happens to hold one repeated value is still rejected. The alternative, comparing
  the resolved colours across surviving rows, is more permissive but would make a
  page's validity depend on which rows came back that morning, and would have to move
  the rule out of the structural pass to do it.

## A `size` value is a diameter, and it makes the glyph a circle

`hdml-point`'s extent comes from `--hdml-tick-width`/`-height`, or from the `size`
channel when it is bound, and two things about that were decisions rather than
readings.

**Both forms are diameters.** `--hdml-tick-width` is a *width*, and
`--hdml-size-min`'s `2px` initial reads as a 2 px dot; the alternative — treating
either as a radius — draws every glyph at twice its declared size, and **no scene
assertion catches it**, because every number in the scene is then self-consistently
wrong. That is why [`mark-point.test.ts`](../src/hdvl/mark-point.test.ts) asserts the
extent against the *computed property* rather than against a transcribed number.

**A bound `size` supplies both extents**, so the glyph is a circle and the two tick
properties are ignored rather than scaled. The channel is one number and there is no
second one to keep an authored aspect ratio against; any factor-based reading would
have to invent a denominator. The corpus's only `size` user
([`06-bubble.html`](../html/hdvl/06-bubble.html)) declares neither tick property and
asks for *area ∝ value*, which a circle of that diameter through a `sqrt` scale is
exactly.

The **ramp itself is the scale's** and not the widget's: `--hdml-size-min`/`-max` are
the `size` channel's *range*, resolved once in [`scale.ts`](../src/hdvl/scale.ts) from
the size scale's own measured snapshot. The widget calls `project()` — a second
interpolation here would be a second implementation of one rule, and the two would
eventually disagree.

## An arc's fully-unbound radial case is its own clause

`hdml-arc`'s radial extent has three cases, and the ranged resolver expresses only
two of them: `r0` **and** `r1` bound is the author's on both edges, and `radius`
bound is sugar for `r1`. The third — **nothing bound at all** — is the full radius
range, and the resolver cannot say it, because `null` is exactly what it returns for
an unbound channel. So the widget carries one explicit clause for it, and that clause
is what makes the pure `a0`/`a1` arc interchangeable with `hdml-pie`.

`--hdml-inner-radius` replaces the **synthetic** lower edge only. An authored `r0`
may paint inside the hole — authored data is sacred — and the predicate for
"synthetic" is `RangedValues.sugar`, whose JSDoc otherwise forbids branching on it.
This is **the one place in the project it is read**, and it is not a geometry branch:
both sides compute the same kind of number, and the question being asked is *did the
author say anything about the lower edge*, which is precisely what the flag means.

The property registers as a `<length-percentage>`, and a registered one **computes to
a percentage unresolved** — there is no layout box for the UA to resolve it against —
so the widget separates the two forms itself: a percentage takes the radial ceiling,
a length is already px.

## V5 reports a length mismatch; it does not stop the paint

*Equal length N across a widget's array/column bindings; scalars broadcast; mismatch
is an error, **never a `Math.max` zip**.* The rule landed as a diagnostic and
`rowCountOf`'s longest-wins behaviour did not change, for three reasons.

Every other rule in [`validate.ts`](../src/hdvl/validate.ts) reports and lets the
frame render; blanking belongs to the error **unit**, through `:state(error)`. Making
one rule additionally suppress geometry would be a second mechanism for the same
thing. What the spec forbids is the **silence** — two columns of 12 and 7 rows quietly
becoming a chart of 7 points — and a diagnostic that names both slots and both counts
removes exactly that.

And a count of zero could not carry the meaning anyway: a column that has not
delivered yet also has no rows, and a rule that could not tell it from a real
mismatch would turn every loading page into an error. That is also why the rule
counts **delivered** rows (`Delivery.rows`) and skips a column still in flight.

## §4.7's ordinal notice is a notice, not a diagnostic

*"A value outside the domain produces no mark and one console notice naming the
value."* It is emitted by [`validate.ts`](../src/hdvl/validate.ts), which is still the
only module down here that writes to the console, and it is edge-triggered per
`(element, channel, value)` like everything else — but it is **not** a `Diagnostic`
and does not appear in `diagnosticsOf()`.

Three reasons:

- SPEC and the RFC both say *notice*. The six warnings are enumerated exhaustively and
  none of them is this one.
- Every diagnostic in the validator is a statement about the **composition** — what the
  author wrote. An out-of-domain row is a statement about the **data**, which changes
  between Tuesday and Wednesday without anybody editing the page.
- The corpus gate asserts that a valid page produces no diagnostics. A page can be
  perfectly valid and still meet a category the author filtered out, and a gate that
  went red for it would be teaching the wrong lesson.

The **all-drop** is the opposite case and *is* an error, on the scale: every row
outside the domain is a mistyped column far more often than a filter, and the code
`all-rows-dropped` already existed for it. It is filed under **V2**, whose pass asks
whether the delivered data fits this scale — an all-drop being the strongest possible
answer of *no*.

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

## `Scale.format()` formats one value; a label **set** goes to the kernel

`Scale` has a `format(v, skeleton?)` and it is deliberately **single-value**. The
temptation is to let a guide call it once per tick, and that would be wrong in a way no
test of `format()` itself could catch: SPEC §7 makes axis coherence a property of the
label **set**, so per-value formatting emits `900K, 1.2M, 1.5M` on one axis — the exact
bug [`kernel/format-skeleton.ts`](../src/hdvl/kernel/format-skeleton.ts)'s
`formatCompactSet` exists to prevent, and every per-value assertion would still pass.

Two ways out were available. Giving `Scale` a **twelfth member** — a set-formatter — is a
change to a published contract, and it would put the shared-prefix algorithm behind a
*scale* method when the thing that actually shares it is `hdml-label` and a continuous
`hdml-legend`'s ramp values, neither of which is a scale. Instead the guide calls
`formatCompactSet` **directly**, with the scale's kind, skeleton, zone and locale.

There is still exactly **one** implementation, which is what the rule requires; the
shared boundary is simply the kernel module rather than a `Scale` method. `Scale.format()`
keeps the cases that are genuinely per-value — a datum readout, a tooltip, one date
label — and an ordinal scale's `format()` returns the domain string verbatim, because
SPEC says an ordinal channel renders its domain strings as written.

*The locale, and where it is resolved — amended at step 24.* This section used to say
§4.9's nearest-`lang` walk *"belongs to the guide"*, and step 24 chose the opposite. A
`Scale` that captured a locale at construction would still freeze it against a `lang`
change, so it is read **per frame**; but a *second* resolution in the label is the one
construction under which a single axis can format in two locales, because `hdml-label`
reaches `formatCompactSet` directly on a continuous channel and reaches `Scale.format`
on a datetime one (only the scale knows its `timeZone`). So `localeOf` was **exported
from `scale.ts`** — one line, additive, no contract change — and both paths call it.

Resolving at the **view** rather than by an ancestor walk is what makes them agree by
construction: a label and the scale it labels share a view, so they cannot disagree,
which is a stronger guarantee than the walk would give. The narrowing it costs is that a
`lang` on an element *between* the view and a guide does not take effect. Nothing in the
corpus writes one, and widening it is a behaviour change to `Scale.format` as much as to
the label — a decision to take deliberately, not a side effect of a guide slice. The
`closest()` ban under `src/hdvl/` points the same way.

## The ramp is a `color-mix()` string, resolved by the page and not by us

`paint()` on a continuous colour scale returns
`color-mix(in <space>, A <p>%, B)` — a legal CSS `<color>` — rather than a resolved
`rgb()`. Two consequences were weighed and both point the same way.

Resolving it would mean **re-implementing OKLCh interpolation**, which is a second
interpolator that can disagree with the one the page's own CSS uses; the registry names
`oklch` as the initial `--hdml-color-interpolate-space` precisely because the platform
already does this correctly on all three engines.

Reading it back resolved would mean a `getComputedStyle` call, and computed style is read
**once per element per frame**. The ramp's fraction is per **row**, so a per-value
read-back could not go through MEASURE at all — it would be a style read inside COMPUTE,
which is the one thing the frame's phase separation exists to forbid. A mark painting the
unresolved string paints correctly; only the legend's ramp *bar* needs a resolved value,
and that is one read for one element.

## A guide forwards `count`/`step`/`values`; it resolves between them nowhere

§6.5 makes the three *"mutually exclusive (V16)"*, and SPEC §7 makes them **modes**
rather than options — *"`step=` states the interval exactly and invokes no tick
algorithm"*. So an author who writes two of them has asked two questions at once, and
V16 (step 24) reports it. But the page paints meanwhile, which means some answer is
owed *before* the diagnostic exists, and the tempting move — pick one in
`guide-spec.ts` — is the wrong one.

`Scale.ticks` already has a precedence, and publishes it: `ticksFor` tests `values`,
then `step`, then `count`, and `kernel/scale-band.ts`'s `thinOrdinal` does the same in
the same order, its own doc comment saying it *"states the precedence it applies if
more than one arrives anyway"*. A second resolution in the guide would be a second
ladder entry point in all but name — R12's exact failure mode — and the two could
drift apart. So [`tickSpecOf`](../src/hdvl/guide-spec.ts) parses each attribute
independently and forwards **every** member the author wrote. A guide states no
precedence because it has none to state.

The same function reads an attribute that is present but **empty** as absent, which is
what lets one fixture helper spell all four cases; and it parses `values` as literal
JSON **locally** rather than through `mark.ts`'s `slotValuesOf`. That reader classifies
SPEC §5's *binding* grammar, where a bare identifier names a column and a bare number
broadcasts — neither of which means anything on an element that binds nothing. Reusing
it would have silently accepted `values="units"` as a tick list.

## An axis's line sits on its own box's near edge, derived from two measured boxes

§6.5 says what an axis spans — the whole range — and says nothing about where it sits
across that span, because SPEC §7 has already answered: *"placement is pure CSS… no
`position` attribute"*. There is therefore nothing to read, and the answer has to be
**derived**: the line goes on the edge of the guide's own content box nearest the scale
it serves, measured against the scale's content-box **centre** rather than its near
edge, so a guide overlapping the plot still has one answer instead of a tie between two
zero distances.

That gives the placements SPEC §3 describes without encoding them: a guide in the bottom
gutter draws on its **top** edge, one moved above the plot on its **bottom** edge, one in
the left gutter on its **right**. It is also why the derivation lives in
[`guide-spec.ts`](../src/hdvl/guide-spec.ts) rather than in the axis — §6.5 derives
`hdml-label`'s anchor and baseline from the identical fact, and two implementations of
"which side faces the plot" could disagree about a guide the author moved.

## A label's anchor and baseline are the per-axis sign of the outward normal

Step 24 cashed that in and step 27 generalised it. §6.5 derives the two `text` fields
from *"which edge of its own box the scale's axis runs along"*, and the temptation is
four cases keyed on the channel — which is the authored `position` SPEC §7 forbids,
merely spelled in TypeScript, and which silently stops tracking a box that CSS moved.

Both facts needed are already computed. `guideEdge` returns the near edge; the scale's
content box gives the plot's centre; the text hangs off that edge *away* from the plot.
Step 24's answer was **the sign of `edge − centre`** on the perpendicular axis — high
side means the run continues toward higher coordinates (`top` baseline on a horizontal
guide, `start` anchor on a vertical one), low side toward lower (`bottom` / `end`) — and
along the guide's own axis the run is centred, so the remaining field is `middle` either
way. §6.5's four rows fall out of that one predicate rather than being tabulated, and
the test proves it by moving the box and watching both fields change.

**Step 27 kept the predicate and replaced its input.** A ring has no near edge, and
asking a polar guide for one would have produced four more cases keyed on the channel —
exactly what the derivation exists to avoid. What generalises is the vector: the text
hangs along the **outward normal**, the direction away from the plot, and the answer is
that normal's **per-axis sign**. Under a plane composing in view space the normal is
constant and axis-aligned, `(0, ±1)` or `(±1, 0)`, its sign the old `edge − centre`;
**the zero component is why each of §6.5's four rows carries a `middle`**, which the
tabulated form never explained. Under a plane composing about a pole it is radial — the
point less the pole — so it turns with the ring and the placement resolves per tick.

The deadband is relative to the normal's own magnitude, because the two normals differ
in length by a radius. `cos(π / 2)` is `6.1e-17`, so a three-o'clock tick's vertical
component sits fifteen orders of magnitude under a `1e-6` threshold while the smallest
angle an author can distinguish sits nine orders over it. A tick **on** the pole has no
direction and resolves to `middle`/`middle` — the truthful answer, not a guard.

## A tick's `decorative: true` lives in the node kind it emits

§6.5 calls a tick glyph `decorative: true` and §5.10 gives decoration an `aria-hidden`
floor — but §2.5 puts `decorative` on the `text` node **alone**, and Contract 3 has been
whole since step 10. A `rect` has nowhere to carry it.

That is not an omission to be patched. `decorative` exists on `text` precisely because
text is the one node kind that would otherwise be exposed *and* selectable, so the
tick/label distinction has to be written down there and nowhere else. Everything §5.10
promises for a glyph is already true without a field: `hdml-view` is `role="img"`, which
prunes the whole SVG subtree from the accessibility tree, and a bare SVG shape
contributes nothing to it in the first place. A tick's decorative-ness is therefore
carried by **the node kind it emits**, and the invariant is asserted directly —
`guide-tick.test.ts` asserts that nothing `hdml-tick` paints is a `text` node. Adding a
`decorative` field to `rect`/`ellipse` would widen a frozen contract to restate a fact
the renderer can already read off `SceneGroup.role`.

## V14's ordinal clause landed at step 24, not step 31

The plan scheduled a D1 escalation here and it resolved, with the user on 2026-08-23, to
the recommended default. SPEC §7 files `count`/`step`/`values`/`format` over an **ordinal
legend** under V20 and files nothing for the same `format` on an ordinal `hdml-label`,
where `Scale.format` returns `String(v)` and drops the skeleton on the floor. One
authoring mistake was an error on one guide and silent on the other.

It is **V14**, not V20: V14 is *"format skeleton well-formed and matches the channel
kind"*, and SPEC's own words give it *"agreement with the channel's scale kind is then a
separate check with its own message"* — this is that check, with a message symmetric to
the *"date skeleton on a continuous channel"* one SPEC quotes. Filing it as V20 would
cost `channel-guide-fit` its meaning, which is *this guide cannot address this channel at
all*. V14's other two clauses — well-formedness, and the disjoint token spaces
`skeletonKind` already classifies — landed **whole** at step 31, together with the legend
half, because `format` reaches its last tag there and no later step adds a validator rule.
A string in **neither** token space and one in **both** carry different messages, because
they are different mistakes: `"MMM compact-short"` is two intelligible halves that cannot
combine and `"qqq"` is not a skeleton at all. An empty `format` reads as *absent*, the
same reading `tickSpecOf` gives an empty `count`.

## Why `hdml-legend` is one element, and not an axis or a tick+label pair

SPEC §2 once said *"no separate legend element"*, and finding 17 reversed it with cause.
Both losing candidates were steelmanned, and each breaks a deeper rule than the one it
fixes:

- **`hdml-axis channel="color"`** terminates in **modal attribute sets** — `format` and
  `count` legal on one channel and not another, on the same tag. That is the disease the
  three-scale collapse and the `hdml-pie`/`hdml-arc` split were both designed out of, and
  the runtime cost is a validator whose rules depend on which channel an attribute sits
  beside rather than on what the tag *is*.
- **`hdml-tick` + `hdml-label` on the color channel** makes swatch↔name row alignment
  **cascade-determined geometry no validator can check** — which is finding 15's own
  killer argument, aimed at its mechanism. Two elements, two boxes, two independent
  `count`s: nothing in the document says the third swatch and the third name are the same
  entry, and nothing can be made to say it.

The dedicated element dissolves both **structurally**, and that is the whole verdict: one
element generates each entry whole, from one domain value, in one loop. Alignment is by
construction, and the tick/label contract survives *inside* the element as an
implementation invariant — swatch decorative, name real text — where it cannot be
mis-authored. The fence is narrow and stated: an element may fuse glyph and text exactly
when the pair is **one datum of a mapping**. `hdml-axis` on a non-positional channel is
now V20's error, which is the same decision seen from the other side.

## Palette exhaustion errors on the scale, and the legend is not involved

[kernel/color.ts](../src/hdvl/kernel/color.ts) has said since step 18 that *"the
diagnostic itself is the legend's, Slice H"*. That is true of the **step** and not of the
**unit**, and step 31 settled which: the error is reported **on the scale**, by
`validate.ts`'s binding pass, whether or not any legend was written.

The fact is a property of the resolved domain and `--hdml-palette`, both of which exist
with or without a key. A page with nine categories over an eight-colour palette paints two
series the same colour — §1.5's silent wrong chart, and the reason `paletteColor` returns
`null` rather than wrapping — and reporting it from the legend would make the diagnostic
conditional on the one element whose *absence* makes the problem harder to notice, not
less real. It is filed under **V2** for `all-rows-dropped`'s reason: §8.3's V2 row is the
binding pass's *"does the delivered data fit this scale"* question, and a resolved domain
the scale cannot paint is an answer of no. SPEC §11 gives it no V-number of its own;
`palette-exhausted` has been its own `DiagnosticCode` since step 12.

`scale.ts` answers the question (`paletteGapOf`) and `validate.ts` reports it, rather than
`scale.ts` importing the validator — which would close an import cycle, since `validate.ts`
already imports `scaleKindOf` and evaluates `MODIFIERS` at module top level.

## A colour channel has no range, but a continuous one has a position

Contract 2 says `range()` is `null` for `color` — *"a colour's range is a palette"* — and
that stands. What step 31 found is that `project()` returning `null` alongside it made
`Scale.ticks()` answer `[]` on **every** colour scale, because `ticksFor` drops a tick
whose `at` is `null` (§4.7's per-value rule). A continuous legend would have had no
graduations at all, silently, since an empty tick list is a legal answer everywhere else.

So on a **continuous** colour channel `project(v)` is the **ramp fraction** in `[0, 1]` —
the number `paint()` already maps through, not a new one — and `Tick.at` is that fraction.
The legend's bar and its graduations then share one axis, and it is the scale's own
transform: a `log` colour scale's colours sit where its values sit. The **ordinal** colour
case stays `null`, because a palette slot is not a position and a key renders the domain
rather than a tick list.

## The guide placement rules reset the opposite offset, and state an extent

This one looks like noise and is load-bearing. The element sheet's generic rule is
`:host { position: absolute; inset: 0 }`, and `inset` is **four longhands**. SPEC §3's
idiom for an x-channel guide is `top: 100%` — but `top: 100%` *alone* leaves `bottom: 0`
in force, and an absolutely positioned box with both offsets and `height: auto` is
over-constrained: its used height is *containerHeight − containerHeight − 0*, i.e.
**zero**. A zero-high guide measures as a zero box and every scene it produces is
geometry against nothing — and it renders, silently, with no diagnostic and no failing
assertion anywhere near the cause.

`bottom: auto` alone does not fix it either: the box would then shrink-to-fit shadow
content whose `.plot` is `height: 100%` of an indefinite height. So each rule carries a
third declaration — `height: 24px` for the x row, `width: 40px` for the y — and those
numbers are not written twice: [`ua.ts`](../src/hdvl/ua.ts) builds both the plane's
`padding` and the guides' extent from one `GUTTER` object, because SPEC §3 calls that
padding *"the gutter the guide defaults spill into"* and a gutter that disagreed with
what spills into it is invisible in a scene assertion.

The corpus pages never hit any of this: they were written against no UA sheet at all and
set three offsets each, which is why the trap survived until the sheet existed. **That
was a prediction when the sheet landed at step 23 and is a measurement since step 25** —
all six gated pages mount and every guide box in all ten goldens has a non-zero extent.

`hdml-grid` gets **no rule of its own**, deliberately. SPEC §3's grid row is `inset: 0`
over the plot area, which the generic `:host` rule already *is*. A redundant rule would
be harmless and would also be a thing a later reader trusts as load-bearing.

## `nice` rounds to the scale's own ladder, not always the linear one

SPEC §6 defines `nice` as *"the next multiple of the tick step for its own target count"*
and names exactly one special case — *"on `hdml-datetime-scale` the step comes from the
calendar ladder"*. It says nothing about the three **non-linear** continuous transforms,
none of which has a uniform step at all, so step 18 read the silence as *linear*.

On a `log` scale that is not a rounding difference. A delivered domain of `[12.5, 1250]`
runs the `{1, 2, 5} × 10ⁿ` ladder to a step of `100` and comes back as **`[0, 1400]`** — and
a log domain that touches zero is V2's error, projects nothing, and paints a blank figure.
An opt-in modifier turned a legal page into no chart. It surfaced on corpus page
`05-scatter` B at step 25, the first time a page ran it.

Decided under D1 with the user: **whichever ladder a scale's ticks come from is the ladder
its `nice` rounds to** — a generalisation of the datetime clause rather than a second
special case. `log` rounds to the enclosing **power of the base** (`[12.5, 1250]` →
`[10, 10000]`), symlog per endpoint by region, and `linear`/`pow`/`sqrt` are unchanged
*because they were already right*: §4.8's pow ladder **is** the numeric ladder in value
space (`ticksPow` returns `ticksNumeric`), so a `nicePow` would be a second name for one
function. Powers rather than §4.8's decade subdivisions, for the same reason the datetime
clause says *month/year boundaries* rather than the finest rung it could reach.

The one place `nice` deliberately does nothing: a `log` endpoint that is **already** zero
or negative is left exactly where it is. `nice` may widen a domain; it may never invent a
legal one, or it would suppress the V2 diagnosis of the page that is actually broken.

## An ordinal-angle slice is `bandOf().width`, not a whole step

SPEC §7 grants `hdml-arc` a second angle form — *"`angle` — ordinal angle scale, **equal
slices**"* — and §4.4 gives two readings of what "equal slices" means. §4.4 hands a **bar**
`b · step` and hands *everything else* the `centre`, so an arc could either fill its band
(`bandOf().width`) or span half a step either side of its centre. At the initial
`--hdml-bandwidth: 0.8` those differ by a **20 % gap between every pair of slices** in a
Nightingale rose — the difference between a solid rose and a spoked one, on the same markup.

Decided under D1 with the user at step 26: **`bandOf().width`**. `a0` is `bandOf().start`
and `a1` is `start + width`.

Three things carried it. It is **consistent with `hdml-bar`**, the other widget that fills a
band rather than sitting at its centre, and there is now a single sentence covering both:
*a mark that spans a category takes the band; every other lookup takes the centre.* It keeps
`--hdml-bandwidth` **live** on the tag — the rejected reading makes a registered property
that authors will write silently inert, which is exactly the shape of §1.5's complaint that
step 24 resolved the same way for an ordinal `format`. And the corpus had already voted:
`09-polar-area` writes `--hdml-bandwidth: 1` on its angle scale and `10-radar` writes
`--hdml-bandwidth: 0`, neither of which means anything under the other reading.

The cost is one sentence that had to be corrected in three places — `hdml-bar` was *"the one
widget in the project that reads `bandOf().width`"* and is now one of two. There is also a
third spelling nobody argued, `centre ± b · step / 2`; it is algebraically identical to the
one chosen and is not a separate option.

The band comes from `Scale.bandOf` and never from a `360 / n` of the arc's own (R12): the
angular range is `--hdml-angle-start`/`-end` and need be neither a full turn nor ascending,
and §4.4's denominator is `n − 1 + b` rather than `n`, which is what puts the last slice's
high edge exactly on the range's own end.

## H7 held for every mark — the polar plane cost zero widget lines

The step plan's H7 predicted that because a mark reads `Projection.channels` rather than
naming `x` and `y`, a polar plane would reach every mark without any of them gaining a
branch. It was measured twice and held both times: `plane-polar.ts` supplied the projection
at step 22 and **no widget changed**, and at step 26 `hdml-line`, `hdml-area` and
`hdml-point` were run under a polar plane for the first time — vertices, regions and glyph
centres all landing on §4.6's own arithmetic — with a **zero-line** diff to all three files.

That is worth recording because a prediction of this shape cannot be proved by the code that
implements it. The evidence is [`mark-polar.test.ts`](../src/hdvl/mark-polar.test.ts): every
geometry assertion in it runs against files that were not touched, and the fixtures would be
the first thing to fail if a channel name had leaked into a widget.

The one polar-scoped thing a shared mark does carry is `hdml-line`'s `closed`, and it is
scoped by the plane's **channels** — the same question `hdml-arc` asks to decide whether it
has a pole at all — never by a plane kind. A branch on kind is what H7 forbids; asking a
plane which channels it projects is what the seam is for.

## `hdml-area`'s `closed` is two counter-wound rings, and the fill rule was unnecessary

*(Raised at step 26, decided with the user and landed at step 27. SPEC §7 carries the
dated amendment.)*

`hdml-area` publishes `closed` and, on a cartesian plane, does not read it: every region
it emits is already a closed outline — upper edge forward, across, lower edge reversed,
close — so the attribute has nothing left to say, and a cartesian area written with it
emits a byte-identical node. Under a **polar** plane it does have something to say. That
outline runs from the first category to the last and then closes *through the pole*,
leaving a wedge-shaped notch between the last category and the first where a radar band
should close *around* the loop — `10-radar`'s band, visibly wrong while the `hdml-line
closed` outline drawn over it is right.

Step 26 recorded the fix as *"an outer ring and an inner ring as two subpaths **with a
fill rule**"* and deferred it as a SPEC question about what `closed` means on a filled
mark. The SPEC question was real; the fill rule was not. **The two edges are already
counter-wound** — the upper runs first → last and the lower is emitted reversed, last →
first, which the cap-joined form needed anyway — so emitting them as two subpaths rather
than one gives them opposite winding, and SVG's default `nonzero` rule fills the annulus
and leaves the hole empty by itself. Nothing is added to §2.5's node, the renderer is not
touched, and the node's `closed` flag was already a `Z` **per subpath** since step 10, so
each ring closes on itself.

What the attribute changes is therefore **how many subpaths a region has**, never the
flag. A band whose inner edge is `r0="0"` degenerates to a ring of coincident poles,
encloses nothing, and fills to the centre — the right answer by the same arithmetic
rather than by a case. The predicate itself is shared with `hdml-line` (`closedOf`):
presence, on a plane composing angularly, one implementation for both tags.

## A guide asks its plane which channels it projects, exactly as a mark does

`guide-spec.ts` carried a `readonly [Channel, Channel]` naming `x`/`y`, and `resolveGuide`
refused any plane that did not answer it. That was correct while nothing composed
`(along, across)` except a cartesian plane, and it was **H7 half-applied**: the mark half
had asked the plane since step 22, the guide half had not. Step 27 deleted the constant.

What replaced it is not a plane-kind test. `guidePoint` hands both positions to
`Projection.point` in the plane's own channel order — and the cartesian output is
*unchanged*, because that plane composes with the identity pair precisely so that "an `x`
position already is a view x". `resolveGuide` then resolves one extra member, `pole`, as
`projection.point(0, 0)`, the same read `hdml-arc` already made; the four guide elements
read polar-ness back off `pole !== null` plus `first`, so **no guide element names a
channel at all**. A ring is *"my own channel is this plane's first and there is a pole"*
and `--hdml-grid-shape`'s home is *"my own channel is its second and there is a pole"*.

One channel name survives, in `guide-spec.ts` and nowhere else: `ANGULAR`, asked once, to
decide whether a plane composes about a pole. That is the identical question
`mark-line.ts`'s `closedOf` asks and `mark-arc.ts` asks of its own channels — a fact about
**channels**, which H7 permits, and not a branch on plane kind, which it forbids.

## A polar guide sits at the other channel's range, not at its own box

`guideEdge` derives *which edge of its own box faces the scale*, and SPEC §7 gives
placement to CSS precisely so that derivation tracks an author rule. It returns a **view
coordinate**, and that is a legal `across` exactly when the other channel's range is
measured in one.

Under a polar plane it is not: the other channel's range is degrees or a radius, and no
box edge is a value in either. A polar guide's box is also the plane's — the UA sheet
places gutters for `x` and `y` guides and a polar plane has none, so the generic
`inset: 0` applies — which means there would be nothing to read even in principle. So
`guideAcross` takes the other channel's range's **far end**: the rim for a guide repeating
around it, the end of the turn for one repeating outward along a spoke. On the full turn
every corpus polar page writes, `360deg` **is** `0deg`, so a radial guide lands on the
twelve-o'clock spoke — which is where every charting library puts one, arrived at by
derivation rather than by convention.

## `hdml-pie` is `hdml-arc` with a derived angle form, and nothing else

§6.3 calls the pie *"the same, with one cross-row `derive()` in data space before
projection"*, and SPEC §7 claims 08-A and 08-C are interchangeable. Both sentences are
easy to *state* and easy to falsify by writing a second `k: "arc"` node literal — at which
point the claim becomes a coincidence between two implementations that can drift.

Step 26 had already built the seam without knowing it. `mark-arc.ts`'s `AngleForm`
resolves *how a row becomes a pair of degrees* before the row loop, so that the loop, the
three radial cases and the node are written once for the arc's two forms. The pie is a
**third** form behind the same interface. Step 27 therefore lifted the arc's `scene()`
body into a free `sectorScene(ctx, el, formOf)` and both tags call it: the arc passes its
scale-kind dispatcher, the pie passes its prefix sum. R12 is satisfied by construction and
the interchangeability test compares two scenes that came out of one function.

The pie publishes no radial attribute at all, so it always takes the arc's *third* radial
case — the full range floored by `--hdml-inner-radius` — which is exactly 08-B's
widget-scoped doughnut and 08-D's plane-scoped ring, differing only in where the
declaration sits.

## The pie's `a1` is a running quotient, so the last slice closes exactly

RFC §6.3 writes `a1ₖ = a0ₖ + vₖ / total`. The implementation computes `acc / total` with
`acc` the running sum. The two are algebraically identical and **only the second closes
the circle**: `acc` after the last row is the same sum, accumulated in the same order,
that `total` is, so the final quotient is exactly `1` and the last slice's high edge lands
exactly on the angular range's end. Summing the quotients instead leaves a hairline gap
whose width is a float's — invisible in a screenshot, present in the scene, and the sort of
thing that shows up as a seam at one zoom level and not another.

## V7 needed a seventh `WarningCode`, and no new `DiagnosticCode`

V7 has two halves and they report differently. **Negative pie values** are an error, and
the code was already there: `negative-pie-value` landed in the union at step 12 for H5's
reason and had no caller until step 27 gave it one — the third step running (24, 25, 27)
to find the code it wanted already in the enum. It is reported from COMPUTE by the widget
that met the rows and drained by the binding pass, exactly as `all-rows-dropped` is,
because draining rather than accumulating is what makes recovery work.

**The row-order clause** is a *warning* — SPEC §11 says *"the validator warns where it can
see"* — and §8.1 makes warnings carry a `WarningCode`. The six that existed are W1–W6, one
per rule, and that 1:1 mapping had read as a contract; it was in fact a property of no
V-rule having had a non-error clause yet. So `unpinned-row-order` is a seventh code
carried by `rule: "V7"`, a §8 amendment with no SPEC change (§11's V7 row already states
the rule). It warns without blanking and without `:state(error)`, as §8.3 requires.

The **locality clause** is the whole design of that half: the check resolves the effective
`source` as an in-page `?hdml-frame=` ref and reports only when the page declares that
frame and the frame carries no `hdml-sort-by`. A ref with a path names another document
and a ref this page does not declare is *unresolvable*, which is a different claim from
*unsorted* — and "add a sort to a frame I have never seen" is a statement §1.5 would
rather not make. It is the same split V4 takes, for the same reason.

It is also why `vocabulary.ts` now exports one **data** tag, `HDQL_SORT_BY_TAG`. Everything
else the validator knows about the data vocabulary it derives — the host tag out of the
author's own ref, a frame's fields out of its children carrying a `name` — and neither
derivation can reach a sibling block element. SPEC §11 names `hdml-sort-by` explicitly, so
the check cannot be spelled without it; putting it in the one module that imports
`@hdml/types` keeps the display half's whole vocabulary surface auditable in one place, and
`vocabulary.test.ts`'s exhaustive export fence keeps counting it.

## A corpus page is fetched, not inlined — and its `hdml-io` is removed

Two decisions in [src/testing/corpus.ts](../src/testing/corpus.ts) that five gate steps
inherit, both of which have a plausible alternative that fails quietly.

**Fetched.** `html/hdvl/*.html` are already byte copies of the project folder's originals,
and a `cmp` at landing time is what keeps them so. Inlining a page's markup into a
`.test.ts` would make a **third** copy that no `cmp` covers, and the gate would then assert
against markup nobody ships. Fetching instead depends on the runner serving `rootDir: "."`
statically — a dependency whose failure mode is a 404 that throws and names the URL, where a
drifted inline copy is silent.

**Removed.** Ten of the thirteen gated pages declare an `hdml-io` against a host that does
not exist — `00-minimal`, `02-area` and `12-coverage` are the literal-only conformance class
and declare none, which the gate asserts rather than assumes. Leaving it in place is not neutral in two independent ways: its `connectedCallback`
creates an endpoint and immediately posts props + HTML, which means a network call, a Worker
and `@hdml/parser` on every corpus test; and it is *also* a D8 provider, and
[subscribe.ts](../src/hdvl/subscribe.ts) de-dupes requests by `id`, not by provider — so it
and `FakeIo` would **both** receive every request and both call `deliver`, with a transport
error racing canned data by generation stamp. RFC §10.3 already settles which one drives the
corpus. The harness asserts how many it removed *and* that none survives in the mounted
page, so a page that gains or loses one is a failure rather than a silent change in what the
gate proves.

The layout viewport is pinned at 800 px for a related reason: twelve of the thirteen pages
size their view `width: 100%`, so the runner's window would be baked into every number in
every golden. 800 is wider than every page's own `max-width` (760, 760, 760, 760, 720, 760,
780, 480, 480, 520, 780, 480), so each page keeps the
dimensions its author gave it and none is capped by the harness — the opposite of retuning
the corpus to suit the runner. It is also what fixes `11-multi-plane`'s panel thirds at
33.333 % of **780** px, a fractional number of pixels and so the corpus's one
engine-dependent used width.

## A channel's range is the plane's answer, not the scale's

[mark.ts](../src/hdvl/mark.ts)'s `Projection` gained a member at step 28:
`span(channel)` — a channel's range in its own unit, the scale's `range()` where one serves
and **whatever the plane supplies** otherwise. Four call sites that each spelled
`projection.scale(other)?.range() ?? null` inline now ask it.

The reason is one sentence of SPEC §3: *"the pole is the box's center and the range is
`[0, min(content-width, content-height) / 2]`; when no radius scale exists (a pure pie
chain), the plane's content box serves."* Both halves of that sentence read **one box** —
and the implementation resolved the fallback twice, once in `poleOf` and not at all for the
range. `plane-polar.ts` therefore resolves the *box* now and derives the pole and the
ceiling from it, so a future reader cannot repeat the split.

*The road not taken* — teaching each of the four readers the fallback — was rejected on
R12: it is four chances to disagree about what a chain with no radius scale means, and it
would have put a polar concept inside `mark-rule.ts`, which is cartesian. *The other road
not taken* — a `radialSpan` member — was rejected on H7: a member named for one plane's
channel is a plane branch with extra steps. `span` is keyed by channel like every other
member of the interface, the cartesian plane declines every channel, and the polar plane
answers for its second one only, because an angular range is
`--hdml-angle-start`/`-end` on the angle scale and there is nothing to read without one.

It landed as a **correction to step 22**, not as new work: the fallback was already
specified, already implemented for the pole, and already relied on by four corpus pages that
had never been executed. Until step 28 executed them, all of `08-pie-doughnut` and
`12-coverage` B painted an empty scene with no `:state(error)` and no diagnostic.

## A corpus gate excludes a later slice's element by name

C3: *"every slice gate is expressed as named scene-`deepEqual` assertions over the groups
**that slice owns**; a double-gated page's whole-page render assertion belongs to the
**later** slice."* Step 28 is the first gate that meets one — step 30 met the extreme case,
`04-grouped-stacked`, where **every** view declares a legend — and
[corpus.ts](../src/testing/corpus.ts) spells the exclusion as a constant plus a filter —
`DEFERRED_TO_SLICE_H` and `withoutDeferred` — rather than as a golden that happens to have
no legend groups in it.

The distinction is not pedantic, and step 31 settled it. When those gates were written
`hdml-legend` was **registered and inert** — it emitted no group at all, so an unfiltered
golden over `08-A` would have been byte-identical to a filtered one. Then the legend
gained a body. An unfiltered golden would at that moment have silently become a
whole-page assertion over whatever the legend first happened to emit, and frozen it;
the filtered ones instead kept asserting exactly what their own slices own, and **not
one golden literal moved**.

What the filter does *not* cover is a hand-written assertion that reads an unfiltered
scene, and step 31 found the one there is: `page-08.test.ts`'s *"A's pie and C's arcs are
one geometry"* compares two views' **group tag lists**, which grew a `hdml-legend` entry.
It was widened to name the legend rather than to filter it out, so it survived step 32
unchanged too.

### What emptying the constant proved (step 32)

`DEFERRED_TO_SLICE_H` is now `[]`. The eleven scoped goldens were regenerated against a
legend that paints, and the result is the strongest form the claim could take: **1 794
inserted lines and zero deleted lines**, across all eleven, with the inserted text carrying
exactly one `tag: "hdml-legend"` and no other `tag:` line per golden. **No mark coordinate,
no guide position and no group box moved for any reason other than the legend** — there was
nothing to move, because nothing was removed. The two goldens on those pages whose views
declare no legend (`09` B, `12` B) are byte-identical to their step-28 form.

Two of the eleven also settle a claim that "appended" would have hidden: a legend's group
sits **where document order puts it**. In `04` E that is index 10 of 11 and in `08` D it is
index **1 of 3** — between the two rings, because the element is written inside the *first*
of two sibling planes. `08` D is the only gated view where the position is distinguishable
from a rule that put guides last.

**The constant and `withoutDeferred` are kept, empty.** The mechanism outlives its first
argument: step 33 gates `11-multi-plane`, and any later page carrying an element its own
slice has not built needs the same value with a different tag in it. An empty list is also
an assertion — *nothing is deferred* — and every corpus suite still takes its goldens
through the filter, so one tag added here scopes every gate at once.

### The UA placement default **is** corpus-covered, and step 31 said it was not

Step 31 recorded finding 24 — a legend's entries paint on the *view's* surface, so its own
shadow tree is empty, `width: max-content` resolves to **0**, and SPEC §3's row anchors the
key at the plot's top-right corner rather than hugging it — and stated that *"no corpus page
is affected, and that is not luck: all five that declare a legend give it an explicit width
and the gutter idiom (`left: 100%`)"*. **Four of the five do.** `12-coverage` writes **no
`hdml-legend` rule at all**, deliberately, and says so in its own header (*"no legend gutter:
the UA default overlays the legend on the plot's top-right corner (§3)"*).

Measured at step 32: both `12` legend groups carry `box.w === 0` and `box.x === plotRight −
8px`. The figures still render — `--hdml-legend-direction`'s initial is `column`, so the flow
axis is the box's **height**, which `top: 8px` plus the generic `inset: 0`'s `bottom: 0` leave
non-zero, and `keyNodes`' wrap guard (`limit > 0`) is written for exactly this case. The
entries flow rightwards out of a zero-width anchor. Nothing was changed for it: the finding
ships verbatim because a default width is a magic number and an element writing its own
`style` is a widget fighting the cascade it reads. What changed is that the corpus now
**asserts** it (`page-12.test.ts`, *"the UA default, on a page (finding 24)"*), so the
default and the gutter idiom are each pinned by a page rather than one of them by a fixture
alone.

## One corpus gate runs a second frame, because one caption is about an interaction

Every other corpus assertion is a single render: mount, quiesce, compare. `12-C`'s caption
is not — *"the stack rebases over rendered children; the y ceiling stays put (§7)"* is a
claim about what happens **when something changes**, and a static golden cannot separate its
two halves. A chart whose scale domains silently followed the toggle would produce exactly
the same first frame.

So [page-12.test.ts](../src/hdvl/corpus/page-12.test.ts) removes the third bar's `hidden`,
re-runs the frame, and puts it back: two bands become three at the **derived** baseline
(band 2's floor is band 1's top, `strictEqual`), the golden returns byte-for-byte, and every
scale's `domain()` is identical across all three states. Nothing HDVL-specific is toggled —
`hidden` **is** `HTMLElement.hidden`.

*The road not taken* — leaving the interaction to `container-stack.test.ts`, which already
toggles a `hidden` child — was rejected because that fixture builds its own markup. What the
page adds is that the toggle is written by an **author**, on a stack that shares its scale
chain with a legend and two axes, and that the thing which must not move is a domain the page
declares as `min="0" max="100"` rather than one the fixture chose to be assertable.

## A display element is `border-box`, so an authored width is the element, not its plot

*(Step 33, found by the `11-multi-plane` gate — the corpus's finding 25.)*

SPEC §3 gives a plane `position: absolute; inset: 0` and a **padding** gutter, and until
step 33 no corpus page had ever authored a `width` or a `height` on one. Under
`inset: 0` with `width: auto` the used width is whatever fills the containing block, and
`box-sizing` cannot change it — so the property had never mattered, and the UA sheet did not
declare one.

`11-multi-plane` A is the first page to author one: three panels at `width: 33.333%` on a
plane whose padding is the §3 gutter (`16px 12px 32px 44px` here). Under the platform default
(`content-box`) that width sizes the **plot area**, so each panel's border box is a third of
the view *plus 56 px*, the three panels do not tile, and the third runs off the right edge of
the view and is clipped by the `<svg>`. The page carries its own consistency check and failed
it: the panel titles are host HTML — three `span`s at `width: 33.333%` — which sit at the true
thirds while the plots do not.

[ua.ts](../src/hdvl/ua.ts)'s generic `:host` rule now declares `box-sizing: border-box`.

- **It cannot be the author's fix.** §3 makes the gutter the **UA's** number, so
  `calc(33.333% - 56px)` hard-codes a value the sheet owns and re-breaks the moment a page
  overrides the padding.
- **It is a no-op everywhere else, and the corpus proves it rather than arguing it.** The
  twelve pages gated before step 33 have byte-identical goldens with and without the line,
  and the whole suite passed unchanged on all three engines the first time it ran.
- *The road not taken* — editing the page to `box-sizing: border-box` — was rejected because
  the corpus pages are the acceptance contract, and a page that has to restate a UA default to
  get the layout SPEC §3 describes is a defect in the sheet, not in the page.

## One corpus view is quantized to two decimals, not rule 3's six

*(Step 33.)*

Cross-engine rule 3 quantizes every scene assertion to **six** decimals, which is what makes a
`deepEqual` safe against the last-ulp differences of `Math.log/pow/sin/cos`. It is not enough
for `11-multi-plane` A, and the reason is not arithmetic: a **used width** is snapped to the
engine's own layout unit — 1/64 px in Blink and WebKit, 1/60 px in Gecko — so `33.333%` of
780 px (`259.9974`) resolves to `259.984375` on two engines and `259.983337` on the third, and
every position derived from it inherits the difference.

Measured over the whole scene the worst disagreement is **2.1 × 10⁻³ px**, and all three
engines agree exactly at **two** decimals — 1/100 of a CSS px, finer than a device pixel at
any device-pixel ratio. `page-11.test.ts` therefore takes A's golden through
`sceneOf(view, {precision: 2})`; everything else in the corpus, `11` B included, stays at six.

*The road not taken* — asserting A's golden on chromium alone, as the `text` half is — was
rejected because it would drop the geometry of three planes on two engines to buy a precision
nothing reads. This is a property of a **fractional percentage**, not of multiple planes.

## A view-level `source` coalesces refs, not subscriptions

*(Step 33.)*

`11-multi-plane` is the corpus's one page where a `source` on the **`hdml-view`** feeds more
than one plane, and its header claims *"one view-level source, one query (identical refs
coalesce)"*. The gate asserts the claim in the two numbers it actually decomposes into, so
neither can be mistaken for the other:

- **twelve subscriptions** for view A — `subscribe.ts` keys a subscription by the binding
  **site** (`uid:slot`), so three panels × four bound slots is twelve registry entries, and
  that number is a fact about the *consumer* side;
- **one ref**, over six distinct `(column, raw)` reads — which is what "one query" names, and
  where the coalescing happens: the query engine batches by ref and column, and `<hdml-io>`
  de-dupes by `id`.

A gate that asserted only the first would read as *"no coalescing"*; one that asserted only
the second would pass on a page with one plane. Both are asserted, and the effective-`source`
inheritance is asserted from the document beside them: `source` is on the view and no plane
repeats it.

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

## HDVL's `hidden` **is** the platform's

*(Decided at step 29, the slice that first had to read it. The tag surface left the
question open at step 09 and both `container-*.ts` said so in as many words.)*

SPEC §7 gives every widget a `hidden` attribute meaning *"withheld from painting; its
container re-derives without it"*, and the corpus writes it as a bare boolean
(`12-coverage` C). Two readings were available: a HDVL-private attribute that happens to be
spelled `hidden`, or the platform's own `HTMLElement.hidden`.

It is the platform's, and the argument is that **two mechanisms could disagree**. A page
that made a `hidden` element `display: block` again would get a series that paints and is
excluded from the relation — a chart whose bands do not add up, with nothing anywhere
saying so, which is exactly the silent wrong chart §1.5 exists to kill. Taking the
platform's meaning also buys the layout and accessibility half for free, and the reading is
what SPEC's own sentence describes.

The consequence is that the implementation almost disappears: the predicate is `el.hidden`,
read **once**, in [`subscribe.ts`](../src/hdvl/subscribe.ts)'s `paintSuppressed` — the one
question every widget already asks first — and in
[`container.ts`](../src/hdvl/container.ts)'s `renderedChildrenOf`. No widget spells it, and
a future widget cannot forget it.

The class field behind the observed attribute stays named **`hiddenAttr`**: a
`null | string` field named `hidden` shadows the boolean IDL property and does not
type-check. The observed attribute is still `hidden`, so `observedAttributes` and the
invalidation funnel are exactly as SPEC specifies. The field exists to make the attribute
*observed*; the platform property is what is *read*.

## The curve source is the stack, and that cost `mark-area.ts` a line

*(Step 29. Recorded because it is the one place H8's "the children do not change" claim
does not reach, and the reason is worth being precise about.)*

H8 says a container re-parameterises marks that know nothing about it, and step 29 measured
it: `hdml-stack` supplies `y0ₖ` through `rangedValuesOf`'s override and
[`mark-bar.ts`](../src/hdvl/mark-bar.ts) has a **zero-line** diff.
[`mark-area.ts`](../src/hdvl/mark-area.ts) does not, and the line it gained is **not** H8's.

SPEC §9's `--hdml-curve-*` rows name the reader outright — *"`hdml-line`, `hdml-area`; for
a stacked area, **`hdml-stack`** (children's curve properties are inert inside a stack,
§7)"* — and §7 gives the reason: band *k*'s top is band *k+1*'s baseline, so per-child
curves would tear the shared edges. That is a second, independent re-parameterisation, and
it is about *which element a property is read off*, which no value-level override can
express.

The road not taken was CSS: `hdml-stack > * { --hdml-curve-type: inherit !important }` in
the document sheet would have kept the zero-line diff. It was rejected because it makes
correctness depend on the cascade — a page rule with class-level specificity and its own
`!important` beats it — and *"the edges must not tear"* is not a claim that may hold
modulo specificity. `container.ts`'s `curveSourceOf` answers with one element instead, so
the two edges cannot disagree by construction. A child's own declaration still **computes**
— it is a registered inheriting property and CSS is not being lied to — and is simply never
read, which is what SPEC means by *inert*.

## V17 before V6, because a container is one error unit

*(Step 29. The fourth stated ordering inside the structural pass; see
[architecture.md](architecture.md).)*

`applyErrors` gives a **unit** its first finding, and `resolve.ts` makes the outermost
container the unit for its whole subtree. So a container reports exactly one diagnostic no
matter how many things are wrong below it, and the ordering decides which.

**V17 runs first**: *what the container is made of.* *"A `hdml-stack` holds `hdml-bar` or
`hdml-area`"* is the message that fixes a stack of lines. **V6 runs second**: *who binds
what.* *"The x channel belongs to `<hdml-stack>`"*, said about a line that may not belong
in the stack at all, sends the author to the wrong edit. **V7's source clause** is third,
because where the data comes from is only interesting once the shape is right.

Two clauses need no code of their own and are stated rather than implemented:
**stack-in-cluster being the only legal nesting** falls out of the two child lists (a
container inside a stack is neither a bar nor an area; a cluster inside a cluster is
neither a bar nor a stack), and **all-or-nothing** is already true, because every finding
in the subtree carries the container as its `unit`.

## A structural V-rule reads the DOM, not the index

*(Step 29, found by corpus `12-C`.)*

`displayKids` counts the children the resolution walk resolved — and a custom element that
has not upgraded yet is not one. On the first `reindex()` of a freshly parsed page a
perfectly full `hdml-stack` therefore read as **empty**, and V17's empty-container clause
reported it: a spurious error line on a valid page, cleared one frame later.

`checkV17` now reads `el.children`. Every clause it applies needs only `localName`, which
an un-upgraded custom element already has, so the rule became independent of upgrade order
— which is what *structural* was supposed to mean in the first place. It is the same move
`checkV13` already makes for its `hdml-fallback` count. The finding is still reported *on*
the offending child where the index knows it, and on the container where it does not; the
state lands on the container either way (§3.5).

## 70-column line width

[.eslintrc.js](../.eslintrc.js#L31-L36) sets `max-len: 70` and Prettier `printWidth: 70`.
Aggressive, but the JSDoc on these elements is long and 70 cols keeps it readable in
TypeDoc's HTML. Match the existing wrap when editing or the lint will fail.

## `docs/` collided with TypeDoc — resolved

TypeDoc writes to **`./docs/api`** ([package.json:47](../package.json#L47)) and
`npm run clear` removes **only `docs/api`** ([package.json:45](../package.json#L45)), so the
hand-written agent docs in `docs/*.md` survive a `clear`/`build`.
[`.gitignore`](../.gitignore) ignores `docs/*` and re-includes `!docs/*.md`, which keeps
`docs/api/` untracked and the `.md` tracked. Previously both pointed at `./docs` and
`clear` deleted the tracked `.md` from the working tree; the `TODO(confirm:)` that recorded
it is answered and removed (step 28's audit).

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
