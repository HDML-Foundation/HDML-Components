/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `hdml-ordinal-scale` element (RFC 016/001 §2.2).
 *
 * @module hdvl/scale-ordinal
 */

import { customElement, property } from "lit/decorators.js";
import { HdvlElement } from "./base";
import type { SceneGroup } from "./scene";
import {
  HDVL_FAMILIES,
  HDVL_TAG_NAMES,
  ORDINAL_SCALE_ATTRS_LIST,
} from "./vocabulary";

/**
 * A categorical `domain → range` map, banded by `--hdml-bandwidth`
 * (§4.4). On `channel="color"` it is the palette scale, and its
 * key is what `hdml-legend` renders.
 *
 * **Registered and inert as of this commit.** Step 09 lands the tag
 * surface once and for all — the tag, the family and the observed
 * attributes — and every body arrives in its own slice. In
 * particular this element declares no `scene()`: `FrameContext` is
 * made of the frame's MEASURE snapshot, so it and `scene()` land
 * together at step 11 (step-plan C6).
 *
 * @tagname hdml-ordinal-scale
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
 * @attribute {string} sort - The domain ordering (ordinal only).
 *
 * @attribute {string} reverse - Whether the range runs in the
 * opposite direction.
 *
 * @attribute {string} source - The data source for this subtree,
 * nearest-ancestor-wins (SPEC §4.5).
 */
@customElement(HDVL_TAG_NAMES.ORDINAL_SCALE)
export class HdmlOrdinalScaleElement extends HdvlElement {
  public readonly tag = HDVL_TAG_NAMES.ORDINAL_SCALE;

  public readonly family =
    HDVL_FAMILIES[HDVL_TAG_NAMES.ORDINAL_SCALE];

  /**
   * @internal
   */
  @property({ type: String })
  [ORDINAL_SCALE_ATTRS_LIST.CHANNEL]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [ORDINAL_SCALE_ATTRS_LIST.MIN]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [ORDINAL_SCALE_ATTRS_LIST.MAX]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [ORDINAL_SCALE_ATTRS_LIST.VALUES]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [ORDINAL_SCALE_ATTRS_LIST.SORT]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [ORDINAL_SCALE_ATTRS_LIST.REVERSE]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [ORDINAL_SCALE_ATTRS_LIST.SOURCE]: null | string = null;

  /**
   * @override
   *
   * §5.1: a scale emits **no group at all**. It resolves a domain
   * and a range for the widgets below it and paints nothing itself.
   * Permanent; step 18 gives this element a `Scale`, not a scene.
   */
  public scene(): SceneGroup | null {
    return null;
  }
}
