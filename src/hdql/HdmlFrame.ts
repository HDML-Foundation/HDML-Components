/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { HDML_TAG_NAMES, FRAME_ATTRS_LIST } from "@hdml/types";
import { customElement, property } from "lit/decorators.js";
import { HdqlElement } from "./HdqlElement";

/**
 * The `hdml-frame` component is used to create a data frame based on
 * the provided HDML model or another HDML frame. It serves as a
 * container for organizing and processing data within the HDML
 * structure. This includes tasks such as filtering, aggregating,
 * sorting, and performing calculations on the data. Essentially, the
 * `hdml-frame` allows for manipulating and analyzing the data
 * according to specified criteria.
 *
 * **Note**: At least one `hdml-field` must be specified within the
 * `hdml-frame`.
 *
 * **Note**: In the case of using hdml-field within the `hdml-frame`
 * component scope, the `origin` attribute refers to the “parent”
 * structure field name.
 *
 * @tagname hdml-frame
 *
 * @event {CustomEvent} - Triggers an `hdom-changed`
 * event on the `document` element when component is connected to or
 * disconnected from the `document`, or when any of the described
 * attributes change.
 *
 * @attribute {string} name - The name of the frame.
 *
 * @attribute {string} description - The description of the frame.
 *
 * @attribute {string} source - Specifies the parent structure for the
 * frame. This attribute indicates the source of the data model used
 * to construct the frame. Depending on whether the parent structure
 * is stored separately or within the same document, the value of this
 * attribute varies:
 * - If the parent structure is stored separately on the HDIO server,
 * the value should be an HDIO path to the file, followed by either
 * `hdml-model=model_name` or `hdml-frame=frame_name`. For example:
 * `/path/to/file.hdml?hdml-model=model_name` or
 * `/path/to/file.hdml?hdml-frame=frame_name`.
 * - If the parent structure is declared within the same file, only
 * specify `hdml-model=model_name` or `hdml-frame=frame_name` without
 * the path and file name. For example: `?hdml-model=model_name` or
 * `?hdml-frame=frame_name`.
 *
 * @attribute {number} offset - Specifies the number of rows to skip
 * before starting to include rows in the frame.
 *
 * @attribute {number} limit - Specifies the maximum number of rows to
 * include in the frame.
 */
@customElement(HDML_TAG_NAMES.FRAME)
export class HdmlFrame extends HdqlElement {
  /**
   * @internal
   */
  @property({ type: String })
  [FRAME_ATTRS_LIST.NAME]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [FRAME_ATTRS_LIST.DESCRIPTION]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [FRAME_ATTRS_LIST.SOURCE]: null | string = null;

  /**
   * @internal
   */
  @property({ type: Number })
  [FRAME_ATTRS_LIST.OFFSET]: null | number = null;

  /**
   * @internal
   */
  @property({ type: Number })
  [FRAME_ATTRS_LIST.LIMIT]: null | number = null;
}
