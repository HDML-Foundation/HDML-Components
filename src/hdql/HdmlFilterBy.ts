/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { HDML_TAG_NAMES } from "@hdml/types";
import { customElement } from "lit/decorators.js";
import { HdqlElement } from "./HdqlElement";

/**
 * The `hdml-filter-by` component is used to filter data within the
 * context of an `hdml-frame`. It allows you to specify conditions to
 * filter rows of data based on specific criteria. This component is
 * essential for refining datasets and focusing on relevant
 * information.
 *
 * The `hdml-connective` element must be a child element of
 * `hdml-filter-by` and is used to specify the logical operator for
 * joining multiple filter conditions.
 *
 * Multiple `hdml-filter` elements can be included within
 * `hdml-connective` to define complex filter conditions.
 *
 * @tagname hdml-filter-by
 *
 * @event {CustomEvent} - Triggers an `hdom-changed`
 * event on the `document` element when component is connected to or
 * disconnected from the `document`.
 */
@customElement(HDML_TAG_NAMES.FILTER_BY)
export class HdmlFilterBy extends HdqlElement {}
