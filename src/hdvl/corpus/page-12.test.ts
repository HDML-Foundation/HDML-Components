/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import "../index";
import type { Scene, SceneNode } from "../scene";
import type { HdvlElement } from "../base";
import type { HdmlViewElement } from "../view";
import {
  DEFERRED_TO_SLICE_H,
  ENGINE,
  assertRenders,
  goldenOf,
  mountCorpus,
  negativeZeros,
  nodeCount,
  quiesce,
  stripText,
  withoutDeferred,
} from "../../testing/corpus";
import { scaleOf } from "../scale";
import {
  installSceneRecorder,
  restoreRenderers,
  sceneOf,
} from "../../testing/scene-of";

/**
 * ★ **`12-coverage` B — the gauge, and the only partial angular
 * sweep in the corpus** (RFC §10.1 F, SPEC §3).
 *
 * Every other polar page writes a full turn, where `360deg` is
 * `0deg` and a great deal of arithmetic is forgiving. The gauge does
 * not: `--hdml-angle-start: -120deg` / `--hdml-angle-end: 120deg` is
 * a 240° sweep about the 6 o'clock side, so an angle is a real
 * interpolation and a negative one at that.
 *
 * Three things are only observable here:
 *
 * - **the sweep is CSS, not data** — the scale's domain is
 *   `0 … 100` and the arcs bind `a0`/`a1` in *those* units;
 * - **document order is paint order** (§1.1) — the track arc is
 *   written first and the value arc covers it, which is the whole
 *   construction of a gauge;
 * - **the label is deliberately AFTER the marks**, the one place in
 *   the corpus where §4.4's guides-first convention is used the
 *   other way on purpose, because the ring would occlude the text.
 *
 * ★ **This page has four views and this file gates two, one slice
 * apart.** The gauge is Slice F's; **C is Slice G's** and is gated
 * in the second suite below. `12-A` carries an `hdml-legend` (Slice
 * H) and `12-D` a `symlog` datetime cartesian chart, and neither is
 * gated yet — the scope is asserted from the document rather than
 * left to the indices `1` and `2`.
 *
 * ★ **The gauge is a pure polar chain with no radius scale**, so it
 * is the second thing step 28's `Projection.span` correction
 * revived: before it, both arcs resolved no radial ceiling and the
 * whole figure was six labels stacked on the pole.
 */

/** §4.3's radial ceiling over the plane's content box. */
const CEILING = 148;

/** The page's angular sweep, in degrees. */
const SWEEP: readonly [number, number] = [-120, 120];

/** The value arc's reading, and its domain. */
const VALUE = 72;
const DOMAIN: readonly [number, number] = [0, 100];

/**
 * B's index in the page's four views. Named, because `views[1]`
 * spelled inline would silently follow a page edit that inserted a
 * figure — and the first test asserts what the other three are.
 */
const GAUGE = 1;

/** A `rect` node, narrowed. */
type Rect = Extract<SceneNode, { k: "rect" }>;

/** Every console line the validator wrote during a test. */
let lines: string[] = [];
let realWarn: typeof console.warn;
let realError: typeof console.error;

/** The captured lines starting with a rule's prefix. */
function said(prefix: string): string[] {
  return lines.filter((l) => l.startsWith(prefix));
}

suite("corpus 12-coverage (B, the gauge)", () => {
  setup(() => {
    installSceneRecorder();
  });

  teardown(() => {
    restoreRenderers();
  });

  test("★ four views, and this gate owns one", async () => {
    // Slice F's scope, asserted from the document. `12-C`'s
    // `hdml-stack` is the second suite's and `12-A`'s legend is
    // Slice H's; this suite must not grow to cover either.
    const page = await mountCorpus("12-coverage");
    assert.lengthOf(page.views, 4);
    // Deliberately server-free — the literal-only conformance
    // class, so there is no `hdml-io` to remove and no FakeIo.
    assert.strictEqual(page.removedIo, 0);
    assert.lengthOf(page.root.querySelectorAll("hdml-stack"), 1);
    assert.lengthOf(page.root.querySelectorAll("hdml-legend"), 2);
    const gauge = page.views[GAUGE];
    assert.lengthOf(gauge.querySelectorAll("hdml-polar-plane"), 1);
    assert.lengthOf(gauge.querySelectorAll("hdml-arc"), 2);
    assertRenders(gauge);
  });

  test("★ the sweep is partial, and it is the CSS's", async () => {
    // Derived on the RAW scene. The track spans the declared
    // sweep end to end; the value arc interpolates 72 of 100
    // through it. Neither is a full turn, and the low edge is
    // NEGATIVE — the first corpus angle that is.
    const page = await mountCorpus("12-coverage");
    const scene = sceneOf(page.views[GAUGE]);
    const arcs = scene.groups
      .filter((g) => g.role === "mark")
      .flatMap((g) => g.nodes);
    assert.lengthOf(arcs, 2);
    const [track, value] = arcs;
    if (track.k !== "arc" || value.k !== "arc") {
      assert.fail("a gauge arc is an arc node");
      return;
    }
    assert.strictEqual(track.a0, SWEEP[0]);
    assert.strictEqual(track.a1, SWEEP[1]);
    assert.strictEqual(value.a0, SWEEP[0]);
    const turn = SWEEP[1] - SWEEP[0];
    assert.closeTo(
      value.a1,
      SWEEP[0] +
        ((VALUE - DOMAIN[0]) / (DOMAIN[1] - DOMAIN[0])) * turn,
      1e-9,
    );
    assert.isBelow(turn, 360);
  });

  test("★ the doughnut floor is the plane's", async () => {
    // `--hdml-inner-radius: 70%` is declared on the plane and read
    // at each widget (§9's reader rule), and resolves against §3's
    // range CEILING — which, with no radius scale in the chain at
    // all, is the plane's own content box.
    const page = await mountCorpus("12-coverage");
    const scene = goldenOf(page.views[GAUGE]);
    scene.groups
      .filter((g) => g.role === "mark")
      .flatMap((g) => g.nodes)
      .forEach((n) => {
        assert.strictEqual(n.k === "arc" ? n.r0 : NaN, 0.7 * CEILING);
        assert.strictEqual(n.k === "arc" ? n.r1 : NaN, CEILING);
      });
  });

  test("★ paint order is the document's, both ways", async () => {
    // Track under value is §1.1 used the usual way; label after
    // both is §1.1 used deliberately against §4.4's convention.
    // One rule, two authorial intents, and the scene shows both.
    const page = await mountCorpus("12-coverage");
    const scene = goldenOf(page.views[GAUGE]);
    assert.deepEqual(
      scene.groups.map((g) => `${g.role}:${g.tag}`),
      ["mark:hdml-arc", "mark:hdml-arc", "guide:hdml-label"],
    );
  });

  test("★ the labels ring the rim, hanging outward", async () => {
    // The angular guide's `across` is the RADIUS range's far end
    // (step 27's `guideAcross`), so the ticks sit on the rim — and
    // the placement turns with them, because the outward normal is
    // radial under a pole. The two horizontal extremes are what
    // that means: the first tick hangs left-and-down, the last
    // right-and-down.
    const page = await mountCorpus("12-coverage");
    const scene = goldenOf(page.views[GAUGE]);
    const labels = scene.groups.filter((g) => g.role === "guide")[0];
    assert.lengthOf(labels.nodes, 6);
    const pole = { x: 240, y: 160 };
    labels.nodes.forEach((n) => {
      if (n.k !== "text") {
        assert.fail("a gauge label is a text node");
        return;
      }
      assert.closeTo(
        Math.hypot(n.x - pole.x, n.y - pole.y),
        CEILING,
        1e-6,
      );
    });
    const first = labels.nodes[0];
    const last = labels.nodes[labels.nodes.length - 1];
    assert.strictEqual(first.k === "text" ? first.anchor : "", "end");
    assert.strictEqual(last.k === "text" ? last.anchor : "", "start");
  });

  test("the golden holds on every engine", async () => {
    const page = await mountCorpus("12-coverage");
    assert.deepEqual(
      stripText(goldenOf(page.views[GAUGE])),
      stripText(GOLDEN_B),
    );
  });

  test("the text holds on chromium", async () => {
    assert.notStrictEqual(ENGINE, "unclassified");
    if (ENGINE !== "chromium") {
      return;
    }
    const page = await mountCorpus("12-coverage");
    assert.deepEqual(goldenOf(page.views[GAUGE]), GOLDEN_B);
  });

  test("it round-trips, is -0 free and fits the budget", async () => {
    const page = await mountCorpus("12-coverage");
    const view = page.views[GAUGE];
    const scene = goldenOf(view);
    assert.deepEqual(structuredClone(scene), scene);
    assert.deepEqual(negativeZeros(sceneOf(view)), []);
    assert.isBelow(nodeCount(scene), 20000);
  });
});

/**
 * ★ **`12-coverage` C — the `hidden` toggle, and the only corpus
 * assertion that runs a second frame** (RFC §10.1 G, SPEC §7).
 *
 * The view's caption is a claim about a **live interaction**, not
 * about a static render: *"the stack rebases over rendered children;
 * the y ceiling stays put (§7)"*. A golden alone cannot make it —
 * the two halves of that sentence are only distinguishable once
 * something toggles. So this suite mounts the page, removes the
 * attribute, re-runs the frame, and puts it back.
 *
 * ★ **`hidden` IS `HTMLElement.hidden`.** Nothing here reads an HDVL
 * mechanism: the third bar carries the platform's attribute, and
 * `subscribe.ts`'s `paintSuppressed` and `container.ts`'s
 * `renderedChildrenOf` are the two places that ask.
 *
 * ★ **The view is literal-only.** Every binding is an inline array
 * or a scalar constant, so the page declares no `hdml-io`, no
 * `hdml-frame` and no `source` — which is what makes V7's
 * order-pinning clause silent here by **locality** rather than by a
 * sort key, exactly as `04-grouped-stacked` is silent by carrying
 * one.
 *
 * **C3 — the legend is Slice H's.** This view declares one of the
 * page's two, so the golden is taken over {@link withoutDeferred}'s
 * restriction and step 32 re-runs the view whole.
 */

/** C's index in the page's four views. */
const STACK = 2;

/** The three series the view writes as literal arrays. */
const ALPHA = [20, 25, 22, 28];
const BETA = [15, 18, 21, 17];
const GAMMA = [30, 27, 24, 33];

/** The scene this gate owns — C3's restriction, quantized. */
function ownedC(view: HdmlViewElement): Scene {
  return withoutDeferred(goldenOf(view), DEFERRED_TO_SLICE_H);
}

/** Re-runs the frame after a declarative change. */
async function reflow(view: HdmlViewElement): Promise<void> {
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  view.markDirty();
  await quiesce([view]);
}

/** Every mark group's rects, in document order. */
function bands(view: HdmlViewElement): Rect[][] {
  return sceneOf(view)
    .groups.filter((g) => g.role === "mark")
    .map((g) =>
      g.nodes.map((n) => {
        assert.strictEqual(n.k, "rect");
        return <Rect>n;
      }),
    );
}

/** A scale element's domain, as the string a byte compare uses. */
function domainOf(view: HdmlViewElement, sel: string): string {
  const hit = view.querySelector(sel);
  assert.isNotNull(hit);
  return JSON.stringify(
    scaleOf(<HdvlElement>(<unknown>hit))?.domain() ?? null,
  );
}

suite("corpus 12-coverage (C, the hidden stack)", () => {
  setup(() => {
    installSceneRecorder();
    lines = [];
    realWarn = console.warn;
    realError = console.error;
    console.warn = (...args: unknown[]): void => {
      lines.push(String(args[0]));
    };
    console.error = (...args: unknown[]): void => {
      lines.push(String(args[0]));
    };
  });

  teardown(() => {
    console.warn = realWarn;
    console.error = realError;
    restoreRenderers();
  });

  test("★ C renders, and its legend is deferred", async () => {
    const page = await mountCorpus("12-coverage");
    const view = page.views[STACK];
    assert.lengthOf(view.querySelectorAll("hdml-stack"), 1);
    assert.lengthOf(view.querySelectorAll("hdml-bar"), 3);
    // Both halves of C3.
    assert.lengthOf(view.querySelectorAll("hdml-legend"), 1);
    assert.lengthOf(
      ownedC(view).groups.filter((g) => g.tag === "hdml-legend"),
      0,
    );
    assertRenders(view);
  });

  test("★ the rendered children are two, not three", async () => {
    // A `hidden` child emits no group AT ALL — not an empty one,
    // not a zero-extent one. The two that remain rebase over each
    // other, so the second's baseline is the first's top.
    const page = await mountCorpus("12-coverage");
    const view = page.views[STACK];
    const hidden = view.querySelectorAll("hdml-bar")[2];
    assert.isTrue((<HTMLElement>hidden).hidden);
    const all = bands(view);
    assert.lengthOf(all, 2);
    for (let i = 0; i < 4; i++) {
      assert.strictEqual(all[1][i].y + all[1][i].h, all[0][i].y);
      // …and the column stops at Alpha + Beta, never at the total.
      const unit = all[0][i].h / ALPHA[i];
      assert.closeTo(all[1][i].h / unit, BETA[i], 1e-9);
    }
  });

  test("★ the toggle rebases, and the scene returns", async () => {
    // The one corpus assertion in the project that runs a second
    // frame. Step 24's trap is why the attribute is really removed
    // and really restored: setting one to the value it already has
    // fires no callback and would test nothing.
    const page = await mountCorpus("12-coverage");
    const view = page.views[STACK];
    const before = ownedC(view);
    const bar = <HTMLElement>view.querySelectorAll("hdml-bar")[2];

    bar.removeAttribute("hidden");
    await reflow(view);
    const all = bands(view);
    assert.lengthOf(all, 3);
    for (let i = 0; i < 4; i++) {
      // The third band appears at its DERIVED baseline — band 1's
      // top — and the two below it have not moved.
      assert.strictEqual(all[2][i].y + all[2][i].h, all[1][i].y);
      assert.strictEqual(all[1][i].y + all[1][i].h, all[0][i].y);
      const unit = all[0][i].h / ALPHA[i];
      assert.closeTo(all[2][i].h / unit, GAMMA[i], 1e-9);
    }

    bar.setAttribute("hidden", "");
    await reflow(view);
    assert.lengthOf(bands(view), 2);
    // Exactly the scene it started from, and exactly the golden.
    assert.deepEqual(ownedC(view), before);
    assert.deepEqual(stripText(ownedC(view)), stripText(GOLDEN_C));
  });

  test("★ no scale domain follows the toggle", async () => {
    // §6, and the view's own caption: *"scale domains never follow a
    // toggle — the ceiling is the author's statement"*. Byte
    // identity across all three states, on every scale in the chain.
    const page = await mountCorpus("12-coverage");
    const view = page.views[STACK];
    const sels = [
      'hdml-ordinal-scale[channel="x"]',
      'hdml-continuous-scale[channel="y"]',
      'hdml-ordinal-scale[channel="color"]',
    ];
    const first = sels.map((s) => domainOf(view, s));
    const bar = <HTMLElement>view.querySelectorAll("hdml-bar")[2];
    bar.removeAttribute("hidden");
    await reflow(view);
    assert.deepEqual(
      sels.map((s) => domainOf(view, s)),
      first,
    );
    bar.setAttribute("hidden", "");
    await reflow(view);
    assert.deepEqual(
      sels.map((s) => domainOf(view, s)),
      first,
    );
  });

  test("★ literal-only: no io, and V7 is silent", async () => {
    // V4's locality: a widget with no effective `source` names no
    // frame, so V7's order clause has nothing to resolve and does
    // not fire. `04-grouped-stacked` reaches the same silence the
    // other way, by declaring `hdml-sort-by`.
    const page = await mountCorpus("12-coverage");
    assert.strictEqual(page.removedIo, 0);
    assert.lengthOf(page.root.querySelectorAll("hdml-frame"), 0);
    const view = page.views[STACK];
    assert.isNull(view.querySelector("[source]"));
    assert.lengthOf(said("hdml V7"), 0);
    assert.lengthOf(said("hdml V6"), 0);
    assert.lengthOf(said("hdml V17"), 0);
    assert.lengthOf(said("hdml W4"), 0);
  });

  test("the golden holds on every engine", async () => {
    const page = await mountCorpus("12-coverage");
    assert.deepEqual(
      stripText(ownedC(page.views[STACK])),
      stripText(GOLDEN_C),
    );
  });

  test("the text holds on chromium", async () => {
    assert.notStrictEqual(ENGINE, "unclassified");
    if (ENGINE !== "chromium") {
      return;
    }
    const page = await mountCorpus("12-coverage");
    assert.deepEqual(ownedC(page.views[STACK]), GOLDEN_C);
  });

  test("it round-trips, is -0 free and fits the budget", async () => {
    const page = await mountCorpus("12-coverage");
    const view = page.views[STACK];
    const scene = ownedC(view);
    assert.deepEqual(structuredClone(scene), scene);
    assert.deepEqual(negativeZeros(sceneOf(view)), []);
    assert.strictEqual(nodeCount(scene), 20);
    assert.isBelow(nodeCount(scene), 20000);
  });
});

const GOLDEN_B: Scene = {
  width: 480,
  height: 320,
  groups: [
    {
      widget: "",
      tag: "hdml-arc",
      role: "mark",
      box: {
        x: 12,
        y: 12,
        w: 456,
        h: 296,
      },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: true,
      clipPath: null,
      nodes: [
        {
          k: "arc",
          i: 0,
          cx: 240,
          cy: 160,
          r0: 103.6,
          r1: 148,
          a0: -120,
          a1: 120,
          fill: "rgb(226, 232, 240)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
      ],
    },
    {
      widget: "",
      tag: "hdml-arc",
      role: "mark",
      box: {
        x: 12,
        y: 12,
        w: 456,
        h: 296,
      },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: true,
      clipPath: null,
      nodes: [
        {
          k: "arc",
          i: 0,
          cx: 240,
          cy: 160,
          r0: 103.6,
          r1: 148,
          a0: -120,
          a1: 52.8,
          fill: "rgb(28, 140, 244)",
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
        x: 12,
        y: 12,
        w: 456,
        h: 296,
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
          x: 111.82824,
          y: 234,
          text: "0",
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
          x: 99.243636,
          y: 114.265485,
          text: "20",
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
          x: 179.802977,
          y: 24.795272,
          text: "40",
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
          x: 300.197023,
          y: 24.795272,
          text: "60",
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
          x: 380.756364,
          y: 114.265485,
          text: "80",
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
          x: 368.17176,
          y: 234,
          text: "100",
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
      ],
    },
  ],
};

const GOLDEN_C: Scene = {
  width: 480,
  height: 320,
  groups: [
    {
      widget: "",
      tag: "hdml-axis",
      role: "guide",
      box: {
        x: 64,
        y: 280,
        w: 392,
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
                x: 64,
                y: 280,
              },
              segments: [
                {
                  k: "line",
                  to: {
                    x: 456,
                    y: 280,
                  },
                },
              ],
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
      box: {
        x: 64,
        y: 280,
        w: 392,
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
          x: 105.263158,
          y: 280,
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
          x: 208.421053,
          y: 280,
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
          x: 311.578947,
          y: 280,
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
          x: 414.736842,
          y: 280,
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
      ],
    },
    {
      widget: "",
      tag: "hdml-axis",
      role: "guide",
      box: {
        x: 24,
        y: 16,
        w: 40,
        h: 264,
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
                x: 64,
                y: 280,
              },
              segments: [
                {
                  k: "line",
                  to: {
                    x: 64,
                    y: 16,
                  },
                },
              ],
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
      box: {
        x: 24,
        y: 16,
        w: 40,
        h: 264,
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
          x: 64,
          y: 280,
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
          y: 227.2,
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
          x: 64,
          y: 174.4,
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
        {
          k: "text",
          i: -1,
          x: 64,
          y: 121.6,
          text: "60",
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
          y: 68.8,
          text: "80",
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
          y: 16,
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
      ],
    },
    {
      widget: "",
      tag: "hdml-bar",
      role: "mark",
      box: {
        x: 64,
        y: 16,
        w: 392,
        h: 264,
      },
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
          y: 227.2,
          w: 82.526316,
          h: 52.8,
          fill: "rgb(28, 140, 244)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 1,
          x: 167.157895,
          y: 214,
          w: 82.526316,
          h: 66,
          fill: "rgb(28, 140, 244)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 2,
          x: 270.315789,
          y: 221.92,
          w: 82.526316,
          h: 58.08,
          fill: "rgb(28, 140, 244)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 3,
          x: 373.473684,
          y: 206.08,
          w: 82.526316,
          h: 73.92,
          fill: "rgb(28, 140, 244)",
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
      box: {
        x: 64,
        y: 16,
        w: 392,
        h: 264,
      },
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
          y: 187.6,
          w: 82.526316,
          h: 39.6,
          fill: "rgb(245, 158, 11)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 1,
          x: 167.157895,
          y: 166.48,
          w: 82.526316,
          h: 47.52,
          fill: "rgb(245, 158, 11)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 2,
          x: 270.315789,
          y: 166.48,
          w: 82.526316,
          h: 55.44,
          fill: "rgb(245, 158, 11)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 3,
          x: 373.473684,
          y: 161.2,
          w: 82.526316,
          h: 44.88,
          fill: "rgb(245, 158, 11)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
      ],
    },
  ],
};
