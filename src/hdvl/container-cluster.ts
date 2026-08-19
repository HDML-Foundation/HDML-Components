/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `hdml-cluster` element (RFC 016/001 §2.2).
 *
 * @module hdvl/container-cluster
 */

import { customElement, property } from "lit/decorators.js";
import { HdvlElement } from "./base";
import {
  CLUSTER_ATTRS_LIST,
  HDVL_FAMILIES,
  HDVL_TAG_NAMES,
} from "./vocabulary";

/**
 * **Not a painter.** It subdivides the band among its rendered
 * children, which then emit as ordinary ranged marks. Slot is the
 * child index and slot count is the rendered-child count, both
 * derived from structure — never from CSS. It is the error unit
 * for its own subtree (SPEC §7's all-or-nothing).
 *
 * **Registered and inert as of this commit.** Step 09 lands the tag
 * surface once and for all — the tag, the family and the observed
 * attributes — and every body arrives in its own slice. In
 * particular this element declares no `scene()`: `FrameContext` is
 * made of the frame's MEASURE snapshot, so it and `scene()` land
 * together at step 11 (step-plan C6).
 *
 * @tagname hdml-cluster
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
@customElement(HDVL_TAG_NAMES.CLUSTER)
export class HdmlClusterElement extends HdvlElement {
  public readonly tag = HDVL_TAG_NAMES.CLUSTER;

  public readonly family = HDVL_FAMILIES[HDVL_TAG_NAMES.CLUSTER];

  /**
   * @internal
   */
  @property({ type: String })
  [CLUSTER_ATTRS_LIST.X]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CLUSTER_ATTRS_LIST.Y]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CLUSTER_ATTRS_LIST.SOURCE]: null | string = null;
}
