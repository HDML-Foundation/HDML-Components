/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `hdml-tick` element (RFC 016/001 §2.2).
 *
 * @module hdvl/guide-tick
 */

import { customElement, property } from "lit/decorators.js";
import { HdvlElement } from "./base";
import type { SceneGroup } from "./scene";
import {
  HDVL_FAMILIES,
  HDVL_TAG_NAMES,
  TICK_ATTRS_LIST,
} from "./vocabulary";

/**
 * A glyph repeated at scale positions, shaped by
 * `--hdml-tick-style` and sized by `--hdml-tick-width` /
 * `--hdml-tick-height`. Binds no columns and takes no `source`.
 *
 * **Registered and inert as of this commit.** Step 09 lands the tag
 * surface once and for all — the tag, the family and the observed
 * attributes — and every body arrives in its own slice. In
 * particular this element declares no `scene()`: `FrameContext` is
 * made of the frame's MEASURE snapshot, so it and `scene()` land
 * together at step 11 (step-plan C6).
 *
 * @tagname hdml-tick
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
@customElement(HDVL_TAG_NAMES.TICK)
export class HdmlTickElement extends HdvlElement {
  public readonly tag = HDVL_TAG_NAMES.TICK;

  public readonly family = HDVL_FAMILIES[HDVL_TAG_NAMES.TICK];

  /**
   * @internal
   */
  @property({ type: String })
  [TICK_ATTRS_LIST.CHANNEL]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [TICK_ATTRS_LIST.COUNT]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [TICK_ATTRS_LIST.STEP]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [TICK_ATTRS_LIST.VALUES]: null | string = null;

  /**
   * @override
   *
   * Contract-complete at `null` (§2.3): "returns null to paint
   * nothing (hidden, errored, or still loading)". **Step 24** puts
   * one glyph per domain value here, and replaces this line alone.
   */
  public scene(): SceneGroup | null {
    return null;
  }
}
