/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import { HdmlIo, nav, endpoints } from "./HdmlIo";
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

// Feeds a worker `result` in through the fake endpoint's onmessage.
function feedResult(ep: FakeEndpoint, data: unknown): void {
  ep.onmessage?.(
    new MessageEvent("message", {
      data: { type: "result", data },
    }),
  );
}

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
    const detail = { id: "s1", ref: REF, column: "m" };
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
    request({ id: "s1", ref: REF, column: "m" });
    const subs = ofType(ep, "subscribe");
    assert.lengthOf(subs, 1);
    assert.equal((subs[0].data as { id: string }).id, "s1");
  });

  test("a duplicate id yields one subscription", async () => {
    mount({ host: "", tenant: "t" });
    await tick(20);
    const detail = { id: "s1", ref: REF, column: "m" };
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

  test("one result fans out to every subscriber", async () => {
    mount({ host: "", tenant: "t" });
    await tick(20);
    const got1: unknown[] = [];
    const got2: unknown[] = [];
    const got3: unknown[] = [];
    request({
      id: "s1",
      ref: REF,
      column: "m",
      deliver: (r: unknown): void => {
        got1.push(r);
      },
    });
    request({
      id: "s2",
      ref: REF,
      column: "m",
      deliver: (r: unknown): void => {
        got2.push(r);
      },
    });
    // A pure axis on a different column, domain-only (raw:false).
    request({
      id: "s3",
      ref: REF,
      column: "d",
      raw: false,
      deliver: (r: unknown): void => {
        got3.push(r);
      },
    });
    // The worker emits one values-bearing result for column "m"…
    const mPayload = {
      ref: REF,
      column: "m",
      values: ["a", "b"],
      domain: { kind: "ordinal", value: ["a", "b"] },
      type: { kind: "string" },
    };
    feedResult(ep, mPayload);
    // …and a domain-only result for the raw:false column "d".
    feedResult(ep, {
      ref: REF,
      column: "d",
      domain: { kind: "extent", value: [10, 30] },
      type: { kind: "number" },
    });
    // Both subscribers of (REF, "m") got the *same* object — one
    // main-thread buffer shared by reference, never re-cloned (D7).
    assert.lengthOf(got1, 1);
    assert.lengthOf(got2, 1);
    assert.strictEqual(got1[0], got2[0]);
    assert.strictEqual(got1[0], mPayload);
    // The raw:false subscriber got domain only, no values.
    assert.lengthOf(got3, 1);
    const r3 = got3[0] as { values?: unknown; domain: unknown };
    assert.isUndefined(r3.values);
    assert.deepEqual(r3.domain, { kind: "extent", value: [10, 30] });
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
      deliver: (r: unknown): void => {
        got.push(r);
      },
    });
    assert.lengthOf(ofType(ep, "subscribe"), 1);
    ctrl.abort();
    const unsubs = ofType(ep, "unsubscribe");
    assert.lengthOf(unsubs, 1);
    assert.equal((unsubs[0].data as { id: string }).id, "s1");
    // A later result is not delivered to the aborted subscriber.
    feedResult(ep, {
      ref: REF,
      column: "m",
      domain: { kind: "ordinal", value: [] },
      type: { kind: "string" },
    });
    assert.lengthOf(got, 0);
  });
});
