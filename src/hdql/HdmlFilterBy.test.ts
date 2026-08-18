/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { HdmlFilterBy } from "./HdmlFilterBy";
import { fixture, assert } from "@open-wc/testing";
import { html } from "lit/static-html.js";

suite("HdmlFilterBy element", () => {
  test("is defined", () => {
    const el = document.createElement("hdml-filter-by");
    assert.instanceOf(el, HdmlFilterBy);
  });

  test("renders without attributes", async () => {
    let counter = 0;
    let detail: undefined | HdmlFilterBy = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlFilterBy>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-filter-by></hdml-filter-by>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 1);
    assert.instanceOf(detail, HdmlFilterBy);
  });
});
