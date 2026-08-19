/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `hdml-bar` element (RFC 016/001 §2.2).
 *
 * @module hdvl/mark-bar
 */

import { customElement, property } from "lit/decorators.js";
import { HdvlElement } from "./base";
import {
  BAR_ATTRS_LIST,
  HDVL_FAMILIES,
  HDVL_TAG_NAMES,
} from "./vocabulary";

/**
 * One band-filling rectangle per row. Ranged-first for the same
 * reason as `hdml-area` (step-plan H8): a floating bar and a
 * stacked bar are the same primitive, differently parameterised.
 *
 * **Registered and inert as of this commit.** Step 09 lands the tag
 * surface once and for all — the tag, the family and the observed
 * attributes — and every body arrives in its own slice. In
 * particular this element declares no `scene()`: `FrameContext` is
 * made of the frame's MEASURE snapshot, so it and `scene()` land
 * together at step 11 (step-plan C6).
 *
 * @tagname hdml-bar
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
 * @attribute {string} color - The column bound to the `color` channel
 * (SPEC §3).
 *
 * @attribute {string} hidden - Whether this element is withheld from
 * painting; its container re-derives without it (SPEC §7).
 *
 * @attribute {string} source - The data source for this subtree,
 * nearest-ancestor-wins (SPEC §4.5).
 */
@customElement(HDVL_TAG_NAMES.BAR)
export class HdmlBarElement extends HdvlElement {
  public readonly tag = HDVL_TAG_NAMES.BAR;

  public readonly family = HDVL_FAMILIES[HDVL_TAG_NAMES.BAR];

  /**
   * @internal
   */
  @property({ type: String })
  [BAR_ATTRS_LIST.X]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [BAR_ATTRS_LIST.X0]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [BAR_ATTRS_LIST.X1]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [BAR_ATTRS_LIST.Y]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [BAR_ATTRS_LIST.Y0]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [BAR_ATTRS_LIST.Y1]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [BAR_ATTRS_LIST.COLOR]: null | string = null;

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
    attribute: BAR_ATTRS_LIST.HIDDEN,
  })
  public hiddenAttr: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [BAR_ATTRS_LIST.SOURCE]: null | string = null;
}
