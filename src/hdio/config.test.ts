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
    assert.equal(cfg.goneEvent, "hdml-io-gone");
    assert.isFalse(cfg.paranoidObserver);
  });

  test("honours window.HDML_CONFIG overrides", () => {
    window.HDML_CONFIG = {
      queryReadyTimeout: 500,
      readyEvent: "x-ready",
      requestEvent: "x-request",
      goneEvent: "x-gone",
      paranoidObserver: true,
    };
    const cfg = readConfig();
    assert.equal(cfg.queryReadyTimeout, 500);
    assert.equal(cfg.readyEvent, "x-ready");
    assert.equal(cfg.requestEvent, "x-request");
    assert.equal(cfg.goneEvent, "x-gone");
    assert.isTrue(cfg.paranoidObserver);
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
    window.HDML_CONFIG = {
      readyEvent: "",
      requestEvent: "",
      goneEvent: "",
    };
    const cfg = readConfig();
    assert.equal(cfg.readyEvent, "hdml-io-ready");
    assert.equal(cfg.requestEvent, "hdml-io-request");
    assert.equal(cfg.goneEvent, "hdml-io-gone");
  });

  test("a non-boolean paranoidObserver reads false", () => {
    // The string keys fall back through `||`, which would take the
    // TRUTHY string "false" for `true`. The boolean is read
    // `=== true`, so any non-`true` value — a host's "false", a 1, a
    // null — is false.
    window.HDML_CONFIG = {};
    const loose = window.HDML_CONFIG as Record<string, unknown>;
    loose.paranoidObserver = "false";
    assert.isFalse(readConfig().paranoidObserver);
    loose.paranoidObserver = 1;
    assert.isFalse(readConfig().paranoidObserver);
    loose.paranoidObserver = true;
    assert.isTrue(readConfig().paranoidObserver);
  });
});
