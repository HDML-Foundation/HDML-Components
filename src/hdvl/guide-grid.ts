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
import type { SceneGroup, SceneNode } from "./scene";
import { paintSuppressed } from "./subscribe";
import { strokePaint } from "./mark";
import {
  guideGroup,
  guideLine,
  guidePoint,
  resolveGuide,
  tickSpecOf,
} from "./guide-spec";
import {
  GRID_ATTRS_LIST,
  HDVL_FAMILIES,
  HDVL_TAG_NAMES,
} from "./vocabulary";

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
 * **Cartesian only in this slice.** §6.5's row continues into
 * `--hdml-grid-shape`'s `circle` and `polygon` forms on a radius
 * channel, and those land at step 27 with `hdml-pie` and the polar
 * guides; until then `guide-spec.ts` refuses a polar plane and this
 * element paints nothing there, rather than a straight segment
 * through polar space.
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
    const nodes: SceneNode[] = [];
    // A tick whose value does not project is dropped by `ticksFor`
    // before it is seen here, so §4.7 needs no restatement.
    for (const tick of guide.scale.ticks(tickSpecOf(this))) {
      nodes.push(
        guideLine(
          guidePoint(guide, tick.at, span[0]),
          guidePoint(guide, tick.at, span[1]),
          paint,
        ),
      );
    }
    return guideGroup(this, guide.measured, nodes);
  }
}
