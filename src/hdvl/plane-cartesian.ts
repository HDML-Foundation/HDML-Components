/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `hdml-cartesian-plane` element (RFC 016/001 §2.2).
 *
 * @module hdvl/plane-cartesian
 */

import { customElement, property } from "lit/decorators.js";
import { HdvlElement } from "./base";
import type { Point, SceneGroup } from "./scene";
import type { FrameContext } from "./measure";
import type { Channel } from "./resolve";
import type { Projection } from "./mark";
import { createProjection } from "./mark";
import {
  CARTESIAN_PLANE_ATTRS_LIST,
  HDVL_FAMILIES,
  HDVL_TAG_NAMES,
} from "./vocabulary";

/** §2.7's two cartesian channels, in composition order. */
const CHANNELS: readonly [Channel, Channel] = ["x", "y"];

/**
 * A **geometric anchor**: a CSS box with `container-type: size`,
 * plus the projection that gives `x` and `y` their screen meaning.
 * A plane contributes no dimension of its own and emits no scene
 * nodes — the multidimensional space is built by the scale chain
 * inside it (SPEC §3).
 *
 * Its box defaults — `position: absolute; inset: 0` and the
 * `8px 8px 24px 40px` gutter the zero-CSS guide defaults spill
 * into — come from the element sheet, so any author rule beats
 * them.
 *
 * **It supplies the cartesian `Projection`** (H7), through the
 * duck-typed `ProjectionSource` a mark reads. The composition is
 * the identity pair and that is not a placeholder: §4.3 gives a
 * cartesian scale a range taken from its own content box, and
 * §2.7's view coordinates are the space that box was measured in —
 * so an `x` position already *is* a view x. The polar plane's
 * composition is `polarPoint`, and it lands at step 26 without any
 * mark widget changing.
 *
 * @tagname hdml-cartesian-plane
 *
 * @attribute {string} source - The data source for the subtree,
 * nearest-ancestor-wins (SPEC §4.5).
 */
@customElement(HDVL_TAG_NAMES.CARTESIAN_PLANE)
export class HdmlCartesianPlaneElement extends HdvlElement {
  public readonly tag = HDVL_TAG_NAMES.CARTESIAN_PLANE;

  public readonly family =
    HDVL_FAMILIES[HDVL_TAG_NAMES.CARTESIAN_PLANE];

  /**
   * @internal
   */
  @property({ type: String })
  [CARTESIAN_PLANE_ATTRS_LIST.SOURCE]: null | string = null;

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
   * The `x`/`y` projection, for one widget in this plane (H7).
   *
   * @param ctx - The frame's snapshot.
   * @param el - The widget whose scale chain is read.
   * @returns Its projection.
   */
  public projection(
    ctx: FrameContext,
    el: HdvlElement,
  ): Projection | null {
    return createProjection(
      ctx,
      el,
      CHANNELS,
      (x: number, y: number): Point => ({ x, y }),
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
