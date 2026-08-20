/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `hdml-label` element (RFC 016/001 §2.2).
 *
 * @module hdvl/guide-label
 */

import { customElement, property } from "lit/decorators.js";
import { HdvlElement } from "./base";
import type { SceneGroup } from "./scene";
import {
  HDVL_FAMILIES,
  HDVL_TAG_NAMES,
  LABEL_ATTRS_LIST,
} from "./vocabulary";

/**
 * A formatted text run repeated at scale positions. Its `format`
 * skeleton and a continuous legend's ramp values share **one**
 * implementation (step-plan H6). Binds no columns and takes no
 * `source`.
 *
 * **Registered and inert as of this commit.** Step 09 lands the tag
 * surface once and for all — the tag, the family and the observed
 * attributes — and every body arrives in its own slice. In
 * particular this element declares no `scene()`: `FrameContext` is
 * made of the frame's MEASURE snapshot, so it and `scene()` land
 * together at step 11 (step-plan C6).
 *
 * @tagname hdml-label
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
 *
 * @attribute {string} format - The format skeleton for the text runs
 * (SPEC §4.9).
 */
@customElement(HDVL_TAG_NAMES.LABEL)
export class HdmlLabelElement extends HdvlElement {
  public readonly tag = HDVL_TAG_NAMES.LABEL;

  public readonly family = HDVL_FAMILIES[HDVL_TAG_NAMES.LABEL];

  /**
   * @internal
   */
  @property({ type: String })
  [LABEL_ATTRS_LIST.CHANNEL]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [LABEL_ATTRS_LIST.COUNT]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [LABEL_ATTRS_LIST.STEP]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [LABEL_ATTRS_LIST.VALUES]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [LABEL_ATTRS_LIST.FORMAT]: null | string = null;

  /**
   * @override
   *
   * Contract-complete at `null` (§2.3): "returns null to paint
   * nothing (hidden, errored, or still loading)". **Step 24** puts
   * one text run per domain value here, and replaces this line alone.
   */
  public scene(): SceneGroup | null {
    return null;
  }
}
