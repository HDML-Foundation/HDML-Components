/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import { HdmlIo, nav, endpoints } from "./HdmlIo";
import type { Delivery } from "./delivery";
import type { Endpoint } from "./endpoint";

// The app's own page URL (origin + pathname); `?code&state` is added
// per-case. The exchange/stale tests run against the wtr mock HDIO
// (`.testrc.js`) so `host` is "" (same-origin); the tenant selects
// the scenario ("oidc-ok" → 200, "stale-state" → 401).
const HREF = "http://app.example/dash";

// A 20 ms macrotask yield. Bare `await`ing a promise resolved by a
// MessagePort message flakes on WebKit (it can schedule the port's
// `message` a macrotask later than a `setTimeout(0)`, and an idle
// page never pumps it — see endpoint.test.ts), and a fixed wait
// flakes under full-suite load; polling on a real timer covers both.
const tick = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// Polls `pred` every 20 ms up to `cap` iterations (~4 s), so the
// worker round-trip (two port hops + one fetch) is awaited without a
// brittle fixed delay.
async function until(pred: () => boolean, cap = 200): Promise<void> {
  for (let i = 0; i < cap && !pred(); i++) {
    await tick(20);
  }
}

suite("HdmlIo auth state machine", () => {
  let mounted: HdmlIo[] = [];
  const saved = { ...nav };
  // Per-test recording seams; each test points nav's methods here.
  let navCalls: string[] = [];
  let stripCalls: string[] = [];
  let search = "";

  setup(() => {
    navCalls = [];
    stripCalls = [];
    search = "";
    // The element reads this **module-level** seam, so overriding it
    // here (before any element mounts) sidesteps the per-instance
    // upgrade-timing race entirely — no real navigation ever fires.
    nav.href = () => HREF + search;
    nav.search = () => search;
    nav.navigate = (u) => navCalls.push(u);
    nav.strip = (u) => stripCalls.push(u);
  });

  teardown(() => {
    Object.assign(nav, saved);
    mounted.forEach((el) => el.remove());
    mounted = [];
  });

  function mount(attrs: Record<string, string>): HdmlIo {
    const el = document.createElement("hdml-io") as HdmlIo;
    for (const [k, v] of Object.entries(attrs)) {
      el.setAttribute(k, v);
    }
    document.body.appendChild(el);
    mounted.push(el);
    return el;
  }

  test("code+state → exchange → strip params", async () => {
    search = "?code=c&state=s";
    mount({ host: "", tenant: "oidc-ok" });
    await until(() => stripCalls.length > 0);
    assert.deepEqual(stripCalls, [HREF]);
    assert.deepEqual(navCalls, []);
  });

  test("a stale 401 re-navigates, not a hard error", async () => {
    search = "?code=c&state=s";
    mount({ host: "", tenant: "stale-state" });
    await until(() => navCalls.length > 0);
    assert.equal(navCalls.length, 1);
    assert.include(navCalls[0], "/stale-state/api/v1/auth/login");
    assert.include(navCalls[0], "redirect_uri=");
  });

  test("interleaved changes navigate at most once", async () => {
    const el = mount({ host: "", tenant: "t", mode: "oidc" });
    await until(() => navCalls.length > 0);
    assert.equal(navCalls.length, 1);
    assert.include(navCalls[0], "/t/api/v1/auth/login");
    // A later mode/token flurry cannot commit a second navigation.
    el.setAttribute("token", "x");
    el.removeAttribute("token");
    el.setAttribute("mode", "oidc");
    await tick(60);
    assert.equal(navCalls.length, 1);
  });

  test("a silent-auth failure retries interactively", async () => {
    search = "?error=login_required&state=s";
    mount({ host: "", tenant: "t", mode: "oidc" });
    await until(() => navCalls.length > 0);
    assert.equal(navCalls.length, 1);
    assert.include(navCalls[0], "/t/api/v1/auth/login");
    assert.include(navCalls[0], "interactive=1");
    assert.deepEqual(stripCalls, []);
  });

  test("a non-silent IdP error strips, no navigate", async () => {
    search = "?error=access_denied&state=s";
    mount({ host: "", tenant: "t", mode: "oidc" });
    await until(() => stripCalls.length > 0);
    assert.deepEqual(stripCalls, [HREF]);
    assert.deepEqual(navCalls, []);
  });
});

// The settled D8 event names (window.HDML_CONFIG defaults, §8).
const READY = "hdml-io-ready";
const REQUEST = "hdml-io-request";
const REF = "?hdml-frame=x";

// A capturing fake endpoint: records every inbound `postMessage` and
// exposes `onmessage` so a test can feed a worker `result` back. Cast
// to `Endpoint` at the seam (a plain object is neither Worker nor
// MessagePort, but only `postMessage`/`onmessage`/`close` are used).
interface FakeEndpoint {
  posted: unknown[];
  onmessage: null | ((ev: MessageEvent) => void);
  postMessage(msg: unknown): void;
  close(): void;
}

function fakeEndpoint(): FakeEndpoint {
  const ep: FakeEndpoint = {
    posted: [],
    onmessage: null,
    postMessage(msg: unknown): void {
      ep.posted.push(msg);
    },
    close(): void {
      // no-op; the real closeEndpoint calls this for a MessagePort.
    },
  };
  return ep;
}

// Filters the fake's captured inbound messages by `type`.
function ofType(ep: FakeEndpoint, type: string): { data: unknown }[] {
  return ep.posted.filter(
    (m): m is { type: string; data: unknown } =>
      !!m && (m as { type?: string }).type === type,
  );
}

// Dispatches a D8 request event on `document` (bubbles/composed).
function request(detail: unknown): void {
  document.dispatchEvent(
    new CustomEvent(REQUEST, {
      detail,
      bubbles: true,
      composed: true,
    }),
  );
}

// Feeds one atomic worker `result` in through the fake endpoint's
// onmessage (D8 §1: one message per (ref, generation), every
// subscribed column keyed by name).
function feedResult(ep: FakeEndpoint, data: unknown): void {
  ep.onmessage?.(
    new MessageEvent("message", {
      data: { type: "result", data },
    }),
  );
}

// Feeds one worker `error` in through the fake endpoint's onmessage.
// A `ref` fans out to every subscriber of it; a ref-less one is
// logged and reaches nobody (D8 §4).
function feedError(ep: FakeEndpoint, data: unknown): void {
  ep.onmessage?.(
    new MessageEvent("message", {
      data: { type: "error", data },
    }),
  );
}

// A no-op sink for the requests that only assert registration —
// `deliver` is REQUIRED now, so a detail without it is rejected.
const sink = (): void => undefined;

// A second ref, for the fan-out scoping assertions.
const REF2 = "?hdml-frame=other";

suite("HdmlIo D8 discovery bus + registry", () => {
  let mounted: HdmlIo[] = [];
  const savedNav = { ...nav };
  const savedEndpoints = { ...endpoints };
  let ep: FakeEndpoint;

  setup(() => {
    // Isolate navigation (no ?code&state, no real assign) so the
    // OIDC auto-trigger stays inert regardless of the runner URL.
    nav.href = () => "http://app.example/dash";
    nav.search = () => "";
    nav.navigate = () => undefined;
    nav.strip = () => undefined;
    ep = fakeEndpoint();
    endpoints.create = () => ep as unknown as Endpoint;
  });

  teardown(() => {
    Object.assign(nav, savedNav);
    Object.assign(endpoints, savedEndpoints);
    delete window.HDML_CONFIG;
    mounted.forEach((el) => el.remove());
    mounted = [];
  });

  function mount(attrs: Record<string, string>): HdmlIo {
    const el = document.createElement("hdml-io") as HdmlIo;
    for (const [k, v] of Object.entries(attrs)) {
      el.setAttribute(k, v);
    }
    document.body.appendChild(el);
    mounted.push(el);
    return el;
  }

  test("a request before connect subscribes on ready", async () => {
    // A consumer that connected first: it dispatches now (lost — no
    // hdml-io yet) and re-dispatches on hdml-io-ready (§5.8).
    const detail = { id: "s1", ref: REF, column: "m", deliver: sink };
    const redispatch = (): void => request(detail);
    document.addEventListener(READY, redispatch);
    request(detail); // before hdml-io exists → nobody hears it
    mount({ host: "", tenant: "t" });
    await until(() => ofType(ep, "subscribe").length > 0);
    document.removeEventListener(READY, redispatch);
    const subs = ofType(ep, "subscribe");
    assert.lengthOf(subs, 1);
    assert.equal((subs[0].data as { id: string }).id, "s1");
  });

  test("a request after connect subscribes directly", async () => {
    mount({ host: "", tenant: "t" });
    await tick(20);
    request({ id: "s1", ref: REF, column: "m", deliver: sink });
    const subs = ofType(ep, "subscribe");
    assert.lengthOf(subs, 1);
    assert.equal((subs[0].data as { id: string }).id, "s1");
  });

  test("a duplicate id yields one subscription", async () => {
    mount({ host: "", tenant: "t" });
    await tick(20);
    const detail = { id: "s1", ref: REF, column: "m", deliver: sink };
    request(detail);
    request(detail);
    assert.lengthOf(ofType(ep, "subscribe"), 1);
  });

  test("HDML_CONFIG.queryReadyTimeout reaches props", async () => {
    window.HDML_CONFIG = { queryReadyTimeout: 500 };
    mount({ host: "", tenant: "t" });
    await until(() => ofType(ep, "props").length > 0);
    const p = ofType(ep, "props")[0];
    const cfg = (p.data as { config: { queryReadyTimeout: number } })
      .config;
    assert.equal(cfg.queryReadyTimeout, 500);
  });

  test("absent config → the 10000 default in props", async () => {
    delete window.HDML_CONFIG;
    mount({ host: "", tenant: "t" });
    await until(() => ofType(ep, "props").length > 0);
    const p = ofType(ep, "props")[0];
    const cfg = (p.data as { config: { queryReadyTimeout: number } })
      .config;
    assert.equal(cfg.queryReadyTimeout, 10000);
  });

  test("one atomic result slices to every subscriber", async () => {
    mount({ host: "", tenant: "t" });
    await tick(20);
    const got1: Delivery[] = [];
    const got2: Delivery[] = [];
    const got3: Delivery[] = [];
    request({
      id: "s1",
      ref: REF,
      column: "m",
      deliver: (d: Delivery): void => {
        got1.push(d);
      },
    });
    request({
      id: "s2",
      ref: REF,
      column: "m",
      deliver: (d: Delivery): void => {
        got2.push(d);
      },
    });
    // A pure axis on a different column, domain-only (raw:false).
    request({
      id: "s3",
      ref: REF,
      column: "d",
      raw: false,
      deliver: (d: Delivery): void => {
        got3.push(d);
      },
    });
    // ONE message carries both columns of this (ref, generation).
    const buffer = new Float64Array([1, 2]).buffer;
    const values = { buffer, byteOffset: 0, byteLength: 16 };
    feedResult(ep, {
      ref: REF,
      generation: 3,
      rows: 2,
      columns: {
        m: {
          values,
          domain: { kind: "extent", value: [1, 2] },
          type: { kind: "number" },
        },
        d: {
          domain: { kind: "extent", value: [10, 30] },
          type: { kind: "number" },
        },
      },
    });
    // Delivered SYNCHRONOUSLY, inside the one receiving task — this
    // is what dissolves the cross-child stack barrier: no subscriber
    // of the ref can observe a different generation than its
    // siblings, with no consumer barrier code at all.
    assert.lengthOf(got1, 1);
    assert.lengthOf(got2, 1);
    assert.lengthOf(got3, 1);

    assert.equal(got1[0].kind, "data");
    assert.equal(got1[0].generation, 3);
    assert.equal(
      (got1[0] as Extract<Delivery, { kind: "data" }>).rows,
      2,
    );
    assert.equal(got1[0].column, "m");

    // Each subscriber gets its own slice object, but the buffers are
    // shared BY REFERENCE — a column bound by five marks is never
    // re-cloned (D7, D8 §6.4).
    const v1 = (got1[0] as Extract<Delivery, { kind: "data" }>)
      .values;
    const v2 = (got2[0] as Extract<Delivery, { kind: "data" }>)
      .values;
    assert.strictEqual(v1, v2);
    assert.strictEqual(
      (v1 as { buffer: ArrayBuffer }).buffer,
      buffer,
    );

    // The raw:false subscriber got domain only, no values.
    const r3 = got3[0] as Extract<Delivery, { kind: "data" }>;
    assert.isUndefined(r3.values);
    assert.deepEqual(r3.domain, { kind: "extent", value: [10, 30] });
  });

  test("a subscribed column absent → kind:absent", async () => {
    mount({ host: "", tenant: "t" });
    await tick(20);
    const got: Delivery[] = [];
    request({
      id: "s1",
      ref: REF,
      column: "typo",
      deliver: (d: Delivery): void => {
        got.push(d);
      },
    });
    feedResult(ep, {
      ref: REF,
      generation: 7,
      rows: 4,
      columns: {
        m: {
          domain: { kind: "extent", value: [1, 2] },
          type: { kind: "number" },
        },
      },
    });
    // The worker omits it from `columns`; the main thread turns that
    // omission into an EXPLICIT delivery. The old worker-side
    // `if (col)` skip was silent, so a typo'd static-ref column left
    // its widget spinning forever — this is runtime V4 for the refs
    // the in-page validator cannot check.
    assert.lengthOf(got, 1);
    assert.deepEqual(got[0], {
      kind: "absent",
      ref: REF,
      column: "typo",
      generation: 7,
      rows: 4,
      code: "absent-column",
    });
  });

  test("a request with no function deliver is rejected", async () => {
    mount({ host: "", tenant: "t" });
    await tick(20);
    // No `deliver` at all — this used to register a subscription
    // whose every delivery went to a silent no-op default.
    request({ id: "s1", ref: REF, column: "m" });
    // And a non-function one.
    request({ id: "s2", ref: REF, column: "m", deliver: "x" });
    assert.lengthOf(ofType(ep, "subscribe"), 0);
    // A well-formed request on the same element still registers, so
    // the rejection is the detail's, not the listener's.
    request({ id: "s3", ref: REF, column: "m", deliver: sink });
    const subs = ofType(ep, "subscribe");
    assert.lengthOf(subs, 1);
    assert.equal((subs[0].data as { id: string }).id, "s3");
  });

  test("aborting a subscriber posts unsubscribe", async () => {
    mount({ host: "", tenant: "t" });
    await tick(20);
    const ctrl = new AbortController();
    const got: unknown[] = [];
    request({
      id: "s1",
      ref: REF,
      column: "m",
      signal: ctrl.signal,
      deliver: (d: Delivery): void => {
        got.push(d);
      },
    });
    assert.lengthOf(ofType(ep, "subscribe"), 1);
    ctrl.abort();
    const unsubs = ofType(ep, "unsubscribe");
    assert.lengthOf(unsubs, 1);
    assert.equal((unsubs[0].data as { id: string }).id, "s1");
    // A later result is not delivered to the aborted subscriber —
    // not even the `absent` synthesis, since the fan-out reads the
    // registry and the entry is gone.
    feedResult(ep, {
      ref: REF,
      generation: 1,
      rows: 0,
      columns: {},
    });
    assert.lengthOf(got, 0);
  });

  test("an error reaches every subscriber of its ref", async () => {
    mount({ host: "", tenant: "t" });
    await tick(20);
    const got1: Delivery[] = [];
    const got2: Delivery[] = [];
    const other: Delivery[] = [];
    // Two subscribers of one ref on DIFFERENT columns: the failure is
    // the frame's, not one column's, so both must hear it.
    request({
      id: "s1",
      ref: REF,
      column: "m",
      deliver: (d: Delivery): void => {
        got1.push(d);
      },
    });
    request({
      id: "s2",
      ref: REF,
      column: "d",
      deliver: (d: Delivery): void => {
        got2.push(d);
      },
    });
    request({
      id: "s3",
      ref: REF2,
      column: "m",
      deliver: (d: Delivery): void => {
        other.push(d);
      },
    });
    feedError(ep, {
      ref: REF,
      generation: 4,
      message: "kaboom",
      code: "query-failed",
    });
    // Dropped on the floor before delta 4 — no consumer could ever
    // leave :state(loading) on a failure.
    assert.deepEqual(got1, [
      {
        kind: "error",
        ref: REF,
        column: "m",
        message: "kaboom",
        code: "query-failed",
        generation: 4,
      },
    ]);
    assert.lengthOf(got2, 1);
    assert.equal(got2[0].column, "d");
    // A subscriber of a different ref hears nothing.
    assert.lengthOf(other, 0);
  });

  test("a ref-less error fans out to nobody", async () => {
    mount({ host: "", tenant: "t" });
    await tick(20);
    const got: Delivery[] = [];
    request({
      id: "s1",
      ref: REF,
      column: "m",
      deliver: (d: Delivery): void => {
        got.push(d);
      },
    });
    // There is no subscriber it belongs to, so it is logged, not
    // fanned out (D8 §4).
    feedError(ep, { message: "no ref", code: "transport" });
    assert.lengthOf(got, 0);
  });

  test("an unstamped error arrives with no generation", async () => {
    mount({ host: "", tenant: "t" });
    await tick(20);
    const got: Delivery[] = [];
    request({
      id: "s1",
      ref: REF,
      column: "m",
      deliver: (d: Delivery): void => {
        got.push(d);
      },
    });
    // The pre-submit D4 gate timeout carries no stamp. It must NOT be
    // defaulted to 0 or to any cached generation: R38 makes the stamp
    // — not the kind — decide staleness, so a fabricated one would
    // make this comparable, and therefore discardable, against a
    // later data generation.
    feedError(ep, {
      ref: REF,
      message: "query target not ready before timeout",
      code: "gate-timeout",
    });
    assert.lengthOf(got, 1);
    assert.equal(got[0].kind, "error");
    assert.notProperty(got[0], "generation");
    assert.isUndefined(got[0].generation);
  });

  test("a late subscriber is replayed, asynchronously", async () => {
    mount({ host: "", tenant: "t" });
    await tick(20);
    const early: Delivery[] = [];
    request({
      id: "s1",
      ref: REF,
      column: "m",
      deliver: (d: Delivery): void => {
        early.push(d);
      },
    });
    const buffer = new Float64Array([1, 2]).buffer;
    const values = { buffer, byteOffset: 0, byteLength: 16 };
    feedResult(ep, {
      ref: REF,
      generation: 5,
      rows: 2,
      columns: {
        m: {
          values,
          domain: { kind: "extent", value: [1, 2] },
          type: { kind: "number" },
        },
      },
    });
    assert.lengthOf(early, 1);

    // A widget that mounts AFTER the delivery. The worker will never
    // resend — evaluateFrame early-returns on an unchanged union — so
    // without the cache this one starves forever.
    const late: Delivery[] = [];
    request({
      id: "s2",
      ref: REF,
      column: "m",
      deliver: (d: Delivery): void => {
        late.push(d);
      },
    });
    // Never synchronous: request → delivery is ALWAYS async (D8 §4),
    // so a consumer never handles a `deliver` re-entering its own
    // dispatchEvent.
    assert.lengthOf(late, 0);
    await Promise.resolve();
    assert.lengthOf(late, 1);
    assert.equal(late[0].kind, "data");
    assert.equal(late[0].generation, 5);
    const d = late[0] as Extract<Delivery, { kind: "data" }>;
    assert.equal(d.rows, 2);
    // Shared BY REFERENCE with the live delivery — the replay never
    // re-clones a buffer.
    const live = early[0] as Extract<Delivery, { kind: "data" }>;
    assert.strictEqual(d.values, live.values);
    assert.strictEqual(
      (d.values as { buffer: ArrayBuffer }).buffer,
      buffer,
    );
  });

  test("a late subscriber on an uncached column", async () => {
    mount({ host: "", tenant: "t" });
    await tick(20);
    feedResult(ep, {
      ref: REF,
      generation: 2,
      rows: 3,
      columns: {
        m: {
          domain: { kind: "extent", value: [1, 2] },
          type: { kind: "number" },
        },
      },
    });
    const late: Delivery[] = [];
    request({
      id: "s1",
      ref: REF,
      column: "typo",
      deliver: (d: Delivery): void => {
        late.push(d);
      },
    });
    await Promise.resolve();
    // Replayed as an explicit `absent`, not silence — the replay path
    // builds its slice through the SAME helper the live fan-out uses.
    assert.deepEqual(late, [
      {
        kind: "absent",
        ref: REF,
        column: "typo",
        generation: 2,
        rows: 3,
        code: "absent-column",
      },
    ]);
  });

  test("a same-task abort cancels the replay", async () => {
    mount({ host: "", tenant: "t" });
    await tick(20);
    feedResult(ep, {
      ref: REF,
      generation: 1,
      rows: 1,
      columns: {
        m: {
          domain: { kind: "extent", value: [1, 1] },
          type: { kind: "number" },
        },
      },
    });
    const got: Delivery[] = [];
    const ctrl = new AbortController();
    request({
      id: "s1",
      ref: REF,
      column: "m",
      signal: ctrl.signal,
      deliver: (d: Delivery): void => {
        got.push(d);
      },
    });
    // The signal can fire in the same task as the request, before the
    // queued microtask runs.
    ctrl.abort();
    await Promise.resolve();
    assert.lengthOf(got, 0);
  });

  test("a second result overwrites the cache", async () => {
    mount({ host: "", tenant: "t" });
    await tick(20);
    const column = {
      domain: { kind: "extent", value: [1, 2] },
      type: { kind: "number" },
    };
    feedResult(ep, {
      ref: REF,
      generation: 1,
      rows: 1,
      columns: { m: column },
    });
    feedResult(ep, {
      ref: REF,
      generation: 2,
      rows: 9,
      columns: { m: column },
    });
    const late: Delivery[] = [];
    request({
      id: "s1",
      ref: REF,
      column: "m",
      deliver: (d: Delivery): void => {
        late.push(d);
      },
    });
    await Promise.resolve();
    // One payload per ref: the newer generation replaced the older,
    // so a late joiner never sees a superseded one.
    assert.lengthOf(late, 1);
    assert.equal(late[0].generation, 2);
    assert.equal(
      (late[0] as Extract<Delivery, { kind: "data" }>).rows,
      9,
    );
  });

  test("disconnect announces gone exactly once", async () => {
    // A custom name proves the dispatch reads HDML_CONFIG, and keeps
    // this assertion immune to a neighbouring test's teardown firing
    // the default-named event on `document`.
    window.HDML_CONFIG = { goneEvent: "x-gone" };
    const seen: Event[] = [];
    const onGone = (e: Event): void => {
      seen.push(e);
    };
    const onDefault = (): void => {
      seen.push(new Event("unexpected"));
    };
    document.addEventListener("x-gone", onGone);
    document.addEventListener("hdml-io-gone", onDefault);
    const el = mount({ host: "", tenant: "t" });
    await tick(20);
    el.remove();
    document.removeEventListener("x-gone", onGone);
    document.removeEventListener("hdml-io-gone", onDefault);
    // The dispatch is the WHOLE assertion. The reaction — reset the
    // adopted generation, return to :state(loading), await the next
    // hdml-io-ready — is the consumer half, and no listener for it
    // exists in this repo yet.
    assert.lengthOf(seen, 1);
    assert.equal(seen[0].type, "x-gone");
    assert.isTrue(seen[0].bubbles);
    assert.isTrue(seen[0].composed);
  });

  test("a reconnect replays nothing", async () => {
    const el = mount({ host: "", tenant: "t" });
    await tick(20);
    feedResult(ep, {
      ref: REF,
      generation: 1,
      rows: 1,
      columns: {
        m: {
          domain: { kind: "extent", value: [1, 1] },
          type: { kind: "number" },
        },
      },
    });
    el.remove();
    // The cache is endpoint-session-scoped: a reconnect builds a new
    // endpoint whose generation space restarts at 1, so a surviving
    // payload would replay a generation from the old space.
    document.body.appendChild(el);
    await tick(20);
    const late: Delivery[] = [];
    request({
      id: "s1",
      ref: REF,
      column: "m",
      deliver: (d: Delivery): void => {
        late.push(d);
      },
    });
    await Promise.resolve();
    assert.lengthOf(late, 0);
  });
});
