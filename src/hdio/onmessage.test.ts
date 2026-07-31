/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import { createHandler } from "./onmessage";
import type { Post } from "./onmessage";
import { HdioClient } from "./HdioClient";

const origClose = HdioClient.prototype.close;
const origPostDocument = HdioClient.prototype.postDocument;
const origRedeem = HdioClient.prototype.redeemHandoff;

function propsEvent(
  host = "",
  tenant = "",
  token = "",
): MessageEvent {
  return new MessageEvent("message", {
    data: { type: "props", data: { host, tenant, token } },
  });
}

function htmlEvent(html: string): MessageEvent {
  return new MessageEvent("message", {
    data: { type: "html", data: { html } },
  });
}

const tick = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

suite("hdio createHandler", () => {
  teardown(() => {
    HdioClient.prototype.close = origClose;
    HdioClient.prototype.postDocument = origPostDocument;
    HdioClient.prototype.redeemHandoff = origRedeem;
  });

  test("props constructs a client; a second props closes it", () => {
    let closeCount = 0;
    HdioClient.prototype.close = function () {
      closeCount++;
    };
    let postCalls = 0;
    const post: Post = () => {
      postCalls++;
    };
    const handle = createHandler(post);
    handle(propsEvent());
    handle(propsEvent());
    assert.equal(closeCount, 1);
    assert.equal(postCalls, 0);
  });

  test("html parses and posts the document; sink untouched", () => {
    let postDocCount = 0;
    HdioClient.prototype.postDocument = function () {
      postDocCount++;
      return Promise.resolve({ stored: [], ddl: [] });
    };
    let postCalls = 0;
    const handle = createHandler(() => {
      postCalls++;
    });
    handle(propsEvent());
    handle(htmlEvent(""));
    assert.equal(postDocCount, 1);
    assert.equal(postCalls, 0);
  });

  test("handlers keep separate client state", () => {
    let postDocCount = 0;
    HdioClient.prototype.postDocument = function () {
      postDocCount++;
      return Promise.resolve({ stored: [], ddl: [] });
    };
    const handleA = createHandler(() => undefined);
    const handleB = createHandler(() => undefined);
    handleA(propsEvent());
    // B never got props, so its closure client is null — an html
    // must not reach A's client (no module-global bleed).
    handleB(htmlEvent(""));
    assert.equal(postDocCount, 0);
    handleB(propsEvent());
    handleB(htmlEvent(""));
    assert.equal(postDocCount, 1);
  });

  test("redeem once per distinct handoff code", async () => {
    let redeemCount = 0;
    HdioClient.prototype.redeemHandoff = function () {
      redeemCount++;
      return Promise.resolve();
    };
    HdioClient.prototype.close = function () {
      // no-op: keep the redeemed-code guard across reconstructions
    };
    const handle = createHandler(() => undefined);
    handle(propsEvent("h", "acme", "code-1"));
    handle(propsEvent("h", "acme", "code-1"));
    await tick();
    assert.equal(redeemCount, 1);
    // A distinct handoff code redeems again.
    handle(propsEvent("h", "acme", "code-2"));
    await tick();
    assert.equal(redeemCount, 2);
  });
});
