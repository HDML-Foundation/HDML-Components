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
 * ★ **`07-mixed` — three mark kinds on one plane, two y scales**
 * (RFC §10.1 E, SPEC §4.2).
 *
 * The dual axis is **sibling same-channel scales**, not nested ones:
 * two `hdml-continuous-scale channel="y"` blocks under one ordinal
 * `x`. V13 makes each block homogeneous, so every widget sits at a
 * tip, and the shared x guides live in the revenue block — which
 * block is the author's pick, because `channel="x"` resolves to the
 * one shared x scale from either.
 *
 * DOM order is paint order (§1.1): the margin block comes second, so
 * the line and its points paint over the bars. The scene asserts that
 * directly — `groups` is in document order and a renderer owes
 * nothing more.
 */

const REF = "?hdml-frame=monthly_perf";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
const REVENUE = [820000, 910000, 1040000, 980000, 1150000, 1220000];
const MARGIN = [0.18, 0.22, 0.19, 0.25, 0.28, 0.31];
const MONTH_NUM = [1, 2, 3, 4, 5, 6];

suite("corpus 07-mixed", () => {
  let io: FakeIo;

  setup(() => {
    installSceneRecorder();
    io = mountFakeIo({
      [REF]: result(6, {
        month: stringCol(MONTHS),
        revenue: numberCol(REVENUE),
        margin: numberCol(MARGIN),
        month_num: numberCol(MONTH_NUM),
      }),
    });
  });

  teardown(() => {
    restoreRenderers();
  });

  test("it renders through FakeIo alone", async () => {
    const page = await mountCorpus("07-mixed");
    assert.lengthOf(page.views, 1);
    assert.strictEqual(page.removedIo, 1);
    assertRenders(page.views[0]);
    assert.isAbove(io.subscriptions.length, 0);
  });

  test("bar, line and point all paint", async () => {
    const page = await mountCorpus("07-mixed");
    const scene = goldenOf(page.views[0]);
    const marks = scene.groups.filter((g) => g.role === "mark");
    assert.deepEqual(
      marks.map((g) => g.tag),
      ["hdml-bar", "hdml-line", "hdml-point"],
    );
    assert.lengthOf(marks[0].nodes, 6);
    assert.lengthOf(marks[1].nodes, 1);
    assert.lengthOf(marks[2].nodes, 6);
  });

  test("DOM order is paint order", async () => {
    // The margin block is second, so its line and points come after
    // the bars in `groups` — SPEC §1.1's paint order, assertable
    // from the scene alone.
    const page = await mountCorpus("07-mixed");
    const tags = goldenOf(page.views[0]).groups.map((g) => g.tag);
    assert.isBelow(
      tags.indexOf("hdml-bar"),
      tags.indexOf("hdml-line"),
    );
    assert.isBelow(
      tags.indexOf("hdml-line"),
      tags.indexOf("hdml-point"),
    );
  });

  test("the two y scales are siblings, not one", async () => {
    // Both y scales span the same pixels, so an axis cannot tell
    // them apart — their TICKS can. `count="5"` over the revenue
    // domain and over `0 … 0.4` do not agree on how many ladder
    // steps fit, and two label groups of different cardinality are
    // two domains.
    const page = await mountCorpus("07-mixed");
    const scene = goldenOf(page.views[0]);
    const labels = scene.groups.filter((g) => g.tag === "hdml-label");
    assert.lengthOf(labels, 3);
    assert.notStrictEqual(
      labels[1].nodes.length,
      labels[2].nodes.length,
    );
    // …and the shared x axis is one guide, not two: the x label
    // group carries one text per month.
    assert.lengthOf(labels[0].nodes, MONTHS.length);
  });

  test("the golden holds on every engine", async () => {
    const page = await mountCorpus("07-mixed");
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
    const page = await mountCorpus("07-mixed");
    assert.deepEqual(goldenOf(page.views[0]), GOLDEN);
  });

  test("it round-trips and fits the budget", async () => {
    const page = await mountCorpus("07-mixed");
    const scene = goldenOf(page.views[0]);
    assert.deepEqual(structuredClone(scene), scene);
    assert.isBelow(nodeCount(scene), 20000);
  });
});

const GOLDEN: Scene = {
  width: 780,
  height: 360,
  groups: [
    {
      widget: "",
      tag: "hdml-axis",
      role: "guide",
      box: { x: 80, y: 312, w: 620, h: 24 },
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
              start: { x: 80, y: 312 },
              segments: [{ k: "line", to: { x: 700, y: 312 } }],
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
      box: { x: 80, y: 312, w: 620, h: 24 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: false,
      clipPath: null,
      nodes: [
        {
          k: "text",
          i: -1,
          x: 113.214286,
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
          x: 223.928571,
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
          x: 334.642857,
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
          x: 445.357143,
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
          x: 556.071429,
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
          x: 666.785714,
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
      ],
    },
    {
      widget: "",
      tag: "hdml-axis",
      role: "guide",
      box: { x: 80, y: 24, w: 40, h: 288 },
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
              start: { x: 120, y: 312 },
              segments: [{ k: "line", to: { x: 120, y: 24 } }],
            },
          ],
          closed: false,
          vertices: [],
          fill: null,
          stroke: "rgb(28, 140, 244)",
          strokeWidth: 1,
          dash: null,
        },
      ],
    },
    {
      widget: "",
      tag: "hdml-label",
      role: "guide",
      box: { x: 40, y: 24, w: 40, h: 288 },
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
          x: 80,
          y: 209.142857,
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
          y: 106.285714,
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
      box: { x: 80, y: 24, w: 620, h: 288 },
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
          y: 143.314286,
          w: 66.428571,
          h: 168.685714,
          fill: "rgba(28, 140, 244, 0.4)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 1,
          x: 190.714286,
          y: 124.8,
          w: 66.428571,
          h: 187.2,
          fill: "rgba(28, 140, 244, 0.4)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 2,
          x: 301.428571,
          y: 98.057143,
          w: 66.428571,
          h: 213.942857,
          fill: "rgba(28, 140, 244, 0.4)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 3,
          x: 412.142857,
          y: 110.4,
          w: 66.428571,
          h: 201.6,
          fill: "rgba(28, 140, 244, 0.4)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 4,
          x: 522.857143,
          y: 75.428571,
          w: 66.428571,
          h: 236.571429,
          fill: "rgba(28, 140, 244, 0.4)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 5,
          x: 633.571429,
          y: 61.028571,
          w: 66.428571,
          h: 250.971429,
          fill: "rgba(28, 140, 244, 0.4)",
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
      box: { x: 700, y: 24, w: 40, h: 288 },
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
              start: { x: 700, y: 312 },
              segments: [{ k: "line", to: { x: 700, y: 24 } }],
            },
          ],
          closed: false,
          vertices: [],
          fill: null,
          stroke: "rgb(245, 158, 11)",
          strokeWidth: 1,
          dash: null,
        },
      ],
    },
    {
      widget: "",
      tag: "hdml-label",
      role: "guide",
      box: { x: 700, y: 24, w: 40, h: 288 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: false,
      clipPath: null,
      nodes: [
        {
          k: "text",
          i: -1,
          x: 700,
          y: 312,
          text: "0%",
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
          x: 700,
          y: 240,
          text: "10%",
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
          x: 700,
          y: 168,
          text: "20%",
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
          x: 700,
          y: 96,
          text: "30%",
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
          x: 700,
          y: 24,
          text: "40%",
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
    {
      widget: "",
      tag: "hdml-line",
      role: "mark",
      box: { x: 80, y: 24, w: 620, h: 288 },
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
              start: { x: 113.214286, y: 182.4 },
              segments: [
                {
                  k: "cubic",
                  c1: { x: 150.119048, y: 172.8 },
                  c2: { x: 187.02381, y: 153.6 },
                  to: { x: 223.928571, y: 153.6 },
                },
                {
                  k: "cubic",
                  c1: { x: 260.833333, y: 153.6 },
                  c2: { x: 297.738095, y: 175.2 },
                  to: { x: 334.642857, y: 175.2 },
                },
                {
                  k: "cubic",
                  c1: { x: 371.547619, y: 175.2 },
                  c2: { x: 408.452381, y: 142.8 },
                  to: { x: 445.357143, y: 132 },
                },
                {
                  k: "cubic",
                  c1: { x: 482.261905, y: 121.2 },
                  c2: { x: 519.166667, y: 117.6 },
                  to: { x: 556.071429, y: 110.4 },
                },
                {
                  k: "cubic",
                  c1: { x: 592.97619, y: 103.2 },
                  c2: { x: 629.880952, y: 96 },
                  to: { x: 666.785714, y: 88.8 },
                },
              ],
            },
          ],
          closed: false,
          vertices: [
            { x: 113.214286, y: 182.4, i: 0 },
            { x: 223.928571, y: 153.6, i: 1 },
            { x: 334.642857, y: 175.2, i: 2 },
            { x: 445.357143, y: 132, i: 3 },
            { x: 556.071429, y: 110.4, i: 4 },
            { x: 666.785714, y: 88.8, i: 5 },
          ],
          fill: null,
          stroke: "rgb(245, 158, 11)",
          strokeWidth: 2,
          dash: null,
        },
      ],
    },
    {
      widget: "",
      tag: "hdml-point",
      role: "mark",
      box: { x: 80, y: 24, w: 620, h: 288 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: true,
      clipPath: null,
      nodes: [
        {
          k: "ellipse",
          i: 0,
          cx: 113.214286,
          cy: 182.4,
          rx: 3.5,
          ry: 3.5,
          fill: "rgb(255, 255, 255)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "ellipse",
          i: 1,
          cx: 223.928571,
          cy: 153.6,
          rx: 3.5,
          ry: 3.5,
          fill: "rgb(255, 255, 255)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "ellipse",
          i: 2,
          cx: 334.642857,
          cy: 175.2,
          rx: 3.5,
          ry: 3.5,
          fill: "rgb(255, 255, 255)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "ellipse",
          i: 3,
          cx: 445.357143,
          cy: 132,
          rx: 3.5,
          ry: 3.5,
          fill: "rgb(255, 255, 255)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "ellipse",
          i: 4,
          cx: 556.071429,
          cy: 110.4,
          rx: 3.5,
          ry: 3.5,
          fill: "rgb(255, 255, 255)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "ellipse",
          i: 5,
          cx: 666.785714,
          cy: 88.8,
          rx: 3.5,
          ry: 3.5,
          fill: "rgb(255, 255, 255)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
      ],
    },
  ],
};
