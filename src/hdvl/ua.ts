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

import { HDVL_TAG_NAMES } from "./vocabulary";
import { HDVL_PROPERTIES } from "./properties";

const VIEW = HDVL_TAG_NAMES.VIEW;
const CARTESIAN = HDVL_TAG_NAMES.CARTESIAN_PLANE;
const POLAR = HDVL_TAG_NAMES.POLAR_PLANE;
const FALLBACK = HDVL_TAG_NAMES.FALLBACK;

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
  `:host(${CARTESIAN}) { padding: 8px 8px 24px 40px }`,
  `:host(${POLAR}) { padding: 8px }`,
  "",
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
