/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { HDML_TAG_NAMES } from "@hdml/types";
import { customElement } from "lit/decorators.js";
import { HdqlElement } from "./HdqlElement";

/**
 * The `hdml-group-by` component is used within the context of an
 * `hdml-frame` to group data based on specific fields. It allows you
 * to aggregate data based on common values in one or more fields.
 * This component is useful for summarizing data and performing
 * operations on grouped subsets of the dataset.
 *
 * The `hdml-group-by` component must contain at least one
 * `hdml-field` element to specify the field(s) by which the data will
 * be grouped.
 *
 * Grouped data can then be further manipulated or analyzed within the
 * frame’s scope.
 *
 * @tagname hdml-group-by
 *
 * @event {CustomEvent} - Triggers an `hdom-changed`
 * event on the `document` element when component is connected to or
 * disconnected from the `document`.
 */
@customElement(HDML_TAG_NAMES.GROUP_BY)
export class HdmlGroupBy extends HdqlElement {}
