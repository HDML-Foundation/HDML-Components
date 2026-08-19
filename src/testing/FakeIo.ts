/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { readConfig } from "../hdio/config";
import type {
  Delivery,
  DeliveryCode,
  RequestDetail,
} from "../hdio/delivery";

/**
 * A **page-level** double of the D8 provider (RFC 016/001 §10.3,
 * R13). It replaces `<hdml-io>` outright: it listens for the
 * configured request event on `document`, announces ready, and
 * answers with canned {@link Delivery} objects.
 *
 * Because the seam **is** an event plus a callback, a *conformant*
 * double is possible at all — and because twenty-eight downstream
 * gates trust it, conformance is proven rather than asserted: the D8
 * provider contract is written once, as the fourteen clauses of
 * `./conformance`, and run against this class **and** the real
 * `<hdml-io>`.
 *
 * Two constraints on this module are load-bearing.
 *
 * **It imports exactly two `hdio` modules** — `config` as a value and
 * `delivery` **type-only** — the same §2.1 edge `src/hdvl/` lives
 * under. `check-dist.mjs` does not scan `src/testing/`, so a value
 * import of `Delivery` here would tunnel the worker, `@hdml/parser`
 * and Arrow past the guard for anyone reading only that script.
 *
 * **It is deliberately not a custom element.** `npm run manifest`
 * globs all of `src/`, and `custom-elements.json` is a declared
 * package field, so a registered double would be advertised in the
 * **published** manifest — and the tsconfig exclusion cannot stop
 * that, because CEM reads source, not the emitted trees. A plain
 * class needs no registration: the seam is a `document` event plus a
 * callback, so there is nothing for an element to do.
 *
 * **It only produces.** Nothing here tracks a latest generation,
 * reacts to the gone event, or sets a `:state()`. Contract 4's
 * consumer half is implemented exactly once, at step 13.
 *
 * @module testing/FakeIo
 */

/** The `data` arm — the structural source for {@link FakeColumn}. */
type DataDelivery = Extract<Delivery, { kind: "data" }>;

/**
 * One canned column, in the shape the worker's `ColumnResult` has.
 * Derived from the `data` arm rather than re-declared, because
 * `Domain` and `ColumnType` live in `../hdio/reducers` and
 * `../hdio/decode` — two modules the §2.1 edge does not permit this
 * one to import. A `Pick` keeps the fixture literally the same type
 * a real delivery carries, with no second declaration to drift.
 */
export type FakeColumn = Pick<
  DataDelivery,
  "values" | "nulls" | "domain" | "type"
>;

/**
 * One ref's canned result, in the atomic `(ref, generation)` shape
 * the worker posts (D8 §1).
 */
export interface FakeResult {
  generation: number;
  rows: number;
  columns: Record<string, FakeColumn>;
}

/** Construction options for {@link FakeIo}. */
export interface FakeIoOptions {
  /**
   * Seed results, delivered to any subscriber of the ref — including
   * one that subscribes later (late-join replay).
   */
  results?: Record<string, FakeResult>;

  /**
   * Suppress the ready announce, so a test can drive the handshake
   * by hand. Default `false`.
   */
  silent?: boolean;
}

/** One registered subscription, as a test may read it back. */
export interface FakeSubscription {
  id: string;
  ref: string;
  column: string;
  raw: boolean;
}

/** The registry entry, including the sink and the teardown signal. */
interface FakeSubscriber extends FakeSubscription {
  deliver: (d: Delivery) => void;
  signal?: AbortSignal;
}

/**
 * The double. Construct, {@link FakeIo.mount}, feed; every event
 * name is read from `window.HDML_CONFIG` through `readConfig()`, so
 * a test that overrides a name drives this and the real `<hdml-io>`
 * identically.
 */
export class FakeIo {
  /** `ref → latest canned result`, the replay cache (D8 §4). */
  #results = new Map<string, FakeResult>();

  /** `id → subscriber`, de-duped by `id` exactly as `HdmlIo` is. */
  #subs = new Map<string, FakeSubscriber>();

  /**
   * The request-event name captured at {@link FakeIo.mount}, so
   * `removeEventListener` uses the exact string `addEventListener`
   * did even if the host mutates the config mid-life. Doubles as the
   * mounted flag.
   */
  #requestEvent: null | string = null;

  #silent: boolean;

  /**
   * @param options - Seed results and the silent-handshake flag.
   */
  public constructor(options: FakeIoOptions = {}) {
    this.#silent = options.silent === true;
    const seeds = options.results ?? {};
    for (const ref of Object.keys(seeds)) {
      this.#results.set(ref, seeds[ref]);
    }
  }

  /**
   * Every subscription currently registered, for assertions on what
   * a consumer asked for.
   */
  public get subscriptions(): ReadonlyArray<FakeSubscription> {
    return [...this.#subs.values()].map((s) => ({
      id: s.id,
      ref: s.ref,
      column: s.column,
      raw: s.raw,
    }));
  }

  /**
   * Wires the request listener on `document` and announces ready —
   * in that order, so a consumer that re-dispatches on the announce
   * is heard (the symmetric handshake, §5.8). Idempotent.
   */
  public mount(): void {
    if (this.#requestEvent !== null) {
      return;
    }
    this.#requestEvent = readConfig().requestEvent;
    document.addEventListener(this.#requestEvent, this.#onRequest);
    if (!this.#silent) {
      this.#announce(readConfig().readyEvent);
    }
  }

  /**
   * Unwires, clears the registry and the replay cache, and announces
   * gone — the same order `HdmlIo.disconnectedCallback` uses, so a
   * consumer reacting synchronously cannot re-register against a
   * dying provider. Idempotent: a second call announces nothing.
   */
  public unmount(): void {
    if (this.#requestEvent === null) {
      return;
    }
    document.removeEventListener(this.#requestEvent, this.#onRequest);
    this.#requestEvent = null;
    this.#subs.clear();
    this.#results.clear();
    this.announceGone();
  }

  /**
   * Delivers one atomic result to **every** subscriber of `ref`,
   * synchronously within this task (D8 §1), and retains it so a
   * later subscriber is replayed rather than starved.
   *
   * No supersession filtering happens here, on purpose: a provider
   * delivers what it is given, and the consumer adopts iff
   * `G >= latest` (D8 §6.1). Feeding G2 then G1 is exactly the input
   * step 13's discard test needs.
   *
   * @param ref - The effective source ref.
   * @param result - The canned atomic result.
   */
  public feed(ref: string, result: FakeResult): void {
    this.#results.set(ref, result);
    this.#subs.forEach((sub) => {
      if (sub.ref !== ref) {
        return;
      }
      sub.deliver(this.#sliceFor(ref, result, sub.column));
    });
  }

  /**
   * Fans a ref-scoped failure out to every subscriber of that ref,
   * whatever column each is bound to. A `ref` of `undefined` is the
   * ref-less case: logged, delivered to nobody (D8 §4).
   *
   * `generation` is stamped **only** when supplied, never defaulted
   * to `0` — R38 makes the stamp, not the kind, decide staleness, so
   * a fabricated one would make an unstamped gate timeout comparable
   * against a later data generation.
   *
   * @param ref - The failing ref, or `undefined` for the ref-less
   *   case.
   * @param message - The failure text.
   * @param code - The stable machine-readable failure id.
   * @param generation - The stamp, when the failure has one.
   */
  public fail(
    ref: undefined | string,
    message: string,
    code: DeliveryCode,
    generation?: number,
  ): void {
    if (typeof ref !== "string") {
      console.error("FakeIo error:", message);
      return;
    }
    this.#subs.forEach((sub) => {
      if (sub.ref !== ref) {
        return;
      }
      const delivery: Extract<Delivery, { kind: "error" }> = {
        kind: "error",
        ref,
        column: sub.column,
        message,
        code,
      };
      if (typeof generation === "number") {
        delivery.generation = generation;
      }
      sub.deliver(delivery);
    });
  }

  /**
   * Announces the gone event **without** unmounting — the
   * provider-restart case, which a real server cannot be asked for
   * on demand. Nothing in this repo reacts to it: the reaction
   * (reset the adopted generation, return to `:state(loading)`,
   * await the next ready) is step 13's.
   */
  public announceGone(): void {
    this.#announce(readConfig().goneEvent);
  }

  /**
   * Dispatches one discovery-bus event on `document`,
   * `bubbles`/`composed` so it crosses any shadow boundary a
   * consumer sits behind — the same two flags `HdmlIo` uses.
   *
   * @param type - The configured event name.
   * @private
   */
  #announce = (type: string): void => {
    document.dispatchEvent(
      new CustomEvent(type, { bubbles: true, composed: true }),
    );
  };

  /**
   * Registers a subscriber from a request event, applying the
   * **same four validations** `HdmlIo.#onRequest` applies — three
   * string checks plus `typeof deliver !== "function"` — and
   * rejecting by a plain `return`. A double that accepted a detail
   * the real provider rejects would let a broken consumer pass every
   * downstream gate.
   *
   * @param ev - The request `CustomEvent`.
   * @private
   */
  #onRequest = (ev: Event): void => {
    const detail = (ev as CustomEvent<RequestDetail>).detail;
    if (
      !detail ||
      typeof detail.id !== "string" ||
      typeof detail.ref !== "string" ||
      typeof detail.column !== "string" ||
      typeof detail.deliver !== "function"
    ) {
      return;
    }
    if (this.#subs.has(detail.id) || detail.signal?.aborted) {
      return;
    }
    const sub: FakeSubscriber = {
      id: detail.id,
      ref: detail.ref,
      column: detail.column,
      raw: detail.raw !== false,
      deliver: detail.deliver,
      signal: detail.signal,
    };
    this.#subs.set(sub.id, sub);
    detail.signal?.addEventListener(
      "abort",
      () => {
        this.#subs.delete(sub.id);
      },
      { once: true },
    );
    // Late-join replay, `queueMicrotask` and never a synchronous
    // call: request → delivery is ALWAYS async (D8 §4). The identity
    // re-check covers a signal that fires in the request's own task.
    const cached = this.#results.get(sub.ref);
    if (cached) {
      queueMicrotask(() => {
        if (this.#subs.get(sub.id) !== sub) {
          return;
        }
        sub.deliver(this.#sliceFor(sub.ref, cached, sub.column));
      });
    }
  };

  /**
   * One subscriber's slice of a canned result — the single
   * implementation the live feed **and** the replay both call.
   *
   * The lookup goes through `hasOwnProperty` because `columns` is
   * keyed by **author-controlled** names: a bare index returns
   * `Object.prototype.constructor` — truthy, and not a column — for
   * a column named `constructor` / `toString` / `valueOf`.
   *
   * @param ref - The result's ref.
   * @param result - The canned result.
   * @param column - The subscriber's bound column.
   * @returns The `data` or `absent` delivery for that column.
   * @private
   */
  #sliceFor = (
    ref: string,
    result: FakeResult,
    column: string,
  ): Delivery => {
    const has = Object.prototype.hasOwnProperty;
    const col = has.call(result.columns, column)
      ? result.columns[column]
      : undefined;
    if (!col) {
      return {
        kind: "absent",
        ref,
        column,
        generation: result.generation,
        rows: result.rows,
        code: "absent-column",
      };
    }
    return {
      kind: "data",
      ref,
      column,
      generation: result.generation,
      rows: result.rows,
      values: col.values,
      nulls: col.nulls,
      domain: col.domain,
      type: col.type,
    };
  };
}

/**
 * Every instance {@link mountFakeIo} created and has not yet torn
 * down. Module-level, because the teardown hook below is registered
 * once per test page rather than once per call.
 */
const mounted: FakeIo[] = [];

/**
 * The RFC §10.3 convenience: construct, seed, mount, and register
 * the teardown.
 *
 * @param results - Seed results keyed by ref.
 * @returns The instance, for per-test control.
 */
export function mountFakeIo(
  results?: Record<string, FakeResult>,
): FakeIo {
  const io = new FakeIo({ results });
  io.mount();
  mounted.push(io);
  return io;
}

// A ROOT-level `teardown`, registered when this module is first
// imported — deliberately, not a hook added from inside
// `mountFakeIo`. Mocha resolves a suite's hook list when it runs, so
// registering from inside a running test would append one more hook
// on every call and attach it to whichever suite happened to be
// executing. One root hook, added at import, unmounts anything left
// mounted after every test in the page. `src/testing/` is a
// test-only tree that reaches the browser through `tst.json` alone,
// so depending on the TDD globals here is in-contract.
teardown(() => {
  while (mounted.length > 0) {
    mounted.pop()?.unmount();
  }
});
