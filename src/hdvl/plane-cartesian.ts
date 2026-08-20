/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `hdml-cartesian-plane` element (RFC 016/001 §2.2).
 *
 * @module hdvl/plane-cartesian
 */

import { customElement, property } from "lit/decorators.js";
import { HdvlElement } from "./base";
import type { SceneGroup } from "./scene";
import {
  CARTESIAN_PLANE_ATTRS_LIST,
  HDVL_FAMILIES,
  HDVL_TAG_NAMES,
} from "./vocabulary";

/**
 * A **geometric anchor**: a CSS box with `container-type: size`,
 * plus the projection that gives `x` and `y` their screen meaning.
 * A plane contributes no dimension of its own and emits no scene
 * nodes — the multidimensional space is built by the scale chain
 * inside it (SPEC §3).
 *
 * Its box defaults — `position: absolute; inset: 0` and the
 * `8px 8px 24px 40px` gutter the zero-CSS guide defaults spill
 * into — come from the element sheet, so any author rule beats
 * them. The `Projection` it will supply is step 11's; nothing about
 * it is stubbed here.
 *
 * @tagname hdml-cartesian-plane
 *
 * @attribute {string} source - The data source for the subtree,
 * nearest-ancestor-wins (SPEC §4.5).
 */
@customElement(HDVL_TAG_NAMES.CARTESIAN_PLANE)
export class HdmlCartesianPlaneElement extends HdvlElement {
  public readonly tag = HDVL_TAG_NAMES.CARTESIAN_PLANE;

  public readonly family =
    HDVL_FAMILIES[HDVL_TAG_NAMES.CARTESIAN_PLANE];

  /**
   * @internal
   */
  @property({ type: String })
  [CARTESIAN_PLANE_ATTRS_LIST.SOURCE]: null | string = null;

  /**
   * @override
   *
   * §3.4's table gives `loading` to the view **and** its planes.
   */
  public connectedCallback(): void {
    super.connectedCallback();
    this.setState("loading", true);
  }

  /**
   * @override
   *
   * §5.1: a plane emits **no group at all** — it is a geometric
   * anchor, not a painter (§2.2). Permanent; no later slice fills
   * this in.
   */
  public scene(): SceneGroup | null {
    return null;
  }
}
