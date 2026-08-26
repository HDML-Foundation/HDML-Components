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
 * The three guides SPEC §3 places **per channel** — an axis, its
 * ticks and its labels all sit in the same gutter, which is the
 * whole point of a gutter. `hdml-grid` is not among them: it runs
 * *across* the plane and is covered already (see
 * {@link GUIDE_PLACEMENT}); `hdml-legend` is not either, because it
 * is placed **once**, not per channel — see {@link LEGEND_CSS}.
 */
const PLACED = [
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
 * Keyed by {@link Channel} rather than by a string so that a
 * renamed channel is a compile error instead of a selector that
 * silently stops matching; the key is read back out for the
 * attribute selector, so no channel name is written as a literal
 * (R8).
 *
 * **★ Each row resets the opposite offset, and states an extent.**
 * This is not defensive noise and must not be "cleaned up". The
 * generic `:host` rule declares `inset: 0` — four longhands — so
 * `top: 100%` **alone** leaves `bottom: 0` in force, and an
 * absolutely positioned box with both offsets and `height: auto`
 * is over-constrained to a used height of *containerHeight −
 * containerHeight − 0*, i.e. **zero**. A zero-high guide measures
 * as a zero box and every scene it produces is geometry against
 * nothing — and it renders, silently, with no diagnostic. Setting
 * `bottom: auto` alone is not enough either: the box would then
 * shrink-to-fit shadow content whose `.plot` is `height: 100%` of
 * an indefinite height. Hence the third declaration, whose value
 * is the gutter the guide is being placed into.
 *
 * The corpus pages do not hit any of this, because they were
 * written against no UA sheet at all and set three offsets each.
 */
const GUIDE_PLACEMENT: Partial<Record<Channel, readonly string[]>> = {
  x: [
    "  top: 100%;",
    "  bottom: auto;",
    `  height: ${GUTTER.bottom}px;`,
  ],
  y: [
    "  right: 100%;",
    "  left: auto;",
    `  width: ${GUTTER.left}px;`,
  ],
};

/**
 * {@link GUIDE_PLACEMENT} as CSS text.
 *
 * @returns The rules, as sheet lines.
 */
function guideRules(): string[] {
  const attr = AXIS_ATTRS_LIST.CHANNEL;
  const out: string[] = [];
  for (const channel of Object.keys(GUIDE_PLACEMENT)) {
    const decls = GUIDE_PLACEMENT[<Channel>channel];
    if (decls === undefined) {
      continue;
    }
    const selector = PLACED.map(
      (tag) => `:host(${tag}[${attr}="${channel}"])`,
    ).join(",\n");
    out.push(`${selector} {`, ...decls, "}", "");
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
 * `transition-property` + `transition-duration`, and every step that
 * adds a `:host(...)` rule must keep doing the same.
 *
 * The 1 ms duration is the whole detection mechanism: a
 * `transitionrun` on any listed property is what tells the view a
 * declarative change happened — inline, inherited or
 * stylesheet-driven — which is what retires the PoC's document-wide
 * `MutationObserver`.
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
 */
const ELEMENT_CSS = [
  ":host {",
  "  position: absolute;",
  "  inset: 0;",
  `  transition-property: ${SENTINEL_PROPERTIES.join(", ")};`,
  "  transition-duration: 1ms;",
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
