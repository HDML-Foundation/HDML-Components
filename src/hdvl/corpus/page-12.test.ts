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
  pageSource,
  quiesce,
  stripText,
  withoutDeferred,
} from "../../testing/corpus";
import { formatCompactSet } from "../kernel/format-skeleton";
import { localeOf, scaleOf } from "../scale";
import { tickSpecOf } from "../guide-spec";
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
 * ★ **This page has four views and this file gates three, one slice
 * apart each.** The gauge is Slice F's; **C is Slice G's** and is
 * gated in the second suite below; **A is Slice H's** and is gated
 * in the third. `12-D`'s `symlog` datetime cartesian chart is Slice
 * I's and is not gated yet — the scope is asserted from the document
 * rather than left to the indices `1`, `2` and `0`.
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
    // `hdml-stack` is the second suite's and `12-A`'s ramp legend
    // is the third's; this suite must not grow to cover either.
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
 * ★ **C3 is discharged here** (step 32). This view declares one of
 * the page's two legends, and its golden now carries the key's six
 * nodes. It is also **the one gated view where the key and the
 * marks can disagree**, which is why the domain claim is asserted
 * here and not on `04`: the third series is `hidden`, so two
 * colours are painted and **three** entries are keyed. §6 makes a
 * domain the author's statement, and a key that followed the marks
 * would silently drop a category the chart still reserves room for.
 */

/** C's index in the page's four views. */
const STACK = 2;

/** The colour scale's literal domain — and so the key's entries. */
const SERIES = ["Alpha", "Beta", "Gamma"];

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

  test("★ C renders, and its key is painted", async () => {
    const page = await mountCorpus("12-coverage");
    const view = page.views[STACK];
    assert.lengthOf(view.querySelectorAll("hdml-stack"), 1);
    assert.lengthOf(view.querySelectorAll("hdml-bar"), 3);
    // C3, discharged.
    assert.isEmpty(DEFERRED_TO_SLICE_H);
    assert.lengthOf(view.querySelectorAll("hdml-legend"), 1);
    assert.lengthOf(
      ownedC(view).groups.filter((g) => g.tag === "hdml-legend"),
      1,
    );
    assertRenders(view);
  });

  test("★ the key is the domain, not the rendered set", async () => {
    // The one gated view where the two can differ. Two bands paint
    // and three entries are keyed, because the key reads
    // `Scale.domain()` and the marks are not consulted (§6). The
    // colours are compared byte for byte against `paint()`, so the
    // hidden series' swatch is the colour it WOULD have.
    const page = await mountCorpus("12-coverage");
    const view = page.views[STACK];
    const hit = view.querySelector(
      'hdml-ordinal-scale[channel="color"]',
    );
    assert.isNotNull(hit);
    const color = scaleOf(<HdvlElement>(<unknown>hit));
    assert.deepEqual(color?.domain()?.values, SERIES);
    const scene = ownedC(view);
    // Two mark groups, three key entries — the whole claim.
    assert.lengthOf(
      scene.groups.filter((g) => g.role === "mark"),
      2,
    );
    const key = scene.groups.filter(
      (g) => g.tag === "hdml-legend",
    )[0];
    assert.lengthOf(key.nodes, 2 * SERIES.length);
    SERIES.forEach((name, k) => {
      const swatch = key.nodes[2 * k];
      const label = key.nodes[2 * k + 1];
      assert.strictEqual(swatch.k, "rect");
      assert.strictEqual(label.k === "text" ? label.text : "", name);
      assert.strictEqual(swatch.fill, color?.paint(name));
    });
    // …and the two rendered bands really do wear the first two.
    const painted = scene.groups.filter((g) => g.role === "mark");
    assert.strictEqual(painted[0].nodes[0].fill, key.nodes[0].fill);
    assert.strictEqual(painted[1].nodes[0].fill, key.nodes[2].fill);
  });

  test("★ the UA default, on a page (finding 24)", async () => {
    // ★ The corpus DOES cover the UA placement default, and step
    // 31's landed note said it did not. This page writes no
    // `hdml-legend` rule at all — deliberately, per its own header
    // — so §3's row applies whole, and `width: max-content` over a
    // shadow tree with no entries in it resolves to **0**. The row
    // therefore anchors the key at the plot's top-right corner and
    // the entries flow rightwards out of the box.
    const src = await pageSource("12-coverage");
    assert.notMatch(src, /^\s*hdml-legend \{/m);
    const page = await mountCorpus("12-coverage");
    const scene = ownedC(page.views[STACK]);
    const key = scene.groups.filter(
      (g) => g.tag === "hdml-legend",
    )[0];
    assert.strictEqual(key.box.w, 0);
    // A zero cross-extent is harmless: the flow axis is `column`,
    // so `--hdml-legend-direction`'s initial makes the entries
    // advance along the box's HEIGHT, which `top: 8px` + the
    // generic `inset: 0`'s `bottom: 0` leave non-zero.
    assert.isAbove(key.box.h, 0);
    assert.isAbove(key.nodes[1].k === "text" ? key.nodes[1].x : 0, 0);
    // …and the anchor sits inside the plot's right edge by the
    // row's own 8px, which is what "overlay" means.
    const axis = scene.groups.filter((g) => g.tag === "hdml-axis")[0];
    assert.strictEqual(key.box.x, axis.box.x + axis.box.w - 8);
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
    // 20 before step 32, plus the key's three entries.
    assert.strictEqual(nodeCount(scene), 26);
    assert.isBelow(nodeCount(scene), 20000);
  });
});

/**
 * ★ **`12-coverage` A — the continuous ramp, and the last new page
 * this gate opens on an existing file** (RFC §10.1 H, SPEC §6.6).
 *
 * The view is the reason SPEC §2's *"no separate legend element"*
 * was reversed. A ramp is not a key: it has no entries to align, it
 * needs `count` to say how many graduations and `format` to say how
 * they read, and finding 17's own sentence is that **an unlabeled
 * gradient is not a legend**. `hdml-axis channel="color"` would have
 * had to publish a modal attribute set to express it.
 *
 * ★ **Its mode is derived, and nothing on the page picks it.** The
 * markup is `<hdml-legend channel="color" count="5">` — the same
 * five characters `12-C` writes — and it renders a bar because the
 * scale it resolves is `hdml-continuous-scale`. The two views on one
 * page are the cleanest statement of §6.6's derivation the corpus
 * has.
 *
 * ★ **It takes §3's UA placement default**, like `12-C` and unlike
 * every other legend-carrying page — the page's own header says so
 * (*"no legend gutter"*). See the third suite's finding-24 test.
 *
 * ★ **`hdml-fallback` is on this view**, so its scene is also the
 * corpus's statement that fallback content is *alternative content*
 * and never a scene group.
 */

/** A's index in the page's four views. */
const RAMP = 0;

/** How many `rect` samples the bar carries — see `page-09`. */
const RAMP_SAMPLES = 32;

/** A's colour domain, authored: `min="0" max="40"`. */
const COST: readonly [number, number] = [0, 40];

/** The eight unit costs the point binds, verbatim from the page. */
const COSTS = [31, 26, 38, 18, 12, 22, 8, 5];

suite("corpus 12-coverage (A, the ramp legend)", () => {
  setup(() => {
    installSceneRecorder();
  });

  teardown(() => {
    restoreRenderers();
  });

  test("★ A renders a bar, not a key", async () => {
    // §6.6's derivation on a page: one markup, two modes, and the
    // resolved scale's TAG is the whole of the difference.
    const page = await mountCorpus("12-coverage");
    const view = page.views[RAMP];
    assert.isEmpty(DEFERRED_TO_SLICE_H);
    assert.lengthOf(view.querySelectorAll("hdml-legend"), 1);
    assert.lengthOf(view.querySelectorAll("hdml-fallback"), 1);
    assertRenders(view);
    const scene = goldenOf(view);
    const key = scene.groups.filter(
      (g) => g.tag === "hdml-legend",
    )[0];
    assert.strictEqual(key.role, "guide");
    // A bar is 32 samples then one text per graduation — never an
    // alternating swatch/name pair, which is what the ordinal mode
    // emits and what `12-C` asserts.
    const rects = key.nodes.filter((n) => n.k === "rect");
    const texts = key.nodes.filter((n) => n.k === "text");
    assert.lengthOf(rects, RAMP_SAMPLES);
    assert.lengthOf(texts, 5);
    assert.lengthOf(key.nodes, RAMP_SAMPLES + texts.length);
    key.nodes.forEach((n) => assert.strictEqual(n.i, -1));
    // No `hdml-fallback` group: alternative content is not a scene.
    assert.deepEqual(
      scene.groups.map((g) => g.tag),
      [
        "hdml-axis",
        "hdml-tick",
        "hdml-label",
        "hdml-axis",
        "hdml-label",
        "hdml-point",
        "hdml-legend",
      ],
    );
  });

  test("★ the bar and the dots are one paint()", async () => {
    // R18 on a page, the continuous half. The dots are painted at
    // the eight delivered costs and the bar at 32 sample
    // midpoints, and BOTH strings are compared byte for byte
    // against `Scale.paint` — the same function, two callers. No
    // cost lands on a midpoint, so a collision between the two
    // lists is not available and is not what R18 claims.
    const page = await mountCorpus("12-coverage");
    const view = page.views[RAMP];
    const hit = view.querySelector(
      'hdml-continuous-scale[channel="color"]',
    );
    assert.isNotNull(hit);
    const color = scaleOf(<HdvlElement>(<unknown>hit));
    assert.isNotNull(color);
    assert.deepEqual(color?.domain()?.extent, [COST[0], COST[1]]);
    const scene = goldenOf(view);
    const dots = scene.groups.filter(
      (g) => g.tag === "hdml-point",
    )[0];
    assert.lengthOf(dots.nodes, COSTS.length);
    dots.nodes.forEach((n, i) => {
      assert.strictEqual(n.fill, color?.paint(COSTS[i]));
    });
    const key = scene.groups.filter(
      (g) => g.tag === "hdml-legend",
    )[0];
    key.nodes
      .filter((n) => n.k === "rect")
      .forEach((n, i) => {
        const t = (i + 0.5) / RAMP_SAMPLES;
        assert.strictEqual(
          n.fill,
          color?.paint(COST[0] + t * (COST[1] - COST[0])),
        );
      });
  });

  test("★ the graduations sit on the bar's own axis", async () => {
    // Step 31 made a continuous colour `project(v)` the RAMP
    // FRACTION, which is what lets the bar and its values share one
    // axis. Asserted as geometry: every graduation's y is the
    // fraction its tick reports, run through the same span the
    // samples were laid out over.
    const page = await mountCorpus("12-coverage");
    const view = page.views[RAMP];
    const legend = view.querySelector("hdml-legend");
    assert.isNotNull(legend);
    const el = <HdvlElement>(<unknown>legend);
    const hit = view.querySelector(
      'hdml-continuous-scale[channel="color"]',
    );
    const color = scaleOf(<HdvlElement>(<unknown>hit));
    const ticks = color?.ticks(tickSpecOf(el)) ?? [];
    assert.lengthOf(ticks, 5);
    const key = goldenOf(view).groups.filter(
      (g) => g.tag === "hdml-legend",
    )[0];
    const texts = key.nodes.filter((n) => n.k === "text");
    texts.forEach((n, i) => {
      assert.strictEqual(
        n.k === "text" ? n.y : NaN,
        key.box.y + ticks[i].at * key.box.h,
      );
    });
    // The bar runs the same span: sample 0 starts at the box's own
    // origin and the last one ends at its far edge.
    const rects = key.nodes.filter((n) => n.k === "rect");
    const first = rects[0];
    const last = rects[rects.length - 1];
    assert.strictEqual(first.k === "rect" ? first.y : NaN, key.box.y);
    assert.closeTo(
      last.k === "rect" ? last.y + last.h : NaN,
      key.box.y + key.box.h,
      1e-6,
    );
  });

  test("★ the ramp reads, and it reads as one set", async () => {
    // Rule 4 scopes the strings to chromium. `12-A` writes no
    // `format`, so `formatCompactSet` falls through to the
    // locale's default formatting — still over the whole SET, and
    // still `hdml-label`'s one implementation.
    assert.notStrictEqual(ENGINE, "unclassified");
    if (ENGINE !== "chromium") {
      return;
    }
    const page = await mountCorpus("12-coverage");
    const view = page.views[RAMP];
    const legend = view.querySelector("hdml-legend");
    const el = <HdvlElement>(<unknown>legend);
    const hit = view.querySelector(
      'hdml-continuous-scale[channel="color"]',
    );
    const color = scaleOf(<HdvlElement>(<unknown>hit));
    assert.isNotNull(color);
    const ticks = color?.ticks(tickSpecOf(el)) ?? [];
    const want = formatCompactSet(
      ticks.map((t) => Number(t.value)),
      "",
      localeOf(el),
    );
    const got = goldenOf(view)
      .groups.filter((g) => g.tag === "hdml-legend")[0]
      .nodes.filter((n) => n.k === "text")
      .map((n) => (n.k === "text" ? n.text : ""));
    assert.deepEqual(got, want);
    assert.deepEqual(got, ["0", "10", "20", "30", "40"]);
  });

  test("the golden holds on every engine", async () => {
    const page = await mountCorpus("12-coverage");
    assert.deepEqual(
      stripText(goldenOf(page.views[RAMP])),
      stripText(GOLDEN_A),
    );
  });

  test("the text holds on chromium", async () => {
    assert.notStrictEqual(ENGINE, "unclassified");
    if (ENGINE !== "chromium") {
      return;
    }
    const page = await mountCorpus("12-coverage");
    assert.deepEqual(goldenOf(page.views[RAMP]), GOLDEN_A);
  });

  test("it round-trips, is -0 free and fits the budget", async () => {
    const page = await mountCorpus("12-coverage");
    const view = page.views[RAMP];
    const scene = goldenOf(view);
    assert.deepEqual(structuredClone(scene), scene);
    assert.deepEqual(negativeZeros(sceneOf(view)), []);
    assert.strictEqual(nodeCount(scene), 65);
    assert.isBelow(nodeCount(scene), 20000);
  });
});

const GOLDEN_A: Scene = {
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
      tag: "hdml-tick",
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
          k: "rect",
          i: -1,
          x: 63.5,
          y: 277,
          w: 1,
          h: 6,
          fill: "rgb(0, 0, 0)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 141.9,
          y: 277,
          w: 1,
          h: 6,
          fill: "rgb(0, 0, 0)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 220.3,
          y: 277,
          w: 1,
          h: 6,
          fill: "rgb(0, 0, 0)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 298.7,
          y: 277,
          w: 1,
          h: 6,
          fill: "rgb(0, 0, 0)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 377.1,
          y: 277,
          w: 1,
          h: 6,
          fill: "rgb(0, 0, 0)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 455.5,
          y: 277,
          w: 1,
          h: 6,
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
          x: 64,
          y: 280,
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
          x: 142.4,
          y: 280,
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
          x: 220.8,
          y: 280,
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
          x: 299.2,
          y: 280,
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
          x: 377.6,
          y: 280,
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
          x: 456,
          y: 280,
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
          text: "1",
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
          text: "2",
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
          text: "3",
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
          text: "4",
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
          text: "5",
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
          k: "ellipse",
          i: 0,
          cx: 111.04,
          cy: 63.52,
          rx: 0.5,
          ry: 3,
          fill:
            "color-mix(in oklch, rgb(30, 58, " +
            "138) 55.00000000000001%, rgb(28, " +
            "140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "ellipse",
          i: 1,
          cx: 173.76,
          cy: 111.04,
          rx: 0.5,
          ry: 3,
          fill:
            "color-mix(in oklch, rgb(30, 58, " +
            "138) 30.000000000000004%, rgb(28, " +
            "140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "ellipse",
          i: 2,
          cx: 201.2,
          cy: 89.92,
          rx: 0.5,
          ry: 3,
          fill:
            "color-mix(in oklch, rgb(30, 58, " +
            "138) 89.99999999999999%, rgb(28, " +
            "140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "ellipse",
          i: 3,
          cx: 248.24,
          cy: 153.28,
          rx: 0.5,
          ry: 3,
          fill:
            "color-mix(in oklch, rgb(28, 140, " +
            "244) 90%, rgb(219, 234, 254))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "ellipse",
          i: 4,
          cx: 291.36,
          cy: 179.68,
          rx: 0.5,
          ry: 3,
          fill:
            "color-mix(in oklch, rgb(28, 140, " +
            "244) 60%, rgb(219, 234, 254))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "ellipse",
          i: 5,
          cx: 322.72,
          cy: 163.84,
          rx: 0.5,
          ry: 3,
          fill:
            "color-mix(in oklch, rgb(30, 58, " +
            "138) 10.000000000000009%, rgb(28, " +
            "140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "ellipse",
          i: 6,
          cx: 373.68,
          cy: 221.92,
          rx: 0.5,
          ry: 3,
          fill:
            "color-mix(in oklch, rgb(28, 140, " +
            "244) 40%, rgb(219, 234, 254))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "ellipse",
          i: 7,
          cx: 420.72,
          cy: 237.76,
          rx: 0.5,
          ry: 3,
          fill:
            "color-mix(in oklch, rgb(28, 140, " +
            "244) 25%, rgb(219, 234, 254))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
      ],
    },
    {
      widget: "",
      tag: "hdml-legend",
      role: "guide",
      box: {
        x: 448,
        y: 24,
        w: 0,
        h: 256,
      },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: false,
      clipPath: null,
      nodes: [
        {
          k: "rect",
          i: -1,
          x: 448,
          y: 24,
          w: 10,
          h: 8,
          fill:
            "color-mix(in oklch, rgb(28, 140, " +
            "244) 3.125%, rgb(219, 234, 254))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 448,
          y: 32,
          w: 10,
          h: 8,
          fill:
            "color-mix(in oklch, rgb(28, 140, " +
            "244) 9.375%, rgb(219, 234, 254))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 448,
          y: 40,
          w: 10,
          h: 8,
          fill:
            "color-mix(in oklch, rgb(28, 140, " +
            "244) 15.625%, rgb(219, 234, 254))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 448,
          y: 48,
          w: 10,
          h: 8,
          fill:
            "color-mix(in oklch, rgb(28, 140, " +
            "244) 21.875%, rgb(219, 234, 254))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 448,
          y: 56,
          w: 10,
          h: 8,
          fill:
            "color-mix(in oklch, rgb(28, 140, " +
            "244) 28.125%, rgb(219, 234, 254))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 448,
          y: 64,
          w: 10,
          h: 8,
          fill:
            "color-mix(in oklch, rgb(28, 140, " +
            "244) 34.375%, rgb(219, 234, 254))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 448,
          y: 72,
          w: 10,
          h: 8,
          fill:
            "color-mix(in oklch, rgb(28, 140, " +
            "244) 40.625%, rgb(219, 234, 254))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 448,
          y: 80,
          w: 10,
          h: 8,
          fill:
            "color-mix(in oklch, rgb(28, 140, " +
            "244) 46.875%, rgb(219, 234, 254))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 448,
          y: 88,
          w: 10,
          h: 8,
          fill:
            "color-mix(in oklch, rgb(28, 140, " +
            "244) 53.125%, rgb(219, 234, 254))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 448,
          y: 96,
          w: 10,
          h: 8,
          fill:
            "color-mix(in oklch, rgb(28, 140, " +
            "244) 59.375%, rgb(219, 234, 254))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 448,
          y: 104,
          w: 10,
          h: 8,
          fill:
            "color-mix(in oklch, rgb(28, 140, " +
            "244) 65.625%, rgb(219, 234, 254))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 448,
          y: 112,
          w: 10,
          h: 8,
          fill:
            "color-mix(in oklch, rgb(28, 140, " +
            "244) 71.875%, rgb(219, 234, 254))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 448,
          y: 120,
          w: 10,
          h: 8,
          fill:
            "color-mix(in oklch, rgb(28, 140, " +
            "244) 78.125%, rgb(219, 234, 254))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 448,
          y: 128,
          w: 10,
          h: 8,
          fill:
            "color-mix(in oklch, rgb(28, 140, " +
            "244) 84.375%, rgb(219, 234, 254))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 448,
          y: 136,
          w: 10,
          h: 8,
          fill:
            "color-mix(in oklch, rgb(28, 140, " +
            "244) 90.625%, rgb(219, 234, 254))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 448,
          y: 144,
          w: 10,
          h: 8,
          fill:
            "color-mix(in oklch, rgb(28, 140, " +
            "244) 96.875%, rgb(219, 234, 254))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 448,
          y: 152,
          w: 10,
          h: 8,
          fill:
            "color-mix(in oklch, rgb(30, 58, " +
            "138) 3.125%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 448,
          y: 160,
          w: 10,
          h: 8,
          fill:
            "color-mix(in oklch, rgb(30, 58, " +
            "138) 9.375%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 448,
          y: 168,
          w: 10,
          h: 8,
          fill:
            "color-mix(in oklch, rgb(30, 58, " +
            "138) 15.625%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 448,
          y: 176,
          w: 10,
          h: 8,
          fill:
            "color-mix(in oklch, rgb(30, 58, " +
            "138) 21.875%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 448,
          y: 184,
          w: 10,
          h: 8,
          fill:
            "color-mix(in oklch, rgb(30, 58, " +
            "138) 28.125%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 448,
          y: 192,
          w: 10,
          h: 8,
          fill:
            "color-mix(in oklch, rgb(30, 58, " +
            "138) 34.375%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 448,
          y: 200,
          w: 10,
          h: 8,
          fill:
            "color-mix(in oklch, rgb(30, 58, " +
            "138) 40.625%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 448,
          y: 208,
          w: 10,
          h: 8,
          fill:
            "color-mix(in oklch, rgb(30, 58, " +
            "138) 46.875%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 448,
          y: 216,
          w: 10,
          h: 8,
          fill:
            "color-mix(in oklch, rgb(30, 58, " +
            "138) 53.125%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 448,
          y: 224,
          w: 10,
          h: 8,
          fill:
            "color-mix(in oklch, rgb(30, 58, " +
            "138) 59.375%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 448,
          y: 232,
          w: 10,
          h: 8,
          fill:
            "color-mix(in oklch, rgb(30, 58, " +
            "138) 65.625%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 448,
          y: 240,
          w: 10,
          h: 8,
          fill:
            "color-mix(in oklch, rgb(30, 58, " +
            "138) 71.875%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 448,
          y: 248,
          w: 10,
          h: 8,
          fill:
            "color-mix(in oklch, rgb(30, 58, " +
            "138) 78.125%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 448,
          y: 256,
          w: 10,
          h: 8,
          fill:
            "color-mix(in oklch, rgb(30, 58, " +
            "138) 84.375%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 448,
          y: 264,
          w: 10,
          h: 8,
          fill:
            "color-mix(in oklch, rgb(30, 58, " +
            "138) 90.625%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: -1,
          x: 448,
          y: 272,
          w: 10,
          h: 8,
          fill:
            "color-mix(in oklch, rgb(30, 58, " +
            "138) 96.875%, rgb(28, 140, 244))",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "text",
          i: -1,
          x: 462,
          y: 24,
          text: "0",
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
          x: 462,
          y: 88,
          text: "10",
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
          x: 462,
          y: 152,
          text: "20",
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
          x: 462,
          y: 216,
          text: "30",
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
          x: 462,
          y: 280,
          text: "40",
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
  ],
};

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
    {
      widget: "",
      tag: "hdml-legend",
      role: "guide",
      box: {
        x: 448,
        y: 24,
        w: 0,
        h: 256,
      },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: false,
      clipPath: null,
      nodes: [
        {
          k: "rect",
          i: -1,
          x: 448,
          y: 24,
          w: 10,
          h: 10,
          fill: "rgb(28, 140, 244)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "text",
          i: -1,
          x: 462,
          y: 29,
          text: "Alpha",
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
          k: "rect",
          i: -1,
          x: 448,
          y: 38,
          w: 10,
          h: 10,
          fill: "rgb(245, 158, 11)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "text",
          i: -1,
          x: 462,
          y: 43,
          text: "Beta",
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
          k: "rect",
          i: -1,
          x: 448,
          y: 52,
          w: 10,
          h: 10,
          fill: "rgb(16, 185, 129)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "text",
          i: -1,
          x: 462,
          y: 57,
          text: "Gamma",
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
  ],
};
