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
import { subscriptionsOf } from "../subscribe";
import {
  installSceneRecorder,
  restoreRenderers,
} from "../../testing/scene-of";

/**
 * ★ **`02-area` — the literal-only conformance class, proved**
 * (RFC §10.1 E, SPEC §4.4).
 *
 * The page's own comment states the claim: *"no hdml-io, no
 * frames, no `source` anywhere (SPEC §4.4 — literals need none)"*.
 * This suite
 * mounts it with **no provider of any kind** — not even a `FakeIo` —
 * and asserts that it renders and opens **zero** subscriptions. That
 * is what makes SPEC §4's literal-only class real rather than
 * asserted: a page that needed a provider would sit in
 * `:state(loading)` forever, and `assertRenders` fails on exactly
 * that.
 *
 * View **A** is a numeric area over a datetime scale with a scalar
 * `y0="0"` broadcast; view **B** is an area *between categories*
 * whose
 * `y0='"seed"'` is a **string** scalar on a band scale, and a
 * categorical `hdml-rule`. B is also the page's only test of the
 * `2 / 1` aspect ratio doing the sizing — it declares a width and no
 * height.
 */

suite("corpus 02-area", () => {
  setup(() => {
    installSceneRecorder();
  });

  teardown(() => {
    restoreRenderers();
  });

  test("both views render with no provider", async () => {
    const page = await mountCorpus("02-area");
    assert.lengthOf(page.views, 2);
    assert.strictEqual(page.removedIo, 0);
    page.views.forEach((v) => assertRenders(v));
  });

  test("a literal page opens no subscription", async () => {
    const page = await mountCorpus("02-area");
    page.views.forEach((v) => assert.lengthOf(subscriptionsOf(v), 0));
  });

  test("width alone sizes the view", async () => {
    // `figure { max-width: 760px }` and no height anywhere: SPEC §3's
    // `aspect-ratio: 2 / 1` is the only thing that can produce 380.
    const page = await mountCorpus("02-area");
    const scene = goldenOf(page.views[0]);
    assert.strictEqual(scene.width, 760);
    assert.strictEqual(scene.height, 380);
  });

  test("A's area closes over a scalar baseline", async () => {
    // §6.4's ranged primitive: `y0="0"` is a scalar broadcast to
    // N = 6, so the lower edge is the y range's zero — the plot's
    // bottom, because the y scale is `min="0"`.
    const page = await mountCorpus("02-area");
    const scene = goldenOf(page.views[0]);
    const area = scene.groups.find((g) => g.tag === "hdml-area");
    assert.isDefined(area);
    assert.lengthOf(area?.nodes ?? [], 1);
    const node = (area?.nodes ?? [])[0];
    assert.strictEqual(node.k, "path");
    if (node.k !== "path") return;
    assert.isTrue(node.closed);
    // Twelve, not six: an area's subpath is the upper edge forward
    // and the lower edge REVERSED, so every row contributes two
    // projected vertices and the scalar baseline is half of them.
    assert.lengthOf(node.vertices, 12);
    const lower = node.vertices.slice(6);
    assert.strictEqual(new Set(lower.map((v) => v.y)).size, 1);
  });

  test("the golden holds on every engine", async () => {
    const page = await mountCorpus("02-area");
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
    const page = await mountCorpus("02-area");
    assert.deepEqual(goldenOf(page.views[0]), GOLDEN_A);
    assert.deepEqual(goldenOf(page.views[1]), GOLDEN_B);
  });

  test("both round-trip and fit the budget", async () => {
    const page = await mountCorpus("02-area");
    page.views.forEach((v) => {
      const scene = goldenOf(v);
      assert.deepEqual(structuredClone(scene), scene);
      assert.isBelow(nodeCount(scene), 20000);
    });
  });
});

const GOLDEN_A: Scene = {
  width: 760,
  height: 380,
  groups: [
    {
      widget: "",
      tag: "hdml-axis",
      role: "guide",
      box: { x: 64, y: 332, w: 664, h: 24 },
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
              start: { x: 64, y: 332 },
              segments: [{ k: "line", to: { x: 728, y: 332 } }],
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
      box: { x: 64, y: 24, w: 40, h: 308 },
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
              start: { x: 104, y: 332 },
              segments: [{ k: "line", to: { x: 104, y: 24 } }],
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
      box: { x: 64, y: 332, w: 664, h: 24 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: false,
      clipPath: null,
      nodes: [
        {
          k: "text",
          i: -1,
          x: 85.986755,
          y: 332,
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
          x: 116.768212,
          y: 332,
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
          x: 147.549669,
          y: 332,
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
          x: 178.331126,
          y: 332,
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
          x: 209.112583,
          y: 332,
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
          x: 239.89404,
          y: 332,
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
          x: 270.675497,
          y: 332,
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
          x: 301.456954,
          y: 332,
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
          x: 332.238411,
          y: 332,
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
          x: 363.019868,
          y: 332,
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
          x: 393.801325,
          y: 332,
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
          x: 424.582781,
          y: 332,
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
          x: 455.364238,
          y: 332,
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
          x: 486.145695,
          y: 332,
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
          x: 516.927152,
          y: 332,
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
          x: 547.708609,
          y: 332,
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
          x: 578.490066,
          y: 332,
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
          x: 609.271523,
          y: 332,
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
          x: 640.05298,
          y: 332,
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
          x: 670.834437,
          y: 332,
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
          x: 701.615894,
          y: 332,
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
      ],
    },
    {
      widget: "",
      tag: "hdml-label",
      role: "guide",
      box: { x: 24, y: 24, w: 40, h: 308 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: false,
      clipPath: null,
      nodes: [
        {
          k: "text",
          i: -1,
          x: 64,
          y: 332,
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
          x: 64,
          y: 229.333333,
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
          x: 64,
          y: 126.666667,
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
          x: 64,
          y: 24,
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
      ],
    },
    {
      widget: "",
      tag: "hdml-area",
      role: "mark",
      box: { x: 64, y: 24, w: 664, h: 308 },
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
              start: { x: 64, y: 208.8 },
              segments: [
                {
                  k: "cubic",
                  c1: { x: 110.968197, y: 177.459649 },
                  c2: { x: 157.936394, y: 146.119298 },
                  to: { x: 200.317881, y: 147.2 },
                },
                {
                  k: "cubic",
                  c1: { x: 242.699367, y: 148.280702 },
                  c2: { x: 280.494143, y: 181.782456 },
                  to: { x: 323.443709, y: 178 },
                },
                {
                  k: "cubic",
                  c1: { x: 366.393274, y: 174.217544 },
                  c2: { x: 414.497629, y: 133.150877 },
                  to: { x: 459.761589, y: 106.133333 },
                },
                {
                  k: "cubic",
                  c1: { x: 505.02555, y: 79.115789 },
                  c2: { x: 547.449116, y: 66.147368 },
                  to: { x: 591.682119, y: 65.066667 },
                },
                {
                  k: "cubic",
                  c1: { x: 635.915122, y: 63.985965 },
                  c2: { x: 681.957561, y: 74.792982 },
                  to: { x: 728, y: 85.6 },
                },
                { k: "line", to: { x: 728, y: 332 } },
                {
                  k: "cubic",
                  c1: { x: 681.957561, y: 332 },
                  c2: { x: 635.915122, y: 332 },
                  to: { x: 591.682119, y: 332 },
                },
                {
                  k: "cubic",
                  c1: { x: 547.449116, y: 332 },
                  c2: { x: 505.02555, y: 332 },
                  to: { x: 459.761589, y: 332 },
                },
                {
                  k: "cubic",
                  c1: { x: 414.497629, y: 332 },
                  c2: { x: 366.393274, y: 332 },
                  to: { x: 323.443709, y: 332 },
                },
                {
                  k: "cubic",
                  c1: { x: 280.494143, y: 332 },
                  c2: { x: 242.699367, y: 332 },
                  to: { x: 200.317881, y: 332 },
                },
                {
                  k: "cubic",
                  c1: { x: 157.936394, y: 332 },
                  c2: { x: 110.968197, y: 332 },
                  to: { x: 64, y: 332 },
                },
              ],
            },
          ],
          closed: true,
          vertices: [
            { x: 64, y: 208.8, i: 0 },
            { x: 200.317881, y: 147.2, i: 1 },
            { x: 323.443709, y: 178, i: 2 },
            { x: 459.761589, y: 106.133333, i: 3 },
            { x: 591.682119, y: 65.066667, i: 4 },
            { x: 728, y: 85.6, i: 5 },
            { x: 728, y: 332, i: 5 },
            { x: 591.682119, y: 332, i: 4 },
            { x: 459.761589, y: 332, i: 3 },
            { x: 323.443709, y: 332, i: 2 },
            { x: 200.317881, y: 332, i: 1 },
            { x: 64, y: 332, i: 0 },
          ],
          fill: "rgb(126, 188, 246)",
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
      box: { x: 64, y: 24, w: 664, h: 308 },
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
              start: { x: 64, y: 208.8 },
              segments: [
                {
                  k: "cubic",
                  c1: { x: 110.968197, y: 177.459649 },
                  c2: { x: 157.936394, y: 146.119298 },
                  to: { x: 200.317881, y: 147.2 },
                },
                {
                  k: "cubic",
                  c1: { x: 242.699367, y: 148.280702 },
                  c2: { x: 280.494143, y: 181.782456 },
                  to: { x: 323.443709, y: 178 },
                },
                {
                  k: "cubic",
                  c1: { x: 366.393274, y: 174.217544 },
                  c2: { x: 414.497629, y: 133.150877 },
                  to: { x: 459.761589, y: 106.133333 },
                },
                {
                  k: "cubic",
                  c1: { x: 505.02555, y: 79.115789 },
                  c2: { x: 547.449116, y: 66.147368 },
                  to: { x: 591.682119, y: 65.066667 },
                },
                {
                  k: "cubic",
                  c1: { x: 635.915122, y: 63.985965 },
                  c2: { x: 681.957561, y: 74.792982 },
                  to: { x: 728, y: 85.6 },
                },
              ],
            },
          ],
          closed: false,
          vertices: [
            { x: 64, y: 208.8, i: 0 },
            { x: 200.317881, y: 147.2, i: 1 },
            { x: 323.443709, y: 178, i: 2 },
            { x: 459.761589, y: 106.133333, i: 3 },
            { x: 591.682119, y: 65.066667, i: 4 },
            { x: 728, y: 85.6, i: 5 },
          ],
          fill: null,
          stroke: "rgb(28, 140, 244)",
          strokeWidth: 2,
          dash: null,
        },
      ],
    },
  ],
};
const GOLDEN_B: Scene = {
  width: 760,
  height: 380,
  groups: [
    {
      widget: "",
      tag: "hdml-axis",
      role: "guide",
      box: { x: 64, y: 324, w: 664, h: 24 },
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
              start: { x: 64, y: 324 },
              segments: [{ k: "line", to: { x: 728, y: 324 } }],
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
      box: { x: 64, y: 32, w: 40, h: 292 },
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
              start: { x: 104, y: 324 },
              segments: [{ k: "line", to: { x: 104, y: 32 } }],
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
      box: { x: 64, y: 324, w: 664, h: 24 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: false,
      clipPath: null,
      nodes: [
        {
          k: "text",
          i: -1,
          x: 64,
          y: 324,
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
          x: 196.8,
          y: 324,
          text: "20",
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
          x: 329.6,
          y: 324,
          text: "40",
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
          x: 462.4,
          y: 324,
          text: "60",
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
          x: 595.2,
          y: 324,
          text: "80",
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
          y: 324,
          text: "100",
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
      box: { x: 24, y: 32, w: 40, h: 292 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: false,
      clipPath: null,
      nodes: [
        {
          k: "text",
          i: -1,
          x: 64,
          y: 293.263158,
          text: "seed",
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
          x: 64,
          y: 216.421053,
          text: "sprout",
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
          x: 64,
          y: 139.578947,
          text: "growth",
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
          x: 64,
          y: 62.736842,
          text: "bloom",
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
      tag: "hdml-area",
      role: "mark",
      box: { x: 64, y: 32, w: 664, h: 292 },
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
              start: { x: 64, y: 216.421053 },
              segments: [
                {
                  k: "cubic",
                  c1: { x: 108.266667, y: 181.737933 },
                  c2: { x: 152.533333, y: 147.054814 },
                  to: { x: 196.8, y: 139.578947 },
                },
                {
                  k: "cubic",
                  c1: { x: 241.066667, y: 132.103081 },
                  c2: { x: 285.333333, y: 151.834467 },
                  to: { x: 329.6, y: 139.578947 },
                },
                {
                  k: "cubic",
                  c1: { x: 373.866667, y: 127.323428 },
                  c2: { x: 418.133333, y: 83.081004 },
                  to: { x: 462.4, y: 62.736842 },
                },
                {
                  k: "cubic",
                  c1: { x: 506.666667, y: 42.39268 },
                  c2: { x: 550.933333, y: 45.946781 },
                  to: { x: 595.2, y: 62.736842 },
                },
                {
                  k: "cubic",
                  c1: { x: 639.466667, y: 79.526903 },
                  c2: { x: 683.733333, y: 109.552925 },
                  to: { x: 728, y: 139.578947 },
                },
                { k: "line", to: { x: 728, y: 293.263158 } },
                {
                  k: "cubic",
                  c1: { x: 683.733333, y: 293.263158 },
                  c2: { x: 639.466667, y: 293.263158 },
                  to: { x: 595.2, y: 293.263158 },
                },
                {
                  k: "cubic",
                  c1: { x: 550.933333, y: 293.263158 },
                  c2: { x: 506.666667, y: 293.263158 },
                  to: { x: 462.4, y: 293.263158 },
                },
                {
                  k: "cubic",
                  c1: { x: 418.133333, y: 293.263158 },
                  c2: { x: 373.866667, y: 293.263158 },
                  to: { x: 329.6, y: 293.263158 },
                },
                {
                  k: "cubic",
                  c1: { x: 285.333333, y: 293.263158 },
                  c2: { x: 241.066667, y: 293.263158 },
                  to: { x: 196.8, y: 293.263158 },
                },
                {
                  k: "cubic",
                  c1: { x: 152.533333, y: 293.263158 },
                  c2: { x: 108.266667, y: 293.263158 },
                  to: { x: 64, y: 293.263158 },
                },
              ],
            },
          ],
          closed: true,
          vertices: [
            { x: 64, y: 216.421053, i: 0 },
            { x: 196.8, y: 139.578947, i: 1 },
            { x: 329.6, y: 139.578947, i: 2 },
            { x: 462.4, y: 62.736842, i: 3 },
            { x: 595.2, y: 62.736842, i: 4 },
            { x: 728, y: 139.578947, i: 5 },
            { x: 728, y: 293.263158, i: 5 },
            { x: 595.2, y: 293.263158, i: 4 },
            { x: 462.4, y: 293.263158, i: 3 },
            { x: 329.6, y: 293.263158, i: 2 },
            { x: 196.8, y: 293.263158, i: 1 },
            { x: 64, y: 293.263158, i: 0 },
          ],
          fill: "rgb(126, 188, 246)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
      ],
    },
    {
      widget: "",
      tag: "hdml-rule",
      role: "mark",
      box: { x: 64, y: 32, w: 664, h: 292 },
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
              start: { x: 64, y: 139.578947 },
              segments: [
                { k: "line", to: { x: 728, y: 139.578947 } },
              ],
            },
          ],
          closed: false,
          vertices: [
            { x: 64, y: 139.578947, i: 0 },
            { x: 728, y: 139.578947, i: 0 },
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
