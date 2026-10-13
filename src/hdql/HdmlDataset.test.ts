/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { HdmlDataset } from "./HdmlDataset";
import { fixture, assert } from "@open-wc/testing";
import { html } from "lit/static-html.js";

suite("HdmlDataset element", () => {
  test("is defined", () => {
    const el = document.createElement("hdml-dataset");
    assert.instanceOf(el, HdmlDataset);
  });

  test("renders without attributes", async () => {
    let counter = 0;
    let detail: undefined | HdmlDataset = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlDataset>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-dataset></hdml-dataset>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 1);
    assert.instanceOf(detail, HdmlDataset);
    assert.isNull(detail["name"]);
    assert.isNull(detail["type"]);
    assert.isNull(detail["identifier"]);
    assert.isNull(detail["description"]);
  });

  test("renders with `name` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlDataset = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlDataset>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-dataset name="name"></hdml-dataset>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlDataset);
    assert.equal(detail["name"], "name");
    assert.isNull(detail["type"]);
    assert.isNull(detail["identifier"]);
    assert.isNull(detail["description"]);
  });

  test("renders with `type` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlDataset = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlDataset>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-dataset type="type"></hdml-dataset>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlDataset);
    assert.isNull(detail["name"]);
    assert.equal(detail["type"], "type");
    assert.isNull(detail["identifier"]);
    assert.isNull(detail["description"]);
  });

  test("renders with `identifier` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlDataset = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlDataset>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-dataset identifier="identifier"></hdml-dataset>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlDataset);
    assert.isNull(detail["name"]);
    assert.isNull(detail["type"]);
    assert.equal(detail["identifier"], "identifier");
    assert.isNull(detail["description"]);
  });

  test("renders with `description` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlDataset = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlDataset>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-dataset description="description"></hdml-dataset>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlDataset);
    assert.isNull(detail["name"]);
    assert.isNull(detail["type"]);
    assert.isNull(detail["identifier"]);
    assert.equal(detail["description"], "description");
  });
});
