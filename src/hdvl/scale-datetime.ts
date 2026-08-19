/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `hdml-datetime-scale` element (RFC 016/001 §2.2).
 *
 * @module hdvl/scale-datetime
 */

import { customElement, property } from "lit/decorators.js";
import { HdvlElement } from "./base";
import {
  DATETIME_SCALE_ATTRS_LIST,
  HDVL_FAMILIES,
  HDVL_TAG_NAMES,
} from "./vocabulary";

/**
 * A temporal `domain → range` map. Its calendar arithmetic runs in
 * `zone`, behind the seam that keeps `temporal-polyfill` out of
 * every other module.
 *
 * **Registered and inert as of this commit.** Step 09 lands the tag
 * surface once and for all — the tag, the family and the observed
 * attributes — and every body arrives in its own slice. In
 * particular this element declares no `scene()`: `FrameContext` is
 * made of the frame's MEASURE snapshot, so it and `scene()` land
 * together at step 11 (step-plan C6).
 *
 * @tagname hdml-datetime-scale
 *
 * @attribute {string} channel - The channel this element addresses
 * (SPEC §3).
 *
 * @attribute {string} min - The lower bound of the authored domain
 * (SPEC §6).
 *
 * @attribute {string} max - The upper bound of the authored domain
 * (SPEC §6).
 *
 * @attribute {string} values - An explicit list — the domain on a
 * scale, the positions to repeat at on a guide.
 *
 * @attribute {string} zone - The IANA time zone the domain is read
 * in.
 *
 * @attribute {string} nice - Whether the domain extends to round
 * values.
 *
 * @attribute {string} clamp - Whether out-of-domain values clamp into
 * the range.
 *
 * @attribute {string} reverse - Whether the range runs in the
 * opposite direction.
 *
 * @attribute {string} source - The data source for this subtree,
 * nearest-ancestor-wins (SPEC §4.5).
 */
@customElement(HDVL_TAG_NAMES.DATETIME_SCALE)
export class HdmlDatetimeScaleElement extends HdvlElement {
  public readonly tag = HDVL_TAG_NAMES.DATETIME_SCALE;

  public readonly family =
    HDVL_FAMILIES[HDVL_TAG_NAMES.DATETIME_SCALE];

  /**
   * @internal
   */
  @property({ type: String })
  [DATETIME_SCALE_ATTRS_LIST.CHANNEL]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [DATETIME_SCALE_ATTRS_LIST.MIN]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [DATETIME_SCALE_ATTRS_LIST.MAX]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [DATETIME_SCALE_ATTRS_LIST.VALUES]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [DATETIME_SCALE_ATTRS_LIST.ZONE]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [DATETIME_SCALE_ATTRS_LIST.NICE]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [DATETIME_SCALE_ATTRS_LIST.CLAMP]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [DATETIME_SCALE_ATTRS_LIST.REVERSE]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [DATETIME_SCALE_ATTRS_LIST.SOURCE]: null | string = null;
}
