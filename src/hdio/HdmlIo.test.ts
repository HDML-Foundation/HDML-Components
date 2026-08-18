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

// A no-op sink for the requests that only assert registration —
// `deliver` is REQUIRED now, so a detail without it is rejected.
const sink = (): void => undefined;

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
});
