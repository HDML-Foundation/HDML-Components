/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import "../index";
import type { Scene, SceneNode } from "../scene";
import { FakeIo, mountFakeIo } from "../../testing/FakeIo";
import {
  DEFERRED_TO_SLICE_H,
  ENGINE,
  assertRenders,
  goldenOf,
  mountCorpus,
  negativeZeros,
  nodeCount,
  numberCol,
  result,
  stringCol,
  stripText,
  withoutDeferred,
} from "../../testing/corpus";
import { sceneOf } from "../../testing/scene-of";
import {
  installSceneRecorder,
  restoreRenderers,
} from "../../testing/scene-of";

/**
 * ★ **`08-pie-doughnut` — the corpus's first `hdml-pie`, and the
 * page SPEC's interchangeability claim is about** (RFC §10.1 F,
 * SPEC §6.3, §7).
 *
 * Four views, and the pairs are the point. **A** is the layout
 * widget over a subscription; **C** is the same chart written as
 * `hdml-arc a0/a1` over window-clause fields, with the prefix sum
 * computed in the data layer instead of the widget — and SPEC says
 * the two are interchangeable. Since step 27 that is a property of
 * the code (one `sectorScene`, one `k: "arc"` node literal), and
 * here it is a property of a *page*: the two goldens' arc nodes are
 * `deepEqual`.
 *
 * **B** and **D** are the other pair — `--hdml-inner-radius` on the
 * widget and on the plane. The pie publishes no radial attribute at
 * all, so both take the arc's third radial case, and the property
 * inherits; neither the pie nor the arc knows which spelling it met.
 *
 * ★ **This page is why step 28 changed code.** All four views
 * painted **nothing** before it: SPEC §3 gives the radial range a
 * fallback — *"when no radius scale exists (a pure pie chain), the
 * plane's content box serves"* — and step 22 implemented that
 * fallback for the **pole** and not for the **range**, so a pure pie
 * chain resolved no ceiling and every sector bailed. See
 * `Projection.span` in [`../mark.ts`](../mark.ts).
 *
 * **C3 — this gate does not own the legends.** Three of the four
 * views declare an `hdml-legend`, which is Slice H's; the goldens
 * are taken over {@link withoutDeferred}'s restriction and step 32
 * re-runs the page whole.
 */

/** Row order is slice order and nothing sorts — V7's own rule. */
const REGIONS = ["Central", "East", "North", "West"];

/**
 * Integers, deliberately. `region_share_arcs`' window clause reads
 * `(SUM(revenue) OVER (ORDER BY region) - revenue) / SUM(…) OVER ()`
 * where the pie accumulates forward, and the two agree **exactly**
 * only because integer sums under 2^53 are exact — which is what
 * makes the A ≡ C assertion an equality rather than a tolerance.
 */
const REVENUE = [4200000, 3100000, 2600000, 1800000];

/** D's second ring: another value column of the same wide frame. */
const COST = [2900000, 2100000, 1500000, 1400000];

/**
 * The data layer's half of the pie — `region_share_arcs`' two
 * window clauses, evaluated here exactly as the page's SQL states
 * them: a running sum over the total, and its lagged partner.
 *
 * @param values - The measure, in row order.
 * @returns The cumulative fraction pair, per row.
 */
function windowClauses(values: readonly number[]): {
  a0: number[];
  a1: number[];
} {
  let total = 0;
  for (const v of values) {
    total += v;
  }
  const a0: number[] = [];
  const a1: number[] = [];
  let running = 0;
  for (const v of values) {
    running += v;
    a0.push((running - v) / total);
    a1.push(running / total);
  }
  return { a0, a1 };
}

const ARCS = windowClauses(REVENUE);

const SHARE = "?hdml-frame=region_share";
const ARC_REF = "?hdml-frame=region_share_arcs";

/** §4.3's radial ceiling over the outer plane's content box. */
const CEILING = 148;

/** Every mark node in a view's owned scene, flattened. */
function marksOf(scene: Scene): SceneNode[] {
  return scene.groups
    .filter((g) => g.role === "mark")
    .flatMap((g) => g.nodes);
}

suite("corpus 08-pie-doughnut", () => {
  let io: FakeIo;

  setup(() => {
    installSceneRecorder();
    io = mountFakeIo({
      [SHARE]: result(4, {
        region: stringCol(REGIONS),
        revenue: numberCol(REVENUE),
        cost: numberCol(COST),
      }),
      [ARC_REF]: result(4, {
        region: stringCol(REGIONS),
        a0: numberCol(ARCS.a0),
        a1: numberCol(ARCS.a1),
      }),
    });
  });

  teardown(() => {
    restoreRenderers();
  });

  test("all four views render through FakeIo alone", async () => {
    const page = await mountCorpus("08-pie-doughnut");
    assert.lengthOf(page.views, 4);
    assert.strictEqual(page.removedIo, 1);
    page.views.forEach((v) => assertRenders(v));
    assert.isAbove(io.subscriptions.length, 0);
  });

  test("★ C3: the legends belong to Slice H", async () => {
    // The exclusion is a filter by name, not an omission that
    // happens to hold while `hdml-legend` emits nothing — so it
    // still means the same thing after step 31 gives it a body,
    // and step 32 is what widens these goldens.
    const page = await mountCorpus("08-pie-doughnut");
    assert.lengthOf(
      page.root.querySelectorAll(DEFERRED_TO_SLICE_H[0]),
      4,
    );
    page.views.forEach((v) => {
      const owned = withoutDeferred(goldenOf(v), DEFERRED_TO_SLICE_H);
      assert.isEmpty(
        owned.groups.filter((g) =>
          DEFERRED_TO_SLICE_H.includes(g.tag),
        ),
      );
    });
  });

  test("★ A's pie and C's arcs are one geometry", async () => {
    // SPEC's claim, met on a page rather than in a fixture: the
    // widget derive and the window clause reach the same numbers
    // by different routes. Only the mark group's TAG differs.
    //
    // ★ The `hdml-legend` entries appeared at step 31 and are read
    // UNFILTERED on purpose: `withoutDeferred` scopes the *golden*
    // (C3), and this assertion is a hand-written tag list rather
    // than a golden. Naming the legend here rather than filtering
    // it out is what makes the list survive step 32, which empties
    // that constant.
    const page = await mountCorpus("08-pie-doughnut");
    const a = goldenOf(page.views[0]);
    const c = goldenOf(page.views[2]);
    assert.deepEqual(
      a.groups.map((g) => g.tag),
      ["hdml-pie", "hdml-legend"],
    );
    assert.deepEqual(
      c.groups.map((g) => g.tag),
      ["hdml-arc", "hdml-legend"],
    );
    assert.deepEqual(marksOf(a), marksOf(c));
  });

  test("★ the slice angles are the shares, exactly", async () => {
    // Derived, not captured: a share of the turn is the share of
    // the total. Read RAW — `a1 === 360` is the running quotient's
    // whole point (step 27) and six decimals cannot state it.
    const page = await mountCorpus("08-pie-doughnut");
    const nodes = marksOf(sceneOf(page.views[0]));
    const total = REVENUE.reduce((s, v) => s + v, 0);
    let acc = 0;
    REVENUE.forEach((v, i) => {
      const node = nodes[i];
      assert.strictEqual(node.k, "arc");
      if (node.k !== "arc") {
        return;
      }
      assert.closeTo(node.a0, (acc / total) * 360, 1e-9);
      acc += v;
      assert.closeTo(node.a1, (acc / total) * 360, 1e-9);
    });
    const last = nodes[nodes.length - 1];
    assert.strictEqual(last.k === "arc" ? last.a1 : NaN, 360);
  });

  test("★ the doughnut floor: B's widget, D's plane", async () => {
    // `--hdml-inner-radius` is read at the WIDGET and inherits, so
    // 08-B's `hdml-pie.donut { 62% }` and 08-D's
    // `hdml-polar-plane.outer { 80% }` are the same code path met
    // from two declaration sites. Both resolve against §3's
    // ceiling, which is the range's top and not the box.
    const page = await mountCorpus("08-pie-doughnut");
    const b = marksOf(goldenOf(page.views[1]));
    const d = marksOf(goldenOf(page.views[3]));
    b.forEach((n) => {
      assert.strictEqual(n.k === "arc" ? n.r0 : NaN, 0.62 * CEILING);
      assert.strictEqual(n.k === "arc" ? n.r1 : NaN, CEILING);
    });
    // A takes the same third radial case with no floor declared.
    marksOf(goldenOf(page.views[0])).forEach((n) => {
      assert.strictEqual(n.k === "arc" ? n.r0 : NaN, 0);
      assert.strictEqual(n.k === "arc" ? n.r1 : NaN, CEILING);
    });
    assert.strictEqual(
      d[0].k === "arc" ? d[0].r0 : NaN,
      0.8 * CEILING,
    );
  });

  test("★ D's two planes measure two rings", async () => {
    // Step 22's T2: the pole is per WIDGET, so each pie resolves
    // its own from its own plane's content box. Here the page
    // grows the inner plane's padding by 32px on every side, so
    // the two centres COINCIDE by the author's arithmetic while
    // the two ceilings do not — which is what concentric rings
    // are. A golden that shared one radius would be wrong.
    const page = await mountCorpus("08-pie-doughnut");
    const scene = goldenOf(page.views[3]);
    const rings = scene.groups.filter((g) => g.role === "mark");
    assert.lengthOf(rings, 2);
    assert.notDeepEqual(rings[0].box, rings[1].box);
    const outer = rings[0].nodes[0];
    const inner = rings[1].nodes[0];
    assert.strictEqual(outer.k, "arc");
    assert.strictEqual(inner.k, "arc");
    if (outer.k !== "arc" || inner.k !== "arc") {
      return;
    }
    assert.strictEqual(outer.cx, inner.cx);
    assert.strictEqual(outer.cy, inner.cy);
    assert.isAbove(outer.r1, inner.r1);
    // …and the inner ring's outer edge clears the outer ring's
    // floor, which is the page's stated reason for those numbers.
    assert.isAtMost(inner.r1, outer.r0);
    // Different columns, so different shares: the two rings are
    // not one pie drawn twice.
    assert.notStrictEqual(outer.a1, inner.a1);
  });

  test("the goldens hold on every engine", async () => {
    const page = await mountCorpus("08-pie-doughnut");
    const owned = page.views.map((v) =>
      withoutDeferred(goldenOf(v), DEFERRED_TO_SLICE_H),
    );
    assert.deepEqual(stripText(owned[0]), stripText(GOLDEN_A));
    assert.deepEqual(stripText(owned[1]), stripText(GOLDEN_B));
    assert.deepEqual(stripText(owned[2]), stripText(GOLDEN_C));
    assert.deepEqual(stripText(owned[3]), stripText(GOLDEN_D));
  });

  test("the text holds on chromium", async () => {
    assert.notStrictEqual(ENGINE, "unclassified");
    if (ENGINE !== "chromium") {
      return;
    }
    const page = await mountCorpus("08-pie-doughnut");
    const owned = page.views.map((v) =>
      withoutDeferred(goldenOf(v), DEFERRED_TO_SLICE_H),
    );
    assert.deepEqual(owned[0], GOLDEN_A);
    assert.deepEqual(owned[1], GOLDEN_B);
    assert.deepEqual(owned[2], GOLDEN_C);
    assert.deepEqual(owned[3], GOLDEN_D);
  });

  test("it round-trips, is -0 free and fits the budget", async () => {
    const page = await mountCorpus("08-pie-doughnut");
    page.views.forEach((v) => {
      const scene = withoutDeferred(goldenOf(v), DEFERRED_TO_SLICE_H);
      assert.deepEqual(structuredClone(scene), scene);
      assert.deepEqual(negativeZeros(sceneOf(v)), []);
      assert.isBelow(nodeCount(scene), 20000);
    });
  });
});

const GOLDEN_A: Scene = {
  width: 480,
  height: 320,
  groups: [
    {
      widget: "",
      tag: "hdml-pie",
      role: "mark",
      box: {
        x: 12,
        y: 12,
        w: 348,
        h: 296,
      },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: true,
      clipPath: null,
      nodes: [
        {
          k: "arc",
          i: 0,
          cx: 186,
          cy: 160,
          r0: 0,
          r1: 148,
          a0: 0,
          a1: 129.230769,
          fill: "rgb(28, 140, 244)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "arc",
          i: 1,
          cx: 186,
          cy: 160,
          r0: 0,
          r1: 148,
          a0: 129.230769,
          a1: 224.615385,
          fill: "rgb(245, 158, 11)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "arc",
          i: 2,
          cx: 186,
          cy: 160,
          r0: 0,
          r1: 148,
          a0: 224.615385,
          a1: 304.615385,
          fill: "rgb(16, 185, 129)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "arc",
          i: 3,
          cx: 186,
          cy: 160,
          r0: 0,
          r1: 148,
          a0: 304.615385,
          a1: 360,
          fill: "rgb(139, 92, 246)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
      ],
    },
  ],
};

const GOLDEN_B: Scene = {
  width: 480,
  height: 320,
  groups: [
    {
      widget: "",
      tag: "hdml-pie",
      role: "mark",
      box: {
        x: 12,
        y: 12,
        w: 348,
        h: 296,
      },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: true,
      clipPath: null,
      nodes: [
        {
          k: "arc",
          i: 0,
          cx: 186,
          cy: 160,
          r0: 91.76,
          r1: 148,
          a0: 0,
          a1: 154.971429,
          fill: "rgb(28, 140, 244)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "arc",
          i: 1,
          cx: 186,
          cy: 160,
          r0: 91.76,
          r1: 148,
          a0: 154.971429,
          a1: 261.6,
          fill: "rgb(245, 158, 11)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "arc",
          i: 2,
          cx: 186,
          cy: 160,
          r0: 91.76,
          r1: 148,
          a0: 261.6,
          a1: 329.485714,
          fill: "rgb(16, 185, 129)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "arc",
          i: 3,
          cx: 186,
          cy: 160,
          r0: 91.76,
          r1: 148,
          a0: 329.485714,
          a1: 360,
          fill: "rgb(139, 92, 246)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
      ],
    },
  ],
};

const GOLDEN_C: Scene = {
  width: 480,
  height: 320,
  groups: [
    {
      widget: "",
      tag: "hdml-arc",
      role: "mark",
      box: {
        x: 12,
        y: 12,
        w: 348,
        h: 296,
      },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: true,
      clipPath: null,
      nodes: [
        {
          k: "arc",
          i: 0,
          cx: 186,
          cy: 160,
          r0: 0,
          r1: 148,
          a0: 0,
          a1: 129.230769,
          fill: "rgb(28, 140, 244)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "arc",
          i: 1,
          cx: 186,
          cy: 160,
          r0: 0,
          r1: 148,
          a0: 129.230769,
          a1: 224.615385,
          fill: "rgb(245, 158, 11)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "arc",
          i: 2,
          cx: 186,
          cy: 160,
          r0: 0,
          r1: 148,
          a0: 224.615385,
          a1: 304.615385,
          fill: "rgb(16, 185, 129)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "arc",
          i: 3,
          cx: 186,
          cy: 160,
          r0: 0,
          r1: 148,
          a0: 304.615385,
          a1: 360,
          fill: "rgb(139, 92, 246)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
      ],
    },
  ],
};

const GOLDEN_D: Scene = {
  width: 480,
  height: 320,
  groups: [
    {
      widget: "",
      tag: "hdml-pie",
      role: "mark",
      box: {
        x: 12,
        y: 12,
        w: 348,
        h: 296,
      },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: true,
      clipPath: null,
      nodes: [
        {
          k: "arc",
          i: 0,
          cx: 186,
          cy: 160,
          r0: 118.4,
          r1: 148,
          a0: 0,
          a1: 129.230769,
          fill: "rgb(28, 140, 244)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "arc",
          i: 1,
          cx: 186,
          cy: 160,
          r0: 118.4,
          r1: 148,
          a0: 129.230769,
          a1: 224.615385,
          fill: "rgb(245, 158, 11)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "arc",
          i: 2,
          cx: 186,
          cy: 160,
          r0: 118.4,
          r1: 148,
          a0: 224.615385,
          a1: 304.615385,
          fill: "rgb(16, 185, 129)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "arc",
          i: 3,
          cx: 186,
          cy: 160,
          r0: 118.4,
          r1: 148,
          a0: 304.615385,
          a1: 360,
          fill: "rgb(139, 92, 246)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
      ],
    },
    {
      widget: "",
      tag: "hdml-pie",
      role: "mark",
      box: {
        x: 44,
        y: 44,
        w: 284,
        h: 232,
      },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: true,
      clipPath: null,
      nodes: [
        {
          k: "arc",
          i: 0,
          cx: 186,
          cy: 160,
          r0: 85.84,
          r1: 116,
          a0: 0,
          a1: 132.151899,
          fill: "rgb(28, 140, 244)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "arc",
          i: 1,
          cx: 186,
          cy: 160,
          r0: 85.84,
          r1: 116,
          a0: 132.151899,
          a1: 227.848101,
          fill: "rgb(245, 158, 11)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "arc",
          i: 2,
          cx: 186,
          cy: 160,
          r0: 85.84,
          r1: 116,
          a0: 227.848101,
          a1: 296.202532,
          fill: "rgb(16, 185, 129)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "arc",
          i: 3,
          cx: 186,
          cy: 160,
          r0: 85.84,
          r1: 116,
          a0: 296.202532,
          a1: 360,
          fill: "rgb(139, 92, 246)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
      ],
    },
  ],
};
