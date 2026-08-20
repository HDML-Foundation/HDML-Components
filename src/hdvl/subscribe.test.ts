/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert, fixture } from "@open-wc/testing";
import { html } from "lit/static-html.js";
import { LitElement } from "lit";
import "./index";
import { BINDER_TAG, HdvlBinderElement } from "../testing/binder";
import { FakeIo, mountFakeIo } from "../testing/FakeIo";
import type { FakeColumn, FakeResult } from "../testing/FakeIo";
import type { Delivery, RequestDetail } from "../hdio/delivery";
import { HdmlViewElement } from "./view";
import { currentPhase } from "./schedule";
import {
  adoptedOf,
  deliveryTrace,
  subscriptionsOf,
} from "./subscribe";

/**
 * The subscription spine (§7.2–§7.4) — Contract 4's consumer half.
 *
 * Every claim here is about *identity, ordering and lifecycle*, never
 * about pixels: the binder emits one rect so that "painting" is
 * observable, and nothing asserts its geometry. `FakeIo` is the
 * provider throughout, and it applies **no** supersession filtering,
 * which is exactly what makes the discard tests possible.
 *
 * The fixtures carry a real scale chain and an `aria-label`, so a
 * failure here is never confused with V1/V13/W2 log noise.
 */

/** A one-column canned column. */
function col(values: string[]): FakeColumn {
  return {
    values,
    nulls: undefined,
    domain: { kind: "ordinal", value: values },
    type: { kind: "string" },
  };
}

/** One canned atomic result. */
function res(
  generation: number,
  columns: Record<string, string[]>,
): FakeResult {
  const out: Record<string, FakeColumn> = {};
  let rows = 0;
  for (const name of Object.keys(columns)) {
    out[name] = col(columns[name]);
    rows = Math.max(rows, columns[name].length);
  }
  return { generation, rows, columns: out };
}

function tick(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

async function settle(root: Element): Promise<void> {
  const all = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const el of all) {
    if (el instanceof LitElement) {
      await el.updateComplete;
    }
  }
}

/** Waits until no frame has run for three consecutive rAFs. */
async function quiesce(view: HdmlViewElement): Promise<void> {
  let last = -1;
  let still = 0;
  for (let i = 0; i < 60 && still < 3; i++) {
    await tick();
    if (view.framesRun === last && !view.dirty) {
      still++;
    } else {
      still = 0;
      last = view.framesRun;
    }
  }
}

/** One binder under one scale, in a valid, quiet chain. */
async function one(source: string): Promise<{
  view: HdmlViewElement;
  binder: HdvlBinderElement;
}> {
  const view = await fixture<HdmlViewElement>(html`
    <hdml-view
      aria-label="subscription spine"
      source="${source}"
      style="width: 400px; height: 200px"
    >
      <hdml-cartesian-plane>
        <hdml-continuous-scale channel="y">
          <hdvl-binder
            style="width: 40px; height: 40px"
          ></hdvl-binder>
        </hdml-continuous-scale>
      </hdml-cartesian-plane>
    </hdml-view>
  `);
  await settle(view);
  await quiesce(view);
  const binder = <HdvlBinderElement>view.querySelector(BINDER_TAG);
  return { view, binder };
}

/** Two binders, each under its own scale with its own source. */
async function two(
  a: string,
  b: string,
): Promise<{
  view: HdmlViewElement;
  first: HdvlBinderElement;
  second: HdvlBinderElement;
}> {
  const view = await fixture<HdmlViewElement>(html`
    <hdml-view
      aria-label="two sources"
      style="width: 400px; height: 200px"
    >
      <hdml-cartesian-plane>
        <hdml-continuous-scale channel="y" source="${a}">
          <hdvl-binder
            id="first"
            style="width: 40px; height: 40px"
          ></hdvl-binder>
        </hdml-continuous-scale>
        <hdml-continuous-scale channel="x" source="${b}">
          <hdvl-binder
            id="second"
            style="width: 40px; height: 40px"
          ></hdvl-binder>
        </hdml-continuous-scale>
      </hdml-cartesian-plane>
    </hdml-view>
  `);
  await settle(view);
  await quiesce(view);
  return {
    view,
    first: <HdvlBinderElement>view.querySelector("#first"),
    second: <HdvlBinderElement>view.querySelector("#second"),
  };
}

/** Every request detail seen on the bus, `deliver` included. */
function captureRequests(): {
  seen: RequestDetail[];
  stop: () => void;
} {
  const seen: RequestDetail[] = [];
  const on = (e: Event): void => {
    seen.push((<CustomEvent<RequestDetail>>e).detail);
  };
  document.addEventListener("hdml-io-request", on);
  return {
    seen,
    stop: (): void => {
      document.removeEventListener("hdml-io-request", on);
    },
  };
}

/** Counts `hdml-data` events, with their targets. */
function countData(): { seen: Event[]; stop: () => void } {
  const seen: Event[] = [];
  const on = (e: Event): void => {
    seen.push(e);
  };
  document.addEventListener("hdml-data", on);
  return {
    seen,
    stop: (): void => {
      document.removeEventListener("hdml-data", on);
    },
  };
}

suite("hdvl/subscribe — identity and reconciliation", () => {
  test("a rebind adopts only the second column", async () => {
    const io = mountFakeIo({
      rev: res(1, { revenue: ["a"], profit: ["b"] }),
    });
    const { view, binder } = await one("rev");
    binder.bind("y", "revenue");
    await quiesce(view);

    assert.lengthOf(io.subscriptions, 1);
    assert.strictEqual(io.subscriptions[0].column, "revenue");
    assert.strictEqual(adoptedOf(binder, "y")?.column, "revenue");

    binder.bind("y", "profit");
    await quiesce(view);

    // One entry, not a dead `revenue` beside a live `profit`.
    assert.lengthOf(io.subscriptions, 1);
    assert.strictEqual(io.subscriptions[0].column, "profit");
    assert.lengthOf(subscriptionsOf(view), 1);
    assert.strictEqual(adoptedOf(binder, "y")?.column, "profit");
  });

  test("a source swap mints a NEW id", async () => {
    const io = mountFakeIo();
    const { view, binder } = await one("a");
    binder.bind("y", "m");
    await quiesce(view);
    const before = subscriptionsOf(view)[0].id;
    io.feed("a", res(3, { m: ["x"] }));
    await quiesce(view);
    assert.strictEqual(binder.generationAt("y"), 3);

    view.setAttribute("source", "b");
    await quiesce(view);

    const after = subscriptionsOf(view)[0];
    // The whole point of R29: a reused id is silently discarded as
    // a duplicate and never subscribes at all.
    assert.notStrictEqual(after.id, before);
    assert.strictEqual(after.ref, "b");
    assert.lengthOf(io.subscriptions, 1);
    assert.strictEqual(io.subscriptions[0].ref, "b");

    // The new ref's generation 1 is adopted, because REMOVE reset
    // `latest` to 0 — the old ref's 3 is not comparable with it.
    io.feed("b", res(1, { m: ["y"] }));
    await quiesce(view);
    assert.strictEqual(binder.generationAt("y"), 1);
  });

  test("an inherited source change reaches descendants", async () => {
    const io = mountFakeIo();
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view
        aria-label="inherited"
        source="one"
        style="width: 400px; height: 200px"
      >
        <hdml-cartesian-plane>
          <hdml-continuous-scale channel="y">
            <hdvl-binder
              id="a"
              style="width: 40px; height: 40px"
            ></hdvl-binder>
          </hdml-continuous-scale>
          <hdml-continuous-scale channel="x">
            <hdvl-binder
              id="b"
              style="width: 40px; height: 40px"
            ></hdvl-binder>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    await settle(view);
    await quiesce(view);
    const a = <HdvlBinderElement>view.querySelector("#a");
    const b = <HdvlBinderElement>view.querySelector("#b");
    a.bind("y", "m");
    b.bind("x", "n");
    await quiesce(view);
    assert.lengthOf(io.subscriptions, 2);
    for (const s of io.subscriptions) {
      assert.strictEqual(s.ref, "one");
    }

    view.setAttribute("source", "two");
    await quiesce(view);

    assert.lengthOf(io.subscriptions, 2);
    for (const s of io.subscriptions) {
      assert.strictEqual(s.ref, "two");
    }
  });

  test("a removed binding stops delivering, alone", async () => {
    const io = mountFakeIo();
    const { view, binder } = await one("rev");
    binder.bind("y", "m");
    binder.bind("color", "c", false);
    await quiesce(view);
    assert.lengthOf(io.subscriptions, 2);
    const kept = io.subscriptions.filter((s) => s.column === "c")[0];
    // R6: a domain-only subscription is an ordinary one.
    assert.isFalse(kept.raw);

    binder.unbind("y");
    await quiesce(view);

    // Its own controller aborted; the sibling's did not.
    assert.lengthOf(io.subscriptions, 1);
    assert.strictEqual(io.subscriptions[0].id, kept.id);
    io.feed("rev", res(1, { m: ["x"], c: ["y"] }));
    await quiesce(view);
    assert.isNull(adoptedOf(binder, "y"));
    assert.strictEqual(binder.kindAt("color"), "data");
  });

  test("no stale data survives a binding change", async () => {
    const io = mountFakeIo();
    const { view, binder } = await one("rev");
    binder.bind("y", "revenue");
    await quiesce(view);
    io.feed("rev", res(1, { revenue: ["a"], profit: ["b"] }));
    await quiesce(view);
    assert.strictEqual(adoptedOf(binder, "y")?.column, "revenue");

    binder.bind("y", "profit");

    // Discard happens at RECONCILE time, not on the replacement's
    // arrival: the slot holds nothing in between, never the
    // previous column's values.
    assert.isNull(adoptedOf(binder, "y"));
    await quiesce(view);
    assert.strictEqual(adoptedOf(binder, "y")?.column, "profit");
  });
});

suite("hdvl/subscribe — the five duties", () => {
  teardown(() => {
    deliveryTrace.record = null;
  });

  test("the instance fence drops a replaced delivery", async () => {
    const io = mountFakeIo();
    const cap = captureRequests();
    const data = countData();
    try {
      const { view, binder } = await one("rev");
      binder.bind("y", "revenue");
      await quiesce(view);
      assert.lengthOf(cap.seen, 1);
      const stale = cap.seen[0].deliver;

      binder.bind("y", "profit");
      await quiesce(view);
      const before = data.seen.length;

      // A delivery for the OLD subscription id, after the rebind.
      stale({
        kind: "data",
        ref: "rev",
        column: "revenue",
        generation: 9,
        rows: 1,
        values: ["a"],
        domain: { kind: "ordinal", value: ["a"] },
        type: { kind: "string" },
      });
      await quiesce(view);

      assert.isNull(adoptedOf(binder, "y"));
      assert.strictEqual(data.seen.length, before);
      assert.isFalse(binder.painted);
      void io;
    } finally {
      cap.stop();
      data.stop();
    }
  });

  test("duty 1 adopts idempotently on >=", async () => {
    const io = mountFakeIo();
    const data = countData();
    try {
      const { view, binder } = await one("rev");
      binder.bind("y", "m");
      await quiesce(view);
      io.feed("rev", res(2, { m: ["x"] }));
      await quiesce(view);
      const first = data.seen.length;
      assert.strictEqual(binder.generationAt("y"), 2);

      io.feed("rev", res(2, { m: ["x"] }));
      await quiesce(view);

      // `>=`, so a replay of an adopted generation is adopted
      // again rather than dropped — and it is still generation 2.
      assert.strictEqual(binder.generationAt("y"), 2);
      assert.strictEqual(data.seen.length, first + 1);
    } finally {
      data.stop();
    }
  });

  test("a stale generation is discarded wholesale", async () => {
    const io = mountFakeIo();
    const data = countData();
    try {
      const { view, binder } = await one("rev");
      binder.bind("y", "m");
      await quiesce(view);
      io.feed("rev", res(2, { m: ["new"] }));
      await quiesce(view);
      const before = data.seen.length;

      io.feed("rev", res(1, { m: ["old"] }));
      await quiesce(view);

      // No field taken, no event, no state change.
      assert.strictEqual(binder.generationAt("y"), 2);
      const d = <Extract<Delivery, { kind: "data" }>>(
        adoptedOf(binder, "y")
      );
      assert.deepEqual(d.values, ["new"]);
      assert.strictEqual(data.seen.length, before);
    } finally {
      data.stop();
    }
  });

  test("R38 — the stamp decides, never the kind", async () => {
    const io = mountFakeIo();
    const { view, binder } = await one("rev");
    binder.bind("y", "m");
    await quiesce(view);
    io.feed("rev", res(8, { m: ["x"] }));
    await quiesce(view);
    assert.strictEqual(binder.generationAt("y"), 8);

    // A STAMPED error at generation 7 is stale, exactly like data.
    io.fail("rev", "late", "query-failed", 7);
    await quiesce(view);
    assert.strictEqual(binder.kindAt("y"), "data");
    assert.strictEqual(binder.generationAt("y"), 8);
    assert.isFalse(binder.matches(":state(error)"));
    assert.isTrue(binder.painted);

    // An UNSTAMPED error is current by ordering and is adopted.
    io.fail("rev", "gate", "gate-timeout");
    await quiesce(view);
    assert.strictEqual(binder.kindAt("y"), "error");
    assert.isTrue(binder.matches(":state(error)"));
  });

  test("adopted state is keyed by SLOT", async () => {
    const io = mountFakeIo({
      rev: res(1, { revenue: ["a"], profit: ["b"] }),
    });
    const { view, binder } = await one("rev");
    binder.bind("y", "revenue");
    await quiesce(view);
    binder.bind("y", "profit");
    await quiesce(view);

    const live = subscriptionsOf(view);
    assert.lengthOf(live, 1);
    assert.strictEqual(live[0].slot, "y");
    assert.strictEqual(live[0].key, `${binder.uid}:y`);
    void io;
  });

  test("clause 1.3 — deliver never paints", async () => {
    const io = mountFakeIo();
    const { view, binder } = await one("rev");
    binder.bind("y", "m");
    await quiesce(view);

    const phases: (string | null)[] = [];
    const frames: number[] = [];
    deliveryTrace.record = (): void => {
      phases.push(currentPhase());
      frames.push(view.framesRun);
    };
    const at = view.framesRun;
    io.feed("rev", res(1, { m: ["x"] }));

    // Inside `deliver`: no phase is running and no frame has run.
    assert.deepEqual(phases, [null]);
    assert.deepEqual(frames, [at]);
    // And on return: merely dirty, with the paint a whole rAF away.
    assert.strictEqual(view.framesRun, at);
    assert.isTrue(view.dirty);
    await quiesce(view);
    assert.isAbove(view.framesRun, at);
    assert.isTrue(binder.painted);
  });
});

suite("hdvl/subscribe — resilience", () => {
  test("gone resets, and the next ready re-dispatches", async () => {
    const io = mountFakeIo();
    const { view, binder } = await one("rev");
    binder.bind("y", "m");
    await quiesce(view);
    io.feed("rev", res(5, { m: ["x"] }));
    await quiesce(view);
    assert.isFalse(view.matches(":state(loading)"));
    const before = subscriptionsOf(view)[0].id;

    io.announceGone();
    await quiesce(view);

    // Back to loading, latest reset, no `:state(error)` — the
    // provider going away is not a delivery kind (R38).
    assert.isTrue(view.matches(":state(loading)"));
    assert.isFalse(binder.matches(":state(error)"));
    assert.strictEqual(subscriptionsOf(view)[0].generation, 0);

    document.dispatchEvent(
      new CustomEvent("hdml-io-ready", {
        bubbles: true,
        composed: true,
      }),
    );
    await quiesce(view);

    const after = subscriptionsOf(view)[0];
    assert.notStrictEqual(after.id, before);
    assert.lengthOf(io.subscriptions, 1);
    assert.strictEqual(io.subscriptions[0].id, after.id);
  });

  test("the new provider's generation 1 is adopted", async () => {
    const io = mountFakeIo();
    const { view, binder } = await one("rev");
    binder.bind("y", "m");
    await quiesce(view);
    io.feed("rev", res(5, { m: ["x"] }));
    await quiesce(view);

    // A real restart, not `announceGone()`: the replacement has its
    // own registry AND its own replay cache, so its generation
    // space genuinely starts again at 1.
    io.unmount();
    await quiesce(view);
    const next = mountFakeIo();
    await quiesce(view);

    // Which is the whole reason `latest` is reset rather than kept:
    // 1 >= 0 adopts, 1 >= 5 would not.
    next.feed("rev", res(1, { m: ["fresh"] }));
    await quiesce(view);
    assert.strictEqual(binder.generationAt("y"), 1);
    assert.isFalse(view.matches(":state(loading)"));
  });

  test("consumer-first and provider-first converge", async () => {
    // Consumer first: nobody is listening when the request goes out.
    const { view, binder } = await one("rev");
    binder.bind("y", "m");
    await quiesce(view);

    const io: FakeIo = mountFakeIo();
    await quiesce(view);

    // The ready announce re-dispatched it — once, not twice.
    assert.lengthOf(io.subscriptions, 1);
    assert.lengthOf(subscriptionsOf(view), 1);
    assert.strictEqual(
      io.subscriptions[0].id,
      subscriptionsOf(view)[0].id,
    );
    io.feed("rev", res(1, { m: ["x"] }));
    await quiesce(view);
    assert.strictEqual(binder.generationAt("y"), 1);
  });
});

suite("hdvl/subscribe — lifecycle", () => {
  test("no subscriptions: not loading, and empty", async () => {
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view
        aria-label="literal only"
        style="width: 400px; height: 200px"
      >
        <hdml-cartesian-plane>
          <hdml-continuous-scale channel="y"> </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    await settle(view);
    await quiesce(view);
    const plane = <Element>view.querySelector("hdml-cartesian-plane");

    // §3.6: corpus 00, 02 and 12 have no data layer at all.
    assert.isFalse(view.matches(":state(loading)"));
    assert.isFalse(plane.matches(":state(loading)"));
    // Which is what makes `empty` reachable for the first time —
    // step 11 called it structurally unreachable, and it was.
    assert.isTrue(view.matches(":state(empty)"));
  });

  test("loading is set at connect, before any frame", async () => {
    const host = await fixture<HTMLElement>(html`<div></div>`);
    const view = document.createElement("hdml-view");
    view.setAttribute("aria-label", "at connect");
    host.appendChild(view);
    // §3.6, in the one window it describes: connected, nothing
    // known about who subscribes, no frame yet.
    assert.isTrue(view.matches(":state(loading)"));
    assert.isFalse(view.matches(":state(empty)"));
  });

  test("the first resolution suppresses the WHOLE view", async () => {
    const io = mountFakeIo();
    const { view, first, second } = await two("a", "b");
    first.bind("y", "m");
    second.bind("x", "n");
    await quiesce(view);

    io.feed("a", res(1, { m: ["x"] }));
    await quiesce(view);

    // One of two required subscriptions is terminal, so the view
    // has not resolved once — and nothing in it paints.
    assert.isTrue(view.matches(":state(loading)"));
    assert.isFalse(first.painted);
    assert.isFalse(second.painted);

    io.feed("b", res(1, { n: ["y"] }));
    await quiesce(view);

    assert.isFalse(view.matches(":state(loading)"));
    assert.isTrue(first.painted);
    assert.isTrue(second.painted);
  });

  test("a later rebind blanks its own unit only", async () => {
    const io = mountFakeIo();
    const { view, first, second } = await two("a", "b");
    first.bind("y", "m");
    second.bind("x", "n");
    await quiesce(view);
    io.feed("a", res(1, { m: ["x"] }));
    io.feed("b", res(1, { n: ["y"] }));
    await quiesce(view);
    assert.isTrue(first.painted);

    // Re-point the FIRST scale at a ref nobody has fed, so its
    // subscription is genuinely un-terminal rather than instantly
    // resolved out of the provider's replay cache.
    const scale = <Element>view.querySelector("[channel='y']");
    scale.setAttribute("source", "c");
    await quiesce(view);

    // Its own unit blanks; the sibling keeps painting, and the
    // view does NOT re-enter whole-view suppression.
    assert.isTrue(view.matches(":state(loading)"));
    assert.isFalse(first.painted);
    assert.isTrue(second.painted);
  });

  test("an error resolves loading and marks the unit", async () => {
    const io = mountFakeIo();
    const { view, binder } = await one("rev");
    binder.bind("y", "m");
    await quiesce(view);
    assert.isTrue(view.matches(":state(loading)"));

    io.fail("rev", "boom", "query-failed");
    await quiesce(view);

    // An `error` is terminal: it RESOLVES loading (§3.4).
    assert.isFalse(view.matches(":state(loading)"));
    assert.isTrue(binder.matches(":state(error)"));
    assert.isFalse(binder.painted);
  });

  test("hdml-data fires from the adopter, on the edge", async () => {
    const io = mountFakeIo();
    const { view, binder } = await one("rev");
    binder.bind("y", "m");
    await quiesce(view);

    const seen: Event[] = [];
    const phases: (null | string)[] = [];
    const detail: unknown[] = [];
    const on = (e: Event): void => {
      seen.push(e);
      phases.push(currentPhase());
      detail.push((<CustomEvent<unknown>>e).detail);
    };
    document.addEventListener("hdml-data", on);
    try {
      io.feed("rev", res(1, { m: ["x", "y"] }));
      await quiesce(view);

      assert.lengthOf(seen, 1);
      assert.strictEqual(seen[0].target, binder);
      assert.isTrue(seen[0].bubbles);
      assert.isTrue(seen[0].composed);
      // After PAINT, from the queue — never inside a phase.
      assert.deepEqual(phases, [null]);
      const d = <{ channels: string[]; length: number }>detail[0];
      assert.deepEqual(d.channels, ["y"]);
      assert.strictEqual(d.length, 2);

      // Edge-triggered on the ADOPTED set: a frame that changed no
      // adoption re-fires nothing.
      view.markDirty();
      await quiesce(view);
      assert.lengthOf(seen, 1);
    } finally {
      document.removeEventListener("hdml-data", on);
    }
  });
});
