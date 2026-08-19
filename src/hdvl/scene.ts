/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * Contract 3 — the scene (RFC 016/001 §2.5, §2.7, R2).
 *
 * Renderer-neutral by construction: no SVG path string, no DOM node
 * and no CSS selector crosses this boundary. A scene is **plain,
 * immutable, serializable data** — `structuredClone` round-trips it,
 * which is the operational definition the test suite asserts — and
 * that is what makes a scene assertion, rather than a DOM
 * assertion, the primary test mechanism for every widget slice.
 *
 * **All geometry is in view coordinates** (§2.7): CSS pixels, origin
 * at the `hdml-view`'s content-box top-left, y down. Not
 * local-to-widget, because a guide's positions cross boxes by
 * construction — an x-`hdml-label` takes its x from the x-scale's
 * box and its y from its own box, and both must land in one space.
 *
 * The whole contract lands in one commit deliberately (step-plan
 * H9): five of `SceneGroup`'s fields have no producer until Slice D,
 * and §2.5 forecloses adding them later in its own words — *"All
 * four of §9's box-level properties are here — none may be dropped,
 * or the rule is unimplementable."*
 *
 * @module hdvl/scene
 */

/** A resolved font, as four separate fields. */
export interface SceneFont {
  family: string;
  size: number;
  weight: string;
  style: string;
}

/** A point in view coordinates. */
export interface Point {
  x: number;
  y: number;
}

/** A box in view coordinates. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A renderer-neutral path segment. An SVG `d` string is a
 * serialization detail of ONE renderer, so it does not cross the
 * seam.
 *
 * **Two kinds, not one.** Collapsing `line` into a degenerate cubic
 * would triple the payload of the most common path in the corpus,
 * because `--hdml-curve-type: linear` is the *initial value* — and
 * it buys no consumer anything. That reasoning is step-plan S2, and
 * it is why RFC §6.2's `linear` row reads "straight segments".
 */
export type Segment =
  | { k: "line"; to: Point }
  | { k: "cubic"; c1: Point; c2: Point; to: Point };

/**
 * One contiguous run of segments.
 *
 * A new subpath is a **GAP**: SPEC §7's missing values break a path,
 * never bridge it (§4.7). A renderer must therefore start a fresh
 * pen-down at every `start`, never draw from the previous subpath's
 * last point.
 */
export interface Subpath {
  start: Point;
  segments: readonly Segment[];
}

/** The resolved paint of one node. */
export interface Paint {
  /** Resolved CSS `<color>`, or null for none. */
  fill: string | null;
  /** Resolved CSS `<color>`, or null for none. */
  stroke: string | null;
  strokeWidth: number;
  /** null = solid; else the dash pattern in CSS px. */
  dash: readonly number[] | null;
}

/**
 * `i` is the SOURCE ROW index the node was built from, or -1. It is
 * the `index` of SPEC §10's pointer events and is **never**
 * re-derived by inverting a scale.
 */
interface NodeBase extends Paint {
  i: number;
}

/**
 * One drawable.
 *
 * `arc` is **parameterised, not pre-serialized**: an annulus sector
 * and the 360° two-command case are the SVG renderer's own business,
 * and parameters hit-test and clip more simply than a path. The
 * neutrality is a by-product, not the reason (§5.9). Do not
 * "simplify" it into a `path` — the geometry the renderer derives
 * from it is renderer-local by design.
 *
 * Arc angles are **degrees**, `0` at 12 o'clock, increasing
 * clockwise — the `conic-gradient()` convention §4.6 pins.
 */
export type SceneNode =
  | (NodeBase & {
      k: "path";
      subpaths: readonly Subpath[];
      closed: boolean;
      /** Projected data vertices, for hit resolution (§5.7). */
      vertices: readonly (Point & { i: number })[];
    })
  | (NodeBase & { k: "rect" } & Rect)
  | (NodeBase & {
      k: "ellipse";
      cx: number;
      cy: number;
      rx: number;
      ry: number;
    })
  | (NodeBase & {
      k: "arc";
      cx: number;
      cy: number;
      r0: number;
      r1: number;
      a0: number;
      a1: number;
    })
  | (NodeBase & {
      k: "text";
      x: number;
      y: number;
      text: string;
      anchor: "start" | "middle" | "end";
      baseline: "top" | "middle" | "bottom";
      font: SceneFont;
      /**
       * true = decoration, pruned from a11y and from text
       * selection (§6.6).
       */
      decorative: boolean;
    });

/**
 * One widget's contribution.
 *
 * The five fields between `box` and `nodes` are §9's reach rule
 * re-applied by the renderer: CSS on a light-DOM widget cannot reach
 * marks painted on the view's surface (§5.1, §5.4), so the scene
 * carries the resolved values and the renderer transfers them
 * explicitly.
 */
export interface SceneGroup {
  /** `HdvlElement.uid` — the renderer's diff key. */
  widget: string;
  /** The tag, for debugging only. */
  tag: string;
  /**
   * Marks vs guides. Drives §3.4.1's `empty` rule, and makes it
   * assertable from the scene alone. Containers emit no group of
   * their own; view / plane / scale / fallback emit none at all.
   */
  role: "mark" | "guide";
  /** The widget's own CSS box, in view coordinates. */
  box: Rect;
  opacity: number;
  /** Computed `filter`, minus `url()` forms (§5.4). */
  filter: string;
  visibility: "visible" | "hidden";
  /**
   * From computed `overflow`: anything but `visible` clips the group
   * to `box`. Mark widgets get `overflow: hidden` from the UA sheet,
   * which IS SPEC §6's clip-to-the-plot-area rule (§4.7).
   */
  clip: boolean;
  /**
   * Computed `clip-path`, resolved by the RUNTIME into explicit
   * geometry in view coordinates — not passed through as a CSS
   * string, because a `<g>` has no CSS box for percentages and
   * reference boxes to resolve against. null = `none` (§5.4).
   */
  clipPath: readonly Subpath[] | null;
  nodes: readonly SceneNode[];
}

/** Everything one view paints in one frame. */
export interface Scene {
  /** The view's content box, CSS px. */
  width: number;
  height: number;
  /**
   * DOCUMENT ORDER. This is SPEC §1.1's paint order, across widgets
   * and across overlapping planes alike — array order is paint
   * order, and a renderer owes nothing more.
   */
  groups: readonly SceneGroup[];
}

/**
 * An empty scene at a given surface size — what a view renders
 * before any widget produces a group, which through step 11 is
 * every frame.
 *
 * Exported rather than privately re-declared because three
 * consumers need it (the view, the renderer's own tests and the
 * recording stub's initial state) and none of them may own it.
 *
 * @param w - The view's content-box width, CSS px.
 * @param h - The view's content-box height, CSS px.
 * @returns A scene with no groups.
 */
export function emptyScene(w: number, h: number): Scene {
  return { width: w, height: h, groups: [] };
}
