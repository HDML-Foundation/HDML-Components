/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { HDML_TAG_NAMES, JOIN_ATTRS_LIST } from "@hdml/types";
import { customElement, property } from "lit/decorators.js";
import { HdqlElement } from "./HdqlElement";

/**
 * The `hdml-join` component is used to define joins between tables
 * within an `hdml-model`. It provides flexibility in specifying the
 * type of join and the conditions for the join through a combination
 * of attributes and child components.
 *
 * @tagname hdml-join
 *
 * @event {CustomEvent} - Triggers an `hdom-changed`
 * event on the `document` element when component is connected to or
 * disconnected from the `document`, or when any of the described
 * attributes change.
 *
 * @attribute {string} type - Specifies the type of join. Supported
 * values include:
 * - `cross`: Produces the Cartesian product of two tables.
 * - `inner`: Returns only the rows that have matching values in both
 * tables.
 * - `full`: Returns all rows when there is a match in either left or
 * right table records.
 * - `left`, `right`: Returns all rows from the left or right table
 * and matching rows from the right or left table.
 * - `full-outer`, `left-outer`, `right-outer`: Similar to full, left,
 * and right but includes unmatched rows as well.
 *
 * @attribute {string} left - The name of the left table in the join.
 * Should match the name of an `hdml-table` within the same
 * `hdml-model`.
 *
 * @attribute {string} right - The name of the right table in the
 * join. Should match the name of an `hdml-table` within the same
 * `hdml-model`.
 *
 * @attribute {string} description - The description of the model.
 */
@customElement(HDML_TAG_NAMES.JOIN)
export class HdmlJoin extends HdqlElement {
  /**
   * @internal
   */
  @property({ type: String })
  [JOIN_ATTRS_LIST.TYPE]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [JOIN_ATTRS_LIST.LEFT]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [JOIN_ATTRS_LIST.RIGHT]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [JOIN_ATTRS_LIST.DESCRIPTION]: null | string = null;
}
