/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import "../index";
import type { Scene } from "../scene";
import {
  ENGINE,
  assertRenders,
  goldenOf,
  mountCorpus,
  nodeCount,
  stripText,
} from "../../testing/corpus";
import {
  installSceneRecorder,
  restoreRenderers,
} from "../../testing/scene-of";

/**
 * ★ **`00-minimal` — the floor** (RFC §10.1 E, SPEC §4).
 *
 * Forty lines, **no CSS beyond a width**, no `<hdml-io>`, no `source`
 * anywhere. Everything else is a spec default: the view's `2 / 1`
 * aspect ratio, the UA plane gutter, SPEC §3's guide placement, a
 * bandwidth of `0.8`, and `currentColor` marks. If this page does not
 * render, `ua.ts` or the `--hdml-fill-color` initial is what to look
 * at — nothing else is involved.
 *
 * It is also the one page whose whole geometry is derivable by hand
 * from three numbers, which is why the derivation below is
 * written out rather than captured.
 */

/* ---------------------------------------------------------------- */
/* The derivation — independent of anything the code produced       */
/* ---------------------------------------------------------------- */

/** `style="width: 480px"`, the page's only declaration. */
const W = 480;

/** `aspect-ratio: 2 / 1` (SPEC §3), so the view is 480 × 240. */
const H = W / 2;

/** `ua.ts`'s `GUTTER` — the cartesian plane's padding. */
const GUTTER = { top: 8, right: 8, bottom: 24, left: 40 };

/** The plane's content box, in view coordinates. */
const PLOT = {
  x: GUTTER.left,
  y: GUTTER.top,
  w: W - GUTTER.left - GUTTER.right,
  h: H - GUTTER.top - GUTTER.bottom,
};

/** §4.4's band over four categories at the initial bandwidth. */
const BAND = { n: 4, b: 0.8 };
const STEP = PLOT.w / (BAND.n - 1 + BAND.b);

/** The y scale is `min="0" max="500"`, over the plot height. */
function projectY(value: number): number {
  return PLOT.y + PLOT.h - (value / 500) * PLOT.h;
}

suite("corpus 00-minimal", () => {
  setup(() => {
    installSceneRecorder();
  });

  teardown(() => {
    restoreRenderers();
  });

  test("it renders with no CSS and no provider", async () => {
    const page = await mountCorpus("00-minimal");
    assert.lengthOf(page.views, 1);
    assert.strictEqual(page.sheets, 0);
    assert.strictEqual(page.removedIo, 0);
    assertRenders(page.views[0]);
  });

  test("its geometry is the derived geometry", async () => {
    const page = await mountCorpus("00-minimal");
    const scene = goldenOf(page.views[0]);
    assert.strictEqual(scene.width, W);
    assert.strictEqual(scene.height, H);

    const bars = scene.groups.filter((g) => g.role === "mark");
    assert.lengthOf(bars, 1);
    const nodes = bars[0].nodes;
    assert.lengthOf(nodes, 4);
    const values = [310, 420, 380, 490];
    nodes.forEach((node, k) => {
      assert.strictEqual(node.k, "rect");
      if (node.k !== "rect") return;
      assert.closeTo(node.x, PLOT.x + k * STEP, 1e-6);
      assert.closeTo(node.w, BAND.b * STEP, 1e-6);
      assert.closeTo(node.y, projectY(values[k]), 1e-6);
      assert.closeTo(node.h, projectY(0) - node.y, 1e-6);
    });
  });

  test("the golden holds on every engine", async () => {
    const page = await mountCorpus("00-minimal");
    assert.deepEqual(
      stripText(goldenOf(page.views[0])),
      stripText(GOLDEN),
    );
  });

  test("the text holds on chromium", async () => {
    assert.notStrictEqual(ENGINE, "unclassified");
    if (ENGINE !== "chromium") {
      return;
    }
    const page = await mountCorpus("00-minimal");
    assert.deepEqual(goldenOf(page.views[0]), GOLDEN);
  });

  test("it round-trips and fits the budget", async () => {
    const page = await mountCorpus("00-minimal");
    const scene = goldenOf(page.views[0]);
    assert.deepEqual(structuredClone(scene), scene);
    assert.isBelow(nodeCount(scene), 20000);
  });
});

const GOLDEN: Scene = {
  width: 480,
  height: 240,
  groups: [
    {
      widget: "",
      tag: "hdml-axis",
      role: "guide",
      box: { x: 40, y: 216, w: 432, h: 24 },
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
              start: { x: 40, y: 216 },
              segments: [{ k: "line", to: { x: 472, y: 216 } }],
            },
          ],
          closed: false,
          vertices: [],
          fill: null,
          stroke: "rgb(0, 0, 0)",
          strokeWidth: 1.5,
          dash: null,
        },
      ],
    },
    {
      widget: "",
      tag: "hdml-label",
      role: "guide",
      box: { x: 40, y: 216, w: 432, h: 24 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: false,
      clipPath: null,
      nodes: [
        {
          k: "text",
          i: -1,
          x: 85.473684,
          y: 216,
          text: "Q1",
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
          x: 199.157895,
          y: 216,
          text: "Q2",
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
          x: 312.842105,
          y: 216,
          text: "Q3",
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
          x: 426.526316,
          y: 216,
          text: "Q4",
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
      tag: "hdml-axis",
      role: "guide",
      box: { x: 0, y: 8, w: 40, h: 208 },
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
              start: { x: 40, y: 216 },
              segments: [{ k: "line", to: { x: 40, y: 8 } }],
            },
          ],
          closed: false,
          vertices: [],
          fill: null,
          stroke: "rgb(0, 0, 0)",
          strokeWidth: 1.5,
          dash: null,
        },
      ],
    },
    {
      widget: "",
      tag: "hdml-label",
      role: "guide",
      box: { x: 0, y: 8, w: 40, h: 208 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: false,
      clipPath: null,
      nodes: [
        {
          k: "text",
          i: -1,
          x: 40,
          y: 216,
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
          x: 40,
          y: 174.4,
          text: "100",
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
          x: 40,
          y: 132.8,
          text: "200",
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
          x: 40,
          y: 91.2,
          text: "300",
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
          x: 40,
          y: 49.6,
          text: "400",
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
          x: 40,
          y: 8,
          text: "500",
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
      box: { x: 40, y: 8, w: 432, h: 208 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: true,
      clipPath: null,
      nodes: [
        {
          k: "rect",
          i: 0,
          x: 40,
          y: 87.04,
          w: 90.947368,
          h: 128.96,
          fill: "rgb(0, 0, 0)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 1,
          x: 153.684211,
          y: 41.28,
          w: 90.947368,
          h: 174.72,
          fill: "rgb(0, 0, 0)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 2,
          x: 267.368421,
          y: 57.92,
          w: 90.947368,
          h: 158.08,
          fill: "rgb(0, 0, 0)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 3,
          x: 381.052632,
          y: 12.16,
          w: 90.947368,
          h: 203.84,
          fill: "rgb(0, 0, 0)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
      ],
    },
  ],
};
