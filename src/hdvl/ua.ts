/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The two UA stylesheets — two sheets, two scopes
 * (RFC 016/001 §3.2, R28, R33).
 *
 * Both are constructed `CSSStyleSheet`s built once at import time
 * and adopted, never `<style>` injection, so no
 * `style-src 'unsafe-inline'` is required of an embedding page.
 *
 * | Sheet | Adopted by | Carries |
 * |---|---|---|
 * | element | every HDVL element's `ShadowRoot`, one shared
 *   instance | the `:host` box defaults and the internal `.plot` /
 *   `slot` / `svg` rules |
 * | document | `document.adoptedStyleSheets` | only what must work
 *   on **light DOM before upgrade**: the two `hdml-fallback` rules |
 *
 * The split is a cascade fact, not a preference. SPEC §3's defaults
 * must be `:host` rules, which sit below *any* outer-document rule
 * matching the element; written as `hdml-view { … }` in a document
 * sheet they would compete on ordinary specificity and order, so a
 * page rule written before ours would lose — silently inverting the
 * "author always beats UA" promise.
 *
 * @module hdvl/ua
 */

import type { Channel } from "./resolve";
import { AXIS_ATTRS_LIST, HDVL_TAG_NAMES } from "./vocabulary";
import { HDVL_PROPERTIES } from "./properties";

const VIEW = HDVL_TAG_NAMES.VIEW;
const CARTESIAN = HDVL_TAG_NAMES.CARTESIAN_PLANE;
const POLAR = HDVL_TAG_NAMES.POLAR_PLANE;
const FALLBACK = HDVL_TAG_NAMES.FALLBACK;

/**
 * SPEC §3's cartesian plane padding — *"the gutter the guide
 * defaults spill into; without it, zero-CSS guides would clip at
 * the view edge"*.
 *
 * It is a named object rather than four numbers in a string
 * because it is read in **three** places that must agree: the
 * plane's own `padding`, {@link LEGEND_CSS}'s inset, and — until
 * 017 R2 — the extent of the guide placement rules below. R2 took
 * the third away: every placed guide's cross-axis extent is now
 * `0 !important` and reads nothing from here. What still has to
 * hold is that the padding leaves room for the runs the guides
 * paint into it, and **no scene assertion can see that** — a guide
 * clipped at the view edge measures the same box as one with room
 * to spare. `11-multi-plane` is where the gutter's size is
 * load-bearing (see {@link ELEMENT_CSS}).
 */
const GUTTER = { top: 8, right: 8, bottom: 24, left: 40 };

/** SPEC §3's polar plane padding. */
const POLAR_GUTTER = 8;

/**
 * The seven mark-painting hosts that clip to the plot area
 * (SPEC §6, RFC §4.7). `hdml-pie` is among them: it paints, and the
 * clip is the same mechanism as SPEC §9's reach rule for
 * `overflow`, so an author rule beats it.
 */
const CLIPPED = [
  HDVL_TAG_NAMES.LINE,
  HDVL_TAG_NAMES.AREA,
  HDVL_TAG_NAMES.BAR,
  HDVL_TAG_NAMES.POINT,
  HDVL_TAG_NAMES.ARC,
  HDVL_TAG_NAMES.RULE,
  HDVL_TAG_NAMES.PIE,
]
  .map((tag) => `:host(${tag})`)
  .join(",\n");

/**
 * The eight hosts whose paint comes from `mark.ts`'s `fillPaint`,
 * and whose `--hdml-line-width` initial is therefore **neutralised
 * to zero** (017 R4).
 *
 * Until R4 a filled widget never stroked, so `--hdml-line-width`'s
 * registered initial of **`1.5px`** reached nothing. Now that
 * `fillPaint` reads it, that initial would put an edge on every
 * glyph, bar, slice, tick, label and legend entry in the corpus that
 * no author asked for. The fix is one declaration per host here
 * rather than a change in `properties.ts`: the **registry keeps
 * `1.5px`**, which is what `mark.ts`'s `strokePaint` hosts —
 * `hdml-line`, `hdml-rule`, `hdml-axis`, `hdml-grid` — still need,
 * and they are deliberately **absent** from this list.
 *
 * **★ It is a NORMAL declaration, and that is the whole point
 * (trap 12).** R1's extent two rules below is `!important` because it
 * locks the author *out*; this exists so the author decides, so any
 * outer-document `hdml-point { --hdml-line-width: 1px }` beats it by
 * the ordinary shadow-cascade rule that gives the outer tree normal
 * declarations. **Neither may become the other.**
 *
 * **★ Only the WIDTH is neutralised**, not `--hdml-line-color` or
 * `--hdml-line-style`. The width alone gates the outline
 * (`fillPaint` emits no stroke at zero), so the other two keep
 * inheriting — which is what lets an author theme a whole plane's
 * outline colour once and turn it on per widget, and what keeps
 * `schedule.test.ts`'s inherited-`--hdml-line-color` sentinel row
 * reaching a bar.
 *
 * **★ A `:host` declaration beats an INHERITED value**, because
 * inheritance only applies where the element has no declaration of
 * its own. So after R4 `--hdml-line-width` set on an *ancestor* —
 * a `figure`, the view, a plane — no longer reaches a filled widget,
 * and the width must be set by a selector that matches the widget
 * itself. `08-pie-doughnut` is correct for this reason and not by
 * inheritance: it writes `hdml-pie, hdml-arc` as one grouped
 * selector, so the arc is matched directly.
 *
 * **★ `hdml-pie` is the EIGHTH host and is easy to miss**, which is
 * why it is named here. It has no `fillPaint` call of its own: §6.3
 * makes a pie's geometry `hdml-arc`'s *"to the node"*, so
 * `layout-pie` hands its OWN `Measured` to `mark-arc`'s
 * `sectorScene`, and that one call site therefore serves two hosts.
 * A grep for `fillPaint(` finds the file, not the host. Leaving it
 * out put **1.5px** on every unstyled pie, and no corpus golden
 * could catch it: every page with a pie also declares
 * `hdml-pie, hdml-arc { --hdml-line-width: 2px }`, so the default
 * was never the value in force. Measured on all three engines
 * before it was added.
 */
const OUTLINED = [
  HDVL_TAG_NAMES.POINT,
  HDVL_TAG_NAMES.BAR,
  HDVL_TAG_NAMES.ARC,
  HDVL_TAG_NAMES.AREA,
  HDVL_TAG_NAMES.PIE,
  HDVL_TAG_NAMES.TICK,
  HDVL_TAG_NAMES.LABEL,
  HDVL_TAG_NAMES.LEGEND,
]
  .map((tag) => `:host(${tag})`)
  .join(",\n");

/**
 * ★ The glyph extent an **unsized `hdml-point`** takes, in view
 * space — 017 R9.
 *
 * `--hdml-tick-width` / `-height` register **`1px`** and **`6px`**,
 * right for the host they are named after: a tick is a thin mark on
 * an axis. A point is a **dot**, and SPEC §9 gives both rows to
 * `hdml-tick` and `hdml-point` and to nothing else — so a point
 * with no author CSS and no `size` channel rendered as a **1 × 6
 * vertical sliver**, recorded as correct in `12-coverage` A's
 * golden since 016 step 32.
 *
 * **6 × 6 squares the height rather than inventing a number.**
 * `05-scatter` authors `8px` and `07-mixed` `7px`, so an author who
 * deletes their declaration steps down slightly instead of jumping,
 * and the only golden field that moves is `rx` — every centre and
 * every `ry` is untouched, which is what makes the fix legible in a
 * diff. The `6` here and `--hdml-tick-height`'s registered initial
 * are the **same value and not the same number**: that one is a
 * tick's length along its guide, this one is a dot's diameter.
 *
 * **★ These are view-space `x` and `y`, deliberately.** R9's
 * § Interactions pins the point against 017 R5: if R5 makes
 * `--hdml-tick-width` / `-height` mean *along the guide* and *along
 * its normal*, those words are meaningless here — a point sits on
 * no guide and has no normal. Whatever R5 decides for `hdml-tick`,
 * a point's two extents stay the view's two axes, and this rule
 * keeps saying so.
 *
 * **★ NORMAL, exactly like {@link OUTLINED}.** Trap 12 is about
 * R1's `0 !important` further up the sheet, which locks the author
 * *out* of geometry the runtime owns. A glyph's size is the
 * author's, so this rule and `OUTLINED` — emitted as neighbours at
 * the foot of the sheet — **agree**, and R1 is the odd one out. An
 * outer-document `hdml-point { --hdml-tick-width: 4px }` beats this
 * by the ordinary shadow cascade.
 *
 * **★ BOTH properties are declared, and the height's value being a
 * no-op is the reason to declare it.** A `:host` declaration beats
 * an **inherited** one (R4's Finding 2), so declaring the width
 * alone would leave a plane-level `--hdml-tick-height` still
 * reaching the point while its width came from here — a glyph
 * assembled from two sources, which is worse than either answer on
 * its own. Declared together, a point's glyph is square unless a
 * selector matches the **point itself**. Nothing in the corpus
 * relies on the inheritance this removes: all four pages that set
 * either property match `hdml-point` or `hdml-tick` directly.
 *
 * **★ `hdml-tick` is deliberately absent, and that IS the
 * requirement.** This is the first rule on which the two hosts that
 * share these properties disagree; `guide-tick.ts` keeps `1 × 6`
 * and `ua.test.ts` asserts the split in both directions, because a
 * per-host default is invisible to a single-host golden (R4's
 * Finding 1).
 */
const POINT_GLYPH = [
  `:host(${HDVL_TAG_NAMES.POINT}) {`,
  "  --hdml-tick-width: 6px;",
  "  --hdml-tick-height: 6px;",
  "}",
  "",
];

/**
 * The registry's initial for one `--hdml-tick-*` extent — the
 * value {@link tickGlyphRules} transposes.
 *
 * **Read from {@link HDVL_PROPERTIES}, never transcribed**, on
 * {@link SENTINEL_PROPERTIES}'s precedent below. 017 R5's whole
 * claim is that a `y` tick's glyph is the `x` one TURNED rather
 * than a second pair of numbers, and reading the registry is what
 * makes that structural instead of merely commented: change an
 * initial and the transpose follows it.
 *
 * @param axis - Which extent to read.
 * @returns Its registered initial, as CSS text.
 */
function tickInitial(axis: "width" | "height"): string {
  const def = HDVL_PROPERTIES.find(
    (p) => p.name === `--hdml-tick-${axis}`,
  );
  // Unreachable: `properties.ts` registers both WITH an initial,
  // and `registry.test.ts` asserts the set. `initialValue` is
  // optional on the platform's `PropertyDefinition`, so both
  // halves are checked — a `?? ""` would emit a malformed
  // declaration in silence, and this cannot.
  if (def === undefined || def.initialValue === undefined) {
    throw new Error(`--hdml-tick-${axis} has no initial`);
  }
  return def.initialValue;
}

/**
 * ★ **017 R5 — a `y` tick's glyph, TRANSPOSED.**
 *
 * `--hdml-tick-width` and `-height` stay **view-space on every
 * host**, and R5 settled that deliberately: they describe a
 * *glyph* — a `rect` or an `ellipse` per `--hdml-tick-style`,
 * carrying its own outline since R4 — and a shape has a width and
 * a height. Re-meaning them *along the guide* and *across it*
 * would have been meaningless on `hdml-point`, which sits on no
 * guide, and would have split one pair's meaning across two
 * hosts. **Only the DEFAULT turns; nothing is re-meant.**
 *
 * The registry's `1px` × `6px` is an **x** tick — a thin stub
 * hanging below its axis. On a `y` tick that same pair is a 1 × 6
 * stub lying *along* the vertical axis line it sits on, which
 * swallows it. Transposed, it sticks out of the axis instead.
 *
 * **★ Which axis the length runs along is not derived a second
 * time** (R12). {@link GUIDE_PLACEMENT}'s `cross` already names
 * the view axis a guide extends across, and {@link PLACED_LINE}'s
 * comment says why the two are **one fact**: a tick's extent
 * across its channel is a *property* rather than a box, which is
 * precisely why R1 zeroes the box there. So `cross` is read, not
 * restated.
 *
 * **★ `x` gets NO rule, and the asymmetry is deliberate.** An x
 * tick is not broken — the registry's initials are already right
 * for it — so a rule would buy nothing and cost the inheritance
 * below. R5 asks for the `y` default; this is exactly that.
 *
 * **★ BOTH properties are declared**, for R9's reason met a
 * second time (step 05's Finding 1): a `:host` declaration beats
 * an **inherited** one, so declaring the width alone would leave a
 * plane-level `--hdml-tick-height` still reaching the glyph while
 * its width came from here — one glyph assembled from two
 * sources, which is worse than either answer alone.
 *
 * **★ Its cost, stated rather than left to be discovered: an
 * ancestor's `--hdml-tick-*` no longer reaches a `y` tick.** It
 * still reaches an `x` one, which has no declaration of its own.
 * `ua.test.ts` asserts both halves, because that asymmetry is
 * invisible to every golden — no corpus page sets these
 * properties on an ancestor.
 *
 * **★ NORMAL, never `!important`** — {@link OUTLINED} and
 * {@link POINT_GLYPH}'s family, not R1's (trap 12). A glyph's size
 * belongs to the author; R1's lock is for geometry the runtime
 * owns.
 *
 * @returns The rule, as sheet lines.
 */
function tickGlyphRules(): string[] {
  const row = GUIDE_PLACEMENT.y;
  // Unreachable while `y` is a placed channel; a `continue`-shaped
  // guard rather than a throw, because {@link guideRules} treats a
  // missing row the same way.
  if (row === undefined) {
    return [];
  }
  const attr = AXIS_ATTRS_LIST.CHANNEL;
  const tick = HDVL_TAG_NAMES.TICK;
  // `cross` is the view axis a `y` guide extends ACROSS, which is
  // the axis its glyph's LENGTH runs along.
  const long = row.cross;
  const thin = long === "width" ? "height" : "width";
  return [
    `:host(${tick}[${attr}="y"]) {`,
    // ★ Each extent takes the OTHER's initial. That is the whole
    // of R5 as an expression: a transpose, not two new numbers.
    `  --hdml-tick-${long}: ${tickInitial(thin)};`,
    `  --hdml-tick-${thin}: ${tickInitial(long)};`,
    "}",
    "",
  ];
}

/**
 * The guides SPEC §3 places **per channel** whose cross-axis extent
 * is the **runtime's** — zero, `!important`, unreachable from the
 * outer tree (017 R1, extended to `hdml-label` by R2).
 *
 * §3 places three guides per channel: an axis, its ticks and its
 * labels all sit in the same gutter, which is the whole point of a
 * gutter. `hdml-grid` is not among them — it runs *across* the plane
 * and the generic `:host` box rule covers it already (see
 * {@link GUIDE_PLACEMENT}) — and neither is `hdml-legend`, which is
 * placed **once**, not per channel (see {@link LEGEND_CSS}).
 *
 * **★ All three are LINES, and the name says which fact it is.**
 * None of the three reads its own box **across** its channel. An
 * axis is a line. A tick's length is a PROPERTY —
 * `--hdml-tick-height` on an `x` tick and, since 017 R5 transposed
 * the default, `--hdml-tick-width` on a `y` one (see
 * {@link tickGlyphRules}, which reads that same axis off `cross`
 * rather than deriving it twice). And a label's box supplies
 * exactly **one** number, `guideAcross`'s `across`, because
 * `guide-label.ts` never calls `ctx.measureText` — the run carries
 * an `anchor` and a `baseline` and the renderer does the placing.
 * So a gutter extent is, on every one of the three, a number
 * nothing consumes and every author idiom can trip over.
 *
 * **★ `hdml-label` was in a second list until 017 R2, and the
 * reason given for it was never true.** The comment said zeroing
 * the box *"would lay its text into nothing"*; there was no layout
 * there to lose. R1 left the label alone out of caution rather
 * than necessity, and R2 removed the second list. The label's box
 * is now what R2 calls it: *the invisible line its text follows*.
 * {@link guideRules} states why the three still take a rule each.
 */
const PLACED_LINE = [
  HDVL_TAG_NAMES.AXIS,
  HDVL_TAG_NAMES.TICK,
  HDVL_TAG_NAMES.LABEL,
];

/**
 * ★ SPEC §3's `hdml-legend` row — *"top-right **inside the plot
 * area** (`top: 8px; right: 8px` against its scale box);
 * `width: max-content`"*.
 *
 * It is not a gutter guide, and §3 says why: it is *"the overlay
 * default every charting library ships, and the only home correct at
 * **any** plane padding — the 8px default gutter could not hold
 * it"*. Overlap with marks is visible, never silent. Gutter
 * placement is **one author rule** (`left: 100%`), which is what all
 * five corpus pages that declare a legend write.
 *
 * **★ `left: auto` is required and is not tidying.** The generic
 * `:host` rule declares `inset: 0` as four longhands, so `right:
 * 8px` alone leaves `left: 0` in force — and an absolutely
 * positioned box with `left`, `width` and `right` all non-`auto` is
 * over-constrained, which CSS resolves in a left-to-right document
 * by **ignoring `right`**. The legend would then be anchored to the
 * plot's *left* edge, which is the opposite of what this row says,
 * and nothing about the rendered scene would say so. Step 23's
 * guide rows carry the same hazard and the same fix.
 *
 * **★ `bottom: 0` is deliberately LEFT in force**, which is where
 * this row parts company with those. A guide with `height: auto`
 * and both offsets set is over-constrained to a zero extent — the
 * trap step 23 documents — but a legend *wants* the height that
 * `top: 8px` + `bottom: 0` computes: it is the extent its entries
 * flow along, and an `auto` height would shrink-to-fit an empty
 * shadow tree and give the key nowhere to go.
 *
 * **★ And that is exactly what `width: max-content` does to the
 * cross axis.** A legend's entries paint on the **view's** surface,
 * so its own shadow tree is empty and `max-content` resolves to
 * **0** — the box is a zero-width anchor at the plot's top-right
 * corner rather than a box hugging the key, and the entries paint
 * rightwards out of it. SPEC's row is shipped verbatim because the
 * alternative is inventing a width, but the intent it states cannot
 * be met by a box the platform sizes from content that is not
 * there. Recorded as a **finding** at step 31, whose *"every corpus
 * page gives the legend an explicit width"* was **wrong and step 32
 * measured it**: four of the five do, and `12-coverage`
 * deliberately writes no `hdml-legend` rule at all. Both its views
 * carry `box.w === 0` and still render, because the flow axis is
 * `--hdml-legend-direction`'s `column` default — the box's
 * **height**, which `bottom: 0` above keeps non-zero — and
 * `keyNodes`' wrap guard is written for exactly this case. So the
 * default and the authored gutter idiom are each pinned by a page.
 */
const LEGEND_CSS = [
  `:host(${HDVL_TAG_NAMES.LEGEND}) {`,
  `  top: ${GUTTER.top}px;`,
  `  right: ${GUTTER.right}px;`,
  "  left: auto;",
  "  width: max-content;",
  "}",
  "",
];

/**
 * ★ SPEC §3's positional-guide rows, per channel — *"x-channel
 * guides just below the plot (the `top: 100%` idiom); y-channel
 * guides just left (`right: 100%`)"*, spilling into
 * {@link GUTTER}.
 *
 * ★ **Since 017 R2 a LABEL's near offset is not `100%`**: it
 * carries half its gutter as clearance — {@link LABEL_CLEARANCE},
 * where the half is derived, and {@link guideRules}, which emits
 * it.
 *
 * Keyed by {@link Channel} rather than by a string so that a
 * renamed channel is a compile error instead of a selector that
 * silently stops matching; the key is read back out for the
 * attribute selector, so no channel name is written as a literal
 * (R8).
 *
 * **★ Each row resets the opposite offset, and states an extent —
 * and since 017 R1 that extent has TWO cases, not one.** Neither is
 * defensive noise and neither must be "cleaned up".
 *
 * The shared half first. The generic `:host` rule declares
 * `inset: 0` — four longhands — so `top: 100%` **alone** leaves
 * `bottom: 0` in force, and an absolutely positioned box with both
 * offsets and `height: auto` is over-constrained to a used height of
 * *containerHeight − containerHeight − 0*, i.e. **zero**. A
 * zero-high guide measures as a zero box and every scene it produces
 * is geometry against nothing — and it renders, silently, with no
 * diagnostic. Setting `bottom: auto` alone is not enough either: the
 * box would then shrink-to-fit shadow content whose `.plot` is
 * `height: 100%` of an indefinite height. Hence each row's `far`
 * offset being reset, and hence an extent being stated at all.
 *
 * **And since 017 R2 there is only ONE extent**, which is the
 * second case: every {@link PLACED_LINE} gets **`0 !important`**.
 * Here the *deliberate* zero is the correct answer rather than the
 * trap above — a line has no thickness to place, so the box across
 * the channel is a number nothing reads. Stating it as the gutter
 * is what let an author over-constrain the box the other way —
 * `left: 0` against our `right: 100%` **and** `width: 40px`, which
 * CSS resolves by dropping `right`, putting the guide 40px (a
 * scale's padding more on a real page) *inside* the plot. At zero
 * the two idioms **converge**: with no extent, `right: 100%` and
 * `left: 0` put the line in the same place, so it can no longer be
 * shifted by which offset the author reached for. The `!important`
 * is what guarantees the convergence, and `guideEdge` is what makes
 * it free — it derives the drawn edge as whichever edge of this box
 * is nearer the scale's centre, and a zero-extent box's two edges
 * are one number, so the tie-break stops being reachable at all.
 *
 * **★ The lock is the EXTENT and nothing else.** Both offsets stay
 * the author's, which is why R2 ships no `--hdml-label-offset`:
 * distance from the axis is expressed by moving the line, and
 * `top: calc(100% + 8px)` still does exactly that.
 *
 * The corpus pages do not hit the `auto`-reset trap, because they
 * were written against no UA sheet at all and set three offsets
 * each. They hit the extent one — nine of the thirteen write the
 * `left: 0` idiom above on an axis or a tick — which is why R1's
 * fix moved their goldens. **No page writes it on a label**, so
 * R2's half of the lock is proved by `ua.test.ts` alone.
 */
const GUIDE_PLACEMENT: Partial<
  Record<
    Channel,
    {
      /** The offset that places the line. */
      readonly near: "top" | "right";
      /** The opposite offset, reset so the box is not
       * over-constrained. */
      readonly far: "bottom" | "left";
      /** The cross-axis extent's property. */
      readonly cross: "width" | "height";
      /** The {@link GUTTER} side this channel's runs spill into. */
      readonly gutter: number;
    }
  >
> = {
  x: {
    near: "top",
    far: "bottom",
    cross: "height",
    gutter: GUTTER.bottom,
  },
  y: {
    near: "right",
    far: "left",
    cross: "width",
    gutter: GUTTER.left,
  },
};

/**
 * ★ 017 R2's label clearance, as a fraction of the gutter its
 * runs spill into — **and it is derived, not picked.**
 *
 * R2 centres a cartesian run on its tick in *both* dimensions, so
 * with no clearance half of every run sits inside the plot, over
 * the marks. R2 settles that the clearance is the UA's own offset
 * (the alternative makes the zero-CSS floor render labels over its
 * own bars, and `00-minimal` is that floor). It does **not**
 * settle the number. This is the number, and this is why it is
 * the only one:
 *
 * Write the run's extent across its channel `e` and the clearance
 * `c`. A centred run must not reach back over the plot
 * (`c ≥ e / 2`) and must not clip at the view edge
 * (`c + e / 2 ≤ gutter`). Both hold for every `e ≤ gutter`
 * **exactly when `c = gutter / 2`** — any smaller `c` encroaches
 * before the gutter is full, any larger clips before it is.
 *
 * ★ **So it is not a font measurement, and it does not need to
 * be.** The old placement hung the run *outward* from the line
 * (`baseline: top` on x, `anchor: end` on y), which fitted iff
 * `e ≤ gutter`. At `gutter / 2` the centred run fits under the
 * *same* condition, so this step moves every label without moving
 * the font size at which one stops fitting. A literal `8px` would
 * have been the thing this is not: a number that silently stops
 * being right at a different `--hdml-font-size`.
 *
 * **Two limitations, stated rather than discovered.** The sheet is
 * built once at import time, so `gutter` is {@link GUTTER}'s
 * default — an author who shrinks the plane's `padding` gets a
 * clearance sized for the gutter they replaced, and moves the
 * label if they mind. And `dominant-baseline: middle` centres on
 * the x-height midline rather than the em box, so the x centring
 * is a glyph-metric approximation of a geometric claim. ★ Neither
 * is visible to any scene assertion — {@link GUTTER}'s own
 * docblock says why — so both are the visual gate's to catch.
 */
const LABEL_CLEARANCE = 0.5;

/**
 * {@link GUIDE_PLACEMENT} as CSS text — **one rule per tag per
 * channel**, so six rules of three declarations each.
 *
 * ★ **Five of the six carry the same three; the label's two
 * differ by {@link LABEL_CLEARANCE}.** That is what 10-2's
 * one-rule-per-tag split bought and why it is not undone here: a
 * per-tag offset needed no new rule, only a different value in
 * the one the label already had.
 *
 * **★ Identical declarations are emitted separately on purpose, and
 * that is not cosmetic** (017 R1's second reason, generalised by
 * R2). DevTools attributes a struck-through declaration to
 * whichever selector of a group it lists **first**, so a grouped
 * rule makes the Styles pane blame an element the author is not
 * looking at. R1 found that with one rule over all three tags:
 * inspecting a misplaced **axis** pointed the author at a
 * **label**.
 *
 * R1 fixed it half way — two rules, but `hdml-axis` and
 * `hdml-tick` still shared one, so a misplaced **tick** still
 * pointed at an **axis**. R2 removes the second list, and merging
 * what is left into one group of three would put R1's misdirection
 * straight back. So the answer is neither list: **a rule per tag**,
 * which costs three declarations a channel and makes the Styles
 * pane able to name only the element that is actually wrong. It is
 * also assertable as a shape — *no placement rule names more than
 * one tag* — where *"this one rule omits `hdml-label`"* was only
 * ever a statement about the list that happened to exist.
 *
 * **★ One cost, and it is a lookup cost rather than a cascade
 * one.** `:host(hdml-tick[channel="y"])` is now written **twice**
 * in this sheet — here for the extent, and in
 * {@link tickGlyphRules} for R5's transposed glyph default. Two
 * rules with one selector are ordinary CSS and cascade by order,
 * so nothing renders differently; what breaks is any code that
 * finds a rule *by its selector text*, which silently gets this
 * one because `guideRules` is spliced first. `ua.test.ts` asks
 * every such lookup what a rule DECLARES.
 *
 * @returns The rules, as sheet lines.
 */
function guideRules(): string[] {
  const attr = AXIS_ATTRS_LIST.CHANNEL;
  const out: string[] = [];
  for (const channel of Object.keys(GUIDE_PLACEMENT)) {
    const row = GUIDE_PLACEMENT[<Channel>channel];
    if (row === undefined) {
      continue;
    }
    for (const tag of PLACED_LINE) {
      // ★ 017 R2: the LINE is the same for all three, and only
      // the label's is offset off it. An axis and a tick ARE the
      // line; a label is a run hung near it, and with the run now
      // centred on its tick it needs the gutter's own room.
      const near =
        tag === HDVL_TAG_NAMES.LABEL
          ? `calc(100% + ${row.gutter * LABEL_CLEARANCE}px)`
          : "100%";
      out.push(
        `:host(${tag}[${attr}="${channel}"]) {`,
        `  ${row.near}: ${near};`,
        `  ${row.far}: auto;`,
        `  ${row.cross}: 0 !important;`,
        "}",
        "",
      );
    }
  }
  return out;
}

/**
 * The box properties the sentinel covers beyond the registry.
 *
 * `ResizeObserver` reports size and never position (§5.6), so a
 * guide moved by `top: 100%` → `top: 110%` at an unchanged size
 * fires nothing. These five close that hole for the declarative
 * case — a class flip, a stylesheet swap, a container-query
 * breakpoint — and `color` is here because R16 resolves
 * `currentcolor` against it.
 */
const SENTINEL_BOX = [
  "color",
  "inset",
  "margin",
  "padding",
  "width",
  "height",
];

/**
 * Every property whose change schedules a frame (§5.6, R24).
 *
 * **Built from {@link HDVL_PROPERTIES}, never by hand** — a
 * forty-eighth registered property must not be able to become
 * silently unobserved.
 */
export const SENTINEL_PROPERTIES: readonly string[] = [
  ...HDVL_PROPERTIES.map((def) => def.name),
  ...SENTINEL_BOX,
];

/**
 * The one name MEASURE looks for to decide the sentinel survived.
 *
 * An author `transition` shorthand replaces our declaration
 * wholesale, so its absence from the computed `transition-property`
 * is exactly the W5 condition (§5.6).
 */
export const SENTINEL_MARKER: string = SENTINEL_PROPERTIES[0];

/*
 * ── R33: every rule below is host-qualified, except two ──
 *
 * One sheet is adopted by EVERY shadow root, so an unqualified
 * `:host` rule reaches every host — the view's `aspect-ratio` would
 * land on marks and the plane's padding on guides. Only `.plot` and
 * the generic `:host` box rule are legitimately generic, because
 * they are true of every display element.
 *
 * ── R24: the sentinel is LONGHANDS, never the shorthand ──
 *
 * RFC §3.2 shows the frame sentinel written as the `transition`
 * shorthand. That form must never be copied literally: a shorthand
 * is replaced *wholesale* by any later rule of ours, which would
 * silently kill the sentinel for that family and force the fallback
 * observer on. The generic `:host` rule below therefore declares
 * `transition-property` + `transition-duration` + a THIRD longhand,
 * `transition-behavior`, and every step that adds a `:host(...)`
 * rule must keep doing the same.
 *
 * The 1 ms duration is the whole detection mechanism: a
 * `transitionrun` on any listed property is what tells the view a
 * declarative change happened — inline, inherited or
 * stylesheet-driven — which is what retires the PoC's document-wide
 * `MutationObserver`.
 *
 * ── The third longhand: `transition-behavior: allow-discrete` ──
 *
 * **A transition only runs on an INTERPOLABLE property.** A
 * registered custom property whose syntax is a keyword list or `*`
 * is not interpolable, so without this line it fires nothing and a
 * change to it repaints only when some interpolable neighbour
 * happens to move as well.
 *
 * **★ The measurement below is HISTORY and its numbers are not the
 * registry's.** It was taken on a live page with real data on all
 * three engines at 017 R6, when the registry held **thirty-five**
 * properties; R7 took it to forty-seven at step 09-1, and 47 was
 * never measured. The count is therefore left as measured and
 * marked, never renumbered — only the variant *names* are respelled
 * for R7's `--` separator.
 *
 * Measured (017 R6): **fifteen of the then-thirty-five registered
 * properties were silently unobserved** — the six `*`-typed
 * (`--hdml-font-family`, `--hdml-curve-bezier-tangents` and the four
 * `--hover` paint variants that existed then) and the nine keyword
 * lists — and so were the two `<color>+` properties whenever the new
 * list has a DIFFERENT LENGTH from the old, because list
 * interpolation is defined only at equal lengths. `allow-discrete`
 * revives every one of them, on chromium, firefox and webkit, all of
 * which report
 * `CSS.supports("transition-behavior", "allow-discrete")`.
 *
 * **What R7 added is covered by the same declaration, and that was
 * measured rather than argued.** The twelve new state variants are
 * all syntax `*`, so they land in the class the R6 measurement found
 * silent and `allow-discrete` revives — and re-running the sweep at
 * step 09-1 reported **47 registered · 47 schedule a frame · 0
 * silent**, with all sixteen variants firing. Nothing in the
 * mechanism is per-property.
 *
 * It costs nothing at load and nothing per change: a discrete flip
 * lands at 50 % of the 1 ms duration (0.5 ms) while the frame runs
 * at the next `requestAnimationFrame` (~16 ms), so MEASURE always
 * reads the FINAL value, and the frame count from navigation to
 * settle is unchanged. **The 1 ms duration that makes the sentinel
 * cheap is also what makes discrete safe.**
 *
 * `ua.test.ts` asserts the support claim rather than trusting it,
 * and `schedule.test.ts` drives one probe PER SYNTAX CLASS — the
 * gap that let this survive 1264 tests was that both sentinel tests
 * picked an interpolable property, under a guard written to assert
 * only that the sentinel LISTS every registered property.
 *
 * ── The `inset: 0` in the generic rule ──
 *
 * RFC §3.2's code block writes `:host { position: absolute }` alone,
 * but §4.3 states the behaviour the sheet has to produce: "its
 * children re-expand to its content box through the `.plot`
 * wrapper". An absolutely positioned element with `auto` offsets
 * takes its static position and shrink-to-fits, so an empty scale
 * inside a plane would be a 0×0 box — no range, no guide containing
 * block, and R1's "every element owns a true CSS box" false two
 * levels down. `inset: 0` is what §4.3 already describes; the view
 * resets it because the view is the one element in normal flow.
 *
 * ── `box-sizing: border-box`, added at step 33 ──
 *
 * It is a **no-op for every element that takes its size from the
 * insets**, which until step 33 was every element on every corpus
 * page: with `width: auto` and both offsets set, the used width is
 * whatever fills the containing block and box-sizing cannot change
 * it. It binds in exactly one place — an element that authors a
 * **size** *and* carries **padding** — and the only one in the
 * corpus is `11-multi-plane` A's three panels, which write
 * `width: 33.333%` on a plane whose UA padding is the §3 gutter.
 *
 * Under the platform default (`content-box`) that width sizes the
 * **plot area**, so each panel's border box is a third of the view
 * *plus 56 px of gutter*: the three panels do not tile, and the
 * third is pushed off the right edge of the view and clipped by
 * the `<svg>`. The page's own host-HTML titles — three `span`s at
 * `width: 33.333%` — are laid out at the true thirds, so the page
 * contains its own consistency check and fails it. Nothing about
 * this is expressible by the author: §3 makes the gutter the
 * **UA's** number, so `calc(33.333% - 56px)` would hard-code a
 * value the UA sheet owns and re-break on any padding override.
 *
 * The corpus is the proof that it changes nothing else: the twelve
 * pages gated before step 33 have byte-identical goldens with and
 * without this line. Found by the step-33 gate — see
 * `docs/decisions.md` and the corpus README's finding 25.
 */
const ELEMENT_CSS = [
  ":host {",
  "  position: absolute;",
  "  inset: 0;",
  "  box-sizing: border-box;",
  `  transition-property: ${SENTINEL_PROPERTIES.join(", ")};`,
  "  transition-duration: 1ms;",
  "  transition-behavior: allow-discrete;",
  "}",
  "",
  `:host(${VIEW}) {`,
  "  display: block;",
  "  aspect-ratio: 2 / 1;",
  "  position: relative;",
  "  inset: auto;",
  "}",
  "",
  `:host(${CARTESIAN}),`,
  `:host(${POLAR}) {`,
  "  position: absolute;",
  "  inset: 0;",
  "  container-type: size;",
  "}",
  `:host(${CARTESIAN}) {`,
  `  padding: ${GUTTER.top}px ${GUTTER.right}px` +
    ` ${GUTTER.bottom}px ${GUTTER.left}px;`,
  "}",
  `:host(${POLAR}) { padding: ${POLAR_GUTTER}px }`,
  "",
  // SPEC §3's `hdml-grid` row — "inset: 0, over the plot area" —
  // needs NO rule of its own: the generic `:host` above already IS
  // that declaration, and a grid is the one guide that wants it
  // unchanged. Stated rather than omitted, so a later reader does
  // not add a rule that changes nothing and then trust it.
  ...guideRules(),
  ...LEGEND_CSS,
  ".plot { position: relative; width: 100%; height: 100% }",
  "",
  `:host(${VIEW}) > slot { visibility: collapse }`,
  `:host(${VIEW}) > svg {`,
  "  position: absolute;",
  "  inset: 0;",
  "  display: block;",
  // An `<svg>` is a REPLACED element with an intrinsic 300x150, and
  // `width: auto` on a replaced box resolves to that intrinsic size
  // rather than to the inset — so `inset: 0` alone leaves the one
  // surface at 300x150 inside a 400x200 view. Measured, all three
  // engines.
  "  width: 100%;",
  "  height: 100%;",
  "}",
  "",
  `${CLIPPED} { overflow: hidden }`,
  "",
  // 017 R4's neutralised outline default. NORMAL, never
  // `!important` — see OUTLINED.
  `${OUTLINED} { --hdml-line-width: 0 }`,
  "",
  // 017 R9's square glyph for an unsized point — see POINT_GLYPH.
  // Its neighbour above and it AGREE about being normal; R1's
  // `!important` is further up and is the exception (trap 12).
  ...POINT_GLYPH,
  // 017 R5's transposed glyph for a `y` tick — see
  // tickGlyphRules. The third of three per-host / per-channel
  // default families at this foot, and all three are NORMAL.
  ...tickGlyphRules(),
].join("\n");

const DOCUMENT_CSS = [
  `${VIEW}:not(:defined) > ${FALLBACK} { display: block }`,
  `${VIEW}:defined > ${FALLBACK} { display: none }`,
].join("\n");

/**
 * Adopted by every `HdvlElement` shadow root at render-root
 * creation. **One shared instance**, parsed once — an identity two
 * shadow roots can be compared on.
 */
export const elementSheet: CSSStyleSheet = new CSSStyleSheet();
elementSheet.replaceSync(ELEMENT_CSS);

/**
 * Adopted into `document.adoptedStyleSheets`. Carries only the two
 * `hdml-fallback` rules, which are **pure CSS with no JavaScript**
 * (§3.1): the window they exist for is the one where our script has
 * not run, or has failed.
 */
export const documentSheet: CSSStyleSheet = new CSSStyleSheet();
documentSheet.replaceSync(DOCUMENT_CSS);

/**
 * Appends {@link documentSheet} to `document.adoptedStyleSheets` at
 * most once.
 *
 * The list is reassigned rather than mutated because it is a
 * `FrozenArray` on some engines. Idempotency is per module instance:
 * a page that loads two builds adopts two distinct sheets with
 * identical text, which is harmless.
 */
export function adoptDocumentSheet(): void {
  if (document.adoptedStyleSheets.includes(documentSheet)) {
    return;
  }
  document.adoptedStyleSheets = [
    ...document.adoptedStyleSheets,
    documentSheet,
  ];
}
