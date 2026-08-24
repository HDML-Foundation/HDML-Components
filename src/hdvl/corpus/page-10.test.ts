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
} from "../../testing/corpus";
import {
  installSceneRecorder,
  restoreRenderers,
  sceneOf,
} from "../../testing/scene-of";

/**
 * ★ **`10-radar` — the two readings of `closed`, on one page**
 * (RFC §10.1 F, SPEC §7).
 *
 * The page mixes a **literal** series and a **subscription** series
 * in one view — one widget each, which §4.5 makes legal per widget
 * — and each series is an area under a line. `closed` therefore
 * lands twice with two different meanings, and step 27 is where the
 * second one was settled:
 *
 * - on `hdml-line` it is a `Z` on the one subpath, the radar loop;
 * - on `hdml-area` it splits the region into **two counter-wound
 *   subpaths**, an outer ring and an inner one, instead of a single
 *   cap-joined outline that would close *through the pole* and
 *   notch the band.
 *
 * It is also the only page where `--hdml-grid-shape: polygon`
 * paints, and the ring's vertex count is the assertion that matters:
 * the page writes `hdml-grid channel="radius" count="5"` over
 * **six** categories, and a polygon built from the grid's own spec
 * would have five sides. It reads the **angle scale's** `ticks({})`
 * — the whole ordinal domain (step 27's T4) — which is why a
 * radar's rings meet its spokes.
 *
 * ★ **This page carries no `hdml-legend`**, so its golden is the
 * whole scene and step 32 adds nothing to it.
 *
 * ★ **Finding 20 is visible here and is not a defect.**
 * `--hdml-bandwidth: 0` over `[0deg, 360deg]` puts the last category
 * on the first — `360deg` *is* `0deg` — so six categories give
 * **five distinct spokes**, `speed` shares `comfort`'s, and the
 * loop's closing segment runs *along* the noon spoke. The page's own
 * comment calls it a feature (*"first == last position closes the
 * turn"*) and §4.4's arithmetic is what produces it. The golden
 * freezes it deliberately; see corpus README finding 20.
 */

const REF = "?hdml-frame=model_b_scores";

/**
 * The angle domain, and the frame's `sort-by metric asc` order —
 * the page pins them to the same order on purpose, because a path
 * connects rows in ROW order and not in domain order.
 */
const METRICS = [
  "comfort",
  "efficiency",
  "price",
  "range",
  "safety",
  "speed",
];

/** Model B, the bound series. */
const SCORES = [6.5, 7.2, 5.8, 8.1, 7.6, 6.9];

/** Model A, the literal series — written in the page itself. */
const MODEL_A = [7, 6, 8, 5, 9, 6];

/** The plot's pole and radial ceiling, from the page's own CSS. */
const POLE = { x: 260, y: 200 };
const CEILING = 172;

/** A view's groups by tag, in document order. */
function byTag(scene: Scene, tag: string): (readonly SceneNode[])[] {
  return scene.groups
    .filter((g) => g.tag === tag)
    .map((g) => g.nodes);
}

suite("corpus 10-radar", () => {
  let io: FakeIo;

  setup(() => {
    installSceneRecorder();
    io = mountFakeIo({
      [REF]: result(6, {
        metric: stringCol(METRICS),
        score: numberCol(SCORES),
      }),
    });
  });

  teardown(() => {
    restoreRenderers();
  });

  test("it renders, one view, both series", async () => {
    const page = await mountCorpus("10-radar");
    assert.lengthOf(page.views, 1);
    assert.strictEqual(page.removedIo, 1);
    assertRenders(page.views[0]);
    assert.isAbove(io.subscriptions.length, 0);
    // Document order is paint order: area, line, area, line.
    assert.deepEqual(
      goldenOf(page.views[0])
        .groups.filter((g) => g.role === "mark")
        .map((g) => g.tag),
      ["hdml-area", "hdml-line", "hdml-area", "hdml-line"],
    );
  });

  test("★ a polygon ring walks the ANGLE scale", async () => {
    // The load-bearing distinction. `count="5"` is the RADIUS
    // grid's spec and decides only how many RINGS there are; how
    // many corners each ring has is the angle scale's whole
    // domain, read through its own `ticks({})`. A polygon built
    // from the grid's spec would have five sides.
    const page = await mountCorpus("10-radar");
    const [rings, spokes] = byTag(
      goldenOf(page.views[0]),
      "hdml-grid",
    );
    rings.forEach((n) => {
      assert.strictEqual(n.k, "path");
      if (n.k !== "path") {
        return;
      }
      assert.lengthOf(n.subpaths, 1);
      assert.isTrue(n.closed);
      // start + one `to` per remaining vertex = six corners.
      assert.lengthOf(n.subpaths[0].segments, METRICS.length - 1);
    });
    // …and the spokes are that same domain, one straight node
    // each. One generator, not two that agree (R12/R18) — which
    // is why a radar's rings MEET its spokes: the outermost ring
    // sits at the ceiling, so its corners are the spoke ends
    // exactly, with no tolerance.
    assert.lengthOf(spokes, METRICS.length);
    const rim = rings[rings.length - 1];
    if (rim.k !== "path") {
      assert.fail("a polygon ring is a path node");
      return;
    }
    const corners = [
      rim.subpaths[0].start,
      ...rim.subpaths[0].segments.map((s) =>
        s.k === "line" ? s.to : null,
      ),
    ];
    const ends = spokes.map((n) =>
      n.k === "path" && n.subpaths[0].segments[0].k === "line"
        ? n.subpaths[0].segments[0].to
        : null,
    );
    assert.deepEqual(corners, ends);
  });

  test("★ finding 20: six categories, five spokes", async () => {
    // NOT a defect and NOT to be fixed: `--hdml-bandwidth: 0` over
    // a FULL turn places category k at `k / n` of it, so category
    // 5 lands on `360deg`, which is `0deg`. The page's comment
    // states it as the intent. Asserted so that a change to §4.4
    // would have to come here and argue with it.
    const page = await mountCorpus("10-radar");
    const [, spokes] = byTag(goldenOf(page.views[0]), "hdml-grid");
    const ends = spokes.map((n) =>
      n.k === "path" ? JSON.stringify(n.subpaths[0].segments[0]) : "",
    );
    assert.lengthOf(ends, METRICS.length);
    assert.lengthOf(new Set(ends), METRICS.length - 1);
    assert.strictEqual(ends[0], ends[ends.length - 1]);
  });

  test("★ two readings of `closed`, side by side", async () => {
    // The area splits into an outer ring and an inner one — the
    // second collapsed to the pole here, since `r0="0"` — and the
    // line closes on itself as ONE subpath. Both carry the same
    // `closed: true` flag: what the attribute changes is how many
    // subpaths a region has, never the flag (step 27).
    const page = await mountCorpus("10-radar");
    const scene = goldenOf(page.views[0]);
    byTag(scene, "hdml-area").forEach((nodes) => {
      assert.lengthOf(nodes, 1);
      const node = nodes[0];
      assert.strictEqual(node.k, "path");
      if (node.k !== "path") {
        return;
      }
      assert.isTrue(node.closed);
      assert.lengthOf(node.subpaths, 2);
      assert.lengthOf(node.vertices, METRICS.length * 2);
      // `r0="0"` puts the whole inner ring on the pole: a ring of
      // coincident points encloses nothing and fills to the
      // centre, which is the right answer and not a guarded case.
      const inner = node.subpaths[1];
      assert.deepEqual(inner.start, POLE);
      inner.segments.forEach((s) => {
        assert.deepEqual(s.k === "line" ? s.to : null, POLE);
      });
    });
    byTag(scene, "hdml-line").forEach((nodes) => {
      const node = nodes[0];
      assert.strictEqual(node.k, "path");
      if (node.k !== "path") {
        return;
      }
      assert.isTrue(node.closed);
      assert.lengthOf(node.subpaths, 1);
      assert.lengthOf(node.vertices, METRICS.length);
    });
  });

  test("★ a vertex is its score, at its spoke", async () => {
    // Derived, on the RAW scene: a linear radius over `[0, 10]`
    // against §4.3's ceiling, at the noon spoke where the trig is
    // exact. Both series are read, so the literal and the bound
    // one are proved to reach the same geometry.
    const page = await mountCorpus("10-radar");
    const scene = sceneOf(page.views[0]);
    const lines = byTag(scene, "hdml-line");
    [MODEL_A, SCORES].forEach((series, k) => {
      const node = lines[k][0];
      if (node.k !== "path") {
        assert.fail("a radar series is a path node");
        return;
      }
      assert.strictEqual(node.vertices[0].x, POLE.x);
      assert.closeTo(
        POLE.y - node.vertices[0].y,
        (series[0] / 10) * CEILING,
        1e-9,
      );
      // Finding 20 again, from the data's side: the last row sits
      // on the first row's spoke, at its own radius.
      const last = node.vertices[node.vertices.length - 1];
      assert.strictEqual(last.x, POLE.x);
      assert.closeTo(
        POLE.y - last.y,
        (series[series.length - 1] / 10) * CEILING,
        1e-9,
      );
    });
  });

  test("the golden holds on every engine", async () => {
    const page = await mountCorpus("10-radar");
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
    const page = await mountCorpus("10-radar");
    assert.deepEqual(goldenOf(page.views[0]), GOLDEN);
  });

  test("it round-trips, is -0 free and fits the budget", async () => {
    // R20's budget, over the densest view this step gates.
    const page = await mountCorpus("10-radar");
    const scene = goldenOf(page.views[0]);
    assert.deepEqual(structuredClone(scene), scene);
    assert.deepEqual(negativeZeros(sceneOf(page.views[0])), []);
    assert.strictEqual(nodeCount(scene), 28);
    assert.isBelow(nodeCount(scene), 20000);
    assert.isFalse(page.views[0].matches(":state(error)"));
  });
});

const GOLDEN: Scene = {
  width: 520,
  height: 400,
  groups: [
    {
      widget: "",
      tag: "hdml-grid",
      role: "guide",
      box: {
        x: 28,
        y: 28,
        w: 464,
        h: 344,
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
                x: 260,
                y: 200,
              },
              segments: [
                {
                  k: "line",
                  to: {
                    x: 260,
                    y: 200,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 260,
                    y: 200,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 260,
                    y: 200,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 260,
                    y: 200,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 260,
                    y: 200,
                  },
                },
              ],
            },
          ],
          closed: true,
          vertices: [],
          fill: null,
          stroke: "rgb(203, 213, 225)",
          strokeWidth: 1,
          dash: null,
        },
        {
          k: "path",
          i: -1,
          subpaths: [
            {
              start: {
                x: 260,
                y: 165.6,
              },
              segments: [
                {
                  k: "line",
                  to: {
                    x: 292.716344,
                    y: 189.369815,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 280.219813,
                    y: 227.830185,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 239.780187,
                    y: 227.830185,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 227.283656,
                    y: 189.369815,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 260,
                    y: 165.6,
                  },
                },
              ],
            },
          ],
          closed: true,
          vertices: [],
          fill: null,
          stroke: "rgb(203, 213, 225)",
          strokeWidth: 1,
          dash: null,
        },
        {
          k: "path",
          i: -1,
          subpaths: [
            {
              start: {
                x: 260,
                y: 131.2,
              },
              segments: [
                {
                  k: "line",
                  to: {
                    x: 325.432688,
                    y: 178.739631,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 300.439625,
                    y: 255.660369,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 219.560375,
                    y: 255.660369,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 194.567312,
                    y: 178.739631,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 260,
                    y: 131.2,
                  },
                },
              ],
            },
          ],
          closed: true,
          vertices: [],
          fill: null,
          stroke: "rgb(203, 213, 225)",
          strokeWidth: 1,
          dash: null,
        },
        {
          k: "path",
          i: -1,
          subpaths: [
            {
              start: {
                x: 260,
                y: 96.8,
              },
              segments: [
                {
                  k: "line",
                  to: {
                    x: 358.149032,
                    y: 168.109446,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 320.659438,
                    y: 283.490554,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 199.340562,
                    y: 283.490554,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 161.850968,
                    y: 168.109446,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 260,
                    y: 96.8,
                  },
                },
              ],
            },
          ],
          closed: true,
          vertices: [],
          fill: null,
          stroke: "rgb(203, 213, 225)",
          strokeWidth: 1,
          dash: null,
        },
        {
          k: "path",
          i: -1,
          subpaths: [
            {
              start: {
                x: 260,
                y: 62.4,
              },
              segments: [
                {
                  k: "line",
                  to: {
                    x: 390.865377,
                    y: 157.479262,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 340.879251,
                    y: 311.320738,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 179.120749,
                    y: 311.320738,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 129.134623,
                    y: 157.479262,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 260,
                    y: 62.4,
                  },
                },
              ],
            },
          ],
          closed: true,
          vertices: [],
          fill: null,
          stroke: "rgb(203, 213, 225)",
          strokeWidth: 1,
          dash: null,
        },
        {
          k: "path",
          i: -1,
          subpaths: [
            {
              start: {
                x: 260,
                y: 28,
              },
              segments: [
                {
                  k: "line",
                  to: {
                    x: 423.581721,
                    y: 146.849077,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 361.099063,
                    y: 339.150923,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 158.900937,
                    y: 339.150923,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 96.418279,
                    y: 146.849077,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 260,
                    y: 28,
                  },
                },
              ],
            },
          ],
          closed: true,
          vertices: [],
          fill: null,
          stroke: "rgb(203, 213, 225)",
          strokeWidth: 1,
          dash: null,
        },
      ],
    },
    {
      widget: "",
      tag: "hdml-grid",
      role: "guide",
      box: {
        x: 28,
        y: 28,
        w: 464,
        h: 344,
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
                x: 260,
                y: 200,
              },
              segments: [
                {
                  k: "line",
                  to: {
                    x: 260,
                    y: 28,
                  },
                },
              ],
            },
          ],
          closed: false,
          vertices: [],
          fill: null,
          stroke: "rgb(203, 213, 225)",
          strokeWidth: 1,
          dash: null,
        },
        {
          k: "path",
          i: -1,
          subpaths: [
            {
              start: {
                x: 260,
                y: 200,
              },
              segments: [
                {
                  k: "line",
                  to: {
                    x: 423.581721,
                    y: 146.849077,
                  },
                },
              ],
            },
          ],
          closed: false,
          vertices: [],
          fill: null,
          stroke: "rgb(203, 213, 225)",
          strokeWidth: 1,
          dash: null,
        },
        {
          k: "path",
          i: -1,
          subpaths: [
            {
              start: {
                x: 260,
                y: 200,
              },
              segments: [
                {
                  k: "line",
                  to: {
                    x: 361.099063,
                    y: 339.150923,
                  },
                },
              ],
            },
          ],
          closed: false,
          vertices: [],
          fill: null,
          stroke: "rgb(203, 213, 225)",
          strokeWidth: 1,
          dash: null,
        },
        {
          k: "path",
          i: -1,
          subpaths: [
            {
              start: {
                x: 260,
                y: 200,
              },
              segments: [
                {
                  k: "line",
                  to: {
                    x: 158.900937,
                    y: 339.150923,
                  },
                },
              ],
            },
          ],
          closed: false,
          vertices: [],
          fill: null,
          stroke: "rgb(203, 213, 225)",
          strokeWidth: 1,
          dash: null,
        },
        {
          k: "path",
          i: -1,
          subpaths: [
            {
              start: {
                x: 260,
                y: 200,
              },
              segments: [
                {
                  k: "line",
                  to: {
                    x: 96.418279,
                    y: 146.849077,
                  },
                },
              ],
            },
          ],
          closed: false,
          vertices: [],
          fill: null,
          stroke: "rgb(203, 213, 225)",
          strokeWidth: 1,
          dash: null,
        },
        {
          k: "path",
          i: -1,
          subpaths: [
            {
              start: {
                x: 260,
                y: 200,
              },
              segments: [
                {
                  k: "line",
                  to: {
                    x: 260,
                    y: 28,
                  },
                },
              ],
            },
          ],
          closed: false,
          vertices: [],
          fill: null,
          stroke: "rgb(203, 213, 225)",
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
        x: 28,
        y: 28,
        w: 464,
        h: 344,
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
          x: 260,
          y: 28,
          text: "comfort",
          anchor: "middle",
          baseline: "bottom",
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
          x: 423.581721,
          y: 146.849077,
          text: "efficiency",
          anchor: "start",
          baseline: "bottom",
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
          x: 361.099063,
          y: 339.150923,
          text: "price",
          anchor: "start",
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
          x: 158.900937,
          y: 339.150923,
          text: "range",
          anchor: "end",
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
          x: 96.418279,
          y: 146.849077,
          text: "safety",
          anchor: "end",
          baseline: "bottom",
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
          x: 260,
          y: 28,
          text: "speed",
          anchor: "middle",
          baseline: "bottom",
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
        x: 28,
        y: 28,
        w: 464,
        h: 344,
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
          x: 260,
          y: 200,
          text: "0",
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
          x: 260,
          y: 165.6,
          text: "2",
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
          x: 260,
          y: 131.2,
          text: "4",
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
          x: 260,
          y: 96.8,
          text: "6",
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
          x: 260,
          y: 62.4,
          text: "8",
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
          x: 260,
          y: 28,
          text: "10",
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
      tag: "hdml-area",
      role: "mark",
      box: {
        x: 28,
        y: 28,
        w: 464,
        h: 344,
      },
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
              start: {
                x: 260,
                y: 79.6,
              },
              segments: [
                {
                  k: "line",
                  to: {
                    x: 358.149032,
                    y: 168.109446,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 340.879251,
                    y: 311.320738,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 209.450468,
                    y: 269.575462,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 112.776451,
                    y: 152.164169,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 260,
                    y: 96.8,
                  },
                },
              ],
            },
            {
              start: {
                x: 260,
                y: 200,
              },
              segments: [
                {
                  k: "line",
                  to: {
                    x: 260,
                    y: 200,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 260,
                    y: 200,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 260,
                    y: 200,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 260,
                    y: 200,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 260,
                    y: 200,
                  },
                },
              ],
            },
          ],
          closed: true,
          vertices: [
            {
              x: 260,
              y: 79.6,
              i: 0,
            },
            {
              x: 358.149032,
              y: 168.109446,
              i: 1,
            },
            {
              x: 340.879251,
              y: 311.320738,
              i: 2,
            },
            {
              x: 209.450468,
              y: 269.575462,
              i: 3,
            },
            {
              x: 112.776451,
              y: 152.164169,
              i: 4,
            },
            {
              x: 260,
              y: 96.8,
              i: 5,
            },
            {
              x: 260,
              y: 200,
              i: 5,
            },
            {
              x: 260,
              y: 200,
              i: 4,
            },
            {
              x: 260,
              y: 200,
              i: 3,
            },
            {
              x: 260,
              y: 200,
              i: 2,
            },
            {
              x: 260,
              y: 200,
              i: 1,
            },
            {
              x: 260,
              y: 200,
              i: 0,
            },
          ],
          fill: "rgba(28, 140, 244, 0.2)",
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
      box: {
        x: 28,
        y: 28,
        w: 464,
        h: 344,
      },
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
              start: {
                x: 260,
                y: 79.6,
              },
              segments: [
                {
                  k: "line",
                  to: {
                    x: 358.149032,
                    y: 168.109446,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 340.879251,
                    y: 311.320738,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 209.450468,
                    y: 269.575462,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 112.776451,
                    y: 152.164169,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 260,
                    y: 96.8,
                  },
                },
              ],
            },
          ],
          closed: true,
          vertices: [
            {
              x: 260,
              y: 79.6,
              i: 0,
            },
            {
              x: 358.149032,
              y: 168.109446,
              i: 1,
            },
            {
              x: 340.879251,
              y: 311.320738,
              i: 2,
            },
            {
              x: 209.450468,
              y: 269.575462,
              i: 3,
            },
            {
              x: 112.776451,
              y: 152.164169,
              i: 4,
            },
            {
              x: 260,
              y: 96.8,
              i: 5,
            },
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
      tag: "hdml-area",
      role: "mark",
      box: {
        x: 28,
        y: 28,
        w: 464,
        h: 344,
      },
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
              start: {
                x: 260,
                y: 88.2,
              },
              segments: [
                {
                  k: "line",
                  to: {
                    x: 377.778839,
                    y: 161.731335,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 318.637457,
                    y: 280.707535,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 178.109759,
                    y: 312.712248,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 135.677892,
                    y: 159.605298,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 260,
                    y: 81.32,
                  },
                },
              ],
            },
            {
              start: {
                x: 260,
                y: 200,
              },
              segments: [
                {
                  k: "line",
                  to: {
                    x: 260,
                    y: 200,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 260,
                    y: 200,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 260,
                    y: 200,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 260,
                    y: 200,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 260,
                    y: 200,
                  },
                },
              ],
            },
          ],
          closed: true,
          vertices: [
            {
              x: 260,
              y: 88.2,
              i: 0,
            },
            {
              x: 377.778839,
              y: 161.731335,
              i: 1,
            },
            {
              x: 318.637457,
              y: 280.707535,
              i: 2,
            },
            {
              x: 178.109759,
              y: 312.712248,
              i: 3,
            },
            {
              x: 135.677892,
              y: 159.605298,
              i: 4,
            },
            {
              x: 260,
              y: 81.32,
              i: 5,
            },
            {
              x: 260,
              y: 200,
              i: 5,
            },
            {
              x: 260,
              y: 200,
              i: 4,
            },
            {
              x: 260,
              y: 200,
              i: 3,
            },
            {
              x: 260,
              y: 200,
              i: 2,
            },
            {
              x: 260,
              y: 200,
              i: 1,
            },
            {
              x: 260,
              y: 200,
              i: 0,
            },
          ],
          fill: "rgba(245, 158, 11, 0.2)",
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
      box: {
        x: 28,
        y: 28,
        w: 464,
        h: 344,
      },
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
              start: {
                x: 260,
                y: 88.2,
              },
              segments: [
                {
                  k: "line",
                  to: {
                    x: 377.778839,
                    y: 161.731335,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 318.637457,
                    y: 280.707535,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 178.109759,
                    y: 312.712248,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 135.677892,
                    y: 159.605298,
                  },
                },
                {
                  k: "line",
                  to: {
                    x: 260,
                    y: 81.32,
                  },
                },
              ],
            },
          ],
          closed: true,
          vertices: [
            {
              x: 260,
              y: 88.2,
              i: 0,
            },
            {
              x: 377.778839,
              y: 161.731335,
              i: 1,
            },
            {
              x: 318.637457,
              y: 280.707535,
              i: 2,
            },
            {
              x: 178.109759,
              y: 312.712248,
              i: 3,
            },
            {
              x: 135.677892,
              y: 159.605298,
              i: 4,
            },
            {
              x: 260,
              y: 81.32,
              i: 5,
            },
          ],
          fill: null,
          stroke: "rgb(245, 158, 11)",
          strokeWidth: 2,
          dash: null,
        },
      ],
    },
  ],
};
