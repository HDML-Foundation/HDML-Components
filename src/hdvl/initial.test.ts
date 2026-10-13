/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert, fixture } from "@open-wc/testing";
import { html } from "lit/static-html.js";
import { LitElement } from "lit";
import "./index";
import { mountFakeIo } from "../testing/FakeIo";
import type { FakeColumn, FakeResult } from "../testing/FakeIo";
import {
  installSceneRecorder,
  restoreRenderers,
  sceneOf,
} from "../testing/scene-of";
import { HdmlViewElement } from "./view";
import { HdvlElement } from "./base";
import { initialValuesOf, markBindings, slotValuesOf } from "./mark";
import { initialLiteralOf, subscriptionsOf } from "./subscribe";
import { diagnosticsOf } from "./validate";

/**
 * **019 item 1 — `initial-{slot}` paints** (RFC 001 §5).
 *
 * One claim runs through every test here: *a page can be authored so
 * that every mark shows real geometry on its first frame and the
 * same page shows live data once it resolves.* Before this step a
 * widget carrying every literal it needed painted **nothing** if its
 * view held one unresolved subscription — step 43's control 5
 * measured exactly that, `{subs: 3, loading: true, groups: []}` —
 * because §3.4's first-resolution atomicity is a question about the
 * **view** and the answer is the same for everything in it.
 *
 * The fixtures are deliberately starved: `mountFakeIo()` with no
 * results is a provider that announces ready, accepts every
 * subscription and **never delivers**, which is the only state in
 * which the clause under test is live. Nothing here waits for data
 * except the two tests that are about data arriving.
 *
 * ⚠ The scales carry `min`/`max`, so a scale's `values` is a literal
 * domain and opens no subscription of its own — every subscription
 * in these views belongs to a mark, which is what makes the
 * subscription counts below readable.
 */

/** A one-column canned column, in the worker's shape. */
function col(values: number[]): FakeColumn {
  return {
    values: Float64Array.from(values),
    nulls: undefined,
    domain: { kind: "extent", value: [0, 1] },
    type: { kind: "number" },
  };
}

/** One canned atomic result over `a` and `b`. */
function res(generation: number): FakeResult {
  return {
    generation,
    rows: 3,
    columns: { a: col([0.2, 0.5, 0.8]), b: col([0.3, 0.6, 0.9]) },
  };
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

/** How many mark nodes one element contributed this frame. */
function nodesOf(view: HdmlViewElement, el: HdvlElement): number {
  let n = 0;
  for (const group of sceneOf(view).groups) {
    if (group.widget === el.uid) {
      n += group.nodes.length;
    }
  }
  return n;
}

const L3 = "[0.2,0.5,0.8]";

suite("019 item 1 — initial-{slot}", () => {
  teardown(() => {
    restoreRenderers();
  });

  /**
   * ★★★ The row's gate pair, as one fixture: two sibling marks in
   * one unresolved view, one fully backed and one not.
   */
  async function pair(): Promise<{
    view: HdmlViewElement;
    backed: HdvlElement;
    bare: HdvlElement;
    axis: HdvlElement;
  }> {
    installSceneRecorder();
    mountFakeIo();
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view
        aria-label="initial gate pair"
        source="?hdml-frame=f"
        style="width: 400px; height: 200px"
      >
        <hdml-cartesian-plane>
          <hdml-continuous-scale min="0" max="1" channel="x">
            <hdml-continuous-scale min="0" max="1" channel="y">
              <hdml-axis id="axis" channel="y"></hdml-axis>
              <hdml-point
                id="backed"
                x="a"
                y="b"
                initial-x="${L3}"
                initial-y="${L3}"
              ></hdml-point>
              <hdml-point
                id="bare"
                x="a"
                y="b"
                initial-x="${L3}"
              ></hdml-point>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    await settle(view);
    await quiesce(view);
    return {
      view,
      backed: <HdvlElement>view.querySelector("#backed"),
      bare: <HdvlElement>view.querySelector("#bare"),
      axis: <HdvlElement>view.querySelector("#axis"),
    };
  }

  test("a backed widget paints before resolution", async () => {
    const { view, backed } = await pair();
    // The precondition the whole step rests on: nothing has
    // resolved, so §3.4's clause is live.
    assert.lengthOf(subscriptionsOf(view), 4);
    assert.isTrue(view.matches(":state(loading)"));
    // …and it paints anyway, from its two literals.
    assert.strictEqual(nodesOf(view, backed), 3);
  });

  test("a sibling with one unbacked slot stays blank", async () => {
    const { view, bare } = await pair();
    assert.strictEqual(nodesOf(view, bare), 0);
  });

  test("the two answers are per widget, in one view", async () => {
    const { view, backed, bare } = await pair();
    assert.notStrictEqual(
      nodesOf(view, backed) > 0,
      nodesOf(view, bare) > 0,
    );
  });

  /**
   * ⛔ **Control 3.** No guide declares `bindings()` at all, so a
   * guide's unit contributes no subscription. Were the quantifier
   * allowed to be vacuous every axis in an unresolved view would
   * paint against a scale that has not resolved — §3.4's atomicity
   * broken in the opposite direction.
   */
  test("a guide in the same view does NOT paint early", async () => {
    const { view, axis } = await pair();
    assert.strictEqual(nodesOf(view, axis), 0);
  });

  test("the fifth state marks the backed widget only", async () => {
    const { view, backed, bare, axis } = await pair();
    assert.isTrue(backed.matches(":state(initial)"));
    assert.isFalse(bare.matches(":state(initial)"));
    assert.isFalse(axis.matches(":state(initial)"));
    // ★ The VIEW never carries it. No subscription has the view as
    // its unit, so `literalBacked` answers `false` there — which is
    // what keeps `initial` a widget state and `loading` a view one,
    // and why the two can be true at the same moment without
    // contradicting each other.
    assert.isFalse(view.matches(":state(initial)"));
    assert.isTrue(view.matches(":state(loading)"));
  });

  test("a literal paint raises no diagnostic", async () => {
    const { view } = await pair();
    assert.deepEqual(diagnosticsOf(view), []);
  });

  /**
   * ★★ The hand-over. The literal is a **placeholder, not a
   * fallback**: once the column arrives `slotValuesOf` reads the
   * column and the literal is never consulted again.
   */
  test("delivered data replaces the literal", async () => {
    installSceneRecorder();
    const io = mountFakeIo();
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view
        aria-label="initial handover"
        source="?hdml-frame=f"
        style="width: 400px; height: 200px"
      >
        <hdml-cartesian-plane>
          <hdml-continuous-scale min="0" max="1" channel="x">
            <hdml-continuous-scale min="0" max="1" channel="y">
              <hdml-point
                id="m"
                x="a"
                y="b"
                initial-x="[0.1]"
                initial-y="[0.1]"
              ></hdml-point>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    await settle(view);
    await quiesce(view);
    const m = <HdvlElement>view.querySelector("#m");
    // One row, from the literal.
    assert.strictEqual(nodesOf(view, m), 1);
    assert.isTrue(m.matches(":state(initial)"));
    io.feed("?hdml-frame=f", res(1));
    await settle(view);
    await quiesce(view);
    // Three rows, from the column — and the state is gone.
    assert.strictEqual(nodesOf(view, m), 3);
    assert.isFalse(m.matches(":state(initial)"));
    assert.deepEqual(diagnosticsOf(view), []);
  });

  /**
   * ★★ The 25th code. A failed delivery blanks the unit (§3.5) and
   * the literals go with it — the one case where a reader most
   * expects a fallback to show is the case where it does not.
   */
  test("a failed delivery clears the literal", async () => {
    installSceneRecorder();
    const io = mountFakeIo();
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view
        aria-label="initial cleared"
        source="?hdml-frame=f"
        style="width: 400px; height: 200px"
      >
        <hdml-cartesian-plane>
          <hdml-continuous-scale min="0" max="1" channel="x">
            <hdml-continuous-scale min="0" max="1" channel="y">
              <hdml-point
                id="m"
                x="a"
                y="b"
                initial-x="[0.1]"
                initial-y="[0.1]"
              ></hdml-point>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    await settle(view);
    await quiesce(view);
    const m = <HdvlElement>view.querySelector("#m");
    assert.strictEqual(nodesOf(view, m), 1);
    io.fail("?hdml-frame=f", "no such frame", "query-failed");
    await settle(view);
    await quiesce(view);
    assert.strictEqual(nodesOf(view, m), 0);
    assert.isFalse(m.matches(":state(initial)"));
    const codes = diagnosticsOf(view).map((d) => d.code);
    assert.include(codes, "initial-cleared");
    // One per UNIT, never one per bound slot.
    assert.lengthOf(
      codes.filter((c) => c === "initial-cleared"),
      1,
    );
  });

  /**
   * ⚠ Open Q1's other reading, negative-controlled. A container
   * hoists the shared channel and V6 forbids its children from
   * binding it, so a stacked child's `x` is bound on the **stack**.
   * Asked of the element, the child would answer *yes* on its own
   * backed `y` while the stack's `x` had nothing behind it.
   */
  test("a hoisted channel is part of the answer", async () => {
    installSceneRecorder();
    mountFakeIo();
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view
        aria-label="hoisted channel"
        source="?hdml-frame=f"
        style="width: 400px; height: 200px"
      >
        <hdml-cartesian-plane>
          <hdml-ordinal-scale values='["p"]' channel="x">
            <hdml-continuous-scale min="0" max="1" channel="y">
              <hdml-stack id="s" x="a">
                <hdml-bar id="b" y="b" initial-y="[0.4]"></hdml-bar>
              </hdml-stack>
            </hdml-continuous-scale>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    await settle(view);
    await quiesce(view);
    const bar = <HdvlElement>view.querySelector("#b");
    const stack = <HdvlElement>view.querySelector("#s");
    // The child's own slot IS backed; the unit's is not, so the
    // unit stays blank. Backing the stack too is what releases it.
    assert.strictEqual(nodesOf(view, bar), 0);
    assert.isFalse(bar.matches(":state(initial)"));
    stack.setAttribute("initial-x", '["p"]');
    await settle(view);
    await quiesce(view);
    assert.isAbove(nodesOf(view, bar), 0);
    assert.isTrue(bar.matches(":state(initial)"));
  });

  /**
   * ⓓ Control 5's regression question: a view with **zero**
   * subscriptions returns on `state.subs.size === 0` before this
   * clause is reached, so the four literal-only corpus pages never
   * enter it. Asserted rather than assumed.
   */
  test("a zero-subscription view is untouched", async () => {
    installSceneRecorder();
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view
        aria-label="literal only"
        style="width: 400px; height: 200px"
      >
        <hdml-cartesian-plane>
          <hdml-continuous-scale min="0" max="1" channel="x">
            <hdml-continuous-scale min="0" max="1" channel="y">
              <hdml-point id="m" x="${L3}" y="${L3}"></hdml-point>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    await settle(view);
    await quiesce(view);
    const m = <HdvlElement>view.querySelector("#m");
    assert.lengthOf(subscriptionsOf(view), 0);
    assert.strictEqual(nodesOf(view, m), 3);
    // It paints, but it is not painting a PLACEHOLDER: nothing is
    // pending, so the fifth state must stay off.
    assert.isFalse(m.matches(":state(initial)"));
  });

  suite("the grammar", () => {
    /** One detached point carrying the attributes under test. */
    function point(attrs: Record<string, string>): HdvlElement {
      const el = document.createElement("hdml-point");
      for (const k of Object.keys(attrs)) {
        el.setAttribute(k, attrs[k]);
      }
      return <HdvlElement>(<unknown>el);
    }

    /**
     * ⚠ Asserted in a MOUNTED view, not on a detached element:
     * `markBindings` reads the resolution index for its `source`, so
     * a detached element publishes `[]` whatever its attributes say
     * — which would pass this test for entirely the wrong reason.
     */
    test("initial-{slot} publishes no binding", async () => {
      installSceneRecorder();
      mountFakeIo();
      const view = await fixture<HdmlViewElement>(html`
        <hdml-view
          aria-label="no binding"
          source="?hdml-frame=f"
          style="width: 400px; height: 200px"
        >
          <hdml-cartesian-plane>
            <hdml-continuous-scale min="0" max="1" channel="x">
              <hdml-continuous-scale min="0" max="1" channel="y">
                <hdml-point
                  id="m"
                  x="a"
                  initial-x="${L3}"
                  initial-y="${L3}"
                ></hdml-point>
              </hdml-continuous-scale>
            </hdml-continuous-scale>
          </hdml-cartesian-plane>
        </hdml-view>
      `);
      await settle(view);
      await quiesce(view);
      const m = <HdvlElement>view.querySelector("#m");
      // `x` is bound and publishes one; the two literals publish
      // none — so the slot list and the subscription list differ.
      assert.deepEqual(
        markBindings(m, ["x", "y"]).map((b) => b.slot),
        ["x"],
      );
      assert.deepEqual(
        subscriptionsOf(view).map((s) => s.slot),
        ["x"],
      );
    });

    test("an unparseable literal does not back the slot", () => {
      const el = point({ "initial-x": "[1,2" });
      assert.isUndefined(initialLiteralOf(el, "x"));
      assert.isNull(initialValuesOf(el, "x"));
    });

    test("an identifier is not a literal", () => {
      const el = point({ "initial-x": "revenue" });
      assert.isUndefined(initialLiteralOf(el, "x"));
    });

    test("`null` is told from an absent literal", () => {
      assert.isUndefined(initialLiteralOf(point({}), "x"));
      assert.isNull(
        initialLiteralOf(point({ "initial-x": "null" }), "x"),
      );
    });

    test("the literal reads with the channel grammar", () => {
      const arr = initialValuesOf(point({ "initial-x": L3 }), "x");
      assert.isNotNull(arr);
      assert.strictEqual(arr?.rows, 3);
      assert.isFalse(arr?.scalar);
      assert.strictEqual(arr?.at(1), 0.5);
      // A scalar broadcasts, exactly as `x="7"` does.
      const one = initialValuesOf(point({ "initial-x": "7" }), "x");
      assert.isTrue(one?.scalar);
      assert.strictEqual(one?.at(99), 7);
    });

    /**
     * ★ The distinction the dropped `placeholder` flag would have
     * carried, asserted where it is actually observable. A literal
     * CHANNEL attribute and an `initial-{slot}` produce the same
     * values; what separates them is that only the second has a
     * binding pending behind it, and `markBindings` is what says so.
     */
    test("a literal channel is not a pending binding", () => {
      const lit = slotValuesOf(point({ x: L3 }), "x");
      const ini = initialValuesOf(point({ "initial-x": L3 }), "x");
      assert.strictEqual(lit?.rows, 3);
      assert.strictEqual(ini?.rows, 3);
      // Neither publishes a binding, so neither is ever replaced…
      assert.isUndefined(initialLiteralOf(point({ x: L3 }), "x"));
      // …and the literal channel has no initial to be replaced BY.
      assert.isDefined(
        initialLiteralOf(point({ "initial-x": L3 }), "x"),
      );
    });
  });
});
