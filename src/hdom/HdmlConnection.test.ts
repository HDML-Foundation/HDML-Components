/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { HdmlConnection } from "./HdmlConnection";
import { fixture, assert } from "@open-wc/testing";
import { html } from "lit/static-html.js";

suite("HdmlConnection element", () => {
  test("is defined", () => {
    const el = document.createElement("hdml-connection");
    assert.instanceOf(el, HdmlConnection);
  });

  test("renders without attributes", async () => {
    let counter = 0;
    let detail: undefined | HdmlConnection = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlConnection>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-connection></hdml-connection>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 1);
    assert.instanceOf(detail, HdmlConnection);
    assert.isNull(detail["name"]);
    assert.isNull(detail["type"]);
    assert.isNull(detail["description"]);
    assert.isNull(detail["ssl"]);
    assert.isNull(detail["host"]);
    assert.isNull(detail["port"]);
    assert.isNull(detail["user"]);
    assert.isNull(detail["password"]);
    assert.isNull(detail["project-id"]);
    assert.isNull(detail["credentials-key"]);
    assert.isNull(detail["sheet-id"]);
    assert.isNull(detail["region"]);
    assert.isNull(detail["access-key"]);
    assert.isNull(detail["secret-key"]);
    assert.isNull(detail["schema"]);
    assert.isNull(detail["account"]);
    assert.isNull(detail["warehouse"]);
    assert.isNull(detail["database"]);
    assert.isNull(detail["role"]);
  });

  test("renders with `name` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlConnection = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlConnection>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-connection name="name"></hdml-connection>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlConnection);
    assert.equal(detail["name"], "name");
    assert.isNull(detail["type"]);
    assert.isNull(detail["description"]);
    assert.isNull(detail["ssl"]);
    assert.isNull(detail["host"]);
    assert.isNull(detail["port"]);
    assert.isNull(detail["user"]);
    assert.isNull(detail["password"]);
    assert.isNull(detail["project-id"]);
    assert.isNull(detail["credentials-key"]);
    assert.isNull(detail["sheet-id"]);
    assert.isNull(detail["region"]);
    assert.isNull(detail["access-key"]);
    assert.isNull(detail["secret-key"]);
    assert.isNull(detail["schema"]);
    assert.isNull(detail["account"]);
    assert.isNull(detail["warehouse"]);
    assert.isNull(detail["database"]);
    assert.isNull(detail["role"]);
  });

  test("renders with `type` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlConnection = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlConnection>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-connection type="type"></hdml-connection>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlConnection);
    assert.isNull(detail["name"]);
    assert.equal(detail["type"], "type");
    assert.isNull(detail["description"]);
    assert.isNull(detail["ssl"]);
    assert.isNull(detail["host"]);
    assert.isNull(detail["port"]);
    assert.isNull(detail["user"]);
    assert.isNull(detail["password"]);
    assert.isNull(detail["project-id"]);
    assert.isNull(detail["credentials-key"]);
    assert.isNull(detail["sheet-id"]);
    assert.isNull(detail["region"]);
    assert.isNull(detail["access-key"]);
    assert.isNull(detail["secret-key"]);
    assert.isNull(detail["schema"]);
    assert.isNull(detail["account"]);
    assert.isNull(detail["warehouse"]);
    assert.isNull(detail["database"]);
    assert.isNull(detail["role"]);
  });

  test("renders with `description` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlConnection = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlConnection>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-connection
        description="description"
      ></hdml-connection>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlConnection);
    assert.isNull(detail["name"]);
    assert.isNull(detail["type"]);
    assert.equal(detail["description"], "description");
    assert.isNull(detail["ssl"]);
    assert.isNull(detail["host"]);
    assert.isNull(detail["port"]);
    assert.isNull(detail["user"]);
    assert.isNull(detail["password"]);
    assert.isNull(detail["project-id"]);
    assert.isNull(detail["credentials-key"]);
    assert.isNull(detail["sheet-id"]);
    assert.isNull(detail["region"]);
    assert.isNull(detail["access-key"]);
    assert.isNull(detail["secret-key"]);
    assert.isNull(detail["schema"]);
    assert.isNull(detail["account"]);
    assert.isNull(detail["warehouse"]);
    assert.isNull(detail["database"]);
    assert.isNull(detail["role"]);
  });

  test("renders with `ssl` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlConnection = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlConnection>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-connection ssl="ssl"></hdml-connection>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlConnection);
    assert.isNull(detail["name"]);
    assert.isNull(detail["type"]);
    assert.isNull(detail["description"]);
    assert.equal(detail["ssl"], "ssl");
    assert.isNull(detail["host"]);
    assert.isNull(detail["port"]);
    assert.isNull(detail["user"]);
    assert.isNull(detail["password"]);
    assert.isNull(detail["project-id"]);
    assert.isNull(detail["credentials-key"]);
    assert.isNull(detail["sheet-id"]);
    assert.isNull(detail["region"]);
    assert.isNull(detail["access-key"]);
    assert.isNull(detail["secret-key"]);
    assert.isNull(detail["schema"]);
    assert.isNull(detail["account"]);
    assert.isNull(detail["warehouse"]);
    assert.isNull(detail["database"]);
    assert.isNull(detail["role"]);
  });

  test("renders with `host` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlConnection = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlConnection>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-connection host="host"></hdml-connection>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlConnection);
    assert.isNull(detail["name"]);
    assert.isNull(detail["type"]);
    assert.isNull(detail["description"]);
    assert.isNull(detail["ssl"]);
    assert.equal(detail["host"], "host");
    assert.isNull(detail["port"]);
    assert.isNull(detail["user"]);
    assert.isNull(detail["password"]);
    assert.isNull(detail["project-id"]);
    assert.isNull(detail["credentials-key"]);
    assert.isNull(detail["sheet-id"]);
    assert.isNull(detail["region"]);
    assert.isNull(detail["access-key"]);
    assert.isNull(detail["secret-key"]);
    assert.isNull(detail["schema"]);
    assert.isNull(detail["account"]);
    assert.isNull(detail["warehouse"]);
    assert.isNull(detail["database"]);
    assert.isNull(detail["role"]);
  });

  test("renders with `port` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlConnection = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlConnection>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-connection port="port"></hdml-connection>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlConnection);
    assert.isNull(detail["name"]);
    assert.isNull(detail["type"]);
    assert.isNull(detail["description"]);
    assert.isNull(detail["ssl"]);
    assert.isNull(detail["host"]);
    assert.equal(detail["port"], "port");
    assert.isNull(detail["user"]);
    assert.isNull(detail["password"]);
    assert.isNull(detail["project-id"]);
    assert.isNull(detail["credentials-key"]);
    assert.isNull(detail["sheet-id"]);
    assert.isNull(detail["region"]);
    assert.isNull(detail["access-key"]);
    assert.isNull(detail["secret-key"]);
    assert.isNull(detail["schema"]);
    assert.isNull(detail["account"]);
    assert.isNull(detail["warehouse"]);
    assert.isNull(detail["database"]);
    assert.isNull(detail["role"]);
  });

  test("renders with `user` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlConnection = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlConnection>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-connection user="user"></hdml-connection>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlConnection);
    assert.isNull(detail["name"]);
    assert.isNull(detail["type"]);
    assert.isNull(detail["description"]);
    assert.isNull(detail["ssl"]);
    assert.isNull(detail["host"]);
    assert.isNull(detail["port"]);
    assert.equal(detail["user"], "user");
    assert.isNull(detail["password"]);
    assert.isNull(detail["project-id"]);
    assert.isNull(detail["credentials-key"]);
    assert.isNull(detail["sheet-id"]);
    assert.isNull(detail["region"]);
    assert.isNull(detail["access-key"]);
    assert.isNull(detail["secret-key"]);
    assert.isNull(detail["schema"]);
    assert.isNull(detail["account"]);
    assert.isNull(detail["warehouse"]);
    assert.isNull(detail["database"]);
    assert.isNull(detail["role"]);
  });

  test("renders with `password` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlConnection = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlConnection>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-connection password="password"></hdml-connection>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlConnection);
    assert.isNull(detail["name"]);
    assert.isNull(detail["type"]);
    assert.isNull(detail["description"]);
    assert.isNull(detail["ssl"]);
    assert.isNull(detail["host"]);
    assert.isNull(detail["port"]);
    assert.isNull(detail["user"]);
    assert.equal(detail["password"], "password");
    assert.isNull(detail["project-id"]);
    assert.isNull(detail["credentials-key"]);
    assert.isNull(detail["sheet-id"]);
    assert.isNull(detail["region"]);
    assert.isNull(detail["access-key"]);
    assert.isNull(detail["secret-key"]);
    assert.isNull(detail["schema"]);
    assert.isNull(detail["account"]);
    assert.isNull(detail["warehouse"]);
    assert.isNull(detail["database"]);
    assert.isNull(detail["role"]);
  });

  test("renders with `project-id` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlConnection = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlConnection>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-connection
        project-id="project-id"
      ></hdml-connection>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlConnection);
    assert.isNull(detail["name"]);
    assert.isNull(detail["type"]);
    assert.isNull(detail["description"]);
    assert.isNull(detail["ssl"]);
    assert.isNull(detail["host"]);
    assert.isNull(detail["port"]);
    assert.isNull(detail["user"]);
    assert.isNull(detail["password"]);
    assert.equal(detail["project-id"], "project-id");
    assert.isNull(detail["credentials-key"]);
    assert.isNull(detail["sheet-id"]);
    assert.isNull(detail["region"]);
    assert.isNull(detail["access-key"]);
    assert.isNull(detail["secret-key"]);
    assert.isNull(detail["schema"]);
    assert.isNull(detail["account"]);
    assert.isNull(detail["warehouse"]);
    assert.isNull(detail["database"]);
    assert.isNull(detail["role"]);
  });

  test("renders with `credentials-key` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlConnection = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlConnection>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-connection
        credentials-key="credentials-key"
      ></hdml-connection>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlConnection);
    assert.isNull(detail["name"]);
    assert.isNull(detail["type"]);
    assert.isNull(detail["description"]);
    assert.isNull(detail["ssl"]);
    assert.isNull(detail["host"]);
    assert.isNull(detail["port"]);
    assert.isNull(detail["user"]);
    assert.isNull(detail["password"]);
    assert.isNull(detail["project-id"]);
    assert.equal(detail["credentials-key"], "credentials-key");
    assert.isNull(detail["sheet-id"]);
    assert.isNull(detail["region"]);
    assert.isNull(detail["access-key"]);
    assert.isNull(detail["secret-key"]);
    assert.isNull(detail["schema"]);
    assert.isNull(detail["account"]);
    assert.isNull(detail["warehouse"]);
    assert.isNull(detail["database"]);
    assert.isNull(detail["role"]);
  });

  test("renders with `sheet-id` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlConnection = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlConnection>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-connection sheet-id="sheet-id"></hdml-connection>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlConnection);
    assert.isNull(detail["name"]);
    assert.isNull(detail["type"]);
    assert.isNull(detail["description"]);
    assert.isNull(detail["ssl"]);
    assert.isNull(detail["host"]);
    assert.isNull(detail["port"]);
    assert.isNull(detail["user"]);
    assert.isNull(detail["password"]);
    assert.isNull(detail["project-id"]);
    assert.isNull(detail["credentials-key"]);
    assert.equal(detail["sheet-id"], "sheet-id");
    assert.isNull(detail["region"]);
    assert.isNull(detail["access-key"]);
    assert.isNull(detail["secret-key"]);
    assert.isNull(detail["schema"]);
    assert.isNull(detail["account"]);
    assert.isNull(detail["warehouse"]);
    assert.isNull(detail["database"]);
    assert.isNull(detail["role"]);
  });

  test("renders with `region` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlConnection = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlConnection>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-connection region="region"></hdml-connection>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlConnection);
    assert.isNull(detail["name"]);
    assert.isNull(detail["type"]);
    assert.isNull(detail["description"]);
    assert.isNull(detail["ssl"]);
    assert.isNull(detail["host"]);
    assert.isNull(detail["port"]);
    assert.isNull(detail["user"]);
    assert.isNull(detail["password"]);
    assert.isNull(detail["project-id"]);
    assert.isNull(detail["credentials-key"]);
    assert.isNull(detail["sheet-id"]);
    assert.equal(detail["region"], "region");
    assert.isNull(detail["access-key"]);
    assert.isNull(detail["secret-key"]);
    assert.isNull(detail["schema"]);
    assert.isNull(detail["account"]);
    assert.isNull(detail["warehouse"]);
    assert.isNull(detail["database"]);
    assert.isNull(detail["role"]);
  });

  test("renders with `access-key` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlConnection = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlConnection>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-connection
        access-key="access-key"
      ></hdml-connection>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlConnection);
    assert.isNull(detail["name"]);
    assert.isNull(detail["type"]);
    assert.isNull(detail["description"]);
    assert.isNull(detail["ssl"]);
    assert.isNull(detail["host"]);
    assert.isNull(detail["port"]);
    assert.isNull(detail["user"]);
    assert.isNull(detail["password"]);
    assert.isNull(detail["project-id"]);
    assert.isNull(detail["credentials-key"]);
    assert.isNull(detail["sheet-id"]);
    assert.isNull(detail["region"]);
    assert.equal(detail["access-key"], "access-key");
    assert.isNull(detail["secret-key"]);
    assert.isNull(detail["schema"]);
    assert.isNull(detail["account"]);
    assert.isNull(detail["warehouse"]);
    assert.isNull(detail["database"]);
    assert.isNull(detail["role"]);
  });

  test("renders with `secret-key` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlConnection = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlConnection>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-connection
        secret-key="secret-key"
      ></hdml-connection>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlConnection);
    assert.isNull(detail["name"]);
    assert.isNull(detail["type"]);
    assert.isNull(detail["description"]);
    assert.isNull(detail["ssl"]);
    assert.isNull(detail["host"]);
    assert.isNull(detail["port"]);
    assert.isNull(detail["user"]);
    assert.isNull(detail["password"]);
    assert.isNull(detail["project-id"]);
    assert.isNull(detail["credentials-key"]);
    assert.isNull(detail["sheet-id"]);
    assert.isNull(detail["region"]);
    assert.isNull(detail["access-key"]);
    assert.equal(detail["secret-key"], "secret-key");
    assert.isNull(detail["schema"]);
    assert.isNull(detail["account"]);
    assert.isNull(detail["warehouse"]);
    assert.isNull(detail["database"]);
    assert.isNull(detail["role"]);
  });

  test("renders with `schema` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlConnection = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlConnection>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-connection schema="schema"></hdml-connection>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlConnection);
    assert.isNull(detail["name"]);
    assert.isNull(detail["type"]);
    assert.isNull(detail["description"]);
    assert.isNull(detail["ssl"]);
    assert.isNull(detail["host"]);
    assert.isNull(detail["port"]);
    assert.isNull(detail["user"]);
    assert.isNull(detail["password"]);
    assert.isNull(detail["project-id"]);
    assert.isNull(detail["credentials-key"]);
    assert.isNull(detail["sheet-id"]);
    assert.isNull(detail["region"]);
    assert.isNull(detail["access-key"]);
    assert.isNull(detail["secret-key"]);
    assert.equal(detail["schema"], "schema");
    assert.isNull(detail["account"]);
    assert.isNull(detail["warehouse"]);
    assert.isNull(detail["database"]);
    assert.isNull(detail["role"]);
  });

  test("renders with `account` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlConnection = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlConnection>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-connection account="account"></hdml-connection>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlConnection);
    assert.isNull(detail["name"]);
    assert.isNull(detail["type"]);
    assert.isNull(detail["description"]);
    assert.isNull(detail["ssl"]);
    assert.isNull(detail["host"]);
    assert.isNull(detail["port"]);
    assert.isNull(detail["user"]);
    assert.isNull(detail["password"]);
    assert.isNull(detail["project-id"]);
    assert.isNull(detail["credentials-key"]);
    assert.isNull(detail["sheet-id"]);
    assert.isNull(detail["region"]);
    assert.isNull(detail["access-key"]);
    assert.isNull(detail["secret-key"]);
    assert.isNull(detail["schema"]);
    assert.equal(detail["account"], "account");
    assert.isNull(detail["warehouse"]);
    assert.isNull(detail["database"]);
    assert.isNull(detail["role"]);
  });

  test("renders with `warehouse` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlConnection = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlConnection>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-connection warehouse="warehouse"></hdml-connection>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlConnection);
    assert.isNull(detail["name"]);
    assert.isNull(detail["type"]);
    assert.isNull(detail["description"]);
    assert.isNull(detail["ssl"]);
    assert.isNull(detail["host"]);
    assert.isNull(detail["port"]);
    assert.isNull(detail["user"]);
    assert.isNull(detail["password"]);
    assert.isNull(detail["project-id"]);
    assert.isNull(detail["credentials-key"]);
    assert.isNull(detail["sheet-id"]);
    assert.isNull(detail["region"]);
    assert.isNull(detail["access-key"]);
    assert.isNull(detail["secret-key"]);
    assert.isNull(detail["schema"]);
    assert.isNull(detail["account"]);
    assert.equal(detail["warehouse"], "warehouse");
    assert.isNull(detail["database"]);
    assert.isNull(detail["role"]);
  });

  test("renders with `database` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlConnection = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlConnection>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-connection database="database"></hdml-connection>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlConnection);
    assert.isNull(detail["name"]);
    assert.isNull(detail["type"]);
    assert.isNull(detail["description"]);
    assert.isNull(detail["ssl"]);
    assert.isNull(detail["host"]);
    assert.isNull(detail["port"]);
    assert.isNull(detail["user"]);
    assert.isNull(detail["password"]);
    assert.isNull(detail["project-id"]);
    assert.isNull(detail["credentials-key"]);
    assert.isNull(detail["sheet-id"]);
    assert.isNull(detail["region"]);
    assert.isNull(detail["access-key"]);
    assert.isNull(detail["secret-key"]);
    assert.isNull(detail["schema"]);
    assert.isNull(detail["account"]);
    assert.isNull(detail["warehouse"]);
    assert.equal(detail["database"], "database");
    assert.isNull(detail["role"]);
  });

  test("renders with `role` attribute", async () => {
    let counter = 0;
    let detail: undefined | HdmlConnection = undefined;

    document.addEventListener("hdom-changed", (evt) => {
      counter++;
      const event = <CustomEvent<HdmlConnection>>evt;
      detail = event.detail;
    });

    const element = await fixture(
      html`<hdml-connection role="switch"></hdml-connection>`,
    );

    await assert.shadowDom.equal(element, "<slot></slot>");
    assert.equal(counter, 2);
    assert.instanceOf(detail, HdmlConnection);
    assert.isNull(detail["name"]);
    assert.isNull(detail["type"]);
    assert.isNull(detail["description"]);
    assert.isNull(detail["ssl"]);
    assert.isNull(detail["host"]);
    assert.isNull(detail["port"]);
    assert.isNull(detail["user"]);
    assert.isNull(detail["password"]);
    assert.isNull(detail["project-id"]);
    assert.isNull(detail["credentials-key"]);
    assert.isNull(detail["sheet-id"]);
    assert.isNull(detail["region"]);
    assert.isNull(detail["access-key"]);
    assert.isNull(detail["secret-key"]);
    assert.isNull(detail["schema"]);
    assert.isNull(detail["account"]);
    assert.isNull(detail["warehouse"]);
    assert.isNull(detail["database"]);
    assert.equal(detail["role"], "switch");
  });
});
