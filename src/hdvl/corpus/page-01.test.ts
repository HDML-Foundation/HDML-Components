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
  stripText,
} from "../../testing/corpus";
import { subscriptionsOf } from "../subscribe";
import {
  installSceneRecorder,
  restoreRenderers,
} from "../../testing/scene-of";

/**
 * ★ **`01-line` — two sources in one chart** (RFC §10.1 E, §10.3).
 *
 * The page's plane inherits an **in-page** ref
 * (`?hdml-frame=revenue_m`, which V4's structural half completes
 * against the `hdml-frame` beside it) and one of its two
 * `hdml-line`s overrides `source` with a **static** one
 * (`/warehouse/forecast.html?hdml-frame=monthly`). That document does
 * not exist and is **not invented** — RFC §10.3 says so in as many
 * words. `FakeIo` answers **by ref string**, whatever its shape,
 * so both are served through the one D8 seam and the static ref is
 * never resolved to a URL by anything.
 *
 * The page's own provider element — which names a host that does not
 * exist — is removed before mounting. See `testing/corpus`'s
 * decision 2 for why leaving it in place is not a neutral choice.
 * The host is deliberately **not spelled anywhere under this
 * directory**, so the gate's own `grep` for it stays a real guard
 * rather than a hit on prose (standing warning 17).
 */

/** The plane's ref — declared on `hdml-cartesian-plane`. */
const LOCAL = "?hdml-frame=revenue_m";

/** The forecast line's own ref — a static, non-existent document. */
const STATIC = "/warehouse/forecast.html?hdml-frame=monthly";

/** Twelve month starts in 2025, epoch ms — the `date` field. */
const MONTHS = Array.from({ length: 12 }, (_, m) =>
  Date.UTC(2025, m, 1),
);

const REVENUE = [
  820000, 910000, 1040000, 980000, 1150000, 1220000, 1180000, 1310000,
  1260000, 1400000, 1520000, 1610000,
];

const FORECAST = [
  800000, 900000, 1000000, 1100000, 1200000, 1300000, 1400000,
  1500000, 1600000, 1700000, 1800000, 1900000,
];

suite("corpus 01-line", () => {
  let io: FakeIo;

  setup(() => {
    installSceneRecorder();
    io = mountFakeIo({
      [LOCAL]: result(12, {
        month: numberCol(MONTHS, "timestamp"),
        revenue: numberCol(REVENUE),
      }),
      [STATIC]: result(12, {
        month: numberCol(MONTHS, "timestamp"),
        forecast: numberCol(FORECAST),
      }),
    });
  });

  teardown(() => {
    restoreRenderers();
  });

  test("it renders through FakeIo alone", async () => {
    const page = await mountCorpus("01-line");
    assert.lengthOf(page.views, 1);
    assert.strictEqual(page.removedIo, 1);
    assertRenders(page.views[0]);
  });

  test("both ref shapes resolve on one seam", async () => {
    const page = await mountCorpus("01-line");
    const refs = new Set(io.subscriptions.map((s) => s.ref));
    assert.deepEqual([...refs].sort(), [STATIC, LOCAL].sort());
    assert.isAbove(subscriptionsOf(page.views[0]).length, 0);
  });

  test("both series and the rule paint", async () => {
    const page = await mountCorpus("01-line");
    const scene = goldenOf(page.views[0]);
    const lines = scene.groups.filter((g) => g.tag === "hdml-line");
    assert.lengthOf(lines, 2);
    lines.forEach((g) => {
      assert.lengthOf(g.nodes, 1);
      const node = g.nodes[0];
      assert.strictEqual(node.k, "path");
      if (node.k !== "path") return;
      // One stroked path for the whole series, twelve vertices.
      assert.lengthOf(node.vertices, 12);
      assert.isNull(node.fill);
    });
    const rule = scene.groups.find((g) => g.tag === "hdml-rule");
    assert.lengthOf(rule?.nodes ?? [], 1);
  });

  test("the dashed forecast is CSS, not data", async () => {
    // `hdml-line.forecast { --hdml-line-style: dashed }` — the paint
    // is resolved into the scene, so a class selector is assertable
    // without touching the DOM (§9's reach rule).
    const page = await mountCorpus("01-line");
    const scene = goldenOf(page.views[0]);
    const lines = scene.groups.filter((g) => g.tag === "hdml-line");
    assert.isNull(lines[0].nodes[0].dash);
    assert.isNotNull(lines[1].nodes[0].dash);
  });

  test("the golden holds on every engine", async () => {
    const page = await mountCorpus("01-line");
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
    const page = await mountCorpus("01-line");
    assert.deepEqual(goldenOf(page.views[0]), GOLDEN);
  });

  test("it round-trips and fits the budget", async () => {
    const page = await mountCorpus("01-line");
    const scene = goldenOf(page.views[0]);
    assert.deepEqual(structuredClone(scene), scene);
    assert.isBelow(nodeCount(scene), 20000);
  });
});

const GOLDEN: Scene = {
  width: 760,
  height: 360,
  groups: [
    {
      widget: "",
      tag: "hdml-grid",
      role: "guide",
      box: { x: 72, y: 24, w: 656, h: 288 },
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
              start: { x: 72, y: 312 },
              segments: [{ k: "line", to: { x: 728, y: 312 } }],
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
              start: { x: 72, y: 240 },
              segments: [{ k: "line", to: { x: 728, y: 240 } }],
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
              start: { x: 72, y: 168 },
              segments: [{ k: "line", to: { x: 728, y: 168 } }],
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
              start: { x: 72, y: 96 },
              segments: [{ k: "line", to: { x: 728, y: 96 } }],
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
              start: { x: 72, y: 24 },
              segments: [{ k: "line", to: { x: 728, y: 24 } }],
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
      box: { x: 72, y: 312, w: 656, h: 24 },
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
              start: { x: 72, y: 312 },
              segments: [{ k: "line", to: { x: 728, y: 312 } }],
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
      box: { x: 72, y: 24, w: 40, h: 288 },
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
              start: { x: 112, y: 312 },
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
      tag: "hdml-tick",
      role: "guide",
      box: { x: 72, y: 312, w: 656, h: 24 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: false,
      clipPath: null,
      nodes: [
        {
          k: "rect",
          i: -1,
          x: 71.5,
          y: 309,
          w: 1,
          h: 6,
          fill: "rgb(100, 116, 139)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 132.386228,
          y: 309,
          w: 1,
          h: 6,
          fill: "rgb(100, 116, 139)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 187.38024,
          y: 309,
          w: 1,
          h: 6,
          fill: "rgb(100, 116, 139)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 248.266467,
          y: 309,
          w: 1,
          h: 6,
          fill: "rgb(100, 116, 139)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 307.188623,
          y: 309,
          w: 1,
          h: 6,
          fill: "rgb(100, 116, 139)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 368.07485,
          y: 309,
          w: 1,
          h: 6,
          fill: "rgb(100, 116, 139)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 426.997006,
          y: 309,
          w: 1,
          h: 6,
          fill: "rgb(100, 116, 139)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 487.883234,
          y: 309,
          w: 1,
          h: 6,
          fill: "rgb(100, 116, 139)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 548.769461,
          y: 309,
          w: 1,
          h: 6,
          fill: "rgb(100, 116, 139)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 607.691617,
          y: 309,
          w: 1,
          h: 6,
          fill: "rgb(100, 116, 139)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 668.577844,
          y: 309,
          w: 1,
          h: 6,
          fill: "rgb(100, 116, 139)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 727.5,
          y: 309,
          w: 1,
          h: 6,
          fill: "rgb(100, 116, 139)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
      ],
    },
    {
      widget: "",
      tag: "hdml-tick",
      role: "guide",
      box: { x: 72, y: 24, w: 40, h: 288 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: false,
      clipPath: null,
      nodes: [
        {
          k: "rect",
          i: -1,
          x: 111.5,
          y: 309,
          w: 1,
          h: 6,
          fill: "rgb(100, 116, 139)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 111.5,
          y: 237,
          w: 1,
          h: 6,
          fill: "rgb(100, 116, 139)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 111.5,
          y: 165,
          w: 1,
          h: 6,
          fill: "rgb(100, 116, 139)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 111.5,
          y: 93,
          w: 1,
          h: 6,
          fill: "rgb(100, 116, 139)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 111.5,
          y: 21,
          w: 1,
          h: 6,
          fill: "rgb(100, 116, 139)",
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
      box: { x: 72, y: 312, w: 656, h: 24 },
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
          y: 312,
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
          x: 132.886228,
          y: 312,
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
          x: 187.88024,
          y: 312,
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
          x: 248.766467,
          y: 312,
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
          x: 307.688623,
          y: 312,
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
          x: 368.57485,
          y: 312,
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
          x: 427.497006,
          y: 312,
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
          x: 488.383234,
          y: 312,
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
          x: 549.269461,
          y: 312,
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
          x: 608.191617,
          y: 312,
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
          x: 669.077844,
          y: 312,
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
          x: 728,
          y: 312,
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
      box: { x: 32, y: 24, w: 40, h: 288 },
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
          y: 312,
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
          x: 72,
          y: 240,
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
          x: 72,
          y: 168,
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
        {
          k: "text",
          i: -1,
          x: 72,
          y: 96,
          text: "1.5M",
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
          text: "2M",
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
      tag: "hdml-line",
      role: "mark",
      box: { x: 72, y: 24, w: 656, h: 288 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: true,
      clipPath: null,
      nodes: [
        {
          k: "path",
          i: -1,
          subpaths: [
            {
              start: { x: 72, y: 193.92 },
              segments: [
                { k: "line", to: { x: 132.886228, y: 180.96 } },
                { k: "line", to: { x: 187.88024, y: 162.24 } },
                { k: "line", to: { x: 248.766467, y: 170.88 } },
                { k: "line", to: { x: 307.688623, y: 146.4 } },
                { k: "line", to: { x: 368.57485, y: 136.32 } },
                { k: "line", to: { x: 427.497006, y: 142.08 } },
                { k: "line", to: { x: 488.383234, y: 123.36 } },
                { k: "line", to: { x: 549.269461, y: 130.56 } },
                { k: "line", to: { x: 608.191617, y: 110.4 } },
                { k: "line", to: { x: 669.077844, y: 93.12 } },
                { k: "line", to: { x: 728, y: 80.16 } },
              ],
            },
          ],
          closed: false,
          vertices: [
            { x: 72, y: 193.92, i: 0 },
            { x: 132.886228, y: 180.96, i: 1 },
            { x: 187.88024, y: 162.24, i: 2 },
            { x: 248.766467, y: 170.88, i: 3 },
            { x: 307.688623, y: 146.4, i: 4 },
            { x: 368.57485, y: 136.32, i: 5 },
            { x: 427.497006, y: 142.08, i: 6 },
            { x: 488.383234, y: 123.36, i: 7 },
            { x: 549.269461, y: 130.56, i: 8 },
            { x: 608.191617, y: 110.4, i: 9 },
            { x: 669.077844, y: 93.12, i: 10 },
            { x: 728, y: 80.16, i: 11 },
          ],
          fill: null,
          stroke: "rgb(28, 140, 244)",
          strokeWidth: 2,
          dash: null,
        },
      ],
    },
    {
      widget: "",
      tag: "hdml-line",
      role: "mark",
      box: { x: 72, y: 24, w: 656, h: 288 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: true,
      clipPath: null,
      nodes: [
        {
          k: "path",
          i: -1,
          subpaths: [
            {
              start: { x: 72, y: 196.8 },
              segments: [
                { k: "line", to: { x: 132.886228, y: 182.4 } },
                { k: "line", to: { x: 187.88024, y: 168 } },
                { k: "line", to: { x: 248.766467, y: 153.6 } },
                { k: "line", to: { x: 307.688623, y: 139.2 } },
                { k: "line", to: { x: 368.57485, y: 124.8 } },
                { k: "line", to: { x: 427.497006, y: 110.4 } },
                { k: "line", to: { x: 488.383234, y: 96 } },
                { k: "line", to: { x: 549.269461, y: 81.6 } },
                { k: "line", to: { x: 608.191617, y: 67.2 } },
                { k: "line", to: { x: 669.077844, y: 52.8 } },
                { k: "line", to: { x: 728, y: 38.4 } },
              ],
            },
          ],
          closed: false,
          vertices: [
            { x: 72, y: 196.8, i: 0 },
            { x: 132.886228, y: 182.4, i: 1 },
            { x: 187.88024, y: 168, i: 2 },
            { x: 248.766467, y: 153.6, i: 3 },
            { x: 307.688623, y: 139.2, i: 4 },
            { x: 368.57485, y: 124.8, i: 5 },
            { x: 427.497006, y: 110.4, i: 6 },
            { x: 488.383234, y: 96, i: 7 },
            { x: 549.269461, y: 81.6, i: 8 },
            { x: 608.191617, y: 67.2, i: 9 },
            { x: 669.077844, y: 52.8, i: 10 },
            { x: 728, y: 38.4, i: 11 },
          ],
          fill: null,
          stroke: "rgb(148, 163, 184)",
          strokeWidth: 2,
          dash: [8, 6],
        },
      ],
    },
    {
      widget: "",
      tag: "hdml-rule",
      role: "mark",
      box: { x: 72, y: 24, w: 656, h: 288 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: true,
      clipPath: null,
      nodes: [
        {
          k: "path",
          i: 0,
          subpaths: [
            {
              start: { x: 72, y: 96 },
              segments: [{ k: "line", to: { x: 728, y: 96 } }],
            },
          ],
          closed: false,
          vertices: [
            { x: 72, y: 96, i: 0 },
            { x: 728, y: 96, i: 0 },
          ],
          fill: null,
          stroke: "rgb(220, 38, 38)",
          strokeWidth: 1,
          dash: [4, 3],
        },
      ],
    },
  ],
};
