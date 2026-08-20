/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `hdml-arc` element (RFC 016/001 §2.2).
 *
 * @module hdvl/mark-arc
 */

import { customElement, property } from "lit/decorators.js";
import { HdvlElement } from "./base";
import type { SceneGroup } from "./scene";
import {
  ARC_ATTRS_LIST,
  HDVL_FAMILIES,
  HDVL_TAG_NAMES,
} from "./vocabulary";

/**
 * One annular sector per row, in a polar plane. It consumes the
 * plane's `Projection` like every other mark and carries no polar
 * branch of its own (step-plan H7).
 *
 * **Registered and inert as of this commit.** Step 09 lands the tag
 * surface once and for all — the tag, the family and the observed
 * attributes — and every body arrives in its own slice. In
 * particular this element declares no `scene()`: `FrameContext` is
 * made of the frame's MEASURE snapshot, so it and `scene()` land
 * together at step 11 (step-plan C6).
 *
 * @tagname hdml-arc
 *
 * @attribute {string} a0 - The column bound to the ranged `a0`
 * endpoint (SPEC §6.4).
 *
 * @attribute {string} a1 - The column bound to the ranged `a1`
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
 * @attribute {string} source - The data source for this subtree,
 * nearest-ancestor-wins (SPEC §4.5).
 */
@customElement(HDVL_TAG_NAMES.ARC)
export class HdmlArcElement extends HdvlElement {
  public readonly tag = HDVL_TAG_NAMES.ARC;

  public readonly family = HDVL_FAMILIES[HDVL_TAG_NAMES.ARC];

  /**
   * @internal
   */
  @property({ type: String })
  [ARC_ATTRS_LIST.A0]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [ARC_ATTRS_LIST.A1]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [ARC_ATTRS_LIST.ANGLE]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [ARC_ATTRS_LIST.RADIUS]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [ARC_ATTRS_LIST.R0]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [ARC_ATTRS_LIST.R1]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [ARC_ATTRS_LIST.COLOR]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [ARC_ATTRS_LIST.SOURCE]: null | string = null;

  /**
   * @override
   *
   * Contract-complete at `null` (§2.3): "returns null to paint
   * nothing (hidden, errored, or still loading)". **Step 22** puts
   * an annulus sector here, and replaces this line alone.
   */
  public scene(): SceneGroup | null {
    return null;
  }
}
