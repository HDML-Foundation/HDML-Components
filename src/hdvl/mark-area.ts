/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `hdml-area` element (RFC 016/001 §2.2, §4.7, §6.1, §6.2, H8).
 *
 * @module hdvl/mark-area
 */

import { customElement, property } from "lit/decorators.js";
import { HdvlElement } from "./base";
import type { FrameContext } from "./measure";
import type { Point, SceneGroup, SceneNode, Subpath } from "./scene";
import type { Binding, Slot } from "./subscribe";
import { paintSuppressed } from "./subscribe";
import {
  channelColor,
  curveOptionsOf,
  curveTypeOf,
  datumOf,
  fillPaint,
  markBindings,
  markGroup,
  newTally,
  projectionOf,
  rangedValuesOf,
  reportDrops,
  rowCountOf,
  tallyDrop,
} from "./mark";
import { closedOf } from "./mark-line";
import { curve } from "./kernel/curves";
import {
  AREA_ATTRS_LIST,
  HDVL_FAMILIES,
  HDVL_TAG_NAMES,
} from "./vocabulary";

/**
 * Every slot this element can bind, for §7.2's request path.
 *
 * Both plane forms are declared, not just the pair its plane will
 * use: `bindings()` is called inside `reindex()`, outside any frame,
 * where no plane is available. An unauthored attribute contributes
 * no binding anyway.
 */
const SLOTS: readonly Slot[] = [
  AREA_ATTRS_LIST.X,
  AREA_ATTRS_LIST.X0,
  AREA_ATTRS_LIST.X1,
  AREA_ATTRS_LIST.Y,
  AREA_ATTRS_LIST.Y0,
  AREA_ATTRS_LIST.Y1,
  AREA_ATTRS_LIST.ANGLE,
  AREA_ATTRS_LIST.RADIUS,
  AREA_ATTRS_LIST.R0,
  AREA_ATTRS_LIST.R1,
  AREA_ATTRS_LIST.COLOR,
];

/** One contiguous stretch of rows, as its two edges (§6.1). */
interface Region {
  /** The `y1` edge, in row order. */
  upper: Point[];
  /** The `y0` edge, in row order. */
  lower: Point[];
  /** Each pair's source row index. */
  at: number[];
}

/**
 * A filled band between two edges per row (§6.1).
 *
 * **★ The RANGED form is the primitive** (step-plan H8, RFC §6.4).
 * Every channel is resolved through
 * {@link import("./mark").rangedValuesOf} into a `(low, high)` pair
 * before any geometry exists, and the simple form is sugar: `y` ≡
 * `y0="0"`, polar `radius` ≡ `r0="0"`. So `y="v"` and
 * `y0="0" y1="v"` produce byte-identical scenes, no branch below
 * the resolver can tell which the author wrote, and step 29's
 * `hdml-stack` supplies a per-row `y0ₖ` through the same seam
 * without changing a line in here.
 *
 * **★ It names no channel** (H7). The independent channel is
 * {@link import("./mark").Projection.channels}`[0]` and the ranged
 * dependent one is `[1]` — `x`/`y` under a cartesian plane and
 * `angle`/`radius` under a polar one — so the polar plane reached
 * this element with **no diff at all** (confirmed at step 26).
 *
 * **One `path` node for the whole series**, filled, with `i: -1`
 * per §2.5 and row identity in its per-vertex `i`, exactly as
 * `hdml-line`. Each contiguous stretch of rows is one **closed**
 * subpath: *the upper edge forward then the lower edge reversed*,
 * joined by a line and closed back to the first vertex.
 *
 * **The lower edge is reversed BEFORE it is curved.** A curve fitted
 * to a reversed point list is not the reverse of the curve fitted to
 * the forward one — `natural`'s tridiagonal solve is global over its
 * run, and `bezier`'s tangents are chosen per segment — so curving
 * forward and reversing the result would give a lower edge that does
 * not lie on the data.
 *
 * **A gap splits BOTH edges at the same row** (§4.7). A row drops if
 * *either* of its ranged values drops, so the two edges always break
 * together and each stretch becomes one closed region; a stretch of
 * fewer than two rows has no region at all, because `curve()` drops
 * a one-point run.
 *
 * A *varying* `color` is an error here — see `validate.ts`'s
 * `varying-path-color`: one `path` node carries one `Paint`.
 *
 * **★ `closed` splits the region into two counter-wound rings**
 * (step 27, decided with the user; raised at step 26 and deferred
 * to here). Every region above is *already* a closed outline, so on
 * a plane composing in view space the attribute has nothing left to
 * say and stays **inert** — a cartesian area written with `closed`
 * emits a byte-identical node. On a plane composing **about a pole**
 * it says the one thing the joined outline gets wrong: that band
 * closes *through the pole*, running the upper edge from the first
 * category to the last, then in to the lower edge and back, which
 * leaves a wedge-shaped notch between the last category and the
 * first — `10-radar`'s figure, visibly.
 *
 * Closing it is an **outer ring and an inner ring**, and the
 * counter-winding the cap-joined form already has is what makes it
 * free: the upper edge runs first → last and the lower edge is
 * *already reversed*, last → first, so emitting them as two
 * subpaths rather than one gives them opposite winding. Under
 * SVG's default `nonzero` rule the annulus fills and the hole stays
 * empty. **No fill rule is added to §2.5, and the renderer is not
 * touched** — the node's `closed` flag was already a `Z` **per
 * subpath** since step 10, so each ring closes on itself.
 *
 * A radar band whose lower edge is `r0="0"` degenerates to a ring
 * of coincident poles, which encloses nothing and fills to the
 * centre — the right answer, arrived at by the same arithmetic
 * rather than by a case.
 *
 * @tagname hdml-area
 *
 * @attribute {string} x - The column bound to the `x` channel (SPEC
 * §5).
 *
 * @attribute {string} x0 - The column bound to the ranged `x0`
 * endpoint (SPEC §6.4).
 *
 * @attribute {string} x1 - The column bound to the ranged `x1`
 * endpoint (SPEC §6.4).
 *
 * @attribute {string} y - The column bound to the `y` channel (SPEC
 * §5).
 *
 * @attribute {string} y0 - The column bound to the ranged `y0`
 * endpoint (SPEC §6.4).
 *
 * @attribute {string} y1 - The column bound to the ranged `y1`
 * endpoint (SPEC §6.4).
 *
 * @attribute {string} angle - The column bound to the `angle` channel
 * (SPEC §3).
 *
 * @attribute {string} radius - The column bound to the `radius`
 * channel (SPEC §3).
 *
 * @attribute {string} r0 - The column bound to the ranged `r0`
 * endpoint (SPEC §6.4).
 *
 * @attribute {string} r1 - The column bound to the ranged `r1`
 * endpoint (SPEC §6.4).
 *
 * @attribute {string} color - The column bound to the `color` channel
 * (SPEC §3).
 *
 * @attribute {string} closed - Whether the path closes back on its
 * first vertex.
 *
 * @attribute {string} hidden - Whether this element is withheld from
 * painting; its container re-derives without it (SPEC §7).
 *
 * @attribute {string} source - The data source for this subtree,
 * nearest-ancestor-wins (SPEC §4.5).
 */
@customElement(HDVL_TAG_NAMES.AREA)
export class HdmlAreaElement extends HdvlElement {
  public readonly tag = HDVL_TAG_NAMES.AREA;

  public readonly family = HDVL_FAMILIES[HDVL_TAG_NAMES.AREA];

  /**
   * @internal
   */
  @property({ type: String })
  [AREA_ATTRS_LIST.X]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [AREA_ATTRS_LIST.X0]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [AREA_ATTRS_LIST.X1]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [AREA_ATTRS_LIST.Y]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [AREA_ATTRS_LIST.Y0]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [AREA_ATTRS_LIST.Y1]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [AREA_ATTRS_LIST.ANGLE]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [AREA_ATTRS_LIST.RADIUS]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [AREA_ATTRS_LIST.R0]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [AREA_ATTRS_LIST.R1]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [AREA_ATTRS_LIST.COLOR]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [AREA_ATTRS_LIST.CLOSED]: null | string = null;

  /**
   * SPEC's `hidden` collides with `HTMLElement.hidden`, which is a
   * platform **boolean** IDL attribute. Declaring a `null | string`
   * field of that name would shadow it and does not type-check.
   * The observed attribute is still `hidden` — named through the
   * `attribute` option — so `observedAttributes` and the
   * invalidation funnel are exactly as SPEC §7 specifies, and the
   * platform's own property is left alone rather than overwritten.
   * Whether HDVL's `hidden` *is* the platform's is a semantic
   * question the slice that implements it decides.
   *
   * @internal
   */
  @property({
    type: String,
    attribute: AREA_ATTRS_LIST.HIDDEN,
  })
  public hiddenAttr: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [AREA_ATTRS_LIST.SOURCE]: null | string = null;

  /**
   * §7.2's request path — one subscription per column-bound slot,
   * the ranged pairs included.
   *
   * @returns The bindings this element currently wants.
   */
  public bindings(): readonly Binding[] {
    return markBindings(this, SLOTS);
  }

  /**
   * §5.7's `DatumSource` — the row a hit resolved.
   *
   * @param index - The row index a hit named.
   * @returns The row, or `null`.
   */
  public datumAt(
    index: number,
  ): Readonly<Record<string, unknown>> | null {
    return datumOf(this, SLOTS, index);
  }

  /**
   * @override
   *
   * One filled `path`: per contiguous stretch of rows, the upper
   * edge forward then the lower edge reversed, both curved.
   *
   * @param ctx - The frame's snapshot.
   * @returns Its group, or `null`.
   */
  public scene(ctx: FrameContext): SceneGroup | null {
    if (paintSuppressed(this)) {
      return null;
    }
    const projection = projectionOf(ctx, this);
    if (projection === null) {
      return null;
    }
    const [first, second] = projection.channels;
    // ★ H8 — both channels come back as (low, high) pairs. The
    // independent channel's value is its pair's HIGH end, which for
    // the sugar the author actually writes (`x="month"`) is exactly
    // that attribute; no simple slot is named in this file.
    const ind = rangedValuesOf(this, first);
    const dep = rangedValuesOf(this, second);
    if (ind === null || dep === null) {
      // §6.1 makes both required; V19 reports the omission at step
      // 22. Painting half a band meanwhile would be the silent
      // wrong chart §1.5 forbids.
      return null;
    }
    const rows = rowCountOf([ind.high, dep.low, dep.high]);
    const tally = newTally();
    const regions: Region[] = [];
    let open: Region = { upper: [], lower: [], at: [] };
    let kept = 0;
    const close = (): void => {
      if (open.at.length > 0) {
        regions.push(open);
        open = { upper: [], lower: [], at: [] };
      }
    };
    for (let i = 0; i < rows; i++) {
      const iv = ind.high.at(i);
      const lv = dep.low.at(i);
      const hv = dep.high.at(i);
      const base = projection.at(first, iv);
      const top = projection.point(base, projection.at(second, hv));
      const bottom = projection.point(
        base,
        projection.at(second, lv),
      );
      if (top === null || bottom === null) {
        tally.dropped++;
        tallyDrop(tally, this, projection, first, iv);
        tallyDrop(tally, this, projection, second, lv);
        tallyDrop(tally, this, projection, second, hv);
        // THE GAP. Both edges end here and the next row starts a
        // new region; nothing joins them, at any later stage.
        close();
        continue;
      }
      open.upper.push(top);
      open.lower.push(bottom);
      open.at.push(i);
      kept++;
    }
    close();
    reportDrops(this, projection, tally, rows, kept);
    const measured = ctx.measured(this);
    // SPEC §7's radar loop, shared with `hdml-line` — presence, on
    // a plane composing angularly, and inert everywhere else.
    const loop = closedOf(this, first, AREA_ATTRS_LIST.CLOSED);
    const type = curveTypeOf(measured);
    const options = curveOptionsOf(measured);
    const subpaths: Subpath[] = [];
    const vertices: (Point & { i: number })[] = [];
    for (const region of regions) {
      const upper = curve([region.upper], type, options);
      // REVERSED, THEN CURVED — see the class comment. `slice()`
      // because `reverse()` is in place and `region.upper` and
      // `region.lower` are read again below.
      const lower = curve(
        [region.lower.slice().reverse()],
        type,
        options,
      );
      if (upper.length === 0 || lower.length === 0) {
        // A stretch of one row: `curve()` drops a one-point run,
        // and a region with one vertex per edge has no area.
        continue;
      }
      if (loop) {
        // Two rings, counter-wound: the upper edge runs first →
        // last and the lower is already reversed, so the node's
        // `closed` flag closes each on itself and `nonzero` punches
        // the hole. No cap, because there are no ends to cap.
        subpaths.push(
          { start: upper[0].start, segments: upper[0].segments },
          { start: lower[0].start, segments: lower[0].segments },
        );
      } else {
        subpaths.push({
          start: upper[0].start,
          segments: [
            ...upper[0].segments,
            // The right-hand cap. The left-hand one is `closed`.
            { k: "line", to: lower[0].start },
            ...lower[0].segments,
          ],
        });
      }
      // The outline's own order, so a hit anywhere on it names the
      // row that vertex came from — the two edges of one row carry
      // the same `i`, exactly as `hdml-rule`'s two endpoints do.
      for (let j = 0; j < region.at.length; j++) {
        vertices.push({ ...region.upper[j], i: region.at[j] });
      }
      for (let j = region.at.length - 1; j >= 0; j--) {
        vertices.push({ ...region.lower[j], i: region.at[j] });
      }
    }
    if (subpaths.length === 0) {
      // Nothing to fill. An empty `path` would make §3.4.1's
      // `empty` read "not empty" for a chart that shows nothing.
      return markGroup(this, measured, []);
    }
    const node: SceneNode = {
      k: "path",
      // §2.5: a node built from every row has no single source row.
      i: -1,
      subpaths,
      // ALWAYS true, and it is the same word in both readings:
      // "this subpath closes". Without `closed` there is one
      // subpath per region and it closes over the left-hand cap;
      // with it there are two and each closes on itself. What the
      // attribute changes is how many subpaths there are, never
      // this flag.
      closed: true,
      vertices,
      // §6.1's paint resolution. A filled mark, so the fallback is
      // `--hdml-fill-color`. The row is the first SURVIVING one and
      // a varying `color` is a V3 error, so every row would answer
      // the same anyway.
      ...fillPaint(measured, channelColor(ctx, this, vertices[0].i)),
    };
    return markGroup(this, measured, [node]);
  }
}
