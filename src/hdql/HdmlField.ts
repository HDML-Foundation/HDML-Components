/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { HDML_TAG_NAMES, FIELD_ATTRS_LIST } from "@hdml/types";
import { customElement, property } from "lit/decorators.js";
import { HdqlElement } from "./HdqlElement";

/**
 * The `hdml-field` component represents a field within an
 * `hdml-table` in the HDML context.
 *
 * @tagname hdml-field
 *
 * @event {CustomEvent} - Triggers an `hdom-changed`
 * event on the `document` element when it is connected to or
 * disconnected from the `document`, or when any of the described
 * attributes change.
 *
 * @attribute {string} name - The name of the field in the HDML
 * context.
 *
 * @attribute {string} description - Additional metadata or
 * description for the field.
 *
 * @attribute {string} origin - The name of the original field in the
 * database if used within the scope of `hdml-table`, or in the parent
 * structure if used within the scope of an `hdml-frame`. If omitted,
 * it is assumed to be the same as the HDML field name.
 *
 * @attribute {string} clause - An SQL clause defining the field. It
 * takes precedence over the `origin` attribute. For example,
 * ```clause="concat(`table_catalog`, '-', `table_schema`, '-',
 * `table_name`)"```.
 *
 * @attribute {string} type - The data type of the field in the HDML
 * context. Supported types include: `int-8`, `int-16`, `int-32`,
 * `int-64`, `float-16`, `float-32`, `float-64`, `binary`, `utf-8`,
 * `decimal`, `date`, `time`, `timestamp`.
 *
 * @attribute {string} aggregation - Specifies an aggregation function
 * for the field. Supported functions include: `none`, `count`,
 * `countDistinct`, `countDistinctApprox`, `sum`, `avg`, `min`, `max`.
 *
 * @attribute {string} order - Specifies the type of sorting for the
 * field. Supported values are: `none`, `asc` and `desc`.
 *
 * @attribute {string} scale - The number of decimal places for the
 * `type="decimal"`.
 *
 * @attribute {string} precision - The total number of digits,
 * including both the integer and fractional parts for the
 * `type="decimal"`.
 *
 * @attribute {string} unit - Specifies the date format unit for the
 * `type="time"` and `type="timestamp"`. Supported values include
 * `second`, `millisecond`, `microsecond` and `nanosecond`.
 *
 * @attribute {string} timezone - Specifies the timezone for the
 * timestamp field. Supported values include `UTC`, `GMT`, `GMT-12` to
 * `GMT+14`.
 */
@customElement(HDML_TAG_NAMES.FIELD)
export class HdmlField extends HdqlElement {
  /**
   * @internal
   */
  @property({ type: String })
  [FIELD_ATTRS_LIST.NAME]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [FIELD_ATTRS_LIST.DESCRIPTION]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [FIELD_ATTRS_LIST.ORIGIN]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [FIELD_ATTRS_LIST.CLAUSE]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [FIELD_ATTRS_LIST.TYPE]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [FIELD_ATTRS_LIST.AGGREGATION]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [FIELD_ATTRS_LIST.ORDER]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [FIELD_ATTRS_LIST.SCALE]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [FIELD_ATTRS_LIST.PRECISION]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [FIELD_ATTRS_LIST.UNIT]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [FIELD_ATTRS_LIST.TIMEZONE]: null | string = null;
}
