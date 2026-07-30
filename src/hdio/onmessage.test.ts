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
const origPostFiles = HdioClient.prototype.postFiles;

function propsEvent(): MessageEvent {
  return new MessageEvent("message", {
    data: {
      type: "props",
      data: { host: "", tenant: "", token: "" },
    },
  });
}

function htmlEvent(html: string): MessageEvent {
  return new MessageEvent("message", {
    data: { type: "html", data: { html } },
  });
}

suite("hdio createHandler", () => {
  teardown(() => {
    HdioClient.prototype.close = origClose;
    HdioClient.prototype.postFiles = origPostFiles;
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

  test("html parses and posts files; sink untouched", () => {
    let postFilesCount = 0;
    HdioClient.prototype.postFiles = function () {
      postFilesCount++;
      return Promise.resolve();
    };
    let postCalls = 0;
    const handle = createHandler(() => {
      postCalls++;
    });
    handle(propsEvent());
    handle(htmlEvent(""));
    assert.equal(postFilesCount, 1);
    assert.equal(postCalls, 0);
  });

  test("handlers keep separate client state", () => {
    let postFilesCount = 0;
    HdioClient.prototype.postFiles = function () {
      postFilesCount++;
      return Promise.resolve();
    };
    const handleA = createHandler(() => undefined);
    const handleB = createHandler(() => undefined);
    handleA(propsEvent());
    // B never got props, so its closure client is null — an html
    // must not reach A's client (no module-global bleed).
    handleB(htmlEvent(""));
    assert.equal(postFilesCount, 0);
    handleB(propsEvent());
    handleB(htmlEvent(""));
    assert.equal(postFilesCount, 1);
  });
});
