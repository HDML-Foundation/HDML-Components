/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `hdml-polar-plane` element (RFC 016/001 §2.2).
 *
 * @module hdvl/plane-polar
 */

import { customElement, property } from "lit/decorators.js";
import { HdvlElement } from "./base";
import {
  HDVL_FAMILIES,
  HDVL_TAG_NAMES,
  POLAR_PLANE_ATTRS_LIST,
} from "./vocabulary";

/**
 * The polar geometric anchor: the same box role as the cartesian
 * plane with an `8px` gutter, anchoring `angle` and `radius`
 * instead of `x` and `y`.
 *
 * Its `Projection` is step 26's, and is deliberately absent rather
 * than stubbed — the mark base consumes `Projection` from its first
 * line at step 20, so polar arrives as an implementation of an
 * abstraction that already exists, never as a widget-level branch
 * (step-plan H7).
 *
 * @tagname hdml-polar-plane
 *
 * @attribute {string} source - The data source for the subtree,
 * nearest-ancestor-wins (SPEC §4.5).
 */
@customElement(HDVL_TAG_NAMES.POLAR_PLANE)
export class HdmlPolarPlaneElement extends HdvlElement {
  public readonly tag = HDVL_TAG_NAMES.POLAR_PLANE;

  public readonly family = HDVL_FAMILIES[HDVL_TAG_NAMES.POLAR_PLANE];

  /**
   * @internal
   */
  @property({ type: String })
  [POLAR_PLANE_ATTRS_LIST.SOURCE]: null | string = null;

  /**
   * @override
   *
   * §3.4's table gives `loading` to the view **and** its planes.
   */
  public connectedCallback(): void {
    super.connectedCallback();
    this.setState("loading", true);
  }
}
