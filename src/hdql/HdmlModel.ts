/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { HDML_TAG_NAMES, MODEL_ATTRS_LIST } from "@hdml/types";
import { customElement, property } from "lit/decorators.js";
import { HdqlElement } from "./HdqlElement";

/**
 * The `hdml-model` component represents a data model within the
 * HDML structure. It serves as a container for organizing various
 * tables, joins, and relationships that define the structure of the
 * data.
 *
 * @tagname hdml-model
 *
 * @event {CustomEvent} - Triggers an `hdom-changed`
 * event on the `document` element when it is connected to or
 * disconnected from the `document`, or when any of the described
 * attributes change.
 *
 * @attribute {string} name - The name of the model.
 *
 * @attribute {string} description - The description of the model.
 */
@customElement(HDML_TAG_NAMES.MODEL)
export class HdmlModel extends HdqlElement {
  /**
   * @internal
   */
  @property({ type: String })
  [MODEL_ATTRS_LIST.NAME]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [MODEL_ATTRS_LIST.DESCRIPTION]: null | string = null;
}
