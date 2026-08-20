/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The MEASURE phase (RFC 016/001 §2.7, §5.4, R16, R24).
 *
 * **This is the only module under `src/hdvl/` that reads computed
 * style**, and it reads it **once per element per frame**, writing
 * nothing. That is §5.4 made mechanical rather than promised: one
 * `getComputedStyle` yields the box-level properties, the font, every
 * registered `--hdml-*` the element reads *and* its `_hover`
 * variant — which is the whole of SPEC §9's two-mechanism argument,
 * because base and hover values are simultaneously readable from one
 * computed style. Measured cost is ~10–25 µs per element, which is
 * why no per-property caching is specified; do not add any.
 *
 * Two values are resolved here rather than passed through:
 * `currentcolor` (R16 — chromium and firefox compute the literal,
 * webkit the already-resolved `rgb()`, so an unresolved value makes
 * SPEC §9's "an unstyled chart is legible" hold on one engine of
 * three), and `clip-path`, which becomes explicit geometry in view
 * coordinates because the emitted `<g>` has no CSS box to resolve a
 * percentage against.
 *
 * @module hdvl/measure
 */

import type { HdvlElement } from "./base";
import type { HdmlViewElement } from "./view";
import type { Rect, SceneFont, Subpath } from "./scene";
import type { TextMetrics2 } from "./renderer";
import type { Resolution } from "./resolve";
import { clipShape, hasUrlForm } from "./kernel/clip-shape";
import { HDVL_PROPERTIES } from "./properties";
import { SENTINEL_MARKER } from "./ua";

/** Everything one frame measured about one element. */
export interface Measured {
  /** getBoundingClientRect() minus the view's content-box
   *  origin (§2.7). View coordinates, CSS px. */
  box: Rect;
  /** The four box-level properties §9's reach rule needs,
   *  already resolved. */
  opacity: number;
  filter: string;
  visibility: "visible" | "hidden";
  /** Computed `overflow` is not `visible`. */
  clip: boolean;
  clipPath: readonly Subpath[] | null;
  /** The element's computed `color`, already used to
   *  resolve every `currentcolor` below (R16). */
  color: string;
  font: SceneFont;
  /** Every registered `--hdml-*` and `_hover` variant, from
   *  the SAME computed style. */
  props: ReadonlyMap<string, string>;
  /** false when the author replaced the `transition`
   *  shorthand and the sentinel is gone (R24). */
  sentinel: boolean;
  /**
   * A `url()` form appeared in `clip-path` or `filter`, so the
   * value was **ignored, never half-applied** (§5.4).
   *
   * **W6's trigger, carried and not reported.** There is no
   * diagnostics sink until step 12, and a bare `console.warn` here
   * would fire every frame — §8's warnings are edge-triggered
   * (R25). The flag exists so step 12 adds a sink rather than
   * re-plumbing the phase.
   */
  w6: boolean;
}

/** What a widget's `scene()` is handed in COMPUTE (§2.3). */
export interface FrameContext {
  /** The surface size PAINT will render into. */
  width: number;
  height: number;
  measured(el: HdvlElement): Measured;
  resolution(el: HdvlElement): Resolution | undefined;
  /** Available during COMPUTE, before render() (§5.3). */
  measureText(text: string, font: SceneFont): TextMetrics2;
}

/** One MEASURE pass over one view. */
export interface Snapshot {
  /** The view's content box, CSS px. */
  width: number;
  height: number;
  measured: ReadonlyMap<HdvlElement, Measured>;
}

/**
 * A signed zero is `===` zero but is neither `Object.is`-equal nor
 * `deepEqual` to it, and serializes to `"-0"`. `rect.left -
 * originX` for a flush edge is a difference of equal doubles, which
 * produces one — so an unnormalised box would put a permanent
 * cross-engine split into every scene (plan rule 9).
 */
function px(v: number): number {
  return Object.is(v, -0) ? 0 : v;
}

/** `currentcolor`, in either spelling, → the resolved one. */
function resolvePaint(value: string, color: string): string {
  return value.trim().toLowerCase() === "currentcolor"
    ? color
    : value;
}

/** A `<length>` computed value (`"11px"`) as a number. */
function len(value: string, fallback: number): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Whether the frame sentinel survived the author's CSS (R24).
 *
 * `transition` is a shorthand, so *any* author `transition` rule on
 * a display element replaces our declaration wholesale and removes
 * detection. The list is compared by exact membership rather than
 * by substring, because `--hdml-line-width` is a prefix of
 * `--hdml-line-width_hover`.
 */
function sentinelOf(style: CSSStyleDeclaration): boolean {
  const list = style.transitionProperty.split(",");
  for (const item of list) {
    if (item.trim() === SENTINEL_MARKER) {
      return true;
    }
  }
  return false;
}

/** Reads one element, from exactly one computed style. */
function measureOne(
  el: HdvlElement,
  originX: number,
  originY: number,
  style: CSSStyleDeclaration,
): Measured {
  const r = el.getBoundingClientRect();
  const box: Rect = {
    x: px(r.left - originX),
    y: px(r.top - originY),
    w: px(r.width),
    h: px(r.height),
  };

  const color = style.color;
  const props = new Map<string, string>();
  for (const def of HDVL_PROPERTIES) {
    const raw = style.getPropertyValue(def.name).trim();
    props.set(def.name, resolvePaint(raw, color));
  }

  const rawFilter = style.filter;
  const filterUrl = hasUrlForm(rawFilter);
  const shape = clipShape(style.clipPath, box);

  return {
    box,
    opacity: len(style.opacity, 1),
    filter: filterUrl ? "none" : rawFilter,
    visibility: style.visibility === "visible" ? "visible" : "hidden",
    clip:
      style.overflowX !== "visible" || style.overflowY !== "visible",
    clipPath: shape.subpaths,
    color,
    font: {
      family: props.get("--hdml-font-family") ?? "system-ui",
      size: len(props.get("--hdml-font-size") ?? "", 11),
      weight: props.get("--hdml-font-weight") ?? "normal",
      style: props.get("--hdml-font-style") ?? "normal",
    },
    props,
    sentinel: sentinelOf(style),
    w6: filterUrl || shape.w6,
  };
}

/**
 * Measures a whole view — **one `getComputedStyle` per element, and
 * no writes** (§5.4, §5.6).
 *
 * The view is measured first because every other box is expressed
 * relative to its content-box origin (§2.7), and that origin comes
 * out of the view's own computed style. No element pays a second
 * style read for it.
 *
 * §2.7's consequence, stated rather than discovered later: a CSS
 * `transform` on a display element is unsupported in v1 (§13), and
 * nothing here compensates for one.
 *
 * @param view - The view being framed.
 * @param elements - Its display elements, document order, the view
 * first.
 * @returns The frame's snapshot.
 */
export function measureView(
  view: HdmlViewElement,
  elements: readonly HdvlElement[],
): Snapshot {
  const measured = new Map<HdvlElement, Measured>();
  const viewStyle = getComputedStyle(view);
  const viewRect = view.getBoundingClientRect();
  const originX =
    viewRect.left +
    len(viewStyle.borderLeftWidth, 0) +
    len(viewStyle.paddingLeft, 0);
  const originY =
    viewRect.top +
    len(viewStyle.borderTopWidth, 0) +
    len(viewStyle.paddingTop, 0);

  for (const el of elements) {
    const style = el === view ? viewStyle : getComputedStyle(el);
    measured.set(el, measureOne(el, originX, originY, style));
  }

  // The scene's surface is the view's CONTENT box, which is what
  // `ResizeObserver`'s `contentBoxSize` reports and what every box
  // measured above is already relative to.
  const width =
    viewRect.width -
    (originX - viewRect.left) -
    len(viewStyle.borderRightWidth, 0) -
    len(viewStyle.paddingRight, 0);
  const height =
    viewRect.height -
    (originY - viewRect.top) -
    len(viewStyle.borderBottomWidth, 0) -
    len(viewStyle.paddingBottom, 0);

  return { width: px(width), height: px(height), measured };
}
