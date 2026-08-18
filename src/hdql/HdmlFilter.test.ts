/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { HdmlFilter } from "./HdmlFilter";
import { fixture, assert } from "@open-wc/testing";
import { html } from "lit/static-html.js";

suite("HdmlFilter element", () => {
  test("is defined", () => {
    const el = document.createElement("hdml-filter");
    assert.instanceOf(el, HdmlFilter);
  });

  test("renders without attributes", async () => {
    let counter = 0;
    let detail: undefined | HdmlFilter = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlFilter>>evt;
      detail = event.detail;
    });

    const element = await fixture(html`<hdml-filter></hdml-filter>`);

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 1);
    assert.instanceOf(detail, HdmlFilter);
    assert.isNull(detail["type"]);
    assert.isNull(detail["left"]);
    assert.isNull(detail["right"]);
    assert.isNull(detail["clause"]);
    assert.isNull(detail["name"]);
    assert.isNull(detail["field"]);
    assert.isNull(detail["values"]);
  });

  test("renders with `type` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlFilter = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlFilter>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-filter type="type"></hdml-filter>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlFilter);
    assert.equal(detail["type"], "type");
    assert.isNull(detail["left"]);
    assert.isNull(detail["right"]);
    assert.isNull(detail["clause"]);
    assert.isNull(detail["name"]);
    assert.isNull(detail["field"]);
    assert.isNull(detail["values"]);
  });

  test("renders with `left` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlFilter = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlFilter>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-filter left="left"></hdml-filter>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlFilter);
    assert.isNull(detail["type"]);
    assert.equal(detail["left"], "left");
    assert.isNull(detail["right"]);
    assert.isNull(detail["clause"]);
    assert.isNull(detail["name"]);
    assert.isNull(detail["field"]);
    assert.isNull(detail["values"]);
  });

  test("renders with `right` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlFilter = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlFilter>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-filter right="right"></hdml-filter>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlFilter);
    assert.isNull(detail["type"]);
    assert.isNull(detail["left"]);
    assert.equal(detail["right"], "right");
    assert.isNull(detail["clause"]);
    assert.isNull(detail["name"]);
    assert.isNull(detail["field"]);
    assert.isNull(detail["values"]);
  });

  test("renders with `clause` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlFilter = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlFilter>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-filter clause="clause"></hdml-filter>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlFilter);
    assert.isNull(detail["type"]);
    assert.isNull(detail["left"]);
    assert.isNull(detail["right"]);
    assert.equal(detail["clause"], "clause");
    assert.isNull(detail["name"]);
    assert.isNull(detail["field"]);
    assert.isNull(detail["values"]);
  });

  test("renders with `name` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlFilter = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlFilter>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-filter name="name"></hdml-filter>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlFilter);
    assert.isNull(detail["type"]);
    assert.isNull(detail["left"]);
    assert.isNull(detail["right"]);
    assert.isNull(detail["clause"]);
    assert.equal(detail["name"], "name");
    assert.isNull(detail["field"]);
    assert.isNull(detail["values"]);
  });

  test("renders with `field` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlFilter = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlFilter>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-filter field="field"></hdml-filter>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlFilter);
    assert.isNull(detail["type"]);
    assert.isNull(detail["left"]);
    assert.isNull(detail["right"]);
    assert.isNull(detail["clause"]);
    assert.isNull(detail["name"]);
    assert.equal(detail["field"], "field");
    assert.isNull(detail["values"]);
  });

  test("renders with `values` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlFilter = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlFilter>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-filter values="values"></hdml-filter>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlFilter);
    assert.isNull(detail["type"]);
    assert.isNull(detail["left"]);
    assert.isNull(detail["right"]);
    assert.isNull(detail["clause"]);
    assert.isNull(detail["name"]);
    assert.isNull(detail["field"]);
    assert.equal(detail["values"], "values");
  });
});
