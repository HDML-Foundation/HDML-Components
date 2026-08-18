/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { HDML_TAG_NAMES, CONNECTIVE_ATTRS_LIST } from "@hdml/types";
import { customElement, property } from "lit/decorators.js";
import { HdqlElement } from "./HdqlElement";

/**
 * The `hdml-connective` component is utilized to define logical
 * connectives. It is commonly employed within the context of
 * `hdml-join` conditions under `hdml-model` or within the context of
 * `hdml-filter-by` conditions under `hdml-frame`. This component
 * enables you to merge multiple filters using logical operators.
 * `hdml-connective` is specifically designed for connecting multiple
 * `hdml-filter` and other `hdml-connective` components.
 *
 * @tagname hdml-connective
 *
 * @event {CustomEvent} - Triggers an `hdom-changed`
 * event on the `document` element when component is connected to or
 * disconnected from the `document`, or when any of the described
 * attributes change.
 *
 * @attribute {string} operator - Specifies the logical operator to
 * connect filters. Supported values include `and` for logical `AND`
 * operator, `or` for logical `OR` operator and `none` if no operator
 * needed.
 */
@customElement(HDML_TAG_NAMES.CONNECTIVE)
export class HdmlConnective extends HdqlElement {
  /**
   * @internal
   */
  @property({ type: String })
  [CONNECTIVE_ATTRS_LIST.OPERATOR]: null | string = null;
}
