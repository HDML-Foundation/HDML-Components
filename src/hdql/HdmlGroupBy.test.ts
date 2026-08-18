/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { HdmlGroupBy } from "./HdmlGroupBy";
import { fixture, assert } from "@open-wc/testing";
import { html } from "lit/static-html.js";

suite("HdmlGroupBy element", () => {
  test("is defined", () => {
    const el = document.createElement("hdml-group-by");
    assert.instanceOf(el, HdmlGroupBy);
  });

  test("renders without attributes", async () => {
    let counter = 0;
    let detail: undefined | HdmlGroupBy = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlGroupBy>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-group-by></hdml-group-by>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 1);
    assert.instanceOf(detail, HdmlGroupBy);
  });
});
