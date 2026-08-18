/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { HdmlJoin } from "./HdmlJoin";
import { fixture, assert } from "@open-wc/testing";
import { html } from "lit/static-html.js";

suite("HdmlJoin element", () => {
  test("is defined", () => {
    const el = document.createElement("hdml-join");
    assert.instanceOf(el, HdmlJoin);
  });

  test("renders without attributes", async () => {
    let counter = 0;
    let detail: undefined | HdmlJoin = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlJoin>>evt;
      detail = event.detail;
    });

    const element = await fixture(html`<hdml-join></hdml-join>`);

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 1);
    assert.instanceOf(detail, HdmlJoin);
    assert.isNull(detail["type"]);
    assert.isNull(detail["left"]);
    assert.isNull(detail["right"]);
    assert.isNull(detail["description"]);
  });

  test("renders with `type` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlJoin = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlJoin>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-join type="type"></hdml-join>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlJoin);
    assert.equal(detail["type"], "type");
    assert.isNull(detail["left"]);
    assert.isNull(detail["right"]);
    assert.isNull(detail["description"]);
  });

  test("renders with `left` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlJoin = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlJoin>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-join left="left"></hdml-join>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlJoin);
    assert.isNull(detail["type"]);
    assert.equal(detail["left"], "left");
    assert.isNull(detail["right"]);
    assert.isNull(detail["description"]);
  });

  test("renders with `right` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlJoin = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlJoin>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-join right="right"></hdml-join>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlJoin);
    assert.isNull(detail["type"]);
    assert.isNull(detail["left"]);
    assert.equal(detail["right"], "right");
    assert.isNull(detail["description"]);
  });

  test("renders with `description` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlJoin = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlJoin>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-join description="description"></hdml-join>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlJoin);
    assert.isNull(detail["type"]);
    assert.isNull(detail["left"]);
    assert.isNull(detail["right"]);
    assert.equal(detail["description"], "description");
  });
});
