/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `hdml-continuous-scale` element (RFC 016/001 §2.2).
 *
 * @module hdvl/scale-continuous
 */

import { customElement, property } from "lit/decorators.js";
import { HdvlElement } from "./base";
import {
  CONTINUOUS_SCALE_ATTRS_LIST,
  HDVL_FAMILIES,
  HDVL_TAG_NAMES,
} from "./vocabulary";

/**
 * A numeric `domain → range` map. The domain is data-side and
 * async; the range is derived from this element's own **content
 * box** along its channel's axis (§4.3). The five transforms —
 * `linear`, `log`, `pow`, `sqrt`, `symlog` — and the `Scale`
 * implementation itself land whole at step 18 (step-plan H1), never
 * method-by-method as consumers arrive.
 *
 * **Registered and inert as of this commit.** Step 09 lands the tag
 * surface once and for all — the tag, the family and the observed
 * attributes — and every body arrives in its own slice. In
 * particular this element declares no `scene()`: `FrameContext` is
 * made of the frame's MEASURE snapshot, so it and `scene()` land
 * together at step 11 (step-plan C6).
 *
 * @tagname hdml-continuous-scale
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
 * @attribute {string} type - The continuous transform (SPEC §6).
 *
 * @attribute {string} base - The logarithm base, for the `log`
 * transform.
 *
 * @attribute {string} exponent - The exponent, for the `pow`
 * transform.
 *
 * @attribute {string} constant - The linear-region constant, for the
 * `symlog` transform.
 *
 * @attribute {string} nice - Whether the domain extends to round
 * values.
 *
 * @attribute {string} zero - Whether the domain includes zero.
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
@customElement(HDVL_TAG_NAMES.CONTINUOUS_SCALE)
export class HdmlContinuousScaleElement extends HdvlElement {
  public readonly tag = HDVL_TAG_NAMES.CONTINUOUS_SCALE;

  public readonly family =
    HDVL_FAMILIES[HDVL_TAG_NAMES.CONTINUOUS_SCALE];

  /**
   * @internal
   */
  @property({ type: String })
  [CONTINUOUS_SCALE_ATTRS_LIST.CHANNEL]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONTINUOUS_SCALE_ATTRS_LIST.MIN]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONTINUOUS_SCALE_ATTRS_LIST.MAX]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONTINUOUS_SCALE_ATTRS_LIST.VALUES]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONTINUOUS_SCALE_ATTRS_LIST.TYPE]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONTINUOUS_SCALE_ATTRS_LIST.BASE]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONTINUOUS_SCALE_ATTRS_LIST.EXPONENT]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONTINUOUS_SCALE_ATTRS_LIST.CONSTANT]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONTINUOUS_SCALE_ATTRS_LIST.NICE]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONTINUOUS_SCALE_ATTRS_LIST.ZERO]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONTINUOUS_SCALE_ATTRS_LIST.CLAMP]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONTINUOUS_SCALE_ATTRS_LIST.REVERSE]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONTINUOUS_SCALE_ATTRS_LIST.SOURCE]: null | string = null;
}
