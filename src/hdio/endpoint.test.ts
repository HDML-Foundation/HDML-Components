/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import { createEndpoint, closeEndpoint } from "./endpoint";
import type { Endpoint } from "./endpoint";

interface ResultData {
  ref: string;
  column: string;
  values: ArrayBuffer;
  domain: unknown;
  type: unknown;
}

interface ResultMsg {
  type: "result";
  data: ResultData;
}

const tick = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

suite("hdio endpoint (fallback MessageChannel)", () => {
  test("createEndpoint returns a MessagePort", () => {
    const ep = createEndpoint();
    assert.instanceOf(ep, MessagePort);
    closeEndpoint(ep);
  });

  test("props route through the port, never window", async () => {
    // A1 invariant: the fallback touches no global slot, so the
    // element cannot hijack window.onmessage (the pre-Slice-A
    // globalThis.self bug).
    assert.isNull(window.onmessage);
    const ep: Endpoint = createEndpoint();
    (ep as MessagePort).postMessage({
      type: "props",
      data: { host: "", tenant: "", token: "" },
    });
    await tick();
    assert.isNull(window.onmessage);
    closeEndpoint(ep);
  });

  test("closeEndpoint stops delivery on the port", async () => {
    const { port1, port2 } = new MessageChannel();
    let received = 0;
    port2.onmessage = () => {
      received++;
    };
    port1.postMessage("ping");
    await tick();
    assert.equal(received, 1);
    closeEndpoint(port1);
    port1.postMessage("after-close");
    await tick();
    assert.equal(received, 1);
    port2.close();
  });

  test("A4: a result ArrayBuffer transfers + detaches", async () => {
    const { port1, port2 } = new MessageChannel();
    const src = new Uint8Array([1, 2, 3, 4]).buffer;
    let received: null | ArrayBuffer = null;
    const got = new Promise<void>((resolve) => {
      port1.onmessage = (ev: MessageEvent<ResultMsg>) => {
        received = ev.data.data.values;
        resolve();
      };
    });
    port2.onmessage = (ev: MessageEvent<ResultMsg>) => {
      port2.postMessage(ev.data, [ev.data.data.values]);
    };
    const msg: ResultMsg = {
      type: "result",
      data: {
        ref: "r",
        column: "c",
        values: src,
        domain: null,
        type: null,
      },
    };
    port1.postMessage(msg, [src]);
    // The source buffer detaches synchronously at post time.
    assert.equal(src.byteLength, 0);
    await got;
    assert.isNotNull(received);
    const bytes = new Uint8Array(received);
    assert.deepEqual(Array.from(bytes), [1, 2, 3, 4]);
    port1.close();
    port2.close();
  });
});
