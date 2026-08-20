/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `hdml-rule` element (RFC 016/001 §2.2).
 *
 * @module hdvl/mark-rule
 */

import { customElement, property } from "lit/decorators.js";
import { HdvlElement } from "./base";
import type { SceneGroup } from "./scene";
import {
  HDVL_FAMILIES,
  HDVL_TAG_NAMES,
  RULE_ATTRS_LIST,
} from "./vocabulary";

/**
 * One range-spanning line per row, at a position on the single
 * channel it binds — the reference line every threshold chart
 * draws by hand.
 *
 * **Registered and inert as of this commit.** Step 09 lands the tag
 * surface once and for all — the tag, the family and the observed
 * attributes — and every body arrives in its own slice. In
 * particular this element declares no `scene()`: `FrameContext` is
 * made of the frame's MEASURE snapshot, so it and `scene()` land
 * together at step 11 (step-plan C6).
 *
 * @tagname hdml-rule
 *
 * @attribute {string} x - The column bound to the `x` channel (SPEC
 * §5).
 *
 * @attribute {string} y - The column bound to the `y` channel (SPEC
 * §5).
 *
 * @attribute {string} source - The data source for this subtree,
 * nearest-ancestor-wins (SPEC §4.5).
 */
@customElement(HDVL_TAG_NAMES.RULE)
export class HdmlRuleElement extends HdvlElement {
  public readonly tag = HDVL_TAG_NAMES.RULE;

  public readonly family = HDVL_FAMILIES[HDVL_TAG_NAMES.RULE];

  /**
   * @internal
   */
  @property({ type: String })
  [RULE_ATTRS_LIST.X]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [RULE_ATTRS_LIST.Y]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [RULE_ATTRS_LIST.SOURCE]: null | string = null;

  /**
   * @override
   *
   * Contract-complete at `null` (§2.3): "returns null to paint
   * nothing (hidden, errored, or still loading)". **Step 20** puts
   * a spanning rule here, and replaces this line alone.
   */
  public scene(): SceneGroup | null {
    return null;
  }
}
