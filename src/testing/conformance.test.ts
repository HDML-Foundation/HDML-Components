/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import { HdmlIo, nav, endpoints } from "../hdio/HdmlIo";
import type { Endpoint } from "../hdio/endpoint";
import type { Delivery } from "../hdio/delivery";
import { FakeIo, mountFakeIo } from "./FakeIo";
import type { FakeColumn, FakeResult } from "./FakeIo";
import { assertProviderConformance } from "./conformance";
import type { ProviderHarness } from "./conformance";

// The two harnesses live in ONE file on purpose: "the double is held
// to the same contract" has to be visible in a single diff, and
// splitting them across directories re-opens exactly the drift the
// shared suite exists to close.
//
// This is the only module under `src/testing/` that imports an hdio
// module beyond `config` + type-only `delivery`, and it is a
// `*.test.ts`: compiled by `tst.json` alone, present in no published
// tree, imported by nothing. The §2.1 edge is about what enters a
// chart page's bundle.

const REF = "?hdml-frame=x";

// A macrotask yield. Bare-awaiting a promise resolved by a port
// message flakes on WebKit; a real timer covers both engines.
const tick = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Dispatches a D8 request under the default event name. */
function request(detail: unknown): void {
  document.dispatchEvent(
    new CustomEvent("hdml-io-request", {
      detail,
      bubbles: true,
      composed: true,
    }),
  );
}

/** A recording sink plus its collected deliveries. */
function sink(): {
  got: Delivery[];
  deliver: (d: Delivery) => void;
} {
  const got: Delivery[] = [];
  return {
    got,
    deliver: (d: Delivery): void => {
      got.push(d);
    },
  };
}

/** The minimal endpoint surface `HdmlIo` actually drives. */
interface FakeEndpoint {
  onmessage: null | ((ev: MessageEvent) => void);
  postMessage(msg: unknown): void;
  close(): void;
}

/** A worker `error` payload, assembled field by field. */
interface ErrorData {
  ref?: string;
  generation?: number;
  message: string;
  code: string;
}

/**
 * The **real** `hdml-io` element as a D8 provider. The `endpoints`
 * and `nav` seams are MODULE singletons and are overridden before
 * the element is created: the legacy webcomponents polyfill upgrades
 * on connect and would clobber a per-instance injection.
 *
 * @returns A fresh, unmounted harness.
 */
function realHarness(): ProviderHarness {
  const savedNav = { ...nav };
  const savedEndpoints = { ...endpoints };
  let el: null | HdmlIo = null;
  let ep: null | FakeEndpoint = null;

  const post = (msg: unknown): void => {
    ep?.onmessage?.(new MessageEvent("message", { data: msg }));
  };

  return {
    name: "hdml-io",

    async mount(): Promise<void> {
      // Keep the OIDC auto-trigger inert regardless of runner URL.
      nav.href = (): string => "http://app.example/dash";
      nav.search = (): string => "";
      nav.navigate = (): void => undefined;
      nav.strip = (): void => undefined;
      const endpoint: FakeEndpoint = {
        onmessage: null,
        postMessage: (): void => undefined,
        close: (): void => undefined,
      };
      ep = endpoint;
      endpoints.create = (): Endpoint =>
        endpoint as unknown as Endpoint;
      el = document.createElement("hdml-io") as HdmlIo;
      el.setAttribute("host", "");
      el.setAttribute("tenant", "t");
      document.body.appendChild(el);
      await tick(20);
    },

    unmount(): void {
      if (el === null) {
        return;
      }
      el.remove();
      el = null;
      ep = null;
      Object.assign(nav, savedNav);
      Object.assign(endpoints, savedEndpoints);
    },

    feed(ref: string, res: FakeResult): void {
      post({ type: "result", data: { ref, ...res } });
    },

    fail(
      ref: undefined | string,
      message: string,
      code: string,
      generation?: number,
    ): void {
      const data: ErrorData = { message, code };
      if (typeof ref === "string") {
        data.ref = ref;
      }
      if (typeof generation === "number") {
        data.generation = generation;
      }
      post({ type: "error", data });
    },
  };
}

/**
 * The page-level double as a D8 provider.
 *
 * @returns A fresh, unmounted harness.
 */
function fakeHarness(): ProviderHarness {
  const io = new FakeIo();
  return {
    name: "FakeIo",
    mount(): Promise<void> {
      io.mount();
      return Promise.resolve();
    },
    unmount(): void {
      io.unmount();
    },
    feed(ref, res): void {
      io.feed(ref, res);
    },
    fail(ref, message, code, generation): void {
      io.fail(ref, message, code, generation);
    },
  };
}

// The same fourteen clauses, in the same order, both providers.
assertProviderConformance(fakeHarness);
assertProviderConformance(realHarness);

// Everything below is FakeIo-only: what the double can produce that
// a real server cannot be asked for on demand.
suite("FakeIo beyond the shared contract", () => {
  let io: null | FakeIo = null;

  teardown(() => {
    io?.unmount();
    io = null;
    delete window.HDML_CONFIG;
  });

  const column: FakeColumn = {
    domain: { kind: "extent", value: [1, 2] },
    type: { kind: "number" },
  };

  function res(generation: number, rows: number): FakeResult {
    return { generation, rows, columns: { m: column } };
  }

  function mounted(): FakeIo {
    const fake = new FakeIo();
    fake.mount();
    io = fake;
    return fake;
  }

  test("G2 then G1 are both delivered, unfiltered", () => {
    const fake = mounted();
    const s = sink();
    request({ id: "s1", ref: REF, column: "m", deliver: s.deliver });
    fake.feed(REF, res(2, 1));
    fake.feed(REF, res(1, 1));
    // The provider delivers what it is given; the CONSUMER discards
    // on `G >= latest` (D8 §6.1), and that is step 13's. A double
    // that filtered here would make step 13's discard untestable.
    assert.lengthOf(s.got, 2);
    assert.equal(s.got[0].generation, 2);
    assert.equal(s.got[1].generation, 1);
  });

  test("announceGone fires without unmounting", () => {
    window.HDML_CONFIG = { goneEvent: "x-gone-solo" };
    const fake = mounted();
    const seen: Event[] = [];
    const onGone = (e: Event): void => {
      seen.push(e);
    };
    document.addEventListener("x-gone-solo", onGone);
    fake.announceGone();
    // Still mounted: the provider-restart case, where a consumer
    // returns to :state(loading) and awaits the next ready.
    const s = sink();
    request({ id: "s1", ref: REF, column: "m", deliver: s.deliver });
    fake.feed(REF, res(1, 1));
    assert.lengthOf(s.got, 1);
    assert.lengthOf(seen, 1);
    assert.isTrue(seen[0].bubbles);
    assert.isTrue(seen[0].composed);
    fake.unmount();
    assert.lengthOf(seen, 2);
    // Idempotent: a second unmount announces nothing.
    fake.unmount();
    assert.lengthOf(seen, 2);
    document.removeEventListener("x-gone-solo", onGone);
  });

  test("mountFakeIo seeds, and replays a late joiner", async () => {
    const seeded = mountFakeIo({ [REF]: res(4, 3) });
    const s = sink();
    request({
      id: "s1",
      ref: REF,
      column: "m",
      raw: false,
      deliver: s.deliver,
    });
    // The registry records what the consumer asked for, `raw`
    // included — there is no other way to assert a domain-only
    // subscription from the provider side.
    assert.deepEqual(seeded.subscriptions, [
      { id: "s1", ref: REF, column: "m", raw: false },
    ]);
    assert.lengthOf(s.got, 0);
    await Promise.resolve();
    assert.lengthOf(s.got, 1);
    assert.equal(s.got[0].generation, 4);
    // The module's root teardown unmounts it; nothing to do here.
  });

  test("a zero-row result is a real delivery", () => {
    const fake = mounted();
    const s = sink();
    request({ id: "s1", ref: REF, column: "m", deliver: s.deliver });
    fake.feed(REF, res(1, 0));
    // `rows: 0` is a real empty result, not a missing one — the
    // input R22/R34's `empty` quantifier needs, and a case a real
    // server cannot be asked for on demand.
    assert.lengthOf(s.got, 1);
    assert.equal(s.got[0].kind, "data");
    assert.equal(
      (s.got[0] as Extract<Delivery, { kind: "data" }>).rows,
      0,
    );
  });
});
