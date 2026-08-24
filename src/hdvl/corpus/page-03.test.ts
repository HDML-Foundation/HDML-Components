/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import "../index";
import type { Scene } from "../scene";
import { FakeIo, mountFakeIo } from "../../testing/FakeIo";
import {
  ENGINE,
  assertRenders,
  goldenOf,
  mountCorpus,
  nodeCount,
  numberCol,
  result,
  stringCol,
  stripText,
} from "../../testing/corpus";
import {
  installSceneRecorder,
  restoreRenderers,
} from "../../testing/scene-of";

/**
 * ★ **`03-bar` — orientation is derived, three times over**
 * (RFC §10.1 E, SPEC §6).
 *
 * Views **A** and **B** carry the *same tag with its channels
 * swapped*: `hdml-bar x="region" y="revenue"` under an ordinal `x`,
 * then `x="revenue" y="region"` under an ordinal `y`. Nothing in the
 * markup says "horizontal" — the band-filling side is whichever
 * channel resolves an ordinal scale — so the two views are the
 * project's proof that `hdml-bar` has no orientation attribute to get
 * wrong.
 *
 * View **C** is the page's cross-document case: a **static** ref on
 * the plane itself
 * (`/warehouse/weather.html?hdml-frame=monthly_temps`
 * — a document that does not exist and is not invented, RFC §10.3)
 * with a truly two-column range, `y0="t_min" y1="t_max"`.
 */

/** Views A and B — the in-page ref. */
const LOCAL = "?hdml-frame=region_rev";

/** View C — a static ref straight on the plane. */
const STATIC = "/warehouse/weather.html?hdml-frame=monthly_temps";

const REGIONS = ["North", "South", "East", "West"];
const REVENUE = [1200000, 940000, 780000, 520000];

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
const T_MIN = [-6, -4, 0, 5, 10, 14, 16, 15, 11, 6, 1, -3];
const T_MAX = [2, 4, 9, 15, 20, 25, 28, 27, 22, 16, 9, 4];

suite("corpus 03-bar", () => {
  let io: FakeIo;

  setup(() => {
    installSceneRecorder();
    io = mountFakeIo({
      [LOCAL]: result(4, {
        region: stringCol(REGIONS),
        revenue: numberCol(REVENUE),
      }),
      [STATIC]: result(12, {
        month: stringCol(MONTHS),
        t_min: numberCol(T_MIN),
        t_max: numberCol(T_MAX),
      }),
    });
  });

  teardown(() => {
    restoreRenderers();
  });

  test("all three views render", async () => {
    const page = await mountCorpus("03-bar");
    assert.lengthOf(page.views, 3);
    assert.strictEqual(page.removedIo, 1);
    page.views.forEach((v) => assertRenders(v));
  });

  test("the static plane ref reaches the seam", async () => {
    await mountCorpus("03-bar");
    const refs = new Set(io.subscriptions.map((s) => s.ref));
    assert.isTrue(refs.has(STATIC));
    assert.isTrue(refs.has(LOCAL));
  });

  test("orientation is derived from the scales", async () => {
    const page = await mountCorpus("03-bar");
    const a = barsOf(goldenOf(page.views[0]));
    const b = barsOf(goldenOf(page.views[1]));
    assert.lengthOf(a, 4);
    assert.lengthOf(b, 4);
    // A: every bar shares one width and they differ in height.
    assert.strictEqual(new Set(a.map((r) => r.w)).size, 1);
    assert.strictEqual(new Set(a.map((r) => r.h)).size, 4);
    // B: the same markup, channels swapped — one height, four
    // widths. No attribute was added to make this happen.
    assert.strictEqual(new Set(b.map((r) => r.h)).size, 1);
    assert.strictEqual(new Set(b.map((r) => r.w)).size, 4);
  });

  test("C's floating bars span two columns", async () => {
    const page = await mountCorpus("03-bar");
    const bars = barsOf(goldenOf(page.views[2]));
    assert.lengthOf(bars, 12);
    // A baselined bar chart has ONE shared edge; a floating one has
    // none. Both ends vary here, which is what `y0`/`y1` bound to two
    // columns means and what a single `y` could not express.
    assert.isAbove(new Set(bars.map((r) => r.y)).size, 1);
    assert.isAbove(new Set(bars.map((r) => r.y + r.h)).size, 1);
    bars.forEach((r) => assert.isAbove(r.h, 0));
  });

  test("the goldens hold on every engine", async () => {
    const page = await mountCorpus("03-bar");
    [GOLDEN_A, GOLDEN_B, GOLDEN_C].forEach((golden, k) => {
      assert.deepEqual(
        stripText(goldenOf(page.views[k])),
        stripText(golden),
      );
    });
  });

  test("the text holds on chromium", async () => {
    assert.notStrictEqual(ENGINE, "unclassified");
    if (ENGINE !== "chromium") {
      return;
    }
    const page = await mountCorpus("03-bar");
    [GOLDEN_A, GOLDEN_B, GOLDEN_C].forEach((golden, k) => {
      assert.deepEqual(goldenOf(page.views[k]), golden);
    });
  });

  test("all three round-trip and fit the budget", async () => {
    const page = await mountCorpus("03-bar");
    page.views.forEach((v) => {
      const scene = goldenOf(v);
      assert.deepEqual(structuredClone(scene), scene);
      assert.isBelow(nodeCount(scene), 20000);
    });
  });
});

/** Every `hdml-bar` rect in a scene. */
function barsOf(
  scene: Scene,
): { x: number; y: number; w: number; h: number }[] {
  const out: { x: number; y: number; w: number; h: number }[] = [];
  for (const group of scene.groups) {
    if (group.tag !== "hdml-bar") {
      continue;
    }
    for (const node of group.nodes) {
      if (node.k === "rect") {
        out.push({ x: node.x, y: node.y, w: node.w, h: node.h });
      }
    }
  }
  return out;
}

const GOLDEN_A: Scene = {
  width: 760,
  height: 300,
  groups: [
    {
      widget: "",
      tag: "hdml-grid",
      role: "guide",
      box: { x: 80, y: 24, w: 640, h: 228 },
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
              start: { x: 80, y: 252 },
              segments: [{ k: "line", to: { x: 720, y: 252 } }],
            },
          ],
          closed: false,
          vertices: [],
          fill: null,
          stroke: "rgb(203, 213, 225)",
          strokeWidth: 1,
          dash: [1, 2],
        },
        {
          k: "path",
          i: -1,
          subpaths: [
            {
              start: { x: 80, y: 157 },
              segments: [{ k: "line", to: { x: 720, y: 157 } }],
            },
          ],
          closed: false,
          vertices: [],
          fill: null,
          stroke: "rgb(203, 213, 225)",
          strokeWidth: 1,
          dash: [1, 2],
        },
        {
          k: "path",
          i: -1,
          subpaths: [
            {
              start: { x: 80, y: 62 },
              segments: [{ k: "line", to: { x: 720, y: 62 } }],
            },
          ],
          closed: false,
          vertices: [],
          fill: null,
          stroke: "rgb(203, 213, 225)",
          strokeWidth: 1,
          dash: [1, 2],
        },
      ],
    },
    {
      widget: "",
      tag: "hdml-axis",
      role: "guide",
      box: { x: 80, y: 252, w: 640, h: 24 },
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
              start: { x: 80, y: 252 },
              segments: [{ k: "line", to: { x: 720, y: 252 } }],
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
      box: { x: 80, y: 24, w: 40, h: 228 },
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
              start: { x: 120, y: 252 },
              segments: [{ k: "line", to: { x: 120, y: 24 } }],
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
      box: { x: 80, y: 252, w: 640, h: 24 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: false,
      clipPath: null,
      nodes: [
        {
          k: "text",
          i: -1,
          x: 140.540541,
          y: 252,
          text: "North",
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
          x: 313.513514,
          y: 252,
          text: "South",
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
          x: 486.486486,
          y: 252,
          text: "East",
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
          x: 659.459459,
          y: 252,
          text: "West",
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
      box: { x: 40, y: 24, w: 40, h: 228 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: false,
      clipPath: null,
      nodes: [
        {
          k: "text",
          i: -1,
          x: 80,
          y: 252,
          text: "0M",
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
          x: 80,
          y: 157,
          text: "0.5M",
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
          x: 80,
          y: 62,
          text: "1M",
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
      tag: "hdml-bar",
      role: "mark",
      box: { x: 80, y: 24, w: 640, h: 228 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: true,
      clipPath: null,
      nodes: [
        {
          k: "rect",
          i: 0,
          x: 80,
          y: 24,
          w: 121.081081,
          h: 228,
          fill: "rgb(28, 140, 244)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 1,
          x: 252.972973,
          y: 73.4,
          w: 121.081081,
          h: 178.6,
          fill: "rgb(28, 140, 244)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 2,
          x: 425.945946,
          y: 103.8,
          w: 121.081081,
          h: 148.2,
          fill: "rgb(28, 140, 244)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 3,
          x: 598.918919,
          y: 153.2,
          w: 121.081081,
          h: 98.8,
          fill: "rgb(28, 140, 244)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
      ],
    },
  ],
};
const GOLDEN_B: Scene = {
  width: 760,
  height: 300,
  groups: [
    {
      widget: "",
      tag: "hdml-grid",
      role: "guide",
      box: { x: 72, y: 28, w: 656, h: 220 },
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
              start: { x: 72, y: 248 },
              segments: [{ k: "line", to: { x: 72, y: 28 } }],
            },
          ],
          closed: false,
          vertices: [],
          fill: null,
          stroke: "rgb(203, 213, 225)",
          strokeWidth: 1,
          dash: [1, 2],
        },
        {
          k: "path",
          i: -1,
          subpaths: [
            {
              start: { x: 345.333333, y: 248 },
              segments: [{ k: "line", to: { x: 345.333333, y: 28 } }],
            },
          ],
          closed: false,
          vertices: [],
          fill: null,
          stroke: "rgb(203, 213, 225)",
          strokeWidth: 1,
          dash: [1, 2],
        },
        {
          k: "path",
          i: -1,
          subpaths: [
            {
              start: { x: 618.666667, y: 248 },
              segments: [{ k: "line", to: { x: 618.666667, y: 28 } }],
            },
          ],
          closed: false,
          vertices: [],
          fill: null,
          stroke: "rgb(203, 213, 225)",
          strokeWidth: 1,
          dash: [1, 2],
        },
      ],
    },
    {
      widget: "",
      tag: "hdml-axis",
      role: "guide",
      box: { x: 72, y: 248, w: 656, h: 24 },
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
              start: { x: 72, y: 248 },
              segments: [{ k: "line", to: { x: 728, y: 248 } }],
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
      box: { x: 72, y: 28, w: 40, h: 220 },
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
              start: { x: 112, y: 248 },
              segments: [{ k: "line", to: { x: 112, y: 28 } }],
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
      box: { x: 72, y: 248, w: 656, h: 24 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: false,
      clipPath: null,
      nodes: [
        {
          k: "text",
          i: -1,
          x: 72,
          y: 248,
          text: "0M",
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
          x: 345.333333,
          y: 248,
          text: "0.5M",
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
          x: 618.666667,
          y: 248,
          text: "1M",
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
      box: { x: 32, y: 28, w: 40, h: 220 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: false,
      clipPath: null,
      nodes: [
        {
          k: "text",
          i: -1,
          x: 72,
          y: 227.189189,
          text: "North",
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
          x: 72,
          y: 167.72973,
          text: "South",
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
          x: 72,
          y: 108.27027,
          text: "East",
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
          x: 72,
          y: 48.810811,
          text: "West",
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
      tag: "hdml-bar",
      role: "mark",
      box: { x: 72, y: 28, w: 656, h: 220 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: true,
      clipPath: null,
      nodes: [
        {
          k: "rect",
          i: 0,
          x: 72,
          y: 206.378378,
          w: 656,
          h: 41.621622,
          fill: "rgb(28, 140, 244)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 1,
          x: 72,
          y: 146.918919,
          w: 513.866667,
          h: 41.621622,
          fill: "rgb(28, 140, 244)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 2,
          x: 72,
          y: 87.459459,
          w: 426.4,
          h: 41.621622,
          fill: "rgb(28, 140, 244)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 3,
          x: 72,
          y: 28,
          w: 284.266667,
          h: 41.621622,
          fill: "rgb(28, 140, 244)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
      ],
    },
  ],
};
const GOLDEN_C: Scene = {
  width: 760,
  height: 300,
  groups: [
    {
      widget: "",
      tag: "hdml-grid",
      role: "guide",
      box: { x: 80, y: 24, w: 640, h: 228 },
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
              start: { x: 80, y: 252 },
              segments: [{ k: "line", to: { x: 720, y: 252 } }],
            },
          ],
          closed: false,
          vertices: [],
          fill: null,
          stroke: "rgb(203, 213, 225)",
          strokeWidth: 1,
          dash: [1, 2],
        },
        {
          k: "path",
          i: -1,
          subpaths: [
            {
              start: { x: 80, y: 206.4 },
              segments: [{ k: "line", to: { x: 720, y: 206.4 } }],
            },
          ],
          closed: false,
          vertices: [],
          fill: null,
          stroke: "rgb(203, 213, 225)",
          strokeWidth: 1,
          dash: [1, 2],
        },
        {
          k: "path",
          i: -1,
          subpaths: [
            {
              start: { x: 80, y: 160.8 },
              segments: [{ k: "line", to: { x: 720, y: 160.8 } }],
            },
          ],
          closed: false,
          vertices: [],
          fill: null,
          stroke: "rgb(203, 213, 225)",
          strokeWidth: 1,
          dash: [1, 2],
        },
        {
          k: "path",
          i: -1,
          subpaths: [
            {
              start: { x: 80, y: 115.2 },
              segments: [{ k: "line", to: { x: 720, y: 115.2 } }],
            },
          ],
          closed: false,
          vertices: [],
          fill: null,
          stroke: "rgb(203, 213, 225)",
          strokeWidth: 1,
          dash: [1, 2],
        },
        {
          k: "path",
          i: -1,
          subpaths: [
            {
              start: { x: 80, y: 69.6 },
              segments: [{ k: "line", to: { x: 720, y: 69.6 } }],
            },
          ],
          closed: false,
          vertices: [],
          fill: null,
          stroke: "rgb(203, 213, 225)",
          strokeWidth: 1,
          dash: [1, 2],
        },
        {
          k: "path",
          i: -1,
          subpaths: [
            {
              start: { x: 80, y: 24 },
              segments: [{ k: "line", to: { x: 720, y: 24 } }],
            },
          ],
          closed: false,
          vertices: [],
          fill: null,
          stroke: "rgb(203, 213, 225)",
          strokeWidth: 1,
          dash: [1, 2],
        },
      ],
    },
    {
      widget: "",
      tag: "hdml-axis",
      role: "guide",
      box: { x: 80, y: 252, w: 640, h: 24 },
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
              start: { x: 80, y: 252 },
              segments: [{ k: "line", to: { x: 720, y: 252 } }],
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
      box: { x: 80, y: 24, w: 40, h: 228 },
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
              start: { x: 120, y: 252 },
              segments: [{ k: "line", to: { x: 120, y: 24 } }],
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
      box: { x: 80, y: 252, w: 640, h: 24 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: false,
      clipPath: null,
      nodes: [
        {
          k: "text",
          i: -1,
          x: 99.145299,
          y: 252,
          text: "Jan",
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
          x: 153.846154,
          y: 252,
          text: "Feb",
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
          x: 208.547009,
          y: 252,
          text: "Mar",
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
          x: 263.247863,
          y: 252,
          text: "Apr",
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
          x: 317.948718,
          y: 252,
          text: "May",
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
          x: 372.649573,
          y: 252,
          text: "Jun",
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
          x: 427.350427,
          y: 252,
          text: "Jul",
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
          x: 482.051282,
          y: 252,
          text: "Aug",
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
          x: 536.752137,
          y: 252,
          text: "Sep",
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
          x: 591.452991,
          y: 252,
          text: "Oct",
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
          x: 646.153846,
          y: 252,
          text: "Nov",
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
          x: 700.854701,
          y: 252,
          text: "Dec",
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
      box: { x: 40, y: 24, w: 40, h: 228 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: false,
      clipPath: null,
      nodes: [
        {
          k: "text",
          i: -1,
          x: 80,
          y: 252,
          text: "-10",
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
          x: 80,
          y: 206.4,
          text: "0",
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
          x: 80,
          y: 160.8,
          text: "10",
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
          x: 80,
          y: 115.2,
          text: "20",
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
          x: 80,
          y: 69.6,
          text: "30",
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
          x: 80,
          y: 24,
          text: "40",
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
      tag: "hdml-bar",
      role: "mark",
      box: { x: 80, y: 24, w: 640, h: 228 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: true,
      clipPath: null,
      nodes: [
        {
          k: "rect",
          i: 0,
          x: 80,
          y: 197.28,
          w: 38.290598,
          h: 36.48,
          fill: "rgb(245, 158, 11)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 1,
          x: 134.700855,
          y: 188.16,
          w: 38.290598,
          h: 36.48,
          fill: "rgb(245, 158, 11)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 2,
          x: 189.401709,
          y: 165.36,
          w: 38.290598,
          h: 41.04,
          fill: "rgb(245, 158, 11)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 3,
          x: 244.102564,
          y: 138,
          w: 38.290598,
          h: 45.6,
          fill: "rgb(245, 158, 11)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 4,
          x: 298.803419,
          y: 115.2,
          w: 38.290598,
          h: 45.6,
          fill: "rgb(245, 158, 11)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 5,
          x: 353.504274,
          y: 92.4,
          w: 38.290598,
          h: 50.16,
          fill: "rgb(245, 158, 11)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 6,
          x: 408.205128,
          y: 78.72,
          w: 38.290598,
          h: 54.72,
          fill: "rgb(245, 158, 11)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 7,
          x: 462.905983,
          y: 83.28,
          w: 38.290598,
          h: 54.72,
          fill: "rgb(245, 158, 11)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 8,
          x: 517.606838,
          y: 106.08,
          w: 38.290598,
          h: 50.16,
          fill: "rgb(245, 158, 11)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 9,
          x: 572.307692,
          y: 133.44,
          w: 38.290598,
          h: 45.6,
          fill: "rgb(245, 158, 11)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 10,
          x: 627.008547,
          y: 165.36,
          w: 38.290598,
          h: 36.48,
          fill: "rgb(245, 158, 11)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 11,
          x: 681.709402,
          y: 188.16,
          w: 38.290598,
          h: 31.92,
          fill: "rgb(245, 158, 11)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
      ],
    },
  ],
};
