/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { HdmlSortBy } from "./HdmlSortBy";
import { fixture, assert } from "@open-wc/testing";
import { html } from "lit/static-html.js";

suite("HdmlSortBy element", () => {
  test("is defined", () => {
    const el = document.createElement("hdml-sort-by");
    assert.instanceOf(el, HdmlSortBy);
  });

  test("renders without attributes", async () => {
    let counter = 0;
    let detail: undefined | HdmlSortBy = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlSortBy>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-sort-by></hdml-sort-by>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 1);
    assert.instanceOf(detail, HdmlSortBy);
  });
});
