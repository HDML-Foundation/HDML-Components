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
 * because the **guide placement rules below take their extent from
 * the same members**. A gutter and a guide box that disagreed would
 * either clip the guide at the view edge or leave dead space under
 * the plot, and neither is visible in a scene assertion.
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
 * The guides SPEC §3 places **per channel** whose cross-axis extent
 * is the **runtime's** — zero, `!important`, unreachable from the
 * outer tree (017 R1).
 *
 * §3 places three guides per channel: an axis, its ticks and its
 * labels all sit in the same gutter, which is the whole point of a
 * gutter. `hdml-grid` is not among them — it runs *across* the plane
 * and the generic `:host` box rule covers it already (see
 * {@link GUIDE_PLACEMENT}) — and neither is `hdml-legend`, which is
 * placed **once**, not per channel (see {@link LEGEND_CSS}).
 *
 * **★ But the three take TWO rules, not one, and the split is
 * load-bearing.** An axis is a line and a tick's length is
 * `--hdml-tick-height`; neither reads its own box **across** its
 * channel, so a gutter extent there is a number nothing consumes
 * and every author idiom can trip over. {@link guideRules} states
 * why the two rules stay split even where their declarations
 * coincide.
 */
const PLACED_LINE = [HDVL_TAG_NAMES.AXIS, HDVL_TAG_NAMES.TICK];

/**
 * The guide that keeps the gutter extent, because it is the only
 * one with something to lay into it.
 *
 * `hdml-label` was **excluded from R1 deliberately**: zeroing its
 * box would lay its text into nothing. R2 gives it a property
 * instead of a box and then joins it to {@link PLACED_LINE},
 * removing this row entirely — but R1 stands alone if R2 is ever
 * deferred, which is why these are two lists rather than one list
 * and a flag.
 */
const PLACED_RUN = [HDVL_TAG_NAMES.LABEL];

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
 * `height: 100%` of an indefinite height. Hence {@link offsets}
 * resetting the far offset, and hence an extent being stated at all.
 *
 * **Which extent depends on what the guide does with it, which is
 * the R1 split.**
 *
 * - A {@link PLACED_RUN} — `hdml-label` — gets {@link gutter}, the
 *   very number that sets the plane's padding, because its box is
 *   where its text lays out.
 * - A {@link PLACED_LINE} — `hdml-axis`, `hdml-tick` — gets
 *   **`0 !important`**. Here the *deliberate* zero is the correct
 *   answer rather than the trap above: a line has no thickness to
 *   place, so the box across the channel is a number nothing reads.
 *   Stating it as the gutter is what let an author over-constrain
 *   the box the other way — `left: 0` against our `right: 100%`
 *   **and** `width: 40px`, which CSS resolves by dropping `right`,
 *   putting the axis 40px (a scale's padding more on a real page)
 *   *inside* the plot. At zero the two idioms **converge**: with no
 *   extent, `right: 100%` and `left: 0` put the line in the same
 *   place, so it can no longer be shifted by which offset the author
 *   reached for. The `!important` is what guarantees the
 *   convergence, and `guideEdge` is what makes it free — it derives
 *   the drawn edge as whichever edge of this box is nearer the
 *   scale's centre, and a zero-extent box's two edges are one
 *   number, so the tie-break stops being reachable at all.
 *
 * The corpus pages do not hit the `auto`-reset trap, because they
 * were written against no UA sheet at all and set three offsets
 * each. They hit the extent one — nine of the thirteen write the
 * `left: 0` idiom above — which is why R1's fix moves their goldens.
 */
const GUIDE_PLACEMENT: Partial<
  Record<
    Channel,
    {
      /** The near offset, and the far one reset. */
      readonly offsets: readonly string[];
      /** The cross-axis extent's property. */
      readonly cross: "width" | "height";
      /** {@link PLACED_RUN}'s extent, in px. */
      readonly gutter: number;
    }
  >
> = {
  x: {
    offsets: ["  top: 100%;", "  bottom: auto;"],
    cross: "height",
    gutter: GUTTER.bottom,
  },
  y: {
    offsets: ["  right: 100%;", "  left: auto;"],
    cross: "width",
    gutter: GUTTER.left,
  },
};

/**
 * {@link GUIDE_PLACEMENT} as CSS text — **two rules per channel**.
 *
 * **★ The rules stay split even where their declarations coincide,
 * and that is not cosmetic** (017 R1's second reason). DevTools
 * attributes a struck-through declaration to whichever selector of a
 * group it lists **first**, so while one grouped rule carried all
 * three tags, inspecting a misplaced **axis** pointed the author at
 * a **label**. Splitting {@link PLACED_LINE} from
 * {@link PLACED_RUN} makes the Styles pane name the element that is
 * actually wrong. Merging them back — or emitting the extent as a
 * second rule over the same group — would put the misdirection
 * back.
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
    const selector = (tags: readonly string[]): string =>
      tags
        .map((tag) => `:host(${tag}[${attr}="${channel}"])`)
        .join(",\n");
    out.push(
      `${selector(PLACED_LINE)} {`,
      ...row.offsets,
      `  ${row.cross}: 0 !important;`,
      "}",
      "",
      `${selector(PLACED_RUN)} {`,
      ...row.offsets,
      `  ${row.cross}: ${row.gutter}px;`,
      "}",
      "",
    );
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
 * thirty-sixth registered property must not be able to become
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
 * happens to move as well. Measured on a live page with real data
 * on all three engines (017 R6): **fifteen of the thirty-five
 * registered properties were silently unobserved** — the six
 * `*`-typed (`--hdml-font-family`, `--hdml-curve-bezier-tangents`
 * and the four `_hover` variants) and the nine keyword lists — and
 * so were the two `<color>+` properties whenever the new list has a
 * DIFFERENT LENGTH from the old, because list interpolation is
 * defined only at equal lengths. `allow-discrete` revives every one
 * of them, on chromium, firefox and webkit, all of which report
 * `CSS.supports("transition-behavior", "allow-discrete")`.
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
