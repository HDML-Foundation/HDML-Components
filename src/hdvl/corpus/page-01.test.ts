/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import "../index";
import type { Scene } from "../scene";
import type { HdvlElement } from "../base";
import { FakeIo, mountFakeIo } from "../../testing/FakeIo";
import {
  ENGINE,
  assertRenders,
  goldenOf,
  mountCorpus,
  nodeCount,
  numberCol,
  result,
  stateSheetOf,
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

  /** The one rule naming a widget's `uid`, or `""`. */
  function ruleFor(text: string, el: HdvlElement): string {
    return (
      text
        .split("\n")
        .find((r) => r.includes(`data-w="${el.uid}"`)) ?? ""
    );
  }

  test("the hover cue is a rule, not a scene", async () => {
    // The page's whole-series claim, as a gate. `hdml-line` emits ONE
    // node for the row set, so the selector that reaches a bar
    // reaches a series — and the cue is the WIDTH, because a stroked
    // mark is hovered on its stroke only.
    const page = await mountCorpus("01-line");
    const lines = Array.from(
      page.root.querySelectorAll<HdvlElement>("hdml-line"),
    );
    assert.lengthOf(lines, 2);
    const text = stateSheetOf(page.views[0]);
    // EXACTLY two rules: the two lines' `:hover`. Nothing else on
    // this page declares a variant — `hdml-rule`, the other stroked
    // mark here, deliberately does not.
    assert.lengthOf(text.split("\n"), 2);
    for (const line of lines) {
      const rule = ruleFor(text, line);
      assert.notStrictEqual(rule, "", "no rule for a line");
      assert.include(rule, ":hover");
      assert.match(rule, /stroke-width:\s*5px/);
      // ★ The stroked suppression, on a real page for the first
      // time: `strokePaint` returns `fill: null` unconditionally, so
      // a fill may never be emitted for one — and no golden can see
      // that, because the scene's `fill` stays `null` either way.
      assert.notMatch(rule, /(^|[^-])fill:/);
    }
  });

  test("a width state RE-DERIVES the dashed pattern", async () => {
    // `stroke-dasharray` is derived from style x width, so the
    // dashed forecast must not keep gaps computed for 2px while it
    // paints at 5px: dashOf("dashed", 5) is [20, 15]. The solid line
    // gets `none`, because a state that moved either input has to be
    // able to switch a base attribute OFF.
    const page = await mountCorpus("01-line");
    const lines = Array.from(
      page.root.querySelectorAll<HdvlElement>("hdml-line"),
    );
    const text = stateSheetOf(page.views[0]);
    assert.match(ruleFor(text, lines[0]), /stroke-dasharray:\s*none/);
    // ★ The pattern's SERIALIZATION is engine-dependent: the
    // generator writes `20 15` and chromium reads it back as
    // `20, 15`. The numbers are the claim, the separator is not.
    assert.match(
      ruleFor(text, lines[1]),
      /stroke-dasharray:\s*20(px)?[,\s]\s*15(px)?/,
    );
    // The BASE pattern is the scene's, and the state does not move
    // it — which is the golden-blindness restated per page.
    const groups = goldenOf(page.views[0]).groups.filter(
      (g) => g.tag === "hdml-line",
    );
    assert.deepEqual(groups[1].nodes[0].dash, [8, 6]);
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
      box: { x: 72, y: 312, w: 656, h: 0 },
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
      box: { x: 72, y: 24, w: 0, h: 288 },
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
              segments: [{ k: "line", to: { x: 72, y: 24 } }],
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
      box: { x: 72, y: 312, w: 656, h: 0 },
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
      box: { x: 72, y: 24, w: 0, h: 288 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: false,
      clipPath: null,
      nodes: [
        {
          k: "rect",
          i: -1,
          x: 69,
          y: 311.5,
          w: 6,
          h: 1,
          fill: "rgb(100, 116, 139)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 69,
          y: 239.5,
          w: 6,
          h: 1,
          fill: "rgb(100, 116, 139)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 69,
          y: 167.5,
          w: 6,
          h: 1,
          fill: "rgb(100, 116, 139)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 69,
          y: 95.5,
          w: 6,
          h: 1,
          fill: "rgb(100, 116, 139)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 69,
          y: 23.5,
          w: 6,
          h: 1,
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
      box: { x: 72, y: 324, w: 656, h: 0 },
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
          y: 324,
          text: "Jan",
          anchor: "middle",
          baseline: "middle",
          font: {
            family: "system-ui",
            size: 11,
            weight: "normal",
            style: "normal",
          },
          rotate: 0,
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
          y: 324,
          text: "Feb",
          anchor: "middle",
          baseline: "middle",
          font: {
            family: "system-ui",
            size: 11,
            weight: "normal",
            style: "normal",
          },
          rotate: 0,
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
          y: 324,
          text: "Mar",
          anchor: "middle",
          baseline: "middle",
          font: {
            family: "system-ui",
            size: 11,
            weight: "normal",
            style: "normal",
          },
          rotate: 0,
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
          y: 324,
          text: "Apr",
          anchor: "middle",
          baseline: "middle",
          font: {
            family: "system-ui",
            size: 11,
            weight: "normal",
            style: "normal",
          },
          rotate: 0,
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
          y: 324,
          text: "May",
          anchor: "middle",
          baseline: "middle",
          font: {
            family: "system-ui",
            size: 11,
            weight: "normal",
            style: "normal",
          },
          rotate: 0,
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
          y: 324,
          text: "Jun",
          anchor: "middle",
          baseline: "middle",
          font: {
            family: "system-ui",
            size: 11,
            weight: "normal",
            style: "normal",
          },
          rotate: 0,
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
          y: 324,
          text: "Jul",
          anchor: "middle",
          baseline: "middle",
          font: {
            family: "system-ui",
            size: 11,
            weight: "normal",
            style: "normal",
          },
          rotate: 0,
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
          y: 324,
          text: "Aug",
          anchor: "middle",
          baseline: "middle",
          font: {
            family: "system-ui",
            size: 11,
            weight: "normal",
            style: "normal",
          },
          rotate: 0,
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
          y: 324,
          text: "Sep",
          anchor: "middle",
          baseline: "middle",
          font: {
            family: "system-ui",
            size: 11,
            weight: "normal",
            style: "normal",
          },
          rotate: 0,
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
          y: 324,
          text: "Oct",
          anchor: "middle",
          baseline: "middle",
          font: {
            family: "system-ui",
            size: 11,
            weight: "normal",
            style: "normal",
          },
          rotate: 0,
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
          y: 324,
          text: "Nov",
          anchor: "middle",
          baseline: "middle",
          font: {
            family: "system-ui",
            size: 11,
            weight: "normal",
            style: "normal",
          },
          rotate: 0,
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
          y: 324,
          text: "Dec",
          anchor: "middle",
          baseline: "middle",
          font: {
            family: "system-ui",
            size: 11,
            weight: "normal",
            style: "normal",
          },
          rotate: 0,
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
      box: { x: 52, y: 24, w: 0, h: 288 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: false,
      clipPath: null,
      nodes: [
        {
          k: "text",
          i: -1,
          x: 52,
          y: 312,
          text: "0M",
          anchor: "middle",
          baseline: "middle",
          font: {
            family: "system-ui",
            size: 11,
            weight: "normal",
            style: "normal",
          },
          rotate: 0,
          decorative: false,
          fill: "rgb(0, 0, 0)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "text",
          i: -1,
          x: 52,
          y: 240,
          text: "0.5M",
          anchor: "middle",
          baseline: "middle",
          font: {
            family: "system-ui",
            size: 11,
            weight: "normal",
            style: "normal",
          },
          rotate: 0,
          decorative: false,
          fill: "rgb(0, 0, 0)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "text",
          i: -1,
          x: 52,
          y: 168,
          text: "1M",
          anchor: "middle",
          baseline: "middle",
          font: {
            family: "system-ui",
            size: 11,
            weight: "normal",
            style: "normal",
          },
          rotate: 0,
          decorative: false,
          fill: "rgb(0, 0, 0)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "text",
          i: -1,
          x: 52,
          y: 96,
          text: "1.5M",
          anchor: "middle",
          baseline: "middle",
          font: {
            family: "system-ui",
            size: 11,
            weight: "normal",
            style: "normal",
          },
          rotate: 0,
          decorative: false,
          fill: "rgb(0, 0, 0)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "text",
          i: -1,
          x: 52,
          y: 24,
          text: "2M",
          anchor: "middle",
          baseline: "middle",
          font: {
            family: "system-ui",
            size: 11,
            weight: "normal",
            style: "normal",
          },
          rotate: 0,
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
