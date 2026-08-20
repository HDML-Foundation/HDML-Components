/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `hdml-area` element (RFC 016/001 §2.2).
 *
 * @module hdvl/mark-area
 */

import { customElement, property } from "lit/decorators.js";
import { HdvlElement } from "./base";
import type { SceneGroup } from "./scene";
import {
  AREA_ATTRS_LIST,
  HDVL_FAMILIES,
  HDVL_TAG_NAMES,
} from "./vocabulary";

/**
 * A filled band between two edges per row. The **ranged** form
 * (`y0`/`y1`) is the primitive; the simple form is sugar for it
 * (step-plan H8), which is what lets `hdml-stack` supply a
 * baseline without changing anything inside this element.
 *
 * **Registered and inert as of this commit.** Step 09 lands the tag
 * surface once and for all — the tag, the family and the observed
 * attributes — and every body arrives in its own slice. In
 * particular this element declares no `scene()`: `FrameContext` is
 * made of the frame's MEASURE snapshot, so it and `scene()` land
 * together at step 11 (step-plan C6).
 *
 * @tagname hdml-area
 *
 * @attribute {string} x - The column bound to the `x` channel (SPEC
 * §5).
 *
 * @attribute {string} x0 - The column bound to the ranged `x0`
 * endpoint (SPEC §6.4).
 *
 * @attribute {string} x1 - The column bound to the ranged `x1`
 * endpoint (SPEC §6.4).
 *
 * @attribute {string} y - The column bound to the `y` channel (SPEC
 * §5).
 *
 * @attribute {string} y0 - The column bound to the ranged `y0`
 * endpoint (SPEC §6.4).
 *
 * @attribute {string} y1 - The column bound to the ranged `y1`
 * endpoint (SPEC §6.4).
 *
 * @attribute {string} angle - The column bound to the `angle` channel
 * (SPEC §3).
 *
 * @attribute {string} radius - The column bound to the `radius`
 * channel (SPEC §3).
 *
 * @attribute {string} r0 - The column bound to the ranged `r0`
 * endpoint (SPEC §6.4).
 *
 * @attribute {string} r1 - The column bound to the ranged `r1`
 * endpoint (SPEC §6.4).
 *
 * @attribute {string} color - The column bound to the `color` channel
 * (SPEC §3).
 *
 * @attribute {string} closed - Whether the path closes back on its
 * first vertex.
 *
 * @attribute {string} hidden - Whether this element is withheld from
 * painting; its container re-derives without it (SPEC §7).
 *
 * @attribute {string} source - The data source for this subtree,
 * nearest-ancestor-wins (SPEC §4.5).
 */
@customElement(HDVL_TAG_NAMES.AREA)
export class HdmlAreaElement extends HdvlElement {
  public readonly tag = HDVL_TAG_NAMES.AREA;

  public readonly family = HDVL_FAMILIES[HDVL_TAG_NAMES.AREA];

  /**
   * @internal
   */
  @property({ type: String })
  [AREA_ATTRS_LIST.X]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [AREA_ATTRS_LIST.X0]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [AREA_ATTRS_LIST.X1]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [AREA_ATTRS_LIST.Y]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [AREA_ATTRS_LIST.Y0]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [AREA_ATTRS_LIST.Y1]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [AREA_ATTRS_LIST.ANGLE]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [AREA_ATTRS_LIST.RADIUS]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [AREA_ATTRS_LIST.R0]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [AREA_ATTRS_LIST.R1]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [AREA_ATTRS_LIST.COLOR]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [AREA_ATTRS_LIST.CLOSED]: null | string = null;

  /**
   * SPEC's `hidden` collides with `HTMLElement.hidden`, which is a
   * platform **boolean** IDL attribute. Declaring a `null | string`
   * field of that name would shadow it and does not type-check.
   * The observed attribute is still `hidden` — named through the
   * `attribute` option — so `observedAttributes` and the
   * invalidation funnel are exactly as SPEC §7 specifies, and the
   * platform's own property is left alone rather than overwritten.
   * Whether HDVL's `hidden` *is* the platform's is a semantic
   * question the slice that implements it decides.
   *
   * @internal
   */
  @property({
    type: String,
    attribute: AREA_ATTRS_LIST.HIDDEN,
  })
  public hiddenAttr: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [AREA_ATTRS_LIST.SOURCE]: null | string = null;

  /**
   * @override
   *
   * Contract-complete at `null` (§2.3): "returns null to paint
   * nothing (hidden, errored, or still loading)". **Step 21** puts
   * a filled band here, and replaces this line alone.
   */
  public scene(): SceneGroup | null {
    return null;
  }
}
