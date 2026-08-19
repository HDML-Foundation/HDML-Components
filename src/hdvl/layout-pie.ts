/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `hdml-pie` element (RFC 016/001 §2.2).
 *
 * @module hdvl/layout-pie
 */

import { customElement, property } from "lit/decorators.js";
import { HdvlElement } from "./base";
import {
  HDVL_FAMILIES,
  HDVL_TAG_NAMES,
  PIE_ATTRS_LIST,
} from "./vocabulary";

/**
 * A layout **widget**, not a container: it paints. One cross-row
 * `derive()` in data space turns each row's `angle` value into a
 * sector extent before projection, and the sectors it emits are
 * ordinary marks — which is why its family is `mark`, and why a
 * pie of four zero rows counts as "produced no marks" for §3.4.1's
 * `empty` rather than being excluded from the question.
 *
 * **Registered and inert as of this commit.** Step 09 lands the tag
 * surface once and for all — the tag, the family and the observed
 * attributes — and every body arrives in its own slice. In
 * particular this element declares no `scene()`: `FrameContext` is
 * made of the frame's MEASURE snapshot, so it and `scene()` land
 * together at step 11 (step-plan C6).
 *
 * @tagname hdml-pie
 *
 * @attribute {string} angle - The column bound to the `angle` channel
 * (SPEC §3).
 *
 * @attribute {string} color - The column bound to the `color` channel
 * (SPEC §3).
 *
 * @attribute {string} source - The data source for this subtree,
 * nearest-ancestor-wins (SPEC §4.5).
 */
@customElement(HDVL_TAG_NAMES.PIE)
export class HdmlPieElement extends HdvlElement {
  public readonly tag = HDVL_TAG_NAMES.PIE;

  public readonly family = HDVL_FAMILIES[HDVL_TAG_NAMES.PIE];

  /**
   * @internal
   */
  @property({ type: String })
  [PIE_ATTRS_LIST.ANGLE]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [PIE_ATTRS_LIST.COLOR]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [PIE_ATTRS_LIST.SOURCE]: null | string = null;
}
