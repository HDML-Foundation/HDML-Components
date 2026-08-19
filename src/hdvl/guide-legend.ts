/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `hdml-legend` element (RFC 016/001 §2.2).
 *
 * @module hdvl/guide-legend
 */

import { customElement, property } from "lit/decorators.js";
import { HdvlElement } from "./base";
import {
  HDVL_FAMILIES,
  HDVL_TAG_NAMES,
  LEGEND_ATTRS_LIST,
} from "./vocabulary";

/**
 * The **visual-channel** guide: the color scale's key, as a
 * swatch-and-name entry per ordinal domain value or a labeled ramp
 * on a continuous one. It fuses glyph and text because a key entry
 * is one datum of a mapping — a swatch without its name is not a
 * key. Binds no columns and takes no `source`.
 *
 * **Registered and inert as of this commit.** Step 09 lands the tag
 * surface once and for all — the tag, the family and the observed
 * attributes — and every body arrives in its own slice. In
 * particular this element declares no `scene()`: `FrameContext` is
 * made of the frame's MEASURE snapshot, so it and `scene()` land
 * together at step 11 (step-plan C6).
 *
 * @tagname hdml-legend
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
@customElement(HDVL_TAG_NAMES.LEGEND)
export class HdmlLegendElement extends HdvlElement {
  public readonly tag = HDVL_TAG_NAMES.LEGEND;

  public readonly family = HDVL_FAMILIES[HDVL_TAG_NAMES.LEGEND];

  /**
   * @internal
   */
  @property({ type: String })
  [LEGEND_ATTRS_LIST.CHANNEL]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [LEGEND_ATTRS_LIST.COUNT]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [LEGEND_ATTRS_LIST.STEP]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [LEGEND_ATTRS_LIST.VALUES]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [LEGEND_ATTRS_LIST.FORMAT]: null | string = null;
}
