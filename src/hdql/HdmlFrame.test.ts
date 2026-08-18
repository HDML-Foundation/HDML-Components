/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { HdmlFrame } from "./HdmlFrame";
import { fixture, assert } from "@open-wc/testing";
import { html } from "lit/static-html.js";

suite("HdmlFrame element", () => {
  test("is defined", () => {
    const el = document.createElement("hdml-frame");
    assert.instanceOf(el, HdmlFrame);
  });

  test("renders without attributes", async () => {
    let counter = 0;
    let detail: undefined | HdmlFrame = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlFrame>>evt;
      detail = event.detail;
    });

    const element = await fixture(html`<hdml-frame></hdml-frame>`);

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 1);
    assert.instanceOf(detail, HdmlFrame);
    assert.isNull(detail["name"]);
    assert.isNull(detail["description"]);
    assert.isNull(detail["source"]);
    assert.isNull(detail["offset"]);
    assert.isNull(detail["limit"]);
  });

  test("renders with `name` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlFrame = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlFrame>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-frame name="name"></hdml-frame>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlFrame);
    assert.equal(detail["name"], "name");
    assert.isNull(detail["description"]);
    assert.isNull(detail["source"]);
    assert.isNull(detail["offset"]);
    assert.isNull(detail["limit"]);
  });

  test("renders with `description` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlFrame = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlFrame>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-frame description="description"></hdml-frame>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlFrame);
    assert.isNull(detail["name"]);
    assert.equal(detail["description"], "description");
    assert.isNull(detail["source"]);
    assert.isNull(detail["offset"]);
    assert.isNull(detail["limit"]);
  });

  test("renders with `source` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlFrame = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlFrame>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-frame source="source"></hdml-frame>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlFrame);
    assert.isNull(detail["name"]);
    assert.isNull(detail["description"]);
    assert.equal(detail["source"], "source");
    assert.isNull(detail["offset"]);
    assert.isNull(detail["limit"]);
  });

  test("renders with `offset` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlFrame = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlFrame>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-frame offset="0"></hdml-frame>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlFrame);
    assert.isNull(detail["name"]);
    assert.isNull(detail["description"]);
    assert.isNull(detail["source"]);
    assert.equal(detail["offset"], 0);
    assert.isNull(detail["limit"]);
  });

  test("renders with `limit` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlFrame = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlFrame>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-frame limit="5000"></hdml-frame>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlFrame);
    assert.isNull(detail["name"]);
    assert.isNull(detail["description"]);
    assert.isNull(detail["source"]);
    assert.isNull(detail["offset"]);
    assert.equal(detail["limit"], 5000);
  });
});
