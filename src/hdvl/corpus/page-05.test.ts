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
 * ★ **`05-scatter` — the corpus's first `log` scale**
 * (RFC §10.1 E, SPEC §4.5).
 *
 * View **A** is two `nice` continuous scales with a `step="0.05"`
 * grid and label sharing one interval — SPEC §7's *"`step` states the
 * interval exactly and invokes no tick algorithm"*.
 *
 * View **B** is `hdml-continuous-scale type="log"`, and it is the
 * first place in the project where §4.5's log transform and V2's
 * log-domain clause meet a page rather than a fixture. Its domain is
 * strictly positive, which is what V2 requires; a page that delivered
 * a zero would be an error, not a chart.
 */

const REF = "?hdml-frame=product_stats";

const PRODUCTS = [
  "Anvil",
  "Bolt",
  "Cable",
  "Drill",
  "Engine",
  "Filter",
];
const UNITS = [120, 340, 560, 880, 210, 450];
const MARGIN = [0.12, 0.31, 0.22, 0.18, 0.27, 0.35];
const UNIT_PRICE = [12.5, 40, 125, 400, 1250, 60];

suite("corpus 05-scatter", () => {
  let io: FakeIo;

  setup(() => {
    installSceneRecorder();
    io = mountFakeIo({
      [REF]: result(6, {
        product: stringCol(PRODUCTS),
        units: numberCol(UNITS),
        margin: numberCol(MARGIN),
        unit_price: numberCol(UNIT_PRICE),
      }),
    });
  });

  teardown(() => {
    restoreRenderers();
  });

  test("both views render", async () => {
    const page = await mountCorpus("05-scatter");
    assert.lengthOf(page.views, 2);
    assert.strictEqual(page.removedIo, 1);
    page.views.forEach((v) => assertRenders(v));
    assert.isAbove(io.subscriptions.length, 0);
  });

  test("one point per row, both views", async () => {
    const page = await mountCorpus("05-scatter");
    page.views.forEach((v) => {
      const group = goldenOf(v).groups.find(
        (g) => g.tag === "hdml-point",
      );
      assert.lengthOf(group?.nodes ?? [], 6);
      (group?.nodes ?? []).forEach((n) =>
        assert.strictEqual(n.k, "ellipse"),
      );
    });
  });

  test("B's points are log-spaced, not linear", async () => {
    // The load-bearing claim: on a log axis equal *ratios* are equal
    // distances. 12.5 → 125 and 125 → 1250 are both one decade, so
    // the two gaps must match, and they would not on a linear scale.
    const page = await mountCorpus("05-scatter");
    const group = goldenOf(page.views[1]).groups.find(
      (g) => g.tag === "hdml-point",
    );
    const cy = (group?.nodes ?? []).map((n) =>
      n.k === "ellipse" ? n.cy : NaN,
    );
    // rows 0, 2, 4 are 12.5, 125, 1250 — one decade apart each.
    assert.closeTo(cy[0] - cy[2], cy[2] - cy[4], 1e-6);
  });

  test("the goldens hold on every engine", async () => {
    const page = await mountCorpus("05-scatter");
    assert.deepEqual(
      stripText(goldenOf(page.views[0])),
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
    const page = await mountCorpus("05-scatter");
    assert.deepEqual(goldenOf(page.views[0]), GOLDEN_A);
    assert.deepEqual(goldenOf(page.views[1]), GOLDEN_B);
  });

  test("both round-trip and fit the budget", async () => {
    const page = await mountCorpus("05-scatter");
    page.views.forEach((v) => {
      const scene = goldenOf(v);
      assert.deepEqual(structuredClone(scene), scene);
      assert.isBelow(nodeCount(scene), 20000);
    });
  });
});

const GOLDEN_A: Scene = {
  width: 720,
  height: 340,
  groups: [
    {
      widget: "",
      tag: "hdml-grid",
      role: "guide",
      box: { x: 72, y: 24, w: 616, h: 268 },
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
              start: { x: 72, y: 292 },
              segments: [{ k: "line", to: { x: 72, y: 24 } }],
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
              start: { x: 208.888889, y: 292 },
              segments: [{ k: "line", to: { x: 208.888889, y: 24 } }],
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
              start: { x: 345.777778, y: 292 },
              segments: [{ k: "line", to: { x: 345.777778, y: 24 } }],
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
              start: { x: 482.666667, y: 292 },
              segments: [{ k: "line", to: { x: 482.666667, y: 24 } }],
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
              start: { x: 619.555556, y: 292 },
              segments: [{ k: "line", to: { x: 619.555556, y: 24 } }],
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
      box: { x: 72, y: 24, w: 616, h: 268 },
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
              start: { x: 72, y: 292 },
              segments: [{ k: "line", to: { x: 688, y: 292 } }],
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
              start: { x: 72, y: 238.4 },
              segments: [{ k: "line", to: { x: 688, y: 238.4 } }],
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
              start: { x: 72, y: 184.8 },
              segments: [{ k: "line", to: { x: 688, y: 184.8 } }],
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
              start: { x: 72, y: 131.2 },
              segments: [{ k: "line", to: { x: 688, y: 131.2 } }],
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
              start: { x: 72, y: 77.6 },
              segments: [{ k: "line", to: { x: 688, y: 77.6 } }],
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
              start: { x: 72, y: 24 },
              segments: [{ k: "line", to: { x: 688, y: 24 } }],
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
      box: { x: 72, y: 292, w: 616, h: 24 },
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
              start: { x: 72, y: 292 },
              segments: [{ k: "line", to: { x: 688, y: 292 } }],
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
      box: { x: 72, y: 24, w: 40, h: 268 },
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
              start: { x: 112, y: 292 },
              segments: [{ k: "line", to: { x: 112, y: 24 } }],
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
      box: { x: 72, y: 292, w: 616, h: 24 },
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
          y: 292,
          text: "0",
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
          x: 208.888889,
          y: 292,
          text: "200",
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
          x: 345.777778,
          y: 292,
          text: "400",
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
          x: 482.666667,
          y: 292,
          text: "600",
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
          x: 619.555556,
          y: 292,
          text: "800",
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
      box: { x: 32, y: 24, w: 40, h: 268 },
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
          y: 292,
          text: "10%",
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
          y: 238.4,
          text: "15%",
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
          y: 184.8,
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
          x: 72,
          y: 131.2,
          text: "25%",
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
          y: 77.6,
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
          x: 72,
          y: 24,
          text: "35%",
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
      box: { x: 72, y: 24, w: 616, h: 268 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: true,
      clipPath: null,
      nodes: [
        {
          k: "ellipse",
          i: 0,
          cx: 154.133333,
          cy: 270.56,
          rx: 4,
          ry: 4,
          fill: "rgba(28, 140, 244, 0.5)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "ellipse",
          i: 1,
          cx: 304.711111,
          cy: 66.88,
          rx: 4,
          ry: 4,
          fill: "rgba(28, 140, 244, 0.5)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "ellipse",
          i: 2,
          cx: 455.288889,
          cy: 163.36,
          rx: 4,
          ry: 4,
          fill: "rgba(28, 140, 244, 0.5)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "ellipse",
          i: 3,
          cx: 674.311111,
          cy: 206.24,
          rx: 4,
          ry: 4,
          fill: "rgba(28, 140, 244, 0.5)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "ellipse",
          i: 4,
          cx: 215.733333,
          cy: 109.76,
          rx: 4,
          ry: 4,
          fill: "rgba(28, 140, 244, 0.5)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "ellipse",
          i: 5,
          cx: 380,
          cy: 24,
          rx: 4,
          ry: 4,
          fill: "rgba(28, 140, 244, 0.5)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
      ],
    },
  ],
};
const GOLDEN_B: Scene = {
  width: 720,
  height: 340,
  groups: [
    {
      widget: "",
      tag: "hdml-grid",
      role: "guide",
      box: { x: 72, y: 24, w: 616, h: 268 },
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
              start: { x: 72, y: 292 },
              segments: [{ k: "line", to: { x: 688, y: 292 } }],
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
              start: { x: 72, y: 202.666667 },
              segments: [
                { k: "line", to: { x: 688, y: 202.666667 } },
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
              start: { x: 72, y: 113.333333 },
              segments: [
                { k: "line", to: { x: 688, y: 113.333333 } },
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
              start: { x: 72, y: 24 },
              segments: [{ k: "line", to: { x: 688, y: 24 } }],
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
      box: { x: 72, y: 292, w: 616, h: 24 },
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
              start: { x: 72, y: 292 },
              segments: [{ k: "line", to: { x: 688, y: 292 } }],
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
      box: { x: 72, y: 24, w: 40, h: 268 },
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
              start: { x: 112, y: 292 },
              segments: [{ k: "line", to: { x: 112, y: 24 } }],
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
      box: { x: 72, y: 292, w: 616, h: 24 },
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
          y: 292,
          text: "0",
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
          x: 208.888889,
          y: 292,
          text: "200",
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
          x: 345.777778,
          y: 292,
          text: "400",
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
          x: 482.666667,
          y: 292,
          text: "600",
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
          x: 619.555556,
          y: 292,
          text: "800",
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
      box: { x: 32, y: 24, w: 40, h: 268 },
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
          y: 292,
          text: "$0.01K",
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
          y: 202.666667,
          text: "$0.10K",
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
          y: 113.333333,
          text: "$1.00K",
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
          y: 24,
          text: "$10.00K",
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
      box: { x: 72, y: 24, w: 616, h: 268 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: true,
      clipPath: null,
      nodes: [
        {
          k: "ellipse",
          i: 0,
          cx: 154.133333,
          cy: 283.342706,
          rx: 4,
          ry: 4,
          fill: "rgba(28, 140, 244, 0.5)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "ellipse",
          i: 1,
          cx: 304.711111,
          cy: 238.215974,
          rx: 4,
          ry: 4,
          fill: "rgba(28, 140, 244, 0.5)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "ellipse",
          i: 2,
          cx: 455.288889,
          cy: 194.009372,
          rx: 4,
          ry: 4,
          fill: "rgba(28, 140, 244, 0.5)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "ellipse",
          i: 3,
          cx: 674.311111,
          cy: 148.882641,
          rx: 4,
          ry: 4,
          fill: "rgba(28, 140, 244, 0.5)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "ellipse",
          i: 4,
          cx: 215.733333,
          cy: 104.676039,
          rx: 4,
          ry: 4,
          fill: "rgba(28, 140, 244, 0.5)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "ellipse",
          i: 5,
          cx: 380,
          cy: 222.485155,
          rx: 4,
          ry: 4,
          fill: "rgba(28, 140, 244, 0.5)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
      ],
    },
  ],
};
