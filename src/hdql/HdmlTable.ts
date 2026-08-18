/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { HDML_TAG_NAMES, TABLE_ATTRS_LIST } from "@hdml/types";
import { customElement, property } from "lit/decorators.js";
import { HdqlElement } from "./HdqlElement";

/**
 * The `hdml-table` component represents a table within a data model
 * in the HDML structure. It provides a way to define and organize
 * data tables, whether they are actual tables, views, or materialized
 * views from a database or the result of a SQL query.
 *
 * @tagname hdml-table
 *
 * @event {CustomEvent} - Triggers an `hdom-changed`
 * event on the `document` element when it is connected to or
 * disconnected from the `document`, or when any of the described
 * attributes change.
 *
 * @attribute {string} name - The name of the table.
 *
 * @attribute {string} type - The type of the table, either `table`
 * for an actual database table, view, or materialized view, or
 * `query` for a table generated from a SQL query.
 *
 * @attribute {string} identifier - The unique `identifier` for the
 * table, which should include the full three-tier table name for
 * database tables, views, or materialized views, enclosed in back
 * quotes or SQL query.
 *
 * @attribute {string} description - The description of the table.
 */
@customElement(HDML_TAG_NAMES.TABLE)
export class HdmlTable extends HdqlElement {
  /**
   * @internal
   */
  @property({ type: String })
  [TABLE_ATTRS_LIST.NAME]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [TABLE_ATTRS_LIST.TYPE]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [TABLE_ATTRS_LIST.IDENTIFIER]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [TABLE_ATTRS_LIST.DESCRIPTION]: null | string = null;
}
