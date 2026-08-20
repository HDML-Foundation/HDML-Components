/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `hdml-point` element (RFC 016/001 §2.2).
 *
 * @module hdvl/mark-point
 */

import { customElement, property } from "lit/decorators.js";
import { HdvlElement } from "./base";
import type { SceneGroup } from "./scene";
import {
  HDVL_FAMILIES,
  HDVL_TAG_NAMES,
  POINT_ATTRS_LIST,
} from "./vocabulary";

/**
 * One glyph per row, shaped by `--hdml-tick-style` and sized by
 * the `size` channel between `--hdml-size-min` and
 * `--hdml-size-max`.
 *
 * **Registered and inert as of this commit.** Step 09 lands the tag
 * surface once and for all — the tag, the family and the observed
 * attributes — and every body arrives in its own slice. In
 * particular this element declares no `scene()`: `FrameContext` is
 * made of the frame's MEASURE snapshot, so it and `scene()` land
 * together at step 11 (step-plan C6).
 *
 * @tagname hdml-point
 *
 * @attribute {string} x - The column bound to the `x` channel (SPEC
 * §5).
 *
 * @attribute {string} y - The column bound to the `y` channel (SPEC
 * §5).
 *
 * @attribute {string} angle - The column bound to the `angle` channel
 * (SPEC §3).
 *
 * @attribute {string} radius - The column bound to the `radius`
 * channel (SPEC §3).
 *
 * @attribute {string} color - The column bound to the `color` channel
 * (SPEC §3).
 *
 * @attribute {string} size - The column bound to the `size` channel
 * (SPEC §3).
 *
 * @attribute {string} source - The data source for this subtree,
 * nearest-ancestor-wins (SPEC §4.5).
 */
@customElement(HDVL_TAG_NAMES.POINT)
export class HdmlPointElement extends HdvlElement {
  public readonly tag = HDVL_TAG_NAMES.POINT;

  public readonly family = HDVL_FAMILIES[HDVL_TAG_NAMES.POINT];

  /**
   * @internal
   */
  @property({ type: String })
  [POINT_ATTRS_LIST.X]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [POINT_ATTRS_LIST.Y]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [POINT_ATTRS_LIST.ANGLE]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [POINT_ATTRS_LIST.RADIUS]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [POINT_ATTRS_LIST.COLOR]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [POINT_ATTRS_LIST.SIZE]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [POINT_ATTRS_LIST.SOURCE]: null | string = null;

  /**
   * @override
   *
   * Contract-complete at `null` (§2.3): "returns null to paint
   * nothing (hidden, errored, or still loading)". **Step 22** puts
   * one glyph per row here, and replaces this line alone.
   */
  public scene(): SceneGroup | null {
    return null;
  }
}
