/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import { readConfig } from "../hdio/config";
import type { Delivery, DeliveryCode } from "../hdio/delivery";
import type { FakeColumn, FakeResult } from "./FakeIo";

/**
 * The D8 **provider** contract, written once and run against every
 * provider (RFC 016/001 §10.3, R13; D8 §1/§4/§6).
 *
 * A second, hand-written suite for `FakeIo` that happened to agree
 * with the `<hdml-io>` one would prove only that the same author
 * wrote both. So the fourteen clauses below exist exactly once, and
 * both providers are pushed through them in the same order.
 *
 * A new provider behaviour belongs **here**, not in a second suite.
 *
 * The clauses assert *behaviour*, never a registry accessor: whether
 * a request registered is observed by feeding a result and counting
 * deliveries, and whether a malformed request registered is observed
 * by re-using its `id` on a well-formed one — a provider that had
 * wrongly registered the first would then reject the second as a
 * duplicate. That is what keeps {@link ProviderHarness} to four
 * methods and applicable to a real custom element.
 *
 * @module testing/conformance
 */

/** What a provider harness must supply for the shared suite. */
export interface ProviderHarness {
  /** A label for the suite name. */
  name: string;

  /** Bring the provider up; resolve when it can receive. */
  mount(): Promise<void>;

  /** Tear it down (and, for a real element, remove it). */
  unmount(): void;

  /** Push one atomic result through, however this provider does. */
  feed(ref: string, result: FakeResult): void;

  /** Push one failure through. */
  fail(
    ref: undefined | string,
    message: string,
    code: DeliveryCode,
    generation?: number,
  ): void;
}

/** The ref every clause subscribes to. */
const REF = "?hdml-frame=x";

/** A second ref, for the fan-out scoping clauses. */
const REF2 = "?hdml-frame=other";

/** A collected delivery sink. */
interface Sink {
  got: Delivery[];
  deliver: (d: Delivery) => void;
}

/**
 * A fresh recording sink.
 *
 * @returns Its `got` array and the `deliver` that appends to it.
 */
function sink(): Sink {
  const got: Delivery[] = [];
  return {
    got,
    deliver: (d: Delivery): void => {
      got.push(d);
    },
  };
}

/**
 * Dispatches a D8 request on `document` under the **configured**
 * event name, so overriding `window.HDML_CONFIG` steers every
 * provider identically.
 *
 * @param detail - The request detail (deliberately `unknown`, so a
 *   malformed one can be dispatched).
 */
function request(detail: unknown): void {
  document.dispatchEvent(
    new CustomEvent(readConfig().requestEvent, {
      detail,
      bubbles: true,
      composed: true,
    }),
  );
}

/**
 * A canned numeric column.
 *
 * @param values - Optional shared value buffer.
 * @returns The column fixture.
 */
function column(values?: FakeColumn["values"]): FakeColumn {
  return {
    values,
    domain: { kind: "extent", value: [1, 2] },
    type: { kind: "number" },
  };
}

/**
 * A canned one-column result.
 *
 * @param generation - The supersession stamp.
 * @param rows - The shared row count.
 * @param values - Optional shared value buffer for column `m`.
 * @returns The result fixture.
 */
function result(
  generation: number,
  rows: number,
  values?: FakeColumn["values"],
): FakeResult {
  return { generation, rows, columns: { m: column(values) } };
}

/** Narrows a delivery to its `data` arm. */
function asData(d: Delivery): Extract<Delivery, { kind: "data" }> {
  assert.equal(d.kind, "data");
  return d as Extract<Delivery, { kind: "data" }>;
}

/**
 * A per-suite event name, so clause 14 cannot count a neighbouring
 * harness's teardown. Every provider teardown now dispatches on
 * `document`, so counting the default name is order-dependent.
 *
 * @param name - The harness label.
 * @returns A slugged, suite-unique gone-event name.
 */
function goneNameFor(name: string): string {
  return `x-gone-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
}

/**
 * Runs the D8 provider-contract suite against one harness. Call it
 * at the **top level** of a `*.test.ts`: it calls `suite()` itself,
 * and the TDD globals only nest correctly from module scope.
 *
 * @param harness - A factory returning a fresh, unmounted harness.
 */
export function assertProviderConformance(
  harness: () => ProviderHarness,
): void {
  const label = harness().name;
  const gone = goneNameFor(label);

  suite(`D8 provider contract — ${label}`, () => {
    let h: ProviderHarness;

    setup(async () => {
      window.HDML_CONFIG = { goneEvent: gone };
      h = harness();
      await h.mount();
    });

    teardown(() => {
      h.unmount();
      delete window.HDML_CONFIG;
    });

    test("01 a request registers; a duplicate id does not", () => {
      const a = sink();
      const detail = {
        id: "s1",
        ref: REF,
        column: "m",
        deliver: a.deliver,
      };
      request(detail);
      request(detail);
      h.feed(REF, result(1, 2));
      // Two deliveries would mean the id registered twice.
      assert.lengthOf(a.got, 1);
    });

    test("02 a non-function deliver registers nothing", () => {
      const none = sink();
      const bad = sink();
      // No `deliver` at all, and a non-function one. Each id is then
      // re-used by a well-formed request: if the malformed one had
      // registered, the good one would be rejected as a duplicate.
      request({ id: "s1", ref: REF, column: "m" });
      request({
        id: "s1",
        ref: REF,
        column: "m",
        deliver: none.deliver,
      });
      request({ id: "s2", ref: REF, column: "m", deliver: "x" });
      request({
        id: "s2",
        ref: REF,
        column: "m",
        deliver: bad.deliver,
      });
      h.feed(REF, result(1, 2));
      assert.lengthOf(none.got, 1);
      assert.lengthOf(bad.got, 1);
    });

    test("03 an already-aborted signal registers nothing", () => {
      const ctrl = new AbortController();
      ctrl.abort();
      const dead = sink();
      const live = sink();
      request({
        id: "s1",
        ref: REF,
        column: "m",
        signal: ctrl.signal,
        deliver: dead.deliver,
      });
      request({
        id: "s1",
        ref: REF,
        column: "m",
        deliver: live.deliver,
      });
      h.feed(REF, result(1, 2));
      assert.lengthOf(dead.got, 0);
      assert.lengthOf(live.got, 1);
    });

    test("04 one result reaches every subscriber, one task", () => {
      const a = sink();
      const b = sink();
      const c = sink();
      const other = sink();
      request({
        id: "s1",
        ref: REF,
        column: "m",
        deliver: a.deliver,
      });
      request({
        id: "s2",
        ref: REF,
        column: "m",
        deliver: b.deliver,
      });
      request({
        id: "s3",
        ref: REF,
        column: "d",
        raw: false,
        deliver: c.deliver,
      });
      request({
        id: "s4",
        ref: REF2,
        column: "m",
        deliver: other.deliver,
      });
      h.feed(REF, {
        generation: 3,
        rows: 2,
        columns: { m: column(), d: column() },
      });
      // Asserted with NO await: the fan-out is synchronous within
      // the receiving task, which is what dissolves the cross-child
      // stack barrier (D8 §1).
      assert.lengthOf(a.got, 1);
      assert.lengthOf(b.got, 1);
      assert.lengthOf(c.got, 1);
      assert.lengthOf(other.got, 0);
      assert.equal(asData(a.got[0]).generation, 3);
      assert.equal(asData(a.got[0]).rows, 2);
      assert.equal(a.got[0].column, "m");
      assert.equal(c.got[0].column, "d");
    });

    test("05 a subscribed absent column → kind:absent", () => {
      const s = sink();
      request({
        id: "s1",
        ref: REF,
        column: "typo",
        deliver: s.deliver,
      });
      h.feed(REF, result(7, 4));
      assert.deepEqual(s.got, [
        {
          kind: "absent",
          ref: REF,
          column: "typo",
          generation: 7,
          rows: 4,
          code: "absent-column",
        },
      ]);
    });

    test("06 values are shared by reference", () => {
      const buffer = new Float64Array([1, 2]).buffer;
      const values = { buffer, byteOffset: 0, byteLength: 16 };
      const a = sink();
      const b = sink();
      request({
        id: "s1",
        ref: REF,
        column: "m",
        deliver: a.deliver,
      });
      request({
        id: "s2",
        ref: REF,
        column: "m",
        deliver: b.deliver,
      });
      h.feed(REF, result(1, 2, values));
      // Each subscriber gets its own slice object, but a column
      // bound by five marks is never re-cloned (D8 §6.4).
      const va = asData(a.got[0]).values;
      const vb = asData(b.got[0]).values;
      assert.strictEqual(va, vb);
      assert.strictEqual(va, values);
    });

    test("07 an error reaches every subscriber of its ref", () => {
      const a = sink();
      const b = sink();
      const other = sink();
      request({
        id: "s1",
        ref: REF,
        column: "m",
        deliver: a.deliver,
      });
      request({
        id: "s2",
        ref: REF,
        column: "d",
        deliver: b.deliver,
      });
      request({
        id: "s3",
        ref: REF2,
        column: "m",
        deliver: other.deliver,
      });
      h.fail(REF, "kaboom", "query-failed", 4);
      // The failure is the frame's, not one column's, so both
      // columns of the ref hear it and the other ref does not.
      assert.deepEqual(a.got, [
        {
          kind: "error",
          ref: REF,
          column: "m",
          message: "kaboom",
          code: "query-failed",
          generation: 4,
        },
      ]);
      assert.lengthOf(b.got, 1);
      assert.equal(b.got[0].column, "d");
      assert.lengthOf(other.got, 0);
    });

    test("08 a ref-less error reaches nobody", () => {
      const s = sink();
      request({
        id: "s1",
        ref: REF,
        column: "m",
        deliver: s.deliver,
      });
      h.fail(undefined, "no ref", "transport");
      assert.lengthOf(s.got, 0);
    });

    test("09 an unstamped error carries no generation", () => {
      const s = sink();
      request({
        id: "s1",
        ref: REF,
        column: "m",
        deliver: s.deliver,
      });
      h.fail(REF, "not ready before timeout", "gate-timeout");
      assert.lengthOf(s.got, 1);
      assert.equal(s.got[0].kind, "error");
      // Never defaulted to 0: R38 makes the stamp, not the kind,
      // decide staleness.
      assert.notProperty(s.got[0], "generation");
      assert.isUndefined(s.got[0].generation);
    });

    test("10 a late subscriber is replayed async", async () => {
      const buffer = new Float64Array([1, 2]).buffer;
      const values = { buffer, byteOffset: 0, byteLength: 16 };
      h.feed(REF, result(5, 2, values));
      const late = sink();
      request({
        id: "s1",
        ref: REF,
        column: "m",
        deliver: late.deliver,
      });
      assert.lengthOf(late.got, 0);
      await Promise.resolve();
      assert.lengthOf(late.got, 1);
      assert.equal(asData(late.got[0]).generation, 5);
      assert.strictEqual(asData(late.got[0]).values, values);
    });

    test("11 a same-task abort cancels the replay", async () => {
      h.feed(REF, result(1, 1));
      const s = sink();
      const ctrl = new AbortController();
      request({
        id: "s1",
        ref: REF,
        column: "m",
        signal: ctrl.signal,
        deliver: s.deliver,
      });
      ctrl.abort();
      await Promise.resolve();
      assert.lengthOf(s.got, 0);
    });

    test("12 a later result overwrites the cache", async () => {
      h.feed(REF, result(1, 1));
      h.feed(REF, result(2, 9));
      const late = sink();
      request({
        id: "s1",
        ref: REF,
        column: "m",
        deliver: late.deliver,
      });
      await Promise.resolve();
      assert.lengthOf(late.got, 1);
      assert.equal(asData(late.got[0]).generation, 2);
      assert.equal(asData(late.got[0]).rows, 9);
    });

    test("13 abort stops delivery", () => {
      const s = sink();
      const ctrl = new AbortController();
      request({
        id: "s1",
        ref: REF,
        column: "m",
        signal: ctrl.signal,
        deliver: s.deliver,
      });
      h.feed(REF, result(1, 1));
      assert.lengthOf(s.got, 1);
      ctrl.abort();
      h.feed(REF, result(2, 1));
      assert.lengthOf(s.got, 1);
    });

    test("14 teardown announces gone exactly once", () => {
      const seen: Event[] = [];
      const onGone = (e: Event): void => {
        seen.push(e);
      };
      const onDefault = (): void => {
        seen.push(new Event("unexpected"));
      };
      // The configured name proves the dispatch reads HDML_CONFIG,
      // and the default-name listener catches a neighbouring
      // harness's teardown leaking into this count.
      document.addEventListener(gone, onGone);
      document.addEventListener("hdml-io-gone", onDefault);
      h.unmount();
      document.removeEventListener(gone, onGone);
      document.removeEventListener("hdml-io-gone", onDefault);
      assert.lengthOf(seen, 1);
      assert.equal(seen[0].type, gone);
      assert.isTrue(seen[0].bubbles);
      assert.isTrue(seen[0].composed);
    });
  });
}
