/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `hdml-polar-plane` element (RFC 016/001 §2.2).
 *
 * @module hdvl/plane-polar
 */

import { customElement, property } from "lit/decorators.js";
import { HdvlElement } from "./base";
import type { Point, Rect, SceneGroup } from "./scene";
import type { FrameContext } from "./measure";
import type { Channel } from "./resolve";
import type { Projection } from "./mark";
import { createProjection } from "./mark";
import { polarPoint, radialCeiling } from "./kernel/project-polar";
import {
  HDVL_FAMILIES,
  HDVL_TAG_NAMES,
  POLAR_PLANE_ATTRS_LIST,
} from "./vocabulary";

/** §4.6's two polar channels, in composition order. */
const CHANNELS: readonly [Channel, Channel] = ["angle", "radius"];

/**
 * A signed zero is neither `Object.is`- nor `deepEqual`-equal to
 * zero (plan rule 9). A pole coordinate is a sum of a box origin and
 * half an extent, and both can be zero.
 */
function num(v: number): number {
  return v === 0 ? 0 : v;
}

/**
 * ★ **The box the radial geometry is measured in** — §4.6 and §3's
 * one sentence, resolved once.
 *
 * *"The pole is the box's center and the range is `[0, min(content-
 * width, content-height) / 2]`; when no radius scale exists (a pure
 * pie chain), the plane's content box serves."* The pole and the
 * ceiling are **two readings of the same box**, which is why this
 * returns the box rather than either of them: resolving the
 * fallback twice is how step 22 came to implement it for the pole
 * and not for the range (step 28's finding).
 *
 * It is read off the MEASURE snapshot's **content** box, never from
 * a `getBoundingClientRect()` in COMPUTE (R5), and it is resolved
 * per widget rather than per plane because the widget's own chain is
 * what says which radius scale serves it (R35).
 *
 * @param ctx - The frame's snapshot.
 * @param plane - This plane.
 * @param el - The widget asking.
 * @returns The content box, in view coordinates.
 */
function radialBoxOf(
  ctx: FrameContext,
  plane: HdvlElement,
  el: HdvlElement,
): Rect {
  const scale = ctx.resolution(el)?.chain.radius ?? null;
  return ctx.measured(scale ?? plane).content;
}

/**
 * The polar geometric anchor: the same box role as the cartesian
 * plane with an `8px` gutter, anchoring `angle` and `radius`
 * instead of `x` and `y`.
 *
 * **It supplies the polar `Projection`** (H7), through the same
 * duck-typed `ProjectionSource` the cartesian plane implements — so
 * the whole of the plane-kind difference is the `compose` argument,
 * and **no mark widget carries a polar branch**. `createProjection`
 * owns the chain lookup, §4.7's drop rule and the ordinal test for
 * both planes alike, which is why the two cannot disagree about when
 * a row drops.
 *
 * *Landed at step 22 rather than 26, with the user*: `hdml-arc`'s
 * `arc` node needs a pole, and every honest source of one is polar.
 * The alternative was an arc whose only fixtures were cartesian
 * pages carrying `a0`/`a1` — pages **V9** calls invalid. Step 26
 * then added the arc's **ordinal-angle** equal-slices form and
 * `hdml-line`'s `closed`, and step 27 added `hdml-pie`, the four
 * polar **guides** and `--hdml-grid-shape` — and **this file did
 * not change for any of it**. That is what H7 predicted, measured
 * three times: the guide half reached this plane by deleting the
 * channel pair it used to name, not by teaching this one anything.
 *
 * **Step 28 did change it, and H7 still holds.** The corpus gate
 * found that SPEC §3's *"when no radius scale exists (a pure pie
 * chain), the plane's content box serves"* had been implemented for
 * the pole and not for the range, so `08` and `12-B` painted
 * nothing. The fix is a second thing **this plane** supplies —
 * §3's radial default — through the same
 * duck-typed argument `compose` goes through, and **no widget
 * gained a branch**: the four readers of *"the other channel's
 * range"* ask `Projection.span`, which is keyed by channel like
 * every other member. H7 forbids a widget branching on plane kind;
 * it does not forbid a plane knowing its own geometry, which is the
 * whole reason it is the thing being asked.
 *

 * @tagname hdml-polar-plane
 *
 * @attribute {string} source - The data source for the subtree,
 * nearest-ancestor-wins (SPEC §4.5).
 */
@customElement(HDVL_TAG_NAMES.POLAR_PLANE)
export class HdmlPolarPlaneElement extends HdvlElement {
  public readonly tag = HDVL_TAG_NAMES.POLAR_PLANE;

  public readonly family = HDVL_FAMILIES[HDVL_TAG_NAMES.POLAR_PLANE];

  /**
   * @internal
   */
  @property({ type: String })
  [POLAR_PLANE_ATTRS_LIST.SOURCE]: null | string = null;

  /**
   * @override
   *
   * §3.4's table gives `loading` to the view **and** its planes.
   */
  public connectedCallback(): void {
    super.connectedCallback();
    this.setState("loading", true);
  }

  /**
   * The `angle`/`radius` projection, for one widget in this plane
   * (H7, §4.6).
   *
   * The composition is `polarPoint` about {@link poleOf}'s pole, and
   * that is the **only** thing this differs from the cartesian
   * plane's identity pair by. A projected `angle` is in **degrees**
   * — `0` at 12 o'clock, increasing clockwise — and a projected
   * `radius` is CSS px, exactly as §4.3's range table says.
   *
   * @param ctx - The frame's snapshot.
   * @param el - The widget whose scale chain is read.
   * @returns Its projection.
   */
  public projection(
    ctx: FrameContext,
    el: HdvlElement,
  ): Projection | null {
    const box = radialBoxOf(ctx, this, el);
    const pole = {
      x: num(box.x + box.w / 2),
      y: num(box.y + box.h / 2),
    };
    return createProjection(
      ctx,
      el,
      CHANNELS,
      (angle: number, radius: number): Point =>
        polarPoint(pole, angle, radius),
      // §3's radial default, for the chain that has no radius scale
      // at all. The angle channel gets none: its range is
      // `--hdml-angle-start`/`-end` on the angle scale, so with no
      // scale there is nothing to read (step 28).
      (channel: Channel): readonly [number, number] | null =>
        channel === CHANNELS[1]
          ? [0, radialCeiling(box.w, box.h)]
          : null,
    );
  }

  /**
   * @override
   *
   * §5.1: a plane emits **no group at all** — it is a geometric
   * anchor, not a painter (§2.2). Permanent; no later slice fills
   * this in.
   */
  public scene(): SceneGroup | null {
    return null;
  }
}
