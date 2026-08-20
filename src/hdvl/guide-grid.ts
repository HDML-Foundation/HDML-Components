/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `hdml-grid` element (RFC 016/001 §2.2).
 *
 * @module hdvl/guide-grid
 */

import { customElement, property } from "lit/decorators.js";
import { HdvlElement } from "./base";
import type { SceneGroup } from "./scene";
import {
  GRID_ATTRS_LIST,
  HDVL_FAMILIES,
  HDVL_TAG_NAMES,
} from "./vocabulary";

/**
 * A line across the plane repeated at scale positions — never a
 * gutter dweller, which is why its UA placement is `inset: 0`.
 * Binds no columns and takes no `source`.
 *
 * **Registered and inert as of this commit.** Step 09 lands the tag
 * surface once and for all — the tag, the family and the observed
 * attributes — and every body arrives in its own slice. In
 * particular this element declares no `scene()`: `FrameContext` is
 * made of the frame's MEASURE snapshot, so it and `scene()` land
 * together at step 11 (step-plan C6).
 *
 * @tagname hdml-grid
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
 */
@customElement(HDVL_TAG_NAMES.GRID)
export class HdmlGridElement extends HdvlElement {
  public readonly tag = HDVL_TAG_NAMES.GRID;

  public readonly family = HDVL_FAMILIES[HDVL_TAG_NAMES.GRID];

  /**
   * @internal
   */
  @property({ type: String })
  [GRID_ATTRS_LIST.CHANNEL]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [GRID_ATTRS_LIST.COUNT]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [GRID_ATTRS_LIST.STEP]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [GRID_ATTRS_LIST.VALUES]: null | string = null;

  /**
   * @override
   *
   * Contract-complete at `null` (§2.3): "returns null to paint
   * nothing (hidden, errored, or still loading)". **Step 23** puts
   * one line per domain value here, and replaces this line alone.
   */
  public scene(): SceneGroup | null {
    return null;
  }
}
