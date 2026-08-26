/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import "../index";
import type { Scene } from "../scene";
import type { HdvlElement } from "../base";
import type { HdmlViewElement } from "../view";
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
  textsOf,
} from "../../testing/corpus";
import {
  installSceneRecorder,
  restoreRenderers,
  sceneOf,
} from "../../testing/scene-of";
import { diagnosticsOf } from "../validate";
import { scaleOf } from "../scale";

/**
 * ★ **`06-bubble` — the only page in the corpus that runs the
 * `size` channel** (RFC §10.1 H, SPEC §4.3, §6.1, §6.6).
 *
 * The scatterplot's fourth dimension. `05-scatter` already proved
 * the mark; what is new here is that **three** of the four bound
 * channels resolve to *continuous* scales and the fourth to an
 * ordinal one, and that one of the three is `size` — a channel
 * whose range is not a box but a pair of registered lengths on the
 * scale itself.
 *
 * ★ **A bound `size` supplies both extents, and the ramp is the
 * SCALE's.** `--hdml-size-min: 4px` / `--hdml-size-max: 28px` are
 * §4.3's range for the channel, read once in `scale.ts` off the size
 * scale's own snapshot — so `hdml-point` calls `project()` and
 * interpolates nothing (R12), and a glyph is a **circle** because
 * the channel is one number with no second one to keep an aspect
 * ratio against. Both facts are asserted against the *computed
 * properties* rather than against captured pixels, which is the same
 * defence the diameter rule takes.
 *
 * ★ **`nice` on a `sqrt` scale, for the first time on a gated
 * page.** Step 25's correction — *"`nice` rounds to the scale's own
 * ladder, not always the linear one"* — was made for exactly this
 * combination and no corpus page had ever executed it. The resolved
 * domains are asserted against `Scale.domain()`, never against a
 * transcribed pair.
 *
 * ★ **The colour domain is derived from a column**
 * (`values="region"`), which is why this page is also the corpus's
 * one deliberate brush with §9's palette bound: the page declares
 * **four** colours, so the fixture seeds **four** regions. A fifth
 * would be step 31's `palette-exhausted` — an error on the *scale*,
 * raised in the binding pass whether or not a legend is written —
 * and the page would key a category in the fill-colour fallback. The
 * bound is deliberate, and `assertRenders`' empty-diagnostics clause
 * is what holds it.
 */

/** The one frame every channel on the page reads. */
const REF = "?hdml-frame=region_product";

/**
 * The pivot, in `hdml-sort-by`'s own order (`revenue desc`). Four
 * regions × two products — **four** is the palette's length, and
 * seeding a fifth region is what would fire `palette-exhausted`.
 */
const REGION = [
  "East",
  "North",
  "East",
  "North",
  "South",
  "West",
  "South",
  "West",
];

/** Declared by the frame, bound by no widget. */
const PRODUCT = [
  "Widget",
  "Widget",
  "Gadget",
  "Gadget",
  "Widget",
  "Widget",
  "Gadget",
  "Gadget",
];

const UNITS = [1500, 1200, 1100, 900, 800, 700, 640, 520];
const MARGIN = [0.19, 0.34, 0.31, 0.28, 0.41, 0.26, 0.22, 0.37];
const REVENUE = [
  960000, 820000, 720000, 640000, 510000, 450000, 390000, 300000,
];

/** `domainFor`'s insertion-ordered distinct list, and so the key. */
const REGIONS = ["East", "North", "South", "West"];

/** `--hdml-size-min`/`-max`, as the page declares them. */
const SIZE_RANGE: readonly [number, number] = [4, 28];

/** One element of the view, asserted present. */
function el(view: HdmlViewElement, sel: string): HdvlElement {
  const hit = view.querySelector(sel);
  assert.isNotNull(hit);
  return <HdvlElement>(<unknown>hit);
}

/** A registered `<length>`'s computed value, in px. */
function lengthOf(target: HdvlElement, name: string): number {
  return Number.parseFloat(
    getComputedStyle(target).getPropertyValue(name).trim(),
  );
}

/** The one mark group's nodes. */
function dots(scene: Scene): Scene["groups"][number] {
  const hit = scene.groups.filter((g) => g.role === "mark");
  assert.lengthOf(hit, 1);
  return hit[0];
}

suite("corpus 06-bubble", () => {
  let io: FakeIo;

  setup(() => {
    installSceneRecorder();
    io = mountFakeIo({
      [REF]: result(8, {
        region: stringCol(REGION),
        product: stringCol(PRODUCT),
        units: numberCol(UNITS),
        margin: numberCol(MARGIN),
        revenue: numberCol(REVENUE),
      }),
    });
  });

  teardown(() => {
    restoreRenderers();
  });

  test("the view renders through FakeIo alone", async () => {
    const page = await mountCorpus("06-bubble");
    assert.lengthOf(page.views, 1);
    // The page declares a provider against a host that does not
    // exist; the harness removes it and reports the count, so a
    // page that gained or lost one fails here rather than quietly
    // changing what the gate proves.
    assert.strictEqual(page.removedIo, 1);
    assert.strictEqual(page.sheets, 1);
    assertRenders(page.views[0]);
    assert.isAbove(io.subscriptions.length, 0);
    // Four bound channels, four scales in scope (V1).
    const view = page.views[0];
    assert.lengthOf(
      view.querySelectorAll("hdml-continuous-scale"),
      3,
    );
    assert.lengthOf(view.querySelectorAll("hdml-ordinal-scale"), 1);
  });

  test("★ a bound size is one number, twice", async () => {
    // §6.1: the channel supplies BOTH extents, so a glyph is a
    // circle by construction rather than by an aspect-ratio rule
    // nobody wrote. Derived on the RAW scene: the extent is a
    // DIAMETER, so an ellipse takes half of it, and reading the
    // property as a radius would draw every bubble twice its
    // declared size with no scene assertion catching it.
    const page = await mountCorpus("06-bubble");
    const view = page.views[0];
    const sel = 'hdml-continuous-scale[channel="size"]';
    const size = scaleOf(el(view, sel));
    assert.isNotNull(size);
    dots(sceneOf(view)).nodes.forEach((n, i) => {
      assert.strictEqual(n.k, "ellipse");
      if (n.k !== "ellipse") {
        return;
      }
      assert.strictEqual(n.rx, n.ry);
      assert.strictEqual(2 * n.rx, size?.project(REVENUE[i]));
    });
  });

  test("★ the size ramp is the scale's own box", async () => {
    // §4.3: `--hdml-size-min`/`-max` ARE the `size` channel's
    // range, read once in `scale.ts` from the size scale's own
    // snapshot. Asserted against the COMPUTED properties, so the
    // page's declaration and the scale's answer are compared
    // rather than two transcriptions of the same pair.
    const page = await mountCorpus("06-bubble");
    const view = page.views[0];
    const sel = 'hdml-continuous-scale[channel="size"]';
    const target = el(view, sel);
    const size = scaleOf(target);
    assert.strictEqual(
      lengthOf(target, "--hdml-size-min"),
      SIZE_RANGE[0],
    );
    assert.strictEqual(
      lengthOf(target, "--hdml-size-max"),
      SIZE_RANGE[1],
    );
    assert.deepEqual(size?.range(), [SIZE_RANGE[0], SIZE_RANGE[1]]);
    // The extremes land ON the declared pair: the ramp's ends are
    // the DOMAIN's ends, not the delivered rows' — `nice` widened
    // the domain past the largest revenue, so the biggest bubble
    // is deliberately smaller than `--hdml-size-max`.
    const extent = size?.domain()?.extent ?? [0, 0];
    assert.strictEqual(size?.project(extent[0]), SIZE_RANGE[0]);
    assert.strictEqual(size?.project(extent[1]), SIZE_RANGE[1]);
    const widest = Math.max(...REVENUE);
    assert.isBelow(size?.project(widest) ?? 0, SIZE_RANGE[1]);
  });

  test("★ nice rounds on each scale's own ladder", async () => {
    // Step 25's correction, on a page. Every domain is read back
    // from `Scale.domain()` — the only statement of what §4.2's
    // seven steps produced — and none of the three reads a pixel,
    // so a resize cannot move any of them.
    const page = await mountCorpus("06-bubble");
    const view = page.views[0];
    const x = scaleOf(el(view, 'hdml-continuous-scale[channel="x"]'));
    const y = scaleOf(el(view, 'hdml-continuous-scale[channel="y"]'));
    const size = scaleOf(
      el(view, 'hdml-continuous-scale[channel="size"]'),
    );
    // x: `min="0"` floors it, `nice` lifts 1500 to the numeric
    // ladder's next step boundary.
    assert.deepEqual(x?.domain()?.extent, [0, 1600]);
    // y: a fractional extent, rounded on the same ladder at a
    // negative power — the integer-reciprocal form.
    assert.deepEqual(y?.domain()?.extent, [0.15, 0.45]);
    // size: `type="sqrt"`, which `continuousSpec()` resolves to
    // `pow` at exponent 0.5, so §4.8's POW row is what rounds it.
    // Its ladder rounds in the transformed space and lands on
    // 1 000 000 — which the numeric ladder would also have
    // reached from 960 000, so this page does not tell the two
    // apart and does not claim to; what it asserts is that the
    // combination runs at all and produces a domain V2 accepts.
    assert.strictEqual(size?.kind, "continuous");
    assert.deepEqual(size?.domain()?.extent, [0, 1000000]);
    assert.deepEqual(diagnosticsOf(view), []);
  });

  test("★ the colour domain is the column's", async () => {
    // `values="region"` makes the domain an ordinary `raw: false`
    // subscription, so it is the DELIVERED distinct list in
    // insertion order — not the page's text, and not the palette.
    //
    // The fixture seeds exactly four regions ON PURPOSE: the page
    // declares four palette colours, and a fifth value would be
    // `palette-exhausted` on the scale (§9, step 31) — an error
    // raised in the binding pass whether or not a legend exists.
    // The empty-diagnostics assertion is what holds that bound.
    const page = await mountCorpus("06-bubble");
    const view = page.views[0];
    const sel = 'hdml-ordinal-scale[channel="color"]';
    const color = scaleOf(el(view, sel));
    assert.strictEqual(color?.kind, "ordinal");
    assert.deepEqual(color?.domain()?.values, REGIONS);
    assert.lengthOf(REGIONS, 4);
    assert.deepEqual(diagnosticsOf(view), []);
    assert.isFalse(view.matches(":state(error)"));
    // §5.5: a colour scale publishes no range — a palette is a
    // contract, not an omission.
    assert.isNull(color?.range());
  });

  test("★ the key is the domain, in the gutter", async () => {
    // §6.6's ordinal mode: one swatch-plus-name entry per domain
    // value, generated together from one value, so entry k's
    // colour IS `paint(domain[k])`. Compared byte for byte against
    // a real `paint()` call and against the dots that wear it.
    const page = await mountCorpus("06-bubble");
    const view = page.views[0];
    assert.isEmpty(DEFERRED_TO_SLICE_H);
    const color = scaleOf(
      el(view, 'hdml-ordinal-scale[channel="color"]'),
    );
    const scene = goldenOf(view);
    const key = scene.groups.filter(
      (g) => g.tag === "hdml-legend",
    )[0];
    assert.isDefined(key);
    assert.strictEqual(key.role, "guide");
    assert.lengthOf(key.nodes, 2 * REGIONS.length);
    const marks = dots(scene).nodes;
    REGIONS.forEach((name, k) => {
      const swatch = key.nodes[2 * k];
      const label = key.nodes[2 * k + 1];
      // The swatch is `--hdml-tick-style`'s registered INITIAL,
      // not the `ellipse` the page declares on `hdml-point` — the
      // rule is scoped to that tag and does not reach here.
      assert.strictEqual(swatch.k, "rect");
      assert.strictEqual(swatch.i, -1);
      assert.strictEqual(label.k === "text" ? label.text : "", name);
      assert.strictEqual(swatch.fill, color?.paint(name));
      // …and a dot of that region wears the identical string.
      const row = REGION.indexOf(name);
      assert.strictEqual(swatch.fill, marks[row].fill);
    });
    // The corpus gutter idiom (`left: 100%` + an explicit width),
    // which SPEC §3 distinguishes from the UA overlay default:
    // the key's box starts exactly at the plot's right edge.
    const grid = scene.groups.filter((g) => g.tag === "hdml-grid")[0];
    assert.strictEqual(key.box.x, grid.box.x + grid.box.w);
    assert.strictEqual(key.box.w, 120);
  });

  test("the golden holds on every engine", async () => {
    const page = await mountCorpus("06-bubble");
    assert.deepEqual(
      stripText(goldenOf(page.views[0])),
      stripText(GOLDEN),
    );
  });

  test("the text holds on chromium", async () => {
    // Rule 4: `compact-short` on x and `percent precision-integer`
    // on y are both ICU data. The key's names are not — they are
    // domain strings rendered verbatim — but they travel in the
    // same golden, so the whole comparison is scoped.
    assert.notStrictEqual(ENGINE, "unclassified");
    if (ENGINE !== "chromium") {
      return;
    }
    const page = await mountCorpus("06-bubble");
    assert.deepEqual(goldenOf(page.views[0]), GOLDEN);
    assert.deepEqual(textsOf(goldenOf(page.views[0])), [
      "0K",
      "0.5K",
      "1K",
      "1.5K",
      "20%",
      "30%",
      "40%",
      ...REGIONS,
    ]);
  });

  test("it round-trips, is -0 free and fits the budget", async () => {
    const page = await mountCorpus("06-bubble");
    const view = page.views[0];
    const scene = goldenOf(view);
    assert.deepEqual(structuredClone(scene), scene);
    // Rule 9 over the RAW scene, though this page is cartesian and
    // the polar hazard cannot arise: the sweep is cheap and a rule
    // that is only run where it is expected to fire is not a rule.
    assert.deepEqual(negativeZeros(sceneOf(view)), []);
    // R20/W4: eleven guide ticks, eight bubbles and a four-entry
    // key. `04-E` is still the densest gated view in the project.
    assert.strictEqual(nodeCount(scene), 32);
    assert.isBelow(nodeCount(scene), 20000);
  });
});

const GOLDEN: Scene = {
  width: 760,
  height: 380,
  groups: [
    {
      widget: "",
      tag: "hdml-grid",
      role: "guide",
      box: {
        x: 76,
        y: 28,
        w: 542,
        h: 300,
      },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: false,
      clipPath: null,
      nodes: [
        {
          k: "path",
          i: -1,
          subpaths: [
            {
              start: {
                x: 76,
                y: 328,
              },
              segments: [
                {
                  k: "line",
                  to: {
                    x: 76,
                    y: 28,
                  },
                },
              ],
            },
          ],
          closed: false,
          vertices: [],
          fill: null,
          stroke: "rgb(226, 232, 240)",
          strokeWidth: 1,
          dash: [1, 2],
        },
        {
          k: "path",
          i: -1,
          subpaths: [
            {
              start: {
                x: 245.375,
                y: 328,
              },
              segments: [
                {
                  k: "line",
                  to: {
                    x: 245.375,
                    y: 28,
                  },
                },
              ],
            },
          ],
          closed: false,
          vertices: [],
          fill: null,
          stroke: "rgb(226, 232, 240)",
          strokeWidth: 1,
          dash: [1, 2],
        },
        {
          k: "path",
          i: -1,
          subpaths: [
            {
              start: {
                x: 414.75,
                y: 328,
              },
              segments: [
                {
                  k: "line",
                  to: {
                    x: 414.75,
                    y: 28,
                  },
                },
              ],
            },
          ],
          closed: false,
          vertices: [],
          fill: null,
          stroke: "rgb(226, 232, 240)",
          strokeWidth: 1,
          dash: [1, 2],
        },
        {
          k: "path",
          i: -1,
          subpaths: [
            {
              start: {
                x: 584.125,
                y: 328,
              },
              segments: [
                {
                  k: "line",
                  to: {
                    x: 584.125,
                    y: 28,
                  },
                },
              ],
            },
          ],
          closed: false,
          vertices: [],
          fill: null,
          stroke: "rgb(226, 232, 240)",
          strokeWidth: 1,
          dash: [1, 2],
        },
      ],
    },
    {
      widget: "",
      tag: "hdml-grid",
      role: "guide",
      box: {
        x: 76,
        y: 28,
        w: 542,
        h: 300,
      },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: false,
      clipPath: null,
      nodes: [
        {
          k: "path",
          i: -1,
          subpaths: [
            {
              start: {
                x: 76,
                y: 278,
              },
              segments: [
                {
                  k: "line",
                  to: {
                    x: 618,
                    y: 278,
                  },
                },
              ],
            },
          ],
          closed: false,
          vertices: [],
          fill: null,
          stroke: "rgb(226, 232, 240)",
          strokeWidth: 1,
          dash: [1, 2],
        },
        {
          k: "path",
          i: -1,
          subpaths: [
            {
              start: {
                x: 76,
                y: 178,
              },
              segments: [
                {
                  k: "line",
                  to: {
                    x: 618,
                    y: 178,
                  },
                },
              ],
            },
          ],
          closed: false,
          vertices: [],
          fill: null,
          stroke: "rgb(226, 232, 240)",
          strokeWidth: 1,
          dash: [1, 2],
        },
        {
          k: "path",
          i: -1,
          subpaths: [
            {
              start: {
                x: 76,
                y: 78,
              },
              segments: [
                {
                  k: "line",
                  to: {
                    x: 618,
                    y: 78,
                  },
                },
              ],
            },
          ],
          closed: false,
          vertices: [],
          fill: null,
          stroke: "rgb(226, 232, 240)",
          strokeWidth: 1,
          dash: [1, 2],
        },
      ],
    },
    {
      widget: "",
      tag: "hdml-axis",
      role: "guide",
      box: {
        x: 76,
        y: 328,
        w: 542,
        h: 24,
      },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: false,
      clipPath: null,
      nodes: [
        {
          k: "path",
          i: -1,
          subpaths: [
            {
              start: {
                x: 76,
                y: 328,
              },
              segments: [
                {
                  k: "line",
                  to: {
                    x: 618,
                    y: 328,
                  },
                },
              ],
            },
          ],
          closed: false,
          vertices: [],
          fill: null,
          stroke: "rgb(100, 116, 139)",
          strokeWidth: 1,
          dash: null,
        },
      ],
    },
    {
      widget: "",
      tag: "hdml-axis",
      role: "guide",
      box: {
        x: 76,
        y: 28,
        w: 40,
        h: 300,
      },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: false,
      clipPath: null,
      nodes: [
        {
          k: "path",
          i: -1,
          subpaths: [
            {
              start: {
                x: 116,
                y: 328,
              },
              segments: [
                {
                  k: "line",
                  to: {
                    x: 116,
                    y: 28,
                  },
                },
              ],
            },
          ],
          closed: false,
          vertices: [],
          fill: null,
          stroke: "rgb(100, 116, 139)",
          strokeWidth: 1,
          dash: null,
        },
      ],
    },
    {
      widget: "",
      tag: "hdml-label",
      role: "guide",
      box: {
        x: 76,
        y: 328,
        w: 542,
        h: 24,
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
          x: 76,
          y: 328,
          text: "0K",
          anchor: "middle",
          baseline: "top",
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
          x: 245.375,
          y: 328,
          text: "0.5K",
          anchor: "middle",
          baseline: "top",
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
          x: 414.75,
          y: 328,
          text: "1K",
          anchor: "middle",
          baseline: "top",
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
          x: 584.125,
          y: 328,
          text: "1.5K",
          anchor: "middle",
          baseline: "top",
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
    {
      widget: "",
      tag: "hdml-label",
      role: "guide",
      box: {
        x: 36,
        y: 28,
        w: 40,
        h: 300,
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
          x: 76,
          y: 278,
          text: "20%",
          anchor: "end",
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
          x: 76,
          y: 178,
          text: "30%",
          anchor: "end",
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
          x: 76,
          y: 78,
          text: "40%",
          anchor: "end",
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
    {
      widget: "",
      tag: "hdml-point",
      role: "mark",
      box: {
        x: 76,
        y: 28,
        w: 542,
        h: 300,
      },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: true,
      clipPath: null,
      nodes: [
        {
          k: "ellipse",
          i: 0,
          cx: 584.125,
          cy: 288,
          rx: 13.757551,
          ry: 13.757551,
          fill: "rgb(28, 140, 244)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "ellipse",
          i: 1,
          cx: 482.5,
          cy: 138,
          rx: 12.866462,
          ry: 12.866462,
          fill: "rgb(245, 158, 11)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "ellipse",
          i: 2,
          cx: 448.625,
          cy: 168,
          rx: 12.182338,
          ry: 12.182338,
          fill: "rgb(28, 140, 244)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "ellipse",
          i: 3,
          cx: 380.875,
          cy: 198,
          rx: 11.6,
          ry: 11.6,
          fill: "rgb(245, 158, 11)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "ellipse",
          i: 4,
          cx: 347,
          cy: 68,
          rx: 10.569714,
          ry: 10.569714,
          fill: "rgb(16, 185, 129)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "ellipse",
          i: 5,
          cx: 313.125,
          cy: 218,
          rx: 10.049845,
          ry: 10.049845,
          fill: "rgb(139, 92, 246)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "ellipse",
          i: 6,
          cx: 292.8,
          cy: 258,
          rx: 9.493998,
          ry: 9.493998,
          fill: "rgb(16, 185, 129)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "ellipse",
          i: 7,
          cx: 252.15,
          cy: 108,
          rx: 8.572671,
          ry: 8.572671,
          fill: "rgb(139, 92, 246)",
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
        x: 618,
        y: 36,
        w: 120,
        h: 292,
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
          x: 618,
          y: 36,
          w: 10,
          h: 10,
          fill: "rgb(28, 140, 244)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "text",
          i: -1,
          x: 632,
          y: 41,
          text: "East",
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
          k: "rect",
          i: -1,
          x: 618,
          y: 50,
          w: 10,
          h: 10,
          fill: "rgb(245, 158, 11)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "text",
          i: -1,
          x: 632,
          y: 55,
          text: "North",
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
          k: "rect",
          i: -1,
          x: 618,
          y: 64,
          w: 10,
          h: 10,
          fill: "rgb(16, 185, 129)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "text",
          i: -1,
          x: 632,
          y: 69,
          text: "South",
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
          k: "rect",
          i: -1,
          x: 618,
          y: 78,
          w: 10,
          h: 10,
          fill: "rgb(139, 92, 246)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "text",
          i: -1,
          x: 632,
          y: 83,
          text: "West",
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
