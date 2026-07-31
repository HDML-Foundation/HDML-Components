/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import { readConfig } from "./config";

suite("readConfig", () => {
  teardown(() => {
    delete window.HDML_CONFIG;
  });

  test("applies the settled defaults when unset", () => {
    delete window.HDML_CONFIG;
    const cfg = readConfig();
    assert.equal(cfg.queryReadyTimeout, 10000);
    assert.equal(cfg.readyEvent, "hdml-io-ready");
    assert.equal(cfg.requestEvent, "hdml-io-request");
  });

  test("honours window.HDML_CONFIG overrides", () => {
    window.HDML_CONFIG = {
      queryReadyTimeout: 500,
      readyEvent: "x-ready",
      requestEvent: "x-request",
    };
    const cfg = readConfig();
    assert.equal(cfg.queryReadyTimeout, 500);
    assert.equal(cfg.readyEvent, "x-ready");
    assert.equal(cfg.requestEvent, "x-request");
  });

  test("a partial config keeps the other defaults", () => {
    window.HDML_CONFIG = { queryReadyTimeout: 500 };
    const cfg = readConfig();
    assert.equal(cfg.queryReadyTimeout, 500);
    assert.equal(cfg.readyEvent, "hdml-io-ready");
    assert.equal(cfg.requestEvent, "hdml-io-request");
  });

  test("an invalid timeout falls back to the default", () => {
    window.HDML_CONFIG = { queryReadyTimeout: -5 };
    assert.equal(readConfig().queryReadyTimeout, 10000);
    window.HDML_CONFIG = { queryReadyTimeout: 0 };
    assert.equal(readConfig().queryReadyTimeout, 10000);
  });

  test("an empty event name falls back to the default", () => {
    window.HDML_CONFIG = { readyEvent: "", requestEvent: "" };
    const cfg = readConfig();
    assert.equal(cfg.readyEvent, "hdml-io-ready");
    assert.equal(cfg.requestEvent, "hdml-io-request");
  });
});
