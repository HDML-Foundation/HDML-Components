/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { HDML_TAG_NAMES } from "@hdml/types";
import { customElement } from "lit/decorators.js";
import { HdqlElement } from "./HdqlElement";

/**
 * The `hdml-sort-by` component is used within the context of an
 * `hdml-frame` to sort data based on specific fields. It allows you
 * to arrange data in ascending or descending order based on one or
 * more fields. This component is useful for organizing data and
 * presenting it in a structured manner.
 *
 * The `hdml-sort-by` component must contain at least one `hdml-field`
 * element to specify the field(s) by which the data will be sorted.
 *
 * Sorted data can then be further manipulated or analyzed within the
 * frame’s scope.
 *
 * The `order` attribute of the `hdml-field` element determines
 * whether the sorting is done in ascending (`asc`) or descending
 * (`desc`) order. This attribute is meaningful only within the
 * context of `hdml-sort-by`.
 *
 * @tagname hdml-sort-by
 *
 * @event {CustomEvent} - Triggers an `hdom-changed`
 * event on the `document` element when component is connected to or
 * disconnected from the `document`.
 */
@customElement(HDML_TAG_NAMES.SORT_BY)
export class HdmlSortBy extends HdqlElement {}
