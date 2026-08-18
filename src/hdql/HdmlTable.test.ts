/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { HdmlTable } from "./HdmlTable";
import { fixture, assert } from "@open-wc/testing";
import { html } from "lit/static-html.js";

suite("HdmlTable element", () => {
  test("is defined", () => {
    const el = document.createElement("hdml-table");
    assert.instanceOf(el, HdmlTable);
  });

  test("renders without attributes", async () => {
    let counter = 0;
    let detail: undefined | HdmlTable = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlTable>>evt;
      detail = event.detail;
    });

    const element = await fixture(html`<hdml-table></hdml-table>`);

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 1);
    assert.instanceOf(detail, HdmlTable);
    assert.isNull(detail["name"]);
    assert.isNull(detail["type"]);
    assert.isNull(detail["identifier"]);
    assert.isNull(detail["description"]);
  });

  test("renders with `name` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlTable = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlTable>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-table name="name"></hdml-table>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlTable);
    assert.equal(detail["name"], "name");
    assert.isNull(detail["type"]);
    assert.isNull(detail["identifier"]);
    assert.isNull(detail["description"]);
  });

  test("renders with `type` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlTable = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlTable>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-table type="type"></hdml-table>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlTable);
    assert.isNull(detail["name"]);
    assert.equal(detail["type"], "type");
    assert.isNull(detail["identifier"]);
    assert.isNull(detail["description"]);
  });

  test("renders with `identifier` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlTable = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlTable>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-table identifier="identifier"></hdml-table>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlTable);
    assert.isNull(detail["name"]);
    assert.isNull(detail["type"]);
    assert.equal(detail["identifier"], "identifier");
    assert.isNull(detail["description"]);
  });

  test("renders with `description` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlTable = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlTable>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-table description="description"></hdml-table>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlTable);
    assert.isNull(detail["name"]);
    assert.isNull(detail["type"]);
    assert.isNull(detail["identifier"]);
    assert.equal(detail["description"], "description");
  });
});
