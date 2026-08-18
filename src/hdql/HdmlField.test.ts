/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { HdmlField } from "./HdmlField";
import { fixture, assert } from "@open-wc/testing";
import { html } from "lit/static-html.js";

suite("HdmlField element", () => {
  test("is defined", () => {
    const el = document.createElement("hdml-field");
    assert.instanceOf(el, HdmlField);
  });

  test("renders without attributes", async () => {
    let counter = 0;
    let detail: undefined | HdmlField = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlField>>evt;
      detail = event.detail;
    });

    const element = await fixture(html`<hdml-field></hdml-field>`);

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 1);
    assert.instanceOf(detail, HdmlField);
    assert.isNull(detail["name"]);
    assert.isNull(detail["description"]);
    assert.isNull(detail["origin"]);
    assert.isNull(detail["clause"]);
    assert.isNull(detail["type"]);
    assert.isNull(detail["aggregation"]);
    assert.isNull(detail["order"]);
    assert.isNull(detail["scale"]);
    assert.isNull(detail["precision"]);
    assert.isNull(detail["unit"]);
    assert.isNull(detail["timezone"]);
  });

  test("renders with `name` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlField = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlField>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-field name="name"></hdml-field>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlField);
    assert.equal(detail["name"], "name");
    assert.isNull(detail["description"]);
    assert.isNull(detail["origin"]);
    assert.isNull(detail["clause"]);
    assert.isNull(detail["type"]);
    assert.isNull(detail["aggregation"]);
    assert.isNull(detail["order"]);
    assert.isNull(detail["scale"]);
    assert.isNull(detail["precision"]);
    assert.isNull(detail["unit"]);
    assert.isNull(detail["timezone"]);
  });

  test("renders with `description` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlField = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlField>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-field description="description"></hdml-field>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlField);
    assert.isNull(detail["name"]);
    assert.equal(detail["description"], "description");
    assert.isNull(detail["origin"]);
    assert.isNull(detail["clause"]);
    assert.isNull(detail["type"]);
    assert.isNull(detail["aggregation"]);
    assert.isNull(detail["order"]);
    assert.isNull(detail["scale"]);
    assert.isNull(detail["precision"]);
    assert.isNull(detail["unit"]);
    assert.isNull(detail["timezone"]);
  });

  test("renders with `origin` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlField = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlField>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-field origin="origin"></hdml-field>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlField);
    assert.isNull(detail["name"]);
    assert.isNull(detail["description"]);
    assert.equal(detail["origin"], "origin");
    assert.isNull(detail["clause"]);
    assert.isNull(detail["type"]);
    assert.isNull(detail["aggregation"]);
    assert.isNull(detail["order"]);
    assert.isNull(detail["scale"]);
    assert.isNull(detail["precision"]);
    assert.isNull(detail["unit"]);
    assert.isNull(detail["timezone"]);
  });

  test("renders with `clause` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlField = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlField>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-field clause="clause"></hdml-field>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlField);
    assert.isNull(detail["name"]);
    assert.isNull(detail["description"]);
    assert.isNull(detail["origin"]);
    assert.equal(detail["clause"], "clause");
    assert.isNull(detail["type"]);
    assert.isNull(detail["aggregation"]);
    assert.isNull(detail["order"]);
    assert.isNull(detail["scale"]);
    assert.isNull(detail["precision"]);
    assert.isNull(detail["unit"]);
    assert.isNull(detail["timezone"]);
  });

  test("renders with `type` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlField = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlField>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-field type="type"></hdml-field>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlField);
    assert.isNull(detail["name"]);
    assert.isNull(detail["description"]);
    assert.isNull(detail["origin"]);
    assert.isNull(detail["clause"]);
    assert.equal(detail["type"], "type");
    assert.isNull(detail["aggregation"]);
    assert.isNull(detail["order"]);
    assert.isNull(detail["scale"]);
    assert.isNull(detail["precision"]);
    assert.isNull(detail["unit"]);
    assert.isNull(detail["timezone"]);
  });

  test("renders with `aggregation` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlField = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlField>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-field aggregation="aggregation"></hdml-field>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlField);
    assert.isNull(detail["name"]);
    assert.isNull(detail["description"]);
    assert.isNull(detail["origin"]);
    assert.isNull(detail["clause"]);
    assert.isNull(detail["type"]);
    assert.equal(detail["aggregation"], "aggregation");
    assert.isNull(detail["order"]);
    assert.isNull(detail["scale"]);
    assert.isNull(detail["precision"]);
    assert.isNull(detail["unit"]);
    assert.isNull(detail["timezone"]);
  });

  test("renders with `order` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlField = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlField>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-field order="order"></hdml-field>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlField);
    assert.isNull(detail["name"]);
    assert.isNull(detail["description"]);
    assert.isNull(detail["origin"]);
    assert.isNull(detail["clause"]);
    assert.isNull(detail["type"]);
    assert.isNull(detail["aggregation"]);
    assert.equal(detail["order"], "order");
    assert.isNull(detail["scale"]);
    assert.isNull(detail["precision"]);
    assert.isNull(detail["unit"]);
    assert.isNull(detail["timezone"]);
  });

  test("renders with `scale` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlField = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlField>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-field scale="scale"></hdml-field>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlField);
    assert.isNull(detail["name"]);
    assert.isNull(detail["description"]);
    assert.isNull(detail["origin"]);
    assert.isNull(detail["clause"]);
    assert.isNull(detail["type"]);
    assert.isNull(detail["aggregation"]);
    assert.isNull(detail["order"]);
    assert.equal(detail["scale"], "scale");
    assert.isNull(detail["precision"]);
    assert.isNull(detail["unit"]);
    assert.isNull(detail["timezone"]);
  });

  test("renders with `precision` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlField = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlField>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-field precision="precision"></hdml-field>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlField);
    assert.isNull(detail["name"]);
    assert.isNull(detail["description"]);
    assert.isNull(detail["origin"]);
    assert.isNull(detail["clause"]);
    assert.isNull(detail["type"]);
    assert.isNull(detail["aggregation"]);
    assert.isNull(detail["order"]);
    assert.isNull(detail["scale"]);
    assert.equal(detail["precision"], "precision");
    assert.isNull(detail["unit"]);
    assert.isNull(detail["timezone"]);
  });

  test("renders with `unit` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlField = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlField>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-field unit="unit"></hdml-field>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlField);
    assert.isNull(detail["name"]);
    assert.isNull(detail["description"]);
    assert.isNull(detail["origin"]);
    assert.isNull(detail["clause"]);
    assert.isNull(detail["type"]);
    assert.isNull(detail["aggregation"]);
    assert.isNull(detail["order"]);
    assert.isNull(detail["scale"]);
    assert.isNull(detail["precision"]);
    assert.equal(detail["unit"], "unit");
    assert.isNull(detail["timezone"]);
  });

  test("renders with `timezone` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlField = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlField>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-field timezone="timezone"></hdml-field>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlField);
    assert.isNull(detail["name"]);
    assert.isNull(detail["description"]);
    assert.isNull(detail["origin"]);
    assert.isNull(detail["clause"]);
    assert.isNull(detail["type"]);
    assert.isNull(detail["aggregation"]);
    assert.isNull(detail["order"]);
    assert.isNull(detail["scale"]);
    assert.isNull(detail["precision"]);
    assert.isNull(detail["unit"]);
    assert.equal(detail["timezone"], "timezone");
  });
});
