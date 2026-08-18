/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { HdmlModel } from "./HdmlModel";
import { fixture, assert } from "@open-wc/testing";
import { html } from "lit/static-html.js";

suite("HdmlModel element", () => {
  test("is defined", () => {
    const el = document.createElement("hdml-model");
    assert.instanceOf(el, HdmlModel);
  });

  test("renders without attributes", async () => {
    let counter = 0;
    let detail: undefined | HdmlModel = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlModel>>evt;
      detail = event.detail;
    });

    const element = await fixture(html`<hdml-model></hdml-model>`);

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 1);
    assert.instanceOf(detail, HdmlModel);
    assert.isNull(detail["name"]);
    assert.isNull(detail["description"]);
  });

  test("renders with `name` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlModel = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlModel>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-model name="name"></hdml-model>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlModel);
    assert.equal(detail["name"], "name");
    assert.isNull(detail["description"]);
  });

  test("renders with `description` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlModel = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlModel>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-model description="description"></hdml-model>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlModel);
    assert.isNull(detail["name"]);
    assert.equal(detail["description"], "description");
  });
});
