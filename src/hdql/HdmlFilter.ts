/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { HDML_TAG_NAMES, FILTER_ATTRS_LIST } from "@hdml/types";
import { customElement, property } from "lit/decorators.js";
import { HdqlElement } from "./HdqlElement";

/**
 * The `hdml-filter` component is utilized to define filters within
 * the context of `hdml-join` conditions under `hdml-model` or within
 * the context of `hdml-filter-by` conditions under `hdml-frame`. This
 * component allows you to specify conditions for joining tables or
 * filtering data based on specific criteria. Filters are always
 * specified under the `hdml-connective` element, allowing you to
 * articulate the logical conditions for joining tables or filtering
 * data.
 *
 * @tagname hdml-filter
 *
 * @event {CustomEvent} - Triggers an `hdom-changed`
 * event on the `document` element when component is connected to or
 * disconnected from the `document`, or when any of the described
 * attributes change.
 *
 * @attribute {string} type - Specifies the type of filter. Supported
 * values include:
 * - `keys` (Used only in `hdml-join`): Indicates a filter based on
 * key fields. Requires additional attributes: `left` and `right`.
 * - `expr`: Represents a filter based on a conditional SQL-like
 * expression. Requires additional attribute: `clause`.
 * - `named`: Requires additional attributes: `name`, `field`, and
 * `value`.
 *
 * @attribute {string} left - Specifies the left field for key-based
 * filters. Should match the name of the `hdml-field` in the left
 * table.
 *
 * @attribute {string} right - Specifies the right field for key-based
 * filters. Should match the name of the `hdml-field` in the right
 * table.
 *
 * @attribute {string} clause - Specifies the SQL-like conditional
 * clause for expression-based filters. The format depends on the
 * context:
 * - Under `hdml-model > hdml-join` should be set as:
 *   ```
 *   clause="`hdml-table-name`.`hdml-table-field-name` = 'string'"
 *   ```
 * - Under `hdml-frame > hdml-filter-by` should be set as:
 *   ```
 *   clause="`hdml-frame-field-name` = 'string'"
 *   ```
 *
 * @attribute {string} name - Specifies the filter condition name.
 * Supported values include:
 * - `equals`: Field value equals the specified value.
 * - `not-equals`: Field value does not equal the specified value.
 * - `contains`: Field value contains the specified value.
 * - `not-contains`: Field value does not contain the specified value.
 * - `starts-with`: Field value starts with the specified value.
 * - `ends-with`: Field value ends with the specified value.
 * - `greater`: Field value is greater than the specified value.
 * - `greater-equal`: Field value is greater than or equal to the
 * specified value.
 * - `less`: Field value is less than the specified value.
 * - `less-equal`: Field value is less than or equal to the specified
 * value.
 * - `is-null`: Field value is null.
 * - `is-not-null`: Field value is not null.
 * - `between`: Field value is between two specified values.
 *
 * @attribute {string} field - Specifies the field name in the same
 * way it is specified in the `clause` attribute:
 * - Under `hdml-model > hdml-join` should be set as:
 *   ```
 *   clause="`hdml-table-name`.`hdml-table-field-name` = 'string'"
 *   ```
 * - Under `hdml-frame > hdml-filter-by` should be set as:
 *   ```
 *   clause="`hdml-frame-field-name` = 'string'"
 *   ```
 *
 * @attribute {string} values - Specifies the value used to filter
 * data.
 */
@customElement(HDML_TAG_NAMES.FILTER)
export class HdmlFilter extends HdqlElement {
  /**
   * @internal
   */
  @property({ type: String })
  [FILTER_ATTRS_LIST.TYPE]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [FILTER_ATTRS_LIST.LEFT]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [FILTER_ATTRS_LIST.RIGHT]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [FILTER_ATTRS_LIST.CLAUSE]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [FILTER_ATTRS_LIST.NAME]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [FILTER_ATTRS_LIST.FIELD]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [FILTER_ATTRS_LIST.VALUES]: null | string = null;
}
