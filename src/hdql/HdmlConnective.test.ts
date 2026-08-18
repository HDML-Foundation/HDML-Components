/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { HdmlConnective } from "./HdmlConnective";
import { fixture, assert } from "@open-wc/testing";
import { html } from "lit/static-html.js";

suite("HdmlConnective element", () => {
  test("is defined", () => {
    const el = document.createElement("hdml-connective");
    assert.instanceOf(el, HdmlConnective);
  });

  test("renders without attributes", async () => {
    let counter = 0;
    let detail: undefined | HdmlConnective = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlConnective>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-connective></hdml-connective>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 1);
    assert.instanceOf(detail, HdmlConnective);
    assert.isNull(detail["operator"]);
  });

  test("renders with `operator` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlConnective = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlConnective>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-connective operator="operator"></hdml-connective>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlConnective);
    assert.equal(detail["operator"], "operator");
  });
});
