/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import "../index";
import type { Scene, SceneNode } from "../scene";
import {
  ENGINE,
  assertRenders,
  goldenOf,
  mountCorpus,
  negativeZeros,
  nodeCount,
  pageSource,
  propsOf,
  stripText,
} from "../../testing/corpus";
import { assertInvariants } from "../../testing/invariants";
import { subscriptionsOf } from "../subscribe";
import {
  installSceneRecorder,
  restoreRenderers,
} from "../../testing/scene-of";

/**
 * ★★★ **`13-text` — the fourteenth page, and the seventh mark on a
 * document** (019 item 5, Note 003 §8, plan row 43).
 *
 * `hdml-text` landed at step 42 with fifteen fixtures, and fixtures
 * are not what this page adds. A mark that prints a datum has to
 * survive a **real view**: its runs share a viewport with an x
 * ladder, a y gutter and the mark it annotates, and the geometry
 * gate holds them to *no overlap, no escape* at **both** layout
 * widths on **three** engines. That claim cannot be made by a
 * reduced fixture at any effort, because a fixture has no
 * neighbours.
 *
 * ★ **Two views, and the second is not coverage.** §8 asks for *"a
 * scatter that prints its values"* as the minimum, which is **A**.
 * **B** is D9a's *reach* case — a sibling text at a **simple** bar's
 * own binding lands exactly on the bar's high edge — and it is here
 * rather than left to `mark-text.test.ts` because the fixture proves
 * the arithmetic while the page proves the **reading**: a bar chart
 * with its values on the bars is the single most common thing an
 * author will try, and until this page nothing in the repo showed
 * that it works. The stacked half of D9a stays a fixture: a page
 * cannot show where a run is *not*.
 *
 * ★★ **What only a document could find — the selector.**
 * `--hdml-text-format` is registered `inherits: false`, and
 * `hdml-text` is its **third** reader. Every `--hdml-text-format`
 * declaration in `html/` before this page names `hdml-label` or
 * `hdml-legend`, which was complete when each was written. Authoring
 * this page measured two things no prose had:
 *
 * - the **narrow** selector is silent — the runs print the locale
 *   default (`1,500,000` beside a y axis reading `1.5M`) and
 *   `assertRenders`, `assertInvariants` and both goldens are
 *   **green**, because an unformatted run is a valid string;
 * - and the **bare three-tag** widening is an **error** — a plain
 *   `hdml-label` also reaches B's band x label, and V14 makes a
 *   skeleton on an ordinal channel `bad-format-skeleton`.
 *
 * So the idiom has a shape: name the three readers, qualified by
 * channel. The page's stylesheet carries the argument; the two
 * tests below carry the assertion.
 *
 * ★ **Literal-only, and that is a structural fact rather than a
 * convenience.** This page declares no `hdml-io` and binds nothing
 * but JSON arrays, so its views hold **zero** subscriptions — which
 * is the only reason they paint at all with no provider in the
 * document. `paintSuppressed`'s subscription-count clause returns
 * *not suppressed* **before** first-resolution atomicity is ever
 * consulted; a view with one unresolved subscription blanks
 * **everything** in it. Asserted below, because it is the premise
 * every literal-only page in this corpus rests on and nothing
 * stated it.
 */

/** The page's `figure` `max-width` — so the view is 520 at 800. */
const VIEW_W = 520;

/** `hdml-view { height: 300px }`. */
const VIEW_H = 300;

/** `hdml-cartesian-plane { padding: 16px 28px 40px 64px }`. */
const GUTTER = { top: 16, right: 28, bottom: 40, left: 64 };

/** The plot box both views share, in view coordinates. */
const PLOT = {
  x: GUTTER.left,
  y: GUTTER.top,
  w: VIEW_W - GUTTER.left - GUTTER.right,
  h: VIEW_H - GUTTER.top - GUTTER.bottom,
};

/** A's x domain, and the revenue column A prints and B re-uses. */
const A_X = [12, 31, 48, 67, 84];
const A_Y = [420000, 980000, 1500000, 2300000, 3100000];
const A_MAX = { x: 110, y: 3600000 };

/** B's four quarters and their revenue, and its y ceiling. */
const B_Y = [1200000, 1800000, 1500000, 2400000];
const B_MAX = 3000000;

/** Every text node of one group, narrowed. */
function textsOfGroup(
  scene: Scene,
  tag: string,
): Extract<SceneNode, { k: "text" }>[] {
  return scene.groups
    .filter((g) => g.tag === tag)
    .flatMap((g) => g.nodes)
    .filter(
      (n): n is Extract<SceneNode, { k: "text" }> => n.k === "text",
    );
}

/** The rects of one group, narrowed. */
function rectsOfGroup(
  scene: Scene,
  tag: string,
): Extract<SceneNode, { k: "rect" }>[] {
  return scene.groups
    .filter((g) => g.tag === tag)
    .flatMap((g) => g.nodes)
    .filter(
      (n): n is Extract<SceneNode, { k: "rect" }> => n.k === "rect",
    );
}

suite("corpus 13-text", () => {
  setup(() => {
    installSceneRecorder();
  });

  teardown(() => {
    restoreRenderers();
  });

  test("★★★ the geometry invariants hold", async () => {
    // ★ **Zero new `ACCEPTED` entries**, which is the whole claim
    // of this row. The baseline may only shrink (S5), so a page
    // that collided would have had to be re-authored and was: the
    // first draft put two runs 10 units apart, which clears at 800
    // and overlaps at 400, and the gate named both runs at 400 and
    // not at 800. The fix was the PAGE's x values.
    await assertInvariants("13-text");
  });

  test("★ it renders, with two views and no provider", async () => {
    const page = await mountCorpus("13-text");
    assert.lengthOf(page.views, 2);
    assert.strictEqual(page.removedIo, 0);
    assert.strictEqual(page.sheets, 1);
    page.views.forEach((view) => assertRenders(view));
  });

  test("★★ literal-only means ZERO subscriptions", async () => {
    // ★ The premise `00`, `02`, `12` and this page all rest on,
    // asserted for the first time. `paintSuppressed` answers *not
    // suppressed* on `state.subs.size === 0` **before** it reaches
    // first-resolution atomicity, so a document with no provider
    // paints on its first frame. A page that acquired one
    // subscription — a stray `source=`, a column name where an
    // array was meant — would blank **every** widget in that view
    // and the only symptom would be an empty golden.
    const page = await mountCorpus("13-text");
    assert.deepEqual(
      page.views.map((v) => subscriptionsOf(v).length),
      [0, 0],
    );
    assert.notInclude(await pageSource("13-text"), "<hdml-io");
  });

  test("★★★ A prints one run per row, at its own datum", async () => {
    const page = await mountCorpus("13-text");
    const scene = goldenOf(page.views[0]);
    assert.strictEqual(scene.width, VIEW_W);
    assert.strictEqual(scene.height, VIEW_H);

    // The runs are the mark's, so they carry a REAL row index —
    // unlike a guide's `-1`, which is what `i` distinguishes.
    const runs = textsOfGroup(scene, "hdml-text");
    assert.lengthOf(runs, A_X.length);
    assert.deepEqual(
      runs.map((r) => r.i),
      [0, 1, 2, 3, 4],
    );
    assert.deepEqual(
      textsOfGroup(scene, "hdml-label").map((r) => r.i),
      [-1, -1, -1, -1, -1, -1, -1],
    );

    // …and each one is where the two scales put its row, derived
    // from the page's own declarations rather than captured.
    const dots = scene.groups.filter((g) => g.tag === "hdml-point");
    assert.lengthOf(dots, 1);
    runs.forEach((run, k) => {
      assert.closeTo(
        run.x,
        PLOT.x + (A_X[k] / A_MAX.x) * PLOT.w,
        1e-6,
      );
      assert.closeTo(
        run.y,
        PLOT.y + PLOT.h - (A_Y[k] / A_MAX.y) * PLOT.h,
        1e-6,
      );
      // The dot and the run are the same point: one binding, two
      // marks, which is what a data label is.
      const dot = dots[0].nodes[k];
      assert.strictEqual(dot.k, "ellipse");
      if (dot.k !== "ellipse") return;
      assert.closeTo(dot.cx, run.x, 1e-6);
      assert.closeTo(dot.cy, run.y, 1e-6);
    });
  });

  test("★★ §4.9 — ONE prefix across the set, on a page", async () => {
    // The headline of item 19 as a document. `Intl`'s compact
    // notation picks a prefix per value, which would print
    // `420K … 3.1M` down one chart; §4.9 reads the prefix off the
    // largest magnitude and gives it to every value. Five runs,
    // one `M`, and the smallest of them below 1 as a consequence.
    const page = await mountCorpus("13-text");
    assert.notStrictEqual(ENGINE, "unclassified");
    if (ENGINE !== "chromium") {
      return;
    }
    const runs = textsOfGroup(
      goldenOf(page.views[0]),
      "hdml-text",
    ).map((r) => r.text);
    assert.deepEqual(runs, [
      "0.42M",
      "0.98M",
      "1.5M",
      "2.3M",
      "3.1M",
    ]);
    runs.forEach((run) => assert.match(run, /M$/));
  });

  test("★★★ the selector reaches the MARK (C330)", async () => {
    // ★ The one assertion only a document can make, and the one
    // this page exists for. It is made against the page's own
    // SOURCE and against the computed property, because the two
    // failures are different: a selector that forgot `hdml-text`
    // leaves the property at its initial empty string, and the
    // runs then print the locale default with every other gate
    // green. Measured: `420,000 … 3,100,000`.
    const source = await pageSource("13-text");
    assert.match(
      source,
      /hdml-label\[channel="y"\],\s*hdml-legend,\s*hdml-text\s*\{/,
      "the three readers, qualified by channel",
    );
    const page = await mountCorpus("13-text");
    for (const view of page.views) {
      const mark = view.querySelector("hdml-text");
      assert.isNotNull(mark);
      assert.strictEqual(
        propsOf(<HTMLElement>mark).get("--hdml-text-format"),
        "compact-short",
      );
    }
  });

  test("★★ B — a simple bar's top is reachable (D9a)", async () => {
    // Note 003 §3.2's first row, on a page: the run sits exactly
    // on the bar's high edge, because a simple bar's endpoint IS
    // its binding. A stacked child's is derived and internal,
    // which `mark-text.test.ts` asserts and no page can.
    const page = await mountCorpus("13-text");
    const scene = goldenOf(page.views[1]);
    const bars = rectsOfGroup(scene, "hdml-bar");
    const runs = textsOfGroup(scene, "hdml-text");
    assert.lengthOf(bars, B_Y.length);
    assert.lengthOf(runs, B_Y.length);
    runs.forEach((run, k) => {
      assert.closeTo(run.y, bars[k].y, 1e-6);
      assert.closeTo(
        run.y,
        PLOT.y + PLOT.h - (B_Y[k] / B_MAX) * PLOT.h,
        1e-6,
      );
      // Centred on the band, which is `middle` — the element's own
      // default, restated by the page because B wants it and A
      // does not.
      assert.strictEqual(run.anchor, "middle");
      assert.closeTo(run.x, bars[k].x + bars[k].w / 2, 1e-6);
    });
    // A's is the authored one, through 017 R2's reader.
    assert.deepEqual(
      textsOfGroup(goldenOf(page.views[0]), "hdml-text").map(
        (r) => r.anchor,
      ),
      ["start", "start", "start", "start", "start"],
    );
  });

  test("★ the runs are selectable text, not decoration", async () => {
    // §5.10, and the same answer a label gives: a run that prints
    // a datum is what the reader is told, so it is real text.
    const page = await mountCorpus("13-text");
    for (const view of page.views) {
      const runs = textsOfGroup(goldenOf(view), "hdml-text");
      assert.isNotEmpty(runs);
      runs.forEach((run) => {
        assert.isFalse(run.decorative);
        assert.strictEqual(run.baseline, "middle");
        assert.strictEqual(run.rotate, 0);
      });
    }
  });

  test("the goldens hold on every engine", async () => {
    const page = await mountCorpus("13-text");
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
    // ★ Rule 4, and the first page where its chromium-scoped half
    // covers a `role: "mark"` group. Every other golden's `Intl`
    // output is a GUIDE's; here a mark's nodes carry strings too,
    // so the positions are asserted on three engines and the
    // strings on one, by exactly the mechanism the guides use.
    assert.notStrictEqual(ENGINE, "unclassified");
    if (ENGINE !== "chromium") {
      return;
    }
    const page = await mountCorpus("13-text");
    assert.deepEqual(goldenOf(page.views[0]), GOLDEN_A);
    assert.deepEqual(goldenOf(page.views[1]), GOLDEN_B);
  });

  test("they round-trip, are -0 free and fit", async () => {
    const page = await mountCorpus("13-text");
    for (const view of page.views) {
      const scene = goldenOf(view);
      assert.deepEqual(structuredClone(scene), scene);
      assert.isBelow(nodeCount(scene), 20000);
    }
    assert.deepEqual(
      negativeZeros(goldenOf(page.views[0])).concat(
        negativeZeros(goldenOf(page.views[1])),
      ),
      [],
    );
  });
});
const GOLDEN_A: Scene = {
  width: 520,
  height: 300,
  groups: [
    {
      widget: "",
      tag: "hdml-grid",
      role: "guide",
      box: { x: 64, y: 16, w: 428, h: 244 },
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
              start: { x: 64, y: 260 },
              segments: [{ k: "line", to: { x: 492, y: 260 } }],
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
              start: { x: 64, y: 192.222222 },
              segments: [
                { k: "line", to: { x: 492, y: 192.222222 } },
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
              start: { x: 64, y: 124.444444 },
              segments: [
                { k: "line", to: { x: 492, y: 124.444444 } },
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
              start: { x: 64, y: 56.666667 },
              segments: [{ k: "line", to: { x: 492, y: 56.666667 } }],
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
      box: { x: 64, y: 260, w: 428, h: 0 },
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
              start: { x: 64, y: 260 },
              segments: [{ k: "line", to: { x: 492, y: 260 } }],
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
      box: { x: 64, y: 272, w: 428, h: 0 },
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
          y: 272,
          text: "0",
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
          x: 258.545455,
          y: 272,
          text: "50",
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
          x: 453.090909,
          y: 272,
          text: "100",
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
      tag: "hdml-axis",
      role: "guide",
      box: { x: 64, y: 16, w: 0, h: 244 },
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
              start: { x: 64, y: 260 },
              segments: [{ k: "line", to: { x: 64, y: 16 } }],
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
      box: { x: 44, y: 16, w: 0, h: 244 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: false,
      clipPath: null,
      nodes: [
        {
          k: "text",
          i: -1,
          x: 44,
          y: 260,
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
          x: 44,
          y: 192.222222,
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
          x: 44,
          y: 124.444444,
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
        {
          k: "text",
          i: -1,
          x: 44,
          y: 56.666667,
          text: "3M",
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
      tag: "hdml-point",
      role: "mark",
      box: { x: 64, y: 16, w: 428, h: 244 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: true,
      clipPath: null,
      nodes: [
        {
          k: "ellipse",
          i: 0,
          cx: 110.690909,
          cy: 231.533333,
          rx: 3.5,
          ry: 3.5,
          fill: "rgb(28, 140, 244)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "ellipse",
          i: 1,
          cx: 184.618182,
          cy: 193.577778,
          rx: 3.5,
          ry: 3.5,
          fill: "rgb(28, 140, 244)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "ellipse",
          i: 2,
          cx: 250.763636,
          cy: 158.333333,
          rx: 3.5,
          ry: 3.5,
          fill: "rgb(28, 140, 244)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "ellipse",
          i: 3,
          cx: 324.690909,
          cy: 104.111111,
          rx: 3.5,
          ry: 3.5,
          fill: "rgb(28, 140, 244)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "ellipse",
          i: 4,
          cx: 390.836364,
          cy: 49.888889,
          rx: 3.5,
          ry: 3.5,
          fill: "rgb(28, 140, 244)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
      ],
    },
    {
      widget: "",
      tag: "hdml-text",
      role: "mark",
      box: { x: 64, y: 16, w: 428, h: 244 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: true,
      clipPath: null,
      nodes: [
        {
          k: "text",
          i: 0,
          x: 110.690909,
          y: 231.533333,
          text: "0.42M",
          anchor: "start",
          baseline: "middle",
          font: {
            family: "system-ui",
            size: 11,
            weight: "normal",
            style: "normal",
          },
          rotate: 0,
          decorative: false,
          fill: "rgb(15, 23, 42)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "text",
          i: 1,
          x: 184.618182,
          y: 193.577778,
          text: "0.98M",
          anchor: "start",
          baseline: "middle",
          font: {
            family: "system-ui",
            size: 11,
            weight: "normal",
            style: "normal",
          },
          rotate: 0,
          decorative: false,
          fill: "rgb(15, 23, 42)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "text",
          i: 2,
          x: 250.763636,
          y: 158.333333,
          text: "1.5M",
          anchor: "start",
          baseline: "middle",
          font: {
            family: "system-ui",
            size: 11,
            weight: "normal",
            style: "normal",
          },
          rotate: 0,
          decorative: false,
          fill: "rgb(15, 23, 42)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "text",
          i: 3,
          x: 324.690909,
          y: 104.111111,
          text: "2.3M",
          anchor: "start",
          baseline: "middle",
          font: {
            family: "system-ui",
            size: 11,
            weight: "normal",
            style: "normal",
          },
          rotate: 0,
          decorative: false,
          fill: "rgb(15, 23, 42)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "text",
          i: 4,
          x: 390.836364,
          y: 49.888889,
          text: "3.1M",
          anchor: "start",
          baseline: "middle",
          font: {
            family: "system-ui",
            size: 11,
            weight: "normal",
            style: "normal",
          },
          rotate: 0,
          decorative: false,
          fill: "rgb(15, 23, 42)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
      ],
    },
  ],
};

const GOLDEN_B: Scene = {
  width: 520,
  height: 300,
  groups: [
    {
      widget: "",
      tag: "hdml-grid",
      role: "guide",
      box: { x: 64, y: 16, w: 428, h: 244 },
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
              start: { x: 64, y: 260 },
              segments: [{ k: "line", to: { x: 492, y: 260 } }],
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
              start: { x: 64, y: 178.666667 },
              segments: [
                { k: "line", to: { x: 492, y: 178.666667 } },
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
              start: { x: 64, y: 97.333333 },
              segments: [{ k: "line", to: { x: 492, y: 97.333333 } }],
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
              start: { x: 64, y: 16 },
              segments: [{ k: "line", to: { x: 492, y: 16 } }],
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
      box: { x: 64, y: 260, w: 428, h: 0 },
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
              start: { x: 64, y: 260 },
              segments: [{ k: "line", to: { x: 492, y: 260 } }],
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
      box: { x: 64, y: 272, w: 428, h: 0 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: false,
      clipPath: null,
      nodes: [
        {
          k: "text",
          i: -1,
          x: 109.052632,
          y: 272,
          text: "Q1",
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
          x: 221.684211,
          y: 272,
          text: "Q2",
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
          x: 334.315789,
          y: 272,
          text: "Q3",
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
          x: 446.947368,
          y: 272,
          text: "Q4",
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
      tag: "hdml-axis",
      role: "guide",
      box: { x: 64, y: 16, w: 0, h: 244 },
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
              start: { x: 64, y: 260 },
              segments: [{ k: "line", to: { x: 64, y: 16 } }],
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
      box: { x: 44, y: 16, w: 0, h: 244 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: false,
      clipPath: null,
      nodes: [
        {
          k: "text",
          i: -1,
          x: 44,
          y: 260,
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
          x: 44,
          y: 178.666667,
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
          x: 44,
          y: 97.333333,
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
        {
          k: "text",
          i: -1,
          x: 44,
          y: 16,
          text: "3M",
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
      tag: "hdml-bar",
      role: "mark",
      box: { x: 64, y: 16, w: 428, h: 244 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: true,
      clipPath: null,
      nodes: [
        {
          k: "rect",
          i: 0,
          x: 64,
          y: 162.4,
          w: 90.105263,
          h: 97.6,
          fill: "rgb(28, 140, 244)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 1,
          x: 176.631579,
          y: 113.6,
          w: 90.105263,
          h: 146.4,
          fill: "rgb(28, 140, 244)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 2,
          x: 289.263158,
          y: 138,
          w: 90.105263,
          h: 122,
          fill: "rgb(28, 140, 244)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 3,
          x: 401.894737,
          y: 64.8,
          w: 90.105263,
          h: 195.2,
          fill: "rgb(28, 140, 244)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
      ],
    },
    {
      widget: "",
      tag: "hdml-text",
      role: "mark",
      box: { x: 64, y: 16, w: 428, h: 244 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: true,
      clipPath: null,
      nodes: [
        {
          k: "text",
          i: 0,
          x: 109.052632,
          y: 162.4,
          text: "1.2M",
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
          fill: "rgb(15, 23, 42)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "text",
          i: 1,
          x: 221.684211,
          y: 113.6,
          text: "1.8M",
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
          fill: "rgb(15, 23, 42)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "text",
          i: 2,
          x: 334.315789,
          y: 138,
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
          fill: "rgb(15, 23, 42)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "text",
          i: 3,
          x: 446.947368,
          y: 64.8,
          text: "2.4M",
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
          fill: "rgb(15, 23, 42)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
      ],
    },
  ],
};
