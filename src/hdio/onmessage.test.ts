/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import { arrow } from "@hdml/common";
import { createHandler } from "./onmessage";
import type { OutboundMessage, Post } from "./onmessage";
import { HdioClient } from "./HdioClient";
import { parse } from "./parse";
import type { HdioState } from "./parse";

const origClose = HdioClient.prototype.close;
const origPostDocument = HdioClient.prototype.postDocument;
const origRedeem = HdioClient.prototype.redeemHandoff;
const origSetTokens = HdioClient.prototype.setTokens;
const origSubmit = HdioClient.prototype.submitQuery;
const origStatus = HdioClient.prototype.queryStatus;
const origResult = HdioClient.prototype.queryResult;
const origCancel = HdioClient.prototype.cancelQuery;

function propsEvent(
  host = "",
  tenant = "",
  token = "",
  config?: unknown,
): MessageEvent {
  return new MessageEvent("message", {
    data: { type: "props", data: { host, tenant, token, config } },
  });
}

function htmlEvent(html: string): MessageEvent {
  return new MessageEvent("message", {
    data: { type: "html", data: { html } },
  });
}

function tokensEvent(
  access: null | string,
  refresh: null | string,
): MessageEvent {
  return new MessageEvent("message", {
    data: { type: "oidc-tokens", data: { access, refresh } },
  });
}

function subEvent(
  id: string,
  ref: string,
  column: string,
  raw?: boolean,
): MessageEvent {
  return new MessageEvent("message", {
    data: {
      type: "subscribe",
      data: { id, ref, column, raw },
    },
  });
}

function unsubEvent(id: string): MessageEvent {
  return new MessageEvent("message", {
    data: { type: "unsubscribe", data: { id } },
  });
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** A one-batch Arrow IPC `ArrayBuffer` from typed vectors. */
function ipcBuffer(cols: Record<string, arrow.Vector>): ArrayBuffer {
  const ipc = arrow.tableToIPC(new arrow.Table(cols));
  return ipc.slice().buffer;
}

// A model + a frame `f1` (local ref) so a gate test can register the
// `hdml-frame=f1` ref via a real parse (mirrors parse.test.ts).
const gateDoc = `
  <hdml-model name="m1">
    <hdml-table name="t" type="table" identifier="\`c\`.\`s\`.\`t\`">
      <hdml-field name="a"></hdml-field>
    </hdml-table>
  </hdml-model>
  <hdml-frame name="f1" source="?hdml-model=m1">
    <hdml-field name="a"></hdml-field>
  </hdml-frame>`;

// The canonical key `parse` assigns `hdml-frame=f1` — recomputed here
// so a stubbed `postDocument` 201 can confirm exactly that key.
function f1Key(): string {
  const state: HdioState = {
    data: new Uint8Array(),
    registry: new Map(),
  };
  parse(state, gateDoc);
  return state.registry.get("hdml-frame=f1")!.key;
}

// A static (`/`-prefixed) ref never hits the D4 gate — it resolves
// `stored:true` on the pure transform, so a query submits at once.
const STATIC_REF = "/x.html?hdml-frame=f";

const tick = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

suite("hdio createHandler", () => {
  teardown(() => {
    HdioClient.prototype.close = origClose;
    HdioClient.prototype.postDocument = origPostDocument;
    HdioClient.prototype.redeemHandoff = origRedeem;
    HdioClient.prototype.setTokens = origSetTokens;
  });

  test(
    "identical props reuses the client; a changed " +
      "host/tenant closes and rebuilds",
    () => {
      let closeCount = 0;
      HdioClient.prototype.close = function () {
        closeCount++;
      };
      let postCalls = 0;
      const post: Post = () => {
        postCalls++;
      };
      const handle = createHandler(post);
      handle(propsEvent("h", "acme"));
      // A repeat props with the same identity (the debounced
      // attribute flurry / token-mode auth nudge) reuses the client —
      // no close, so an in-flight redeem is never aborted.
      handle(propsEvent("h", "acme"));
      assert.equal(closeCount, 0);
      // A genuine host/tenant change rebuilds, closing the old.
      handle(propsEvent("h", "beta"));
      assert.equal(closeCount, 1);
      assert.equal(postCalls, 0);
    },
  );

  test(
    "a redundant props keeps the redeemed client usable " +
      "(no abort, no re-auth)",
    async () => {
      let redeemCount = 0;
      HdioClient.prototype.redeemHandoff = function () {
        redeemCount++;
        return Promise.resolve();
      };
      let closeCount = 0;
      HdioClient.prototype.close = function () {
        closeCount++;
      };
      let postDocCount = 0;
      HdioClient.prototype.postDocument = function () {
        postDocCount++;
        return Promise.resolve({ stored: [], ddl: [] });
      };
      const handle = createHandler(() => undefined);
      handle(propsEvent("h", "acme", "code-1"));
      // The debounced re-props / auth nudge: same identity + same
      // single-use code. The client must survive — not be closed
      // (which would abort the in-flight redeem) nor re-redeemed
      // (the handoff code is single-use) — so the following html
      // still posts with a real Bearer.
      handle(propsEvent("h", "acme", "code-1"));
      handle(htmlEvent(""));
      await tick();
      assert.equal(redeemCount, 1);
      assert.equal(closeCount, 0);
      assert.equal(postDocCount, 1);
    },
  );

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
    // Same identity across all three props → the client is reused (no
    // reconstruction), so the redeemed-code guard holds.
    const handle = createHandler(() => undefined);
    handle(propsEvent("h", "acme", "code-1"));
    handle(propsEvent("h", "acme", "code-1"));
    await tick();
    assert.equal(redeemCount, 1);
    // A distinct handoff code redeems again on the same client.
    handle(propsEvent("h", "acme", "code-2"));
    await tick();
    assert.equal(redeemCount, 2);
  });

  test("oidc-tokens: the client adopts the minted pair", () => {
    const calls: Array<[null | string, null | string]> = [];
    HdioClient.prototype.setTokens = function (a, r) {
      calls.push([a, r]);
    };
    const handle = createHandler(() => undefined);
    handle(propsEvent("h", "acme", ""));
    // The main thread ran the exchange (§3.3), handing the pair over.
    handle(tokensEvent("access-1", "refresh-1"));
    assert.deepEqual(calls, [["access-1", "refresh-1"]]);
  });

  test("oidc-tokens before props still injects (stash)", () => {
    const calls: Array<[null | string, null | string]> = [];
    HdioClient.prototype.setTokens = function (a, r) {
      calls.push([a, r]);
    };
    const handle = createHandler(() => undefined);
    // The exchange fetch can resolve before the debounced props built
    // the client → stashed, then adopted on client creation.
    handle(tokensEvent("access-2", "refresh-2"));
    handle(propsEvent("h", "acme", ""));
    assert.deepEqual(calls, [["access-2", "refresh-2"]]);
  });

  test("oidc-tokens re-POSTs the load-raced doc", async () => {
    const posts: number[] = [];
    HdioClient.prototype.setTokens = function () {
      return undefined;
    };
    HdioClient.prototype.postDocument = function () {
      posts.push(1);
      // The load-time POST (pre-tokens, `#access` null) rejects
      // "not authenticated"; the re-POST after adoption resolves.
      return posts.length === 1
        ? Promise.reject(new Error("not authenticated"))
        : Promise.resolve({ stored: [], ddl: [] });
    };
    const handle = createHandler(() => undefined);
    handle(propsEvent("h", "acme", ""));
    // hdom-changed fires the POST before the OIDC pair arrives.
    handle(htmlEvent(gateDoc));
    await tick();
    assert.equal(posts.length, 1);
    // Adopting the pair re-drives the POST now that we are authed,
    // so the ref stores and gated queries can run (the OIDC analogue
    // of token mode's redeem→`#pending`→awaited POST).
    handle(tokensEvent("access-1", "refresh-1"));
    await tick();
    assert.equal(posts.length, 2);
  });

  test("oidc-tokens with no parsed doc does not POST", async () => {
    let posts = 0;
    HdioClient.prototype.setTokens = function () {
      return undefined;
    };
    HdioClient.prototype.postDocument = function () {
      posts += 1;
      return Promise.resolve({ stored: [], ddl: [] });
    };
    const handle = createHandler(() => undefined);
    handle(propsEvent("h", "acme", ""));
    // No `html` yet → nothing to re-POST; adoption must not send an
    // empty document.
    handle(tokensEvent("access-1", "refresh-1"));
    await tick();
    assert.equal(posts, 0);
  });
});

type ResultMsg = Extract<OutboundMessage, { type: "result" }>;
type ErrorMsg = Extract<OutboundMessage, { type: "error" }>;

function isResult(m: OutboundMessage): m is ResultMsg {
  return m.type === "result";
}

function isError(m: OutboundMessage): m is ErrorMsg {
  return m.type === "error";
}

suite("hdio query engine (D1/D4/D5/D6/D7)", () => {
  teardown(() => {
    HdioClient.prototype.close = origClose;
    HdioClient.prototype.postDocument = origPostDocument;
    HdioClient.prototype.redeemHandoff = origRedeem;
    HdioClient.prototype.submitQuery = origSubmit;
    HdioClient.prototype.queryStatus = origStatus;
    HdioClient.prototype.queryResult = origResult;
    HdioClient.prototype.cancelQuery = origCancel;
  });

  test("D1: two subs on one frame → one unioned query", async () => {
    const submits: { docPath: string; columns: string[] }[] = [];
    HdioClient.prototype.submitQuery = function (p) {
      submits.push(p);
      return Promise.resolve({ jobId: "j", status: "completed" });
    };
    HdioClient.prototype.queryResult = function () {
      return Promise.resolve([
        ipcBuffer({
          a: arrow.vectorFromArray([1], new arrow.Int32()),
          b: arrow.vectorFromArray([2], new arrow.Int32()),
        }),
      ]);
    };
    const handle = createHandler(() => undefined);
    handle(propsEvent("h", "acme", ""));
    handle(subEvent("s1", STATIC_REF, "a"));
    handle(subEvent("s2", STATIC_REF, "b"));
    await wait(60);
    assert.lengthOf(submits, 1);
    assert.deepEqual(submits[0].columns, ["a", "b"]);
    assert.equal(submits[0].docPath, "/hdml-frame=f@x.hdml");
  });

  test("D4: a local unstored ref does not submit", async () => {
    const submits: unknown[] = [];
    HdioClient.prototype.submitQuery = function (p) {
      submits.push(p);
      return Promise.resolve({ jobId: "j", status: "completed" });
    };
    const posted: OutboundMessage[] = [];
    const handle = createHandler((m) => posted.push(m));
    handle(propsEvent("h", "acme", ""));
    handle(subEvent("s1", "?hdml-frame=f1", "a"));
    await wait(60);
    assert.lengthOf(submits, 0);
    assert.isEmpty(posted);
    // Tear down the armed gate so it never fires post-test.
    handle(unsubEvent("s1"));
  });

  test("D4: a 201 fold releases the gated query", async () => {
    const key = f1Key();
    const submits: { docPath: string; columns: string[] }[] = [];
    HdioClient.prototype.submitQuery = function (p) {
      submits.push(p);
      return Promise.resolve({ jobId: "j", status: "completed" });
    };
    HdioClient.prototype.queryResult = function () {
      return Promise.resolve([
        ipcBuffer({
          a: arrow.vectorFromArray([1], new arrow.Int32()),
        }),
      ]);
    };
    HdioClient.prototype.postDocument = function () {
      return Promise.resolve({
        stored: [{ key, type: "frame", stored: true }],
        ddl: [],
      });
    };
    const handle = createHandler(() => undefined);
    handle(propsEvent("h", "acme", ""));
    handle(subEvent("s1", "?hdml-frame=f1", "a"));
    await wait(40);
    assert.lengthOf(submits, 0);
    handle(htmlEvent(gateDoc));
    await wait(80);
    assert.lengthOf(submits, 1);
    assert.equal(submits[0].docPath, `dynamic:${key}`);
  });

  test("D4: a covering POST rejection fails the gate", async () => {
    const submits: unknown[] = [];
    HdioClient.prototype.submitQuery = function (p) {
      submits.push(p);
      return Promise.resolve({ jobId: "j", status: "completed" });
    };
    HdioClient.prototype.postDocument = function () {
      return Promise.reject(new Error("post failed"));
    };
    const posted: OutboundMessage[] = [];
    const handle = createHandler((m) => posted.push(m));
    handle(propsEvent("h", "acme", ""));
    handle(subEvent("s1", "?hdml-frame=f1", "a"));
    await wait(40);
    handle(htmlEvent(gateDoc));
    await wait(60);
    assert.lengthOf(submits, 0);
    const errs = posted.filter(isError);
    assert.lengthOf(errs, 1);
    assert.equal(errs[0].data.message, "post failed");
    assert.equal(errs[0].data.ref, "?hdml-frame=f1");
    // "transport", not "query-failed": no query was ever submitted —
    // the *document* POST failed — so nothing pending can become
    // stored, and there is no generation to stamp (R38).
    assert.equal(errs[0].data.code, "transport");
    assert.notProperty(errs[0].data, "generation");
  });

  test("D4: a hung POST fails after queryReadyTimeout", async () => {
    const submits: unknown[] = [];
    HdioClient.prototype.submitQuery = function (p) {
      submits.push(p);
      return Promise.resolve({ jobId: "j", status: "completed" });
    };
    HdioClient.prototype.postDocument = function () {
      return new Promise<unknown>(() => undefined);
    };
    const posted: OutboundMessage[] = [];
    const handle = createHandler((m) => posted.push(m));
    handle(propsEvent("h", "acme", "", { queryReadyTimeout: 60 }));
    handle(subEvent("s1", "?hdml-frame=f1", "a"));
    handle(htmlEvent(gateDoc));
    await wait(200);
    assert.lengthOf(submits, 0);
    const errs = posted.filter(isError);
    assert.lengthOf(errs, 1);
    assert.include(errs[0].data.message, "not ready");
    assert.equal(errs[0].data.code, "gate-timeout");
    // Pre-submit: genuinely unstamped. A fabricated stamp would make
    // it comparable — and so discardable — against a later data
    // generation (R38).
    assert.notProperty(errs[0].data, "generation");
  });

  test("D6: pending backs off then completes", async () => {
    HdioClient.prototype.submitQuery = function () {
      return Promise.resolve({ jobId: "j1", status: "pending" });
    };
    const stamps: number[] = [];
    let polls = 0;
    HdioClient.prototype.queryStatus = function () {
      stamps.push(Date.now());
      polls += 1;
      return Promise.resolve({
        status: polls >= 3 ? "completed" : "pending",
      });
    };
    const results: string[] = [];
    HdioClient.prototype.queryResult = function (jobId) {
      results.push(jobId);
      return Promise.resolve([
        ipcBuffer({
          x: arrow.vectorFromArray([1], new arrow.Int32()),
        }),
      ]);
    };
    const handle = createHandler(() => undefined);
    handle(propsEvent("h", "acme", ""));
    handle(subEvent("s1", STATIC_REF, "x"));
    await wait(2200);
    assert.isAtLeast(polls, 3);
    assert.deepEqual(results, ["j1"]);
    // Backoff: the gap after poll #2 exceeds the gap after poll #1.
    assert.isAbove(stamps[2] - stamps[1], stamps[1] - stamps[0]);
  });

  test("D6: failed job posts error, no result", async () => {
    HdioClient.prototype.submitQuery = function () {
      return Promise.resolve({ jobId: "j1", status: "pending" });
    };
    HdioClient.prototype.queryStatus = function () {
      return Promise.resolve({
        status: "failed",
        error: "kaboom",
      });
    };
    let resultCalls = 0;
    HdioClient.prototype.queryResult = function () {
      resultCalls += 1;
      return Promise.resolve([]);
    };
    const posted: OutboundMessage[] = [];
    const handle = createHandler((m) => posted.push(m));
    handle(propsEvent("h", "acme", ""));
    handle(subEvent("s1", STATIC_REF, "x"));
    await wait(400);
    const errs = posted.filter(isError);
    assert.lengthOf(errs, 1);
    assert.equal(errs[0].data.message, "kaboom");
    assert.equal(errs[0].data.code, "query-failed");
    // Post-submit: stamped with the generation it belongs to, so a
    // consumer discards it wholesale if it is already past that one.
    assert.equal(errs[0].data.generation, 1);
    assert.equal(resultCalls, 0);
  });

  test("a thrown submit posts transport + generation", async () => {
    HdioClient.prototype.submitQuery = function () {
      return Promise.reject(new Error("boom"));
    };
    const posted: OutboundMessage[] = [];
    const handle = createHandler((m) => posted.push(m));
    handle(propsEvent("h", "acme", ""));
    handle(subEvent("s1", STATIC_REF, "x"));
    await wait(80);
    const errs = posted.filter(isError);
    assert.lengthOf(errs, 1);
    assert.equal(errs[0].data.message, "boom");
    // A thrown submit/poll/fetch is transport, and it IS post-submit
    // (the generation was bumped before `runQuery` ran), so it
    // carries its stamp.
    assert.equal(errs[0].data.code, "transport");
    assert.equal(errs[0].data.generation, 1);
  });

  test("D5: widen discards stale, cancels pending", async () => {
    const submits: { docPath: string; columns: string[] }[] = [];
    const jobs = ["j1", "j2"];
    let si = 0;
    HdioClient.prototype.submitQuery = function (p) {
      submits.push(p);
      const jobId = jobs[si] ?? "jX";
      si += 1;
      return Promise.resolve({ jobId, status: "pending" });
    };
    HdioClient.prototype.queryStatus = function (jobId) {
      return Promise.resolve({
        status: jobId === "j2" ? "completed" : "pending",
      });
    };
    const results: string[] = [];
    HdioClient.prototype.queryResult = function (jobId) {
      results.push(jobId);
      return Promise.resolve([
        ipcBuffer({
          a: arrow.vectorFromArray([1], new arrow.Int32()),
          b: arrow.vectorFromArray([2], new arrow.Int32()),
        }),
      ]);
    };
    const cancels: string[] = [];
    HdioClient.prototype.cancelQuery = function (jobId) {
      cancels.push(jobId);
      // Reject to prove the engine swallows a cancel failure.
      return Promise.reject(new Error("409"));
    };
    const handle = createHandler(() => undefined);
    handle(propsEvent("h", "acme", ""));
    handle(subEvent("s1", STATIC_REF, "a"));
    await wait(60);
    handle(subEvent("s2", STATIC_REF, "b"));
    await wait(700);
    assert.deepEqual(
      submits.map((s) => s.columns),
      [["a"], ["a", "b"]],
    );
    // j1 superseded before its result fetch; only j2 delivers.
    assert.deepEqual(results, ["j2"]);
    // The still-pending superseded job is best-effort cancelled.
    assert.deepEqual(cancels, ["j1"]);
  });

  test("D7: raw transfers/detaches; raw:false domain", async () => {
    HdioClient.prototype.submitQuery = function () {
      return Promise.resolve({ jobId: "j", status: "completed" });
    };
    HdioClient.prototype.queryResult = function () {
      return Promise.resolve([
        ipcBuffer({
          v: arrow.vectorFromArray([1, 2, 3], new arrow.Int32()),
          d: arrow.vectorFromArray([10, 20, 30], new arrow.Int32()),
          ts: arrow.vectorFromArray(
            [new Date(0), new Date(1000), new Date(2000)],
            new arrow.TimestampMillisecond(),
          ),
        }),
      ]);
    };
    const captured: {
      msg: OutboundMessage;
      transfer: Transferable[];
    }[] = [];
    const received: OutboundMessage[] = [];
    let resolveDone: () => void = () => undefined;
    const done = new Promise<void>((r) => {
      resolveDone = r;
    });
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = (e): void => {
      received.push(e.data as OutboundMessage);
      resolveDone();
    };
    const handle = createHandler((m, t) => {
      captured.push({ msg: m, transfer: t ?? [] });
      port2.postMessage(m, t ?? []);
    });
    handle(propsEvent("h", "acme", ""));
    handle(subEvent("s1", STATIC_REF, "v", true));
    handle(subEvent("s2", STATIC_REF, "d", false));
    handle(subEvent("s3", STATIC_REF, "ts"));
    await done;
    port1.close();
    port2.close();

    // All three columns ride ONE message now (D8 §1), not three.
    const cols = received.filter(isResult)[0].data.columns;

    // raw:true numeric → transferable values (moved buffer valid).
    assert.isDefined(cols.v.values);
    const vv = cols.v.values as { buffer: ArrayBuffer };
    assert.deepEqual(
      Array.from(new Float64Array(vv.buffer)),
      [1, 2, 3],
    );

    // raw:false → domain only, no values pulled.
    assert.isUndefined(cols.d.values);
    assert.deepEqual(cols.d.domain, {
      kind: "extent",
      value: [10, 30],
    });

    // The D9 timestamp tag survives.
    assert.deepEqual(cols.ts.type, {
      kind: "timestamp",
      unit: "ms",
    });

    // A4: the source buffers detached when the worker transferred
    // them — both raw columns on the message's one transfer list.
    const cap = captured.find((c) => isResult(c.msg))!;
    const capCols = (cap.msg as ResultMsg).data.columns;
    const capV = capCols.v.values as { buffer: ArrayBuffer };
    const capTs = capCols.ts.values as { buffer: ArrayBuffer };
    assert.lengthOf(cap.transfer, 2);
    assert.include(cap.transfer, capV.buffer);
    assert.include(cap.transfer, capTs.buffer);
    assert.equal(capV.buffer.byteLength, 0);
  });

  test("D9: nulls mask forwarded + transferred", async () => {
    HdioClient.prototype.submitQuery = function () {
      return Promise.resolve({ jobId: "j", status: "completed" });
    };
    HdioClient.prototype.queryResult = function () {
      return Promise.resolve([
        ipcBuffer({
          v: arrow.vectorFromArray([1, null, 3], new arrow.Float64()),
        }),
      ]);
    };
    const captured: {
      msg: OutboundMessage;
      transfer: Transferable[];
    }[] = [];
    const received: OutboundMessage[] = [];
    let resolveDone: () => void = () => undefined;
    const done = new Promise<void>((r) => {
      resolveDone = r;
    });
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = (e): void => {
      received.push(e.data as OutboundMessage);
      resolveDone();
    };
    const handle = createHandler((m, t) => {
      captured.push({ msg: m, transfer: t ?? [] });
      port2.postMessage(m, t ?? []);
    });
    handle(propsEvent("h", "acme", ""));
    handle(subEvent("s1", STATIC_REF, "v", true));
    await done;
    port1.close();
    port2.close();

    // Received (deserialized) mask: row 1 null → 0b010, one byte.
    const rv = received.filter(isResult)[0].data.columns.v;
    assert.isDefined(rv.nulls);
    const nb = rv.nulls as { buffer: ArrayBuffer };
    assert.deepEqual(Array.from(new Uint8Array(nb.buffer)), [0b010]);
    // The null slot's value reads back as its zero-fill.
    const vb = rv.values as { buffer: ArrayBuffer };
    assert.deepEqual(
      Array.from(new Float64Array(vb.buffer)),
      [1, 0, 3],
    );

    // A4: both the values buffer and the mask buffer transferred.
    const cap = captured.find((c) => isResult(c.msg))!;
    const capNulls = (cap.msg as ResultMsg).data.columns.v.nulls as {
      buffer: ArrayBuffer;
    };
    assert.lengthOf(cap.transfer, 2);
    assert.include(cap.transfer, capNulls.buffer);
    assert.equal(capNulls.buffer.byteLength, 0);
  });
});

// The D8 §1 atomic-result suite. `post` is captured directly (no
// MessageChannel hop), so buffers stay readable and the transfer list
// can be inspected for duplicates before anything detaches.
suite("hdio atomic result (D8 §1/§2/§5)", () => {
  teardown(() => {
    HdioClient.prototype.submitQuery = origSubmit;
    HdioClient.prototype.queryStatus = origStatus;
    HdioClient.prototype.queryResult = origResult;
    HdioClient.prototype.cancelQuery = origCancel;
  });

  function completingClient(
    result: () => Record<string, arrow.Vector>,
  ): void {
    HdioClient.prototype.submitQuery = function () {
      return Promise.resolve({ jobId: "j", status: "completed" });
    };
    HdioClient.prototype.queryResult = function () {
      return Promise.resolve([ipcBuffer(result())]);
    };
  }

  test("one message per (ref, generation), one list", async () => {
    completingClient(() => ({
      a: arrow.vectorFromArray([1, 2], new arrow.Int32()),
      b: arrow.vectorFromArray(["x", "y"], new arrow.Utf8()),
    }));
    const captured: {
      msg: OutboundMessage;
      transfer: Transferable[];
    }[] = [];
    const handle = createHandler((m, t) => {
      captured.push({ msg: m, transfer: t ?? [] });
    });
    handle(propsEvent("h", "acme", ""));
    handle(subEvent("s1", STATIC_REF, "a"));
    handle(subEvent("s2", STATIC_REF, "b"));
    await wait(80);

    // ONE result, not one per column: the per-column split was a
    // message-layer tear, and per-ref atomicity is sufficient
    // because every render unit zips from one ref.
    const results = captured.filter((c) => isResult(c.msg));
    assert.lengthOf(results, 1);
    const msg = results[0].msg as ResultMsg;
    assert.equal(msg.data.ref, STATIC_REF);
    assert.deepEqual(Object.keys(msg.data.columns).sort(), [
      "a",
      "b",
    ]);

    // Every buffer rides that one transfer list — and no
    // `ArrayBuffer` twice: with one shared list a duplicate throws
    // `DataCloneError` and loses the whole generation, where a
    // per-column list would only have detached one message.
    const list = results[0].transfer;
    // Only "a" is numeric; the ordinal "b" is a `string[]`.
    assert.lengthOf(list, 1);
    assert.equal(new Set(list).size, list.length);
  });

  test("generation is >= 1 and strictly increases", async () => {
    completingClient(() => ({
      a: arrow.vectorFromArray([1, 2], new arrow.Int32()),
      b: arrow.vectorFromArray([3, 4], new arrow.Int32()),
    }));
    const posted: OutboundMessage[] = [];
    const handle = createHandler((m) => posted.push(m));
    handle(propsEvent("h", "acme", ""));
    handle(subEvent("s1", STATIC_REF, "a"));
    await wait(80);
    // A widened union bumps the frame's generation and resubmits.
    handle(subEvent("s2", STATIC_REF, "b"));
    await wait(80);
    assert.deepEqual(
      posted.filter(isResult).map((m) => m.data.generation),
      [1, 2],
    );
  });

  test("rows carries numRows; zero rows is a result", async () => {
    let empty = false;
    completingClient(() => ({
      a: empty
        ? arrow.vectorFromArray([], new arrow.Int32())
        : arrow.vectorFromArray([1, 2, 3], new arrow.Int32()),
    }));
    const first: OutboundMessage[] = [];
    const h1 = createHandler((m) => first.push(m));
    h1(propsEvent("h", "acme", ""));
    h1(subEvent("s1", STATIC_REF, "a"));
    await wait(80);
    assert.equal(first.filter(isResult)[0].data.rows, 3);

    empty = true;
    const second: OutboundMessage[] = [];
    const h2 = createHandler((m) => second.push(m));
    h2(propsEvent("h", "acme", ""));
    h2(subEvent("s2", STATIC_REF, "a"));
    await wait(80);
    // A real empty result, on the wire as a `result` and never an
    // `error` (D8 §5). Its extent is [NaN, NaN] — the exact value an
    // all-null column yields — so `rows` is the only thing that can
    // tell "no rows" from "all null".
    const msg = second.filter(isResult)[0];
    assert.equal(msg.data.rows, 0);
    assert.lengthOf(second.filter(isError), 0);
    assert.deepEqual(msg.data.columns.a.domain, {
      kind: "extent",
      value: [NaN, NaN],
    });
  });

  test("a column absent from the result is omitted", async () => {
    completingClient(() => ({
      a: arrow.vectorFromArray([1, 2], new arrow.Int32()),
    }));
    const posted: OutboundMessage[] = [];
    const handle = createHandler((m) => posted.push(m));
    handle(propsEvent("h", "acme", ""));
    handle(subEvent("s1", STATIC_REF, "a"));
    // A typo'd / non-existent column. It is not an error on the
    // wire; the main thread synthesizes the `absent` delivery from
    // the difference against its own subscriptions.
    handle(subEvent("s2", STATIC_REF, "nope"));
    await wait(80);
    const results = posted.filter(isResult);
    assert.lengthOf(results, 1);
    assert.deepEqual(Object.keys(results[0].data.columns), ["a"]);
    // The present sibling is still delivered, and nothing threw.
    assert.isDefined(results[0].data.columns.a.values);
    assert.lengthOf(posted.filter(isError), 0);
  });

  test("per-column raw is the OR over subscribers", async () => {
    completingClient(() => ({
      a: arrow.vectorFromArray([1, 2], new arrow.Int32()),
      b: arrow.vectorFromArray([3, 4], new arrow.Int32()),
    }));
    const posted: OutboundMessage[] = [];
    const handle = createHandler((m) => posted.push(m));
    handle(propsEvent("h", "acme", ""));
    // "a": a domain-only axis AND a raw mark → values pulled once.
    handle(subEvent("s1", STATIC_REF, "a", false));
    handle(subEvent("s2", STATIC_REF, "a", true));
    // "b": domain-only subscribers alone → no values.
    handle(subEvent("s3", STATIC_REF, "b", false));
    await wait(80);
    const cols = posted.filter(isResult)[0].data.columns;
    assert.isDefined(cols.a.values);
    assert.isUndefined(cols.b.values);
    // Both still carry domain + type regardless of `raw`.
    assert.deepEqual(cols.b.domain, {
      kind: "extent",
      value: [3, 4],
    });
    assert.deepEqual(cols.b.type, { kind: "number" });
  });
});
