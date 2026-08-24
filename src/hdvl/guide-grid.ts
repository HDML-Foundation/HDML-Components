/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `hdml-grid` element (RFC 016/001 §2.2).
 *
 * @module hdvl/guide-grid
 */

import { customElement, property } from "lit/decorators.js";
import { HdvlElement } from "./base";
import type { FrameContext } from "./measure";
import type { Paint, SceneGroup, SceneNode } from "./scene";
import type { ResolvedGuide } from "./guide-spec";
import { paintSuppressed } from "./subscribe";
import { strokePaint } from "./mark";
import {
  guideGroup,
  guideLine,
  guidePoint,
  guideRing,
  resolveGuide,
  tickSpecOf,
} from "./guide-spec";
import {
  GRID_ATTRS_LIST,
  HDVL_FAMILIES,
  HDVL_TAG_NAMES,
} from "./vocabulary";

/** SPEC §9's `circle | polygon`; its initial is `circle`. */
const P_SHAPE = "--hdml-grid-shape";
const POLYGON = "polygon";

/**
 * ★ One radial grid line, in whichever of §6.5's two shapes
 * `--hdml-grid-shape` asks for.
 *
 * **`circle` is a full arc** — {@link guideRing}, the same node
 * `hdml-axis` draws an angular range with, so a ring has one
 * implementation and not two (R12).
 *
 * **`polygon` is a closed path through the ANGLE SCALE's
 * positions**, and *through the scale's* is the load-bearing half.
 * The vertices are `scale.ticks({})` on the other channel — the
 * whole ordinal domain, since §4.8's thinning returns it for an
 * empty spec — so a radar's rings meet its spokes because both come
 * out of one generator (R12/R18), not because two agreed. It is
 * emphatically **not** this element's own `count`: `10-radar`
 * writes `count="5"` for five rings over six spokes, and reading
 * that spec for the vertices would draw five-sided rings.
 *
 * A polygon of fewer than two vertices is no line at all and is
 * dropped rather than emitted as a degenerate path.
 *
 * @param guide - The resolved radial guide.
 * @param at - This tick's radius, in CSS px.
 * @param shape - The computed `--hdml-grid-shape`.
 * @param span - The angular range, in degrees.
 * @param paint - The resolved stroke.
 * @returns The node, or `null`.
 */
function ringOf(
  guide: ResolvedGuide,
  at: number,
  shape: string,
  span: readonly [number, number],
  paint: Paint,
): SceneNode | null {
  if (shape !== POLYGON) {
    // `pole` is non-null: `radial` is what selected this branch.
    const pole = guide.pole ?? { x: 0, y: 0 };
    return guideRing(pole, at, span[0], span[1], paint);
  }
  const angles = guide.projection.scale(guide.other);
  const ticks = angles === null ? [] : angles.ticks({});
  if (ticks.length < 2) {
    return null;
  }
  const points = ticks.map((t) => guidePoint(guide, at, t.at));
  return {
    k: "path",
    // §2.5, exactly as `guideLine`: a guide has no source row and
    // no data vertex.
    i: -1,
    subpaths: [
      {
        start: points[0],
        segments: points.slice(1).map((to) => ({
          k: "line" as const,
          to,
        })),
      },
    ],
    closed: true,
    vertices: [],
    ...paint,
  };
}

/**
 * A line across the plane repeated at scale positions — never a
 * gutter dweller, which is why its UA placement is `inset: 0`.
 * Binds no columns and takes no `source`.
 *
 * **One `path` per tick** (§6.5), each spanning the **other**
 * channel's `range()` at its own tick's position — §4.3's range,
 * not the grid's own box, which is the same reading `hdml-rule`
 * takes of the same sentence. The positions come from
 * `scale.ticks(spec)` and are never re-derived here: §4.8's ladders
 * have one implementation and `kernel/` owns it (R12), so a grid
 * whose `step="0.05"` lands exactly where its `hdml-label`'s does
 * is a consequence of there being one generator, not of two
 * agreeing.
 *
 * **★ It is `--hdml-grid-shape`'s one home** (SPEC §9, landed at
 * step 27). §6.5's row continues *"on a radius channel
 * `--hdml-grid-shape: circle` emits a full arc and `polygon` a
 * closed path through the angle-scale positions"* — 10's radar
 * rings. It reads that condition off the resolved guide and never
 * off a channel: the property is consulted when this guide is on
 * the plane's **second** channel and the plane has a **pole**, and
 * a plane composing in view space never reaches it, which is why a
 * cartesian `hdml-grid` cannot be talked into a circle.
 *
 * On the plane's **first** channel under the same pole the line
 * across the other channel's range is already right — that is a
 * **spoke**, `10-radar`'s `hdml-grid channel="angle"` with no spec
 * at all — and it comes out of the unchanged straight branch,
 * because `guidePoint` composes through the plane.
 *
 * @tagname hdml-grid
 *
 * @attribute {string} channel - The channel this element addresses
 * (SPEC §3).
 *
 * @attribute {string} count - How many positions to repeat at (SPEC
 * §7).
 *
 * @attribute {string} step - The interval between repeated positions
 * (SPEC §7).
 *
 * @attribute {string} values - An explicit list — the domain on a
 * scale, the positions to repeat at on a guide.
 */
@customElement(HDVL_TAG_NAMES.GRID)
export class HdmlGridElement extends HdvlElement {
  public readonly tag = HDVL_TAG_NAMES.GRID;

  public readonly family = HDVL_FAMILIES[HDVL_TAG_NAMES.GRID];

  /**
   * @internal
   */
  @property({ type: String })
  [GRID_ATTRS_LIST.CHANNEL]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [GRID_ATTRS_LIST.COUNT]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [GRID_ATTRS_LIST.STEP]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [GRID_ATTRS_LIST.VALUES]: null | string = null;

  /**
   * @override
   *
   * One `path` per tick, across the other channel's range.
   *
   * @param ctx - The frame's snapshot.
   * @returns Its group, or `null`.
   */
  public scene(ctx: FrameContext): SceneGroup | null {
    if (paintSuppressed(this)) {
      return null;
    }
    const guide = resolveGuide(ctx, this);
    if (guide === null) {
      return null;
    }
    // The channel it does NOT repeat along must resolve a scale, or
    // there is no extent to cross the plane with. Unlike a rule's,
    // this is not V1's error: a grid binds one channel and V1 asks
    // only for that one.
    const span = guide.projection.scale(guide.other)?.range() ?? null;
    if (span === null) {
      return null;
    }
    const paint = strokePaint(guide.measured, null);
    // The property registers as `circle | polygon`, so the UA has
    // already rejected anything else — this narrows a string, it
    // does not validate one.
    const radial = guide.pole !== null && !guide.first;
    const shape = (guide.measured.props.get(P_SHAPE) ?? "").trim();
    const nodes: SceneNode[] = [];
    // A tick whose value does not project is dropped by `ticksFor`
    // before it is seen here, so §4.7 needs no restatement.
    for (const tick of guide.scale.ticks(tickSpecOf(this))) {
      const node = radial
        ? ringOf(guide, tick.at, shape, span, paint)
        : guideLine(
            guidePoint(guide, tick.at, span[0]),
            guidePoint(guide, tick.at, span[1]),
            paint,
          );
      if (node !== null) {
        nodes.push(node);
      }
    }
    return guideGroup(this, guide.measured, nodes);
  }
}
