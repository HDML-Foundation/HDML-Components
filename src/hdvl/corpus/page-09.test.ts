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
import {
  installSceneRecorder,
  restoreRenderers,
  sceneOf,
} from "../../testing/scene-of";
import type { HdvlElement } from "../base";
import { formatCompactSet } from "../kernel/format-skeleton";
import { localeOf, scaleOf } from "../scale";
import { tickSpecOf } from "../guide-spec";

/**
 * ★ **`09-polar-area` — the rose, and the equal-slices form on a
 * page** (RFC §10.1 F, SPEC §4.4, §6.1).
 *
 * A polar area is **not** a layout exception. Where `08`'s pie
 * derives its angles from the values, here the angles are §4.4's
 * band on an ordinal angle scale and the *value* goes to the
 * radius — through a `sqrt` scale, because a wedge reads as its
 * **area**. The whole difference between the two pages is which
 * channel the measure binds.
 *
 * `--hdml-bandwidth: 1` is what makes it a rose rather than a fan:
 * the band fills its step, so slice *k*'s high edge **is** slice
 * *k+1*'s low edge and the figure is solid. That is asserted as an
 * identity, on the raw scene, rather than read off a golden.
 *
 * View **A**'s `color` is a continuous **ramp** keyed to the same
 * measure — the page's own header says why: twelve months against
 * §9's palette would be palette exhaustion, and twelve arbitrary
 * hues would say nothing. View **B** keeps the categorical form,
 * five weekdays inside the list.
 *
 * ★ **C3 is discharged here** (step 32). A declares an
 * `hdml-legend` for its ramp; B does not. A's golden now carries
 * the ramp's group — **thirty-two samples and three graduations**,
 * `count="4"` having asked for four boundaries over `[0, 2210]` and
 * §4.8's ladder having answered with three.
 *
 * ★ **This is the ramp on a page, and the first place `ticks()` on a
 * colour scale had ever been asked for outside a fixture.** Step 31
 * found that call answering `[]` on *every* colour scale — a
 * `null`-means-drop filter meeting a `null`-means-not-applicable
 * contract — so before it landed this view would have painted a bar
 * with no readable value beside it, silently. The graduations are
 * asserted against a real `scale.ticks(spec)` call for that reason.
 */

const REF = "?hdml-frame=monthly_units";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const UNITS = [
  1240, 1180, 1520, 1610, 1890, 2050, 2210, 2150, 1930, 1740, 1490,
  1360,
];

/** The frame's row-order key — declared, bound by no widget. */
const MONTH_NUM = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

/**
 * How many `rect` samples a continuous legend's bar carries.
 *
 * **Written out, not imported.** A test that imports the constant
 * asserts that the code equals itself; the literal here is what
 * fixes the count against a length-derived one, which plan rule 8
 * would make differ by an engine.
 */
const RAMP_SAMPLES = 32;

/** Every `arc` node of a view's one mark group. */
function sectorsOf(scene: Scene): SceneNode[] {
  return scene.groups
    .filter((g) => g.role === "mark")
    .flatMap((g) => g.nodes);
}

suite("corpus 09-polar-area", () => {
  let io: FakeIo;

  setup(() => {
    installSceneRecorder();
    io = mountFakeIo({
      [REF]: result(12, {
        month: stringCol(MONTHS),
        units: numberCol(UNITS),
        month_num: numberCol(MONTH_NUM),
      }),
    });
  });

  teardown(() => {
    restoreRenderers();
  });

  test("both views render", async () => {
    const page = await mountCorpus("09-polar-area");
    assert.lengthOf(page.views, 2);
    assert.strictEqual(page.removedIo, 1);
    page.views.forEach((v) => assertRenders(v));
    assert.isAbove(io.subscriptions.length, 0);
  });

  test("★ C3: A's ramp is painted, B has no key", async () => {
    const page = await mountCorpus("09-polar-area");
    assert.isEmpty(DEFERRED_TO_SLICE_H);
    assert.lengthOf(page.root.querySelectorAll("hdml-legend"), 1);
    const owned = withoutDeferred(
      goldenOf(page.views[0]),
      DEFERRED_TO_SLICE_H,
    );
    const keys = owned.groups.filter((g) => g.tag === "hdml-legend");
    assert.lengthOf(keys, 1);
    assert.strictEqual(keys[0].role, "guide");
    // Thirty-two samples is a CONSTANT, never a length derived from
    // the bar's pixels — a text-derived count would differ by one
    // between engines and split this golden (step 31's T6).
    assert.lengthOf(
      keys[0].nodes.filter((n) => n.k === "rect"),
      RAMP_SAMPLES,
    );
    assert.lengthOf(
      goldenOf(page.views[1]).groups.filter(
        (g) => g.tag === "hdml-legend",
      ),
      0,
    );
  });

  test("★ the bar is the marks' ramp, one call", async () => {
    // R18 on a page. Every sample is `Scale.paint(v)` at a real
    // domain value and every wedge is the same call at its own row,
    // so the two are compared BYTE FOR BYTE against that function
    // rather than against each other — no data value lands on a
    // sample midpoint, and asserting a collision that does not
    // exist would be asserting the wrong thing.
    const page = await mountCorpus("09-polar-area");
    const view = page.views[0];
    const hit = view.querySelector(
      'hdml-continuous-scale[channel="color"]',
    );
    assert.isNotNull(hit);
    const color = scaleOf(<HdvlElement>(<unknown>hit));
    assert.isNotNull(color);
    const scene = goldenOf(view);
    const key = scene.groups.filter(
      (g) => g.tag === "hdml-legend",
    )[0];
    // The wedges: one `paint()` per delivered row.
    sectorsOf(scene).forEach((n, i) => {
      assert.strictEqual(n.fill, color?.paint(UNITS[i]));
    });
    // The bar: one `paint()` per sample MIDPOINT, over the same
    // extent, so the bar's two ends are the domain's two ends
    // painted half a sample in.
    const extent = color?.domain()?.extent ?? [0, 0];
    const samples = key.nodes.filter((n) => n.k === "rect");
    samples.forEach((n, i) => {
      const t = (i + 0.5) / RAMP_SAMPLES;
      const v = extent[0] + t * (extent[1] - extent[0]);
      assert.strictEqual(n.fill, color?.paint(v));
    });
    // …and the mark colours lie inside the bar's own span: the
    // largest month is darker than the first sample.
    assert.notStrictEqual(samples[0].fill, samples[31].fill);
  });

  test("★ the rose is solid: bandwidth 1 leaves no gap", async () => {
    // Derived on the RAW scene: `--hdml-bandwidth: 1` makes the
    // band fill its step, so consecutive slices share an edge
    // EXACTLY. Six decimals would only say they nearly do.
    const page = await mountCorpus("09-polar-area");
    [
      [0, MONTHS.length],
      [1, WEEKDAYS.length],
    ].forEach(([view, n]) => {
      const nodes = sectorsOf(sceneOf(page.views[view]));
      assert.lengthOf(nodes, n);
      for (let i = 1; i < nodes.length; i++) {
        const prev = nodes[i - 1];
        const next = nodes[i];
        if (prev.k !== "arc" || next.k !== "arc") {
          assert.fail("a rose slice is an arc node");
          return;
        }
        assert.strictEqual(prev.a1, next.a0);
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      assert.strictEqual(first.k === "arc" ? first.a0 : NaN, 0);
      assert.strictEqual(last.k === "arc" ? last.a1 : NaN, 360);
      // …and every slice is an equal one: n slices, one turn.
      nodes.forEach((node) => {
        if (node.k !== "arc") {
          return;
        }
        assert.closeTo(node.a1 - node.a0, 360 / n, 1e-9);
      });
    });
  });

  test("★ the measure is radial, and area-honest", async () => {
    // A `sqrt` radius is the page's whole argument: a wedge reads
    // as its AREA, so r ∝ √v. Asserted as a ratio identity — the
    // largest month over the smallest — which a linear radius
    // would fail and which needs no captured coordinate.
    const page = await mountCorpus("09-polar-area");
    const nodes = sectorsOf(sceneOf(page.views[0]));
    const r1 = nodes.map((n) => (n.k === "arc" ? n.r1 : NaN));
    const hi = Math.max(...UNITS);
    const lo = Math.min(...UNITS);
    assert.closeTo(
      r1[UNITS.indexOf(hi)] / r1[UNITS.indexOf(lo)],
      Math.sqrt(hi / lo),
      1e-9,
    );
    // Every slice starts at the pole: the arc's `radius` sugar is
    // `r0="0"` and no `--hdml-inner-radius` is declared.
    r1.forEach((_, i) => {
      const node = nodes[i];
      assert.strictEqual(node.k === "arc" ? node.r0 : NaN, 0);
    });
  });

  test("★ A ramps and B enumerates", async () => {
    // Twelve distinct fills off ONE interpolation against five
    // off the palette — the two `color` scale kinds, told apart
    // by what they produce rather than by which tag was written.
    const page = await mountCorpus("09-polar-area");
    const a = sectorsOf(goldenOf(page.views[0])).map((n) => n.fill);
    const b = sectorsOf(goldenOf(page.views[1])).map((n) => n.fill);
    assert.lengthOf(new Set(a), MONTHS.length);
    assert.lengthOf(new Set(b), WEEKDAYS.length);
    // The ramp's interior stops are `color-mix()` — the platform's
    // own interpolator, never re-implemented here (§5.5).
    assert.isTrue(
      a.filter((f) => (f ?? "").startsWith("color-mix(")).length > 0,
    );
    assert.isEmpty(
      b.filter((f) => (f ?? "").startsWith("color-mix")),
    );
  });

  test("★ the radius rings are circles, one per tick", async () => {
    // `--hdml-grid-shape: circle` is an `arc` node with
    // `r0 === r1` — a zero-thickness annulus, which is what a
    // stroked ring is — and both views' grids share the generator
    // their labels read (R12/R18), so A's ring radii and its
    // label radii are the same ladder.
    const page = await mountCorpus("09-polar-area");
    page.views.forEach((v) => {
      const grid = goldenOf(v).groups.find(
        (g) => g.tag === "hdml-grid",
      );
      assert.isDefined(grid);
      (grid?.nodes ?? []).forEach((n) => {
        assert.strictEqual(n.k, "arc");
        if (n.k !== "arc") {
          return;
        }
        assert.strictEqual(n.r0, n.r1);
        assert.strictEqual(n.a0, 0);
        assert.strictEqual(n.a1, 360);
      });
    });
    const scene = goldenOf(page.views[0]);
    const rings = scene.groups.find((g) => g.tag === "hdml-grid");
    const labels = scene.groups.find((g) => g.tag === "hdml-label");
    assert.strictEqual(rings?.nodes.length, labels?.nodes.length);
  });

  test("the goldens hold on every engine", async () => {
    const page = await mountCorpus("09-polar-area");
    assert.deepEqual(
      stripText(
        withoutDeferred(goldenOf(page.views[0]), DEFERRED_TO_SLICE_H),
      ),
      stripText(GOLDEN_A),
    );
    assert.deepEqual(
      stripText(goldenOf(page.views[1])),
      stripText(GOLDEN_B),
    );
  });

  test("the text holds on chromium", async () => {
    assert.notStrictEqual(ENGINE, "unclassified");
    if (ENGINE !== "chromium") {
      return;
    }
    const page = await mountCorpus("09-polar-area");
    assert.deepEqual(
      withoutDeferred(goldenOf(page.views[0]), DEFERRED_TO_SLICE_H),
      GOLDEN_A,
    );
    assert.deepEqual(goldenOf(page.views[1]), GOLDEN_B);
  });

  test("★ the ramp is labeled, and it is one set", async () => {
    // Finding 17's own sentence: an unlabeled gradient is not a
    // legend, and the pre-finding-17 spelling could carry neither
    // `count` nor `format`. This view writes both. Rule 4 scopes
    // the STRINGS to chromium; the tick POSITIONS the graduations
    // sit at are asserted on all three by the golden.
    assert.notStrictEqual(ENGINE, "unclassified");
    if (ENGINE !== "chromium") {
      return;
    }
    const page = await mountCorpus("09-polar-area");
    const view = page.views[0];
    const legend = view.querySelector("hdml-legend");
    assert.isNotNull(legend);
    const el = <HdvlElement>(<unknown>legend);
    const hit = view.querySelector(
      'hdml-continuous-scale[channel="color"]',
    );
    const color = scaleOf(<HdvlElement>(<unknown>hit));
    assert.isNotNull(color);
    const ticks = color?.ticks(tickSpecOf(el)) ?? [];
    // `count="4"` asks for four boundaries; §4.8's ladder answers
    // with three over `[0, 2210]`, and a legend renders what the
    // ladder gave rather than padding to the request.
    assert.lengthOf(ticks, 3);
    const want = formatCompactSet(
      ticks.map((t) => Number(t.value)),
      "compact-short",
      localeOf(el),
    );
    const got = goldenOf(view)
      .groups.filter((g) => g.tag === "hdml-legend")[0]
      .nodes.filter((n) => n.k === "text")
      .map((n) => (n.k === "text" ? n.text : ""));
    assert.deepEqual(got, want);
    // …and the shared compact prefix really is shared (SPEC §7):
    // one bar may not read `900, 1.2K, 2.2K`.
    assert.deepEqual(got, ["0K", "1K", "2K"]);
  });

  test("it round-trips, is -0 free and fits the budget", async () => {
    const page = await mountCorpus("09-polar-area");
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
  height: 340,
  groups: [
    {
      widget: "",
      tag: "hdml-grid",
      role: "guide",
      box: {
        x: 12,
        y: 12,
        w: 348,
        h: 316,
      },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: false,
      clipPath: null,
      nodes: [
        {
          k: "arc",
          i: -1,
          cx: 186,
          cy: 170,
          r0: 0,
          r1: 0,
          a0: 0,
          a1: 360,
          fill: null,
          stroke: "rgb(203, 213, 225)",
          strokeWidth: 1,
          dash: [1, 2],
        },
        {
          k: "arc",
          i: -1,
          cx: 186,
          cy: 170,
          r0: 99.927974,
          r1: 99.927974,
          a0: 0,
          a1: 360,
          fill: null,
          stroke: "rgb(203, 213, 225)",
          strokeWidth: 1,
          dash: [1, 2],
        },
        {
          k: "arc",
          i: -1,
          cx: 186,
          cy: 170,
          r0: 141.319496,
          r1: 141.319496,
          a0: 0,
          a1: 360,
          fill: null,
          stroke: "rgb(203, 213, 225)",
          strokeWidth: 1,
          dash: [1, 2],
        },
      ],
    },
    {
      widget: "",
      tag: "hdml-label",
      role: "guide",
      box: {
        x: 12,
        y: 12,
        w: 348,
        h: 316,
      },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: false,
      clipPath: null,
      nodes: [
        {
          k: "text",
          i: -1,
          x: 186,
          y: 170,
          text: "0K",
          anchor: "middle",
          baseline: "middle",
          font: {
            family: "system-ui",
            size: 10,
            weight: "normal",
            style: "normal",
          },
          decorative: false,
          fill: "rgb(0, 0, 0)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "text",
          i: -1,
          x: 186,
          y: 70.072026,
          text: "1K",
          anchor: "middle",
          baseline: "bottom",
          font: {
            family: "system-ui",
            size: 10,
            weight: "normal",
            style: "normal",
          },
          decorative: false,
          fill: "rgb(0, 0, 0)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "text",
          i: -1,
          x: 186,
          y: 28.680504,
          text: "2K",
          anchor: "middle",
          baseline: "bottom",
          font: {
            family: "system-ui",
            size: 10,
            weight: "normal",
            style: "normal",
          },
          decorative: false,
          fill: "rgb(0, 0, 0)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
      ],
    },
    {
      widget: "",
      tag: "hdml-arc",
      role: "mark",
      box: {
        x: 12,
        y: 12,
        w: 348,
        h: 316,
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
          cy: 170,
          r0: 0,
          r1: 111.275083,
          a0: 0,
          a1: 30,
          fill:
            "color-mix(in oklch, rgb(30, 58, 138) " +
            "12.217194570135748%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "arc",
          i: 1,
          cx: 186,
          cy: 170,
          r0: 0,
          r1: 108.549565,
          a0: 30,
          a1: 60,
          fill:
            "color-mix(in oklch, rgb(30, 58, 138) " +
            "6.7873303167420795%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "arc",
          i: 2,
          cx: 186,
          cy: 170,
          r0: 0,
          r1: 123.199481,
          a0: 60,
          a1: 90,
          fill:
            "color-mix(in oklch, rgb(30, 58, 138) " +
            "37.55656108597285%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "arc",
          i: 3,
          cx: 186,
          cy: 170,
          r0: 0,
          r1: 126.794385,
          a0: 90,
          a1: 120,
          fill:
            "color-mix(in oklch, rgb(30, 58, 138) " +
            "45.70135746606334%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "arc",
          i: 4,
          cx: 186,
          cy: 170,
          r0: 0,
          r1: 137.378252,
          a0: 120,
          a1: 150,
          fill:
            "color-mix(in oklch, rgb(30, 58, 138) " +
            "71.04072398190044%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "arc",
          i: 5,
          cx: 186,
          cy: 170,
          r0: 0,
          r1: 143.075085,
          a0: 150,
          a1: 180,
          fill:
            "color-mix(in oklch, rgb(30, 58, 138) " +
            "85.52036199095024%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "arc",
          i: 6,
          cx: 186,
          cy: 170,
          r0: 0,
          r1: 148.553613,
          a0: 180,
          a1: 210,
          fill: "rgb(30, 58, 138)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "arc",
          i: 7,
          cx: 186,
          cy: 170,
          r0: 0,
          r1: 146.523172,
          a0: 210,
          a1: 240,
          fill:
            "color-mix(in oklch, rgb(30, 58, 138) " +
            "94.57013574660633%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "arc",
          i: 8,
          cx: 186,
          cy: 170,
          r0: 0,
          r1: 138.824378,
          a0: 240,
          a1: 270,
          fill:
            "color-mix(in oklch, rgb(30, 58, 138) " +
            "74.6606334841629%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "arc",
          i: 9,
          cx: 186,
          cy: 170,
          r0: 0,
          r1: 131.814051,
          a0: 270,
          a1: 300,
          fill:
            "color-mix(in oklch, rgb(30, 58, 138) " +
            "57.466063348416284%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "arc",
          i: 10,
          cx: 186,
          cy: 170,
          r0: 0,
          r1: 121.977637,
          a0: 300,
          a1: 330,
          fill:
            "color-mix(in oklch, rgb(30, 58, 138) " +
            "34.84162895927603%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "arc",
          i: 11,
          cx: 186,
          cy: 170,
          r0: 0,
          r1: 116.535042,
          a0: 330,
          a1: 360,
          fill:
            "color-mix(in oklch, rgb(30, 58, 138) " +
            "23.076923076923084%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
      ],
    },
    {
      widget: "",
      tag: "hdml-legend",
      role: "guide",
      box: {
        x: 360,
        y: 20,
        w: 110,
        h: 308,
      },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: false,
      clipPath: null,
      nodes: [
        {
          k: "rect",
          i: -1,
          x: 360,
          y: 20,
          w: 10,
          h: 9.625,
          fill:
            "color-mix(in oklch, rgb(28, 140, " +
            "244) 3.125%, rgb(219, 234, 254))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 360,
          y: 29.625,
          w: 10,
          h: 9.625,
          fill:
            "color-mix(in oklch, rgb(28, 140, " +
            "244) 9.375%, rgb(219, 234, 254))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 360,
          y: 39.25,
          w: 10,
          h: 9.625,
          fill:
            "color-mix(in oklch, rgb(28, 140, " +
            "244) 15.625%, rgb(219, 234, 254))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 360,
          y: 48.875,
          w: 10,
          h: 9.625,
          fill:
            "color-mix(in oklch, rgb(28, 140, " +
            "244) 21.875%, rgb(219, 234, 254))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 360,
          y: 58.5,
          w: 10,
          h: 9.625,
          fill:
            "color-mix(in oklch, rgb(28, 140, " +
            "244) 28.125%, rgb(219, 234, 254))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 360,
          y: 68.125,
          w: 10,
          h: 9.625,
          fill:
            "color-mix(in oklch, rgb(28, 140, " +
            "244) 34.375%, rgb(219, 234, 254))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 360,
          y: 77.75,
          w: 10,
          h: 9.625,
          fill:
            "color-mix(in oklch, rgb(28, 140, " +
            "244) 40.625%, rgb(219, 234, 254))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 360,
          y: 87.375,
          w: 10,
          h: 9.625,
          fill:
            "color-mix(in oklch, rgb(28, 140, " +
            "244) 46.875%, rgb(219, 234, 254))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 360,
          y: 97,
          w: 10,
          h: 9.625,
          fill:
            "color-mix(in oklch, rgb(28, 140, " +
            "244) 53.125%, rgb(219, 234, 254))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 360,
          y: 106.625,
          w: 10,
          h: 9.625,
          fill:
            "color-mix(in oklch, rgb(28, 140, " +
            "244) 59.375%, rgb(219, 234, 254))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 360,
          y: 116.25,
          w: 10,
          h: 9.625,
          fill:
            "color-mix(in oklch, rgb(28, 140, " +
            "244) 65.625%, rgb(219, 234, 254))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 360,
          y: 125.875,
          w: 10,
          h: 9.625,
          fill:
            "color-mix(in oklch, rgb(28, 140, " +
            "244) 71.875%, rgb(219, 234, 254))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 360,
          y: 135.5,
          w: 10,
          h: 9.625,
          fill:
            "color-mix(in oklch, rgb(28, 140, " +
            "244) 78.125%, rgb(219, 234, 254))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 360,
          y: 145.125,
          w: 10,
          h: 9.625,
          fill:
            "color-mix(in oklch, rgb(28, 140, " +
            "244) 84.375%, rgb(219, 234, 254))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 360,
          y: 154.75,
          w: 10,
          h: 9.625,
          fill:
            "color-mix(in oklch, rgb(28, 140, " +
            "244) 90.625%, rgb(219, 234, 254))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 360,
          y: 164.375,
          w: 10,
          h: 9.625,
          fill:
            "color-mix(in oklch, rgb(28, 140, " +
            "244) 96.875%, rgb(219, 234, 254))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 360,
          y: 174,
          w: 10,
          h: 9.625,
          fill:
            "color-mix(in oklch, rgb(30, 58, " +
            "138) 3.125%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 360,
          y: 183.625,
          w: 10,
          h: 9.625,
          fill:
            "color-mix(in oklch, rgb(30, 58, " +
            "138) 9.375%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 360,
          y: 193.25,
          w: 10,
          h: 9.625,
          fill:
            "color-mix(in oklch, rgb(30, 58, " +
            "138) 15.625%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 360,
          y: 202.875,
          w: 10,
          h: 9.625,
          fill:
            "color-mix(in oklch, rgb(30, 58, " +
            "138) 21.875%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 360,
          y: 212.5,
          w: 10,
          h: 9.625,
          fill:
            "color-mix(in oklch, rgb(30, 58, " +
            "138) 28.125%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 360,
          y: 222.125,
          w: 10,
          h: 9.625,
          fill:
            "color-mix(in oklch, rgb(30, 58, " +
            "138) 34.375%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 360,
          y: 231.75,
          w: 10,
          h: 9.625,
          fill:
            "color-mix(in oklch, rgb(30, 58, " +
            "138) 40.625%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 360,
          y: 241.375,
          w: 10,
          h: 9.625,
          fill:
            "color-mix(in oklch, rgb(30, 58, " +
            "138) 46.875%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 360,
          y: 251,
          w: 10,
          h: 9.625,
          fill:
            "color-mix(in oklch, rgb(30, 58, " +
            "138) 53.125%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 360,
          y: 260.625,
          w: 10,
          h: 9.625,
          fill:
            "color-mix(in oklch, rgb(30, 58, " +
            "138) 59.375%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 360,
          y: 270.25,
          w: 10,
          h: 9.625,
          fill:
            "color-mix(in oklch, rgb(30, 58, " +
            "138) 65.625%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 360,
          y: 279.875,
          w: 10,
          h: 9.625,
          fill:
            "color-mix(in oklch, rgb(30, 58, " +
            "138) 71.875%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 360,
          y: 289.5,
          w: 10,
          h: 9.625,
          fill:
            "color-mix(in oklch, rgb(30, 58, " +
            "138) 78.125%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 360,
          y: 299.125,
          w: 10,
          h: 9.625,
          fill:
            "color-mix(in oklch, rgb(30, 58, " +
            "138) 84.375%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 360,
          y: 308.75,
          w: 10,
          h: 9.625,
          fill:
            "color-mix(in oklch, rgb(30, 58, " +
            "138) 90.625%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 360,
          y: 318.375,
          w: 10,
          h: 9.625,
          fill:
            "color-mix(in oklch, rgb(30, 58, " +
            "138) 96.875%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "text",
          i: -1,
          x: 374,
          y: 20,
          text: "0K",
          anchor: "start",
          baseline: "middle",
          font: {
            family: "system-ui",
            size: 11,
            weight: "normal",
            style: "normal",
          },
          decorative: false,
          fill: "rgb(0, 0, 0)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "text",
          i: -1,
          x: 374,
          y: 159.366516,
          text: "1K",
          anchor: "start",
          baseline: "middle",
          font: {
            family: "system-ui",
            size: 11,
            weight: "normal",
            style: "normal",
          },
          decorative: false,
          fill: "rgb(0, 0, 0)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "text",
          i: -1,
          x: 374,
          y: 298.733032,
          text: "2K",
          anchor: "start",
          baseline: "middle",
          font: {
            family: "system-ui",
            size: 11,
            weight: "normal",
            style: "normal",
          },
          decorative: false,
          fill: "rgb(0, 0, 0)",
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
  height: 340,
  groups: [
    {
      widget: "",
      tag: "hdml-grid",
      role: "guide",
      box: {
        x: 12,
        y: 12,
        w: 456,
        h: 316,
      },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: false,
      clipPath: null,
      nodes: [
        {
          k: "arc",
          i: -1,
          cx: 240,
          cy: 170,
          r0: 0,
          r1: 0,
          a0: 0,
          a1: 360,
          fill: null,
          stroke: "rgb(203, 213, 225)",
          strokeWidth: 1,
          dash: [1, 2],
        },
        {
          k: "arc",
          i: -1,
          cx: 240,
          cy: 170,
          r0: 79,
          r1: 79,
          a0: 0,
          a1: 360,
          fill: null,
          stroke: "rgb(203, 213, 225)",
          strokeWidth: 1,
          dash: [1, 2],
        },
        {
          k: "arc",
          i: -1,
          cx: 240,
          cy: 170,
          r0: 111.722871,
          r1: 111.722871,
          a0: 0,
          a1: 360,
          fill: null,
          stroke: "rgb(203, 213, 225)",
          strokeWidth: 1,
          dash: [1, 2],
        },
        {
          k: "arc",
          i: -1,
          cx: 240,
          cy: 170,
          r0: 136.832014,
          r1: 136.832014,
          a0: 0,
          a1: 360,
          fill: null,
          stroke: "rgb(203, 213, 225)",
          strokeWidth: 1,
          dash: [1, 2],
        },
        {
          k: "arc",
          i: -1,
          cx: 240,
          cy: 170,
          r0: 158,
          r1: 158,
          a0: 0,
          a1: 360,
          fill: null,
          stroke: "rgb(203, 213, 225)",
          strokeWidth: 1,
          dash: [1, 2],
        },
      ],
    },
    {
      widget: "",
      tag: "hdml-arc",
      role: "mark",
      box: {
        x: 12,
        y: 12,
        w: 456,
        h: 316,
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
          cx: 240,
          cy: 170,
          r0: 0,
          r1: 117.175936,
          a0: 0,
          a1: 72,
          fill: "rgb(28, 140, 244)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "arc",
          i: 1,
          cx: 240,
          cy: 170,
          r0: 0,
          r1: 141.319496,
          a0: 72,
          a1: 144,
          fill: "rgb(245, 158, 11)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "arc",
          i: 2,
          cx: 240,
          cy: 170,
          r0: 0,
          r1: 93.474061,
          a0: 144,
          a1: 216,
          fill: "rgb(16, 185, 129)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "arc",
          i: 3,
          cx: 240,
          cy: 170,
          r0: 0,
          r1: 132.192284,
          a0: 216,
          a1: 288,
          fill: "rgb(139, 92, 246)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "arc",
          i: 4,
          cx: 240,
          cy: 170,
          r0: 0,
          r1: 153.999351,
          a0: 288,
          a1: 360,
          fill: "rgb(236, 72, 153)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
      ],
    },
  ],
};
