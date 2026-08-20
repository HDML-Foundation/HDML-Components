/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `hdml-axis` element (RFC 016/001 §2.2).
 *
 * @module hdvl/guide-axis
 */

import { customElement, property } from "lit/decorators.js";
import { HdvlElement } from "./base";
import type { SceneGroup } from "./scene";
import {
  AXIS_ATTRS_LIST,
  HDVL_FAMILIES,
  HDVL_TAG_NAMES,
} from "./vocabulary";

/**
 * One line spanning the whole range of a **positional** channel
 * (V20). Like every guide it binds no columns and takes no
 * `source`: it is a function of the resolved scale, its own box
 * and its computed style.
 *
 * **Registered and inert as of this commit.** Step 09 lands the tag
 * surface once and for all — the tag, the family and the observed
 * attributes — and every body arrives in its own slice. In
 * particular this element declares no `scene()`: `FrameContext` is
 * made of the frame's MEASURE snapshot, so it and `scene()` land
 * together at step 11 (step-plan C6).
 *
 * @tagname hdml-axis
 *
 * @attribute {string} channel - The channel this element addresses
 * (SPEC §3).
 */
@customElement(HDVL_TAG_NAMES.AXIS)
export class HdmlAxisElement extends HdvlElement {
  public readonly tag = HDVL_TAG_NAMES.AXIS;

  public readonly family = HDVL_FAMILIES[HDVL_TAG_NAMES.AXIS];

  /**
   * @internal
   */
  @property({ type: String })
  [AXIS_ATTRS_LIST.CHANNEL]: null | string = null;

  /**
   * @override
   *
   * Contract-complete at `null` (§2.3): "returns null to paint
   * nothing (hidden, errored, or still loading)". **Step 23** puts
   * the range-spanning line here, and replaces this line alone.
   */
  public scene(): SceneGroup | null {
    return null;
  }
}
