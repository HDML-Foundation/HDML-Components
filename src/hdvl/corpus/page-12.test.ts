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
  negativeZeros,
  nodeCount,
  stripText,
} from "../../testing/corpus";
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
 * ★ **This page has four views and this step gates one.** `12-A`
 * carries an `hdml-legend` (Slice H), `12-C` an `hdml-stack` (Slice
 * G, step 29) and `12-D` a `symlog` datetime cartesian chart — none
 * is Slice F's, and the scope is asserted rather than left to the
 * index `1`.
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

suite("corpus 12-coverage (B, the gauge)", () => {
  setup(() => {
    installSceneRecorder();
  });

  teardown(() => {
    restoreRenderers();
  });

  test("★ four views, and this gate owns one", async () => {
    // Slice F's scope, asserted from the document. `12-C`'s
    // `hdml-stack` is step 29's and `12-A`'s legend is step 31's;
    // this file must not grow to cover either by accident.
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
