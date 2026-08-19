/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `hdml-line` element (RFC 016/001 §2.2).
 *
 * @module hdvl/mark-line
 */

import { customElement, property } from "lit/decorators.js";
import { HdvlElement } from "./base";
import {
  HDVL_FAMILIES,
  HDVL_TAG_NAMES,
  LINE_ATTRS_LIST,
} from "./vocabulary";

/**
 * A stroked path through one vertex per row, curved by
 * `--hdml-curve-type`. Row-wise: vertex *i* = f(row *i*).
 *
 * **Registered and inert as of this commit.** Step 09 lands the tag
 * surface once and for all — the tag, the family and the observed
 * attributes — and every body arrives in its own slice. In
 * particular this element declares no `scene()`: `FrameContext` is
 * made of the frame's MEASURE snapshot, so it and `scene()` land
 * together at step 11 (step-plan C6).
 *
 * @tagname hdml-line
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
 * @attribute {string} closed - Whether the path closes back on its
 * first vertex.
 *
 * @attribute {string} source - The data source for this subtree,
 * nearest-ancestor-wins (SPEC §4.5).
 */
@customElement(HDVL_TAG_NAMES.LINE)
export class HdmlLineElement extends HdvlElement {
  public readonly tag = HDVL_TAG_NAMES.LINE;

  public readonly family = HDVL_FAMILIES[HDVL_TAG_NAMES.LINE];

  /**
   * @internal
   */
  @property({ type: String })
  [LINE_ATTRS_LIST.X]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [LINE_ATTRS_LIST.Y]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [LINE_ATTRS_LIST.ANGLE]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [LINE_ATTRS_LIST.RADIUS]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [LINE_ATTRS_LIST.COLOR]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [LINE_ATTRS_LIST.CLOSED]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [LINE_ATTRS_LIST.SOURCE]: null | string = null;
}
