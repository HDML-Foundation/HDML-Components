/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { HDML_TAG_NAMES, DATASET_ATTRS_LIST } from "@hdml/types";
import { customElement, property } from "lit/decorators.js";
import { HdqlElement } from "./HdqlElement";

/**
 * The `hdml-dataset` component represents one dataset within a
 * data model in the HDML structure. It provides a way to define and
 * organize data sets, whether they are actual tables, views or
 * materialized views from a database, or the result of a SQL query.
 *
 * ⓘ **Named `hdml-table` until `@hdml/types`
 * `0.0.2-alpha.26`** (019 item 2). The old tag is not an alias: a
 * document still authoring it parses to a model with no dataset,
 * and the parser raises **no diagnostic** for the dropped element.
 *
 * @tagname hdml-dataset
 *
 * @event {CustomEvent} - Triggers an `hdom-changed`
 * event on the `document` element when it is connected to or
 * disconnected from the `document`, or when any of the described
 * attributes change.
 *
 * @attribute {string} name - The name of the dataset.
 *
 * @attribute {string} type - The type of the dataset, either
 * `table` for an actual database table, view or materialized view,
 * or `query` for a dataset generated from a SQL query.
 *
 * @attribute {string} identifier - The unique `identifier` for the
 * dataset, which should include the full three-tier table name for
 * database tables, views or materialized views, enclosed in back
 * quotes — or the SQL query.
 *
 * @attribute {string} description - The description of the dataset.
 */
@customElement(HDML_TAG_NAMES.DATASET)
export class HdmlDataset extends HdqlElement {
  /**
   * @internal
   */
  @property({ type: String })
  [DATASET_ATTRS_LIST.NAME]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [DATASET_ATTRS_LIST.TYPE]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [DATASET_ATTRS_LIST.IDENTIFIER]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [DATASET_ATTRS_LIST.DESCRIPTION]: null | string = null;
}
