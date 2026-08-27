/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import "../index";
import type { Scene } from "../scene";
import type { HdvlElement } from "../base";
import type { HdmlViewElement } from "../view";
import { FakeIo, mountFakeIo } from "../../testing/FakeIo";
import {
  DEFERRED_TO_SLICE_H,
  ENGINE,
  assertRenders,
  goldenOf,
  mountCorpus,
  negativeZeros,
  nodeCount,
  numberCol,
  pageSource,
  result,
  stringCol,
  stripText,
} from "../../testing/corpus";
import {
  installSceneRecorder,
  restoreRenderers,
  sceneOf,
} from "../../testing/scene-of";
import { scaleOf } from "../scale";
import { tickSpecOf } from "../guide-spec";

/**
 * ★ **`11-multi-plane` — the thirteenth page, and the only one
 * whose subject is the *view* rather than a widget** (RFC §10.1 I,
 * SPEC §4.8).
 *
 * Every other corpus page has one plane per view. This one has
 * **three** side by side in A and **two overlapping** in B, and its
 * whole claim is §4.8's: *"a plane contributes no dimension — it is
 * the geometric anchor the scale chains build their spaces in.
 * Scales never cross a plane boundary; data and domains do."*
 * Nothing in `src/hdvl/` was written for it — `resolve.ts` walks
 * view → plane → chain → tip and has always allowed siblings at the
 * plane level — and that prediction is what this gate measures.
 *
 * ★ **It is also the corpus's one query-coalescing page.** Both
 * views declare `source` on the **`hdml-view`** and no plane
 * repeats it, so three planes (A) and two (B) inherit one ref.
 * `subscribe.ts` keys a subscription by the binding **site**, so
 * the registry holds one entry per bound slot — twelve for A — and
 * what coalesces is the **ref**: one, which is what "one query"
 * names. The gate asserts both numbers rather than either alone.
 *
 * ★ **Neither view declares a legend**, so `DEFERRED_TO_SLICE_H` is
 * not needed here — checked against the document rather than
 * assumed, and asserted empty besides.
 *
 * ★ **A is quantized to two decimals, not rule 3's six.** It is the
 * first corpus view whose geometry is **not** engine-identical: the
 * panels are sized `width: 33.333%`, and a used width is snapped to
 * the engine's own layout unit — 1/64 px in Blink and WebKit,
 * 1/60 px in Gecko — so `259.9974` resolves to `259.984375` on two
 * engines and `259.983337` on the third. Measured across the whole
 * scene the worst disagreement is **2.1 × 10⁻³ px**, and every
 * number agrees at two decimals, which is 1/100 of a CSS px and
 * finer than a device pixel at any device-pixel ratio. B and every
 * other gated view stay at six: this is a property of a
 * **fractional percentage**, not of multiple planes. See
 * `docs/decisions.md`.
 */

/** A's ref — the same wide frame `04-grouped-stacked` reads. */
const REF_A = "?hdml-frame=regional_m";

/** B's ref — the monthly frame `07-mixed` reads. */
const REF_B = "?hdml-frame=monthly_perf";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
const NORTH = [620000, 580000, 700000, 660000, 740000, 710000];
const SOUTH = [450000, 690000, 520000, 490000, 730000, 610000];
const EAST = [310000, 360000, 780000, 420000, 450000, 480000];

/**
 * `GREATEST(north, south, east)` per row — the page's own SQL, and
 * the shared panel domain. Each region tops at least one month, so
 * the column is not a copy of any series.
 */
const SERIES_MAX = [620000, 690000, 780000, 660000, 740000, 710000];

const MONTH_NUM = [1, 2, 3, 4, 5, 6];
const REVENUE = [820000, 910000, 1040000, 980000, 1150000, 1220000];
const MARGIN = [0.18, 0.22, 0.19, 0.25, 0.28, 0.31];

/** The view's own width, which the panels take thirds of. */
const VIEW_W = 780;

/** The panels' `padding`, left and right, from the page. */
const PAD_LEFT = 44;
const PAD_RIGHT = 12;

/** The three panel classes, in document order. */
const PANELS = ["north", "south", "east"];

/** The thirds each panel's class declares. */
const OFFSETS = [0, 0.33333, 0.66666];

/** A's quantization — see the header. */
const P2 = { precision: 2 };

/** The harness call a gate mounts a page with. */
const CALL = "mountCorpus";

/** The thirteen committed pages, and the suite that mounts each. */
const CORPUS: readonly (readonly [string, string])[] = [
  ["00-minimal", "page-00"],
  ["01-line", "page-01"],
  ["02-area", "page-02"],
  ["03-bar", "page-03"],
  ["04-grouped-stacked", "page-04"],
  ["05-scatter", "page-05"],
  ["06-bubble", "page-06"],
  ["07-mixed", "page-07"],
  ["08-pie-doughnut", "page-08"],
  ["09-polar-area", "page-09"],
  ["10-radar", "page-10"],
  ["11-multi-plane", "page-11"],
  ["12-coverage", "page-12"],
];

/** A's comparable scene — two decimals, `widget` blanked. */
function goldenA(view: HdmlViewElement): Scene {
  const scene = sceneOf(view, P2);
  return {
    ...scene,
    groups: scene.groups.map((g) => ({ ...g, widget: "" })),
  };
}

/** One element under a view, narrowed. */
function el(view: HdmlViewElement, sel: string): HdvlElement {
  const hit = view.querySelector(sel);
  assert.isNotNull(hit);
  return <HdvlElement>(<unknown>hit);
}

/** A scale element's resolved `Scale`. */
function scale(
  view: HdmlViewElement,
  sel: string,
): ReturnType<typeof scaleOf> {
  return scaleOf(el(view, sel));
}

/** Every group a panel's own elements emitted, in scene order. */
function panelGroups(
  view: HdmlViewElement,
  panel: string,
): { tag: string; n: number }[] {
  const uids = new Set(
    Array.from(view.querySelectorAll(`.${panel} *`)).map(
      (e) => (<HdvlElement>(<unknown>e)).uid,
    ),
  );
  return sceneOf(view)
    .groups.filter((g) => uids.has(g.widget))
    .map((g) => ({ tag: g.tag, n: g.nodes.length }));
}

function seed(): FakeIo {
  return mountFakeIo({
    [REF_A]: result(6, {
      month: stringCol(MONTHS),
      north: numberCol(NORTH),
      south: numberCol(SOUTH),
      east: numberCol(EAST),
      series_max: numberCol(SERIES_MAX),
      month_num: numberCol(MONTH_NUM),
    }),
    [REF_B]: result(6, {
      month: stringCol(MONTHS),
      revenue: numberCol(REVENUE),
      margin: numberCol(MARGIN),
      month_num: numberCol(MONTH_NUM),
    }),
  });
}

suite("corpus 11-multi-plane (A, small multiples)", () => {
  let io: FakeIo;

  setup(() => {
    installSceneRecorder();
    io = seed();
  });

  teardown(() => {
    restoreRenderers();
  });

  test("★ two views, and three planes in A", async () => {
    const page = await mountCorpus("11-multi-plane");
    assert.lengthOf(page.views, 2);
    assert.strictEqual(page.removedIo, 1);
    assert.strictEqual(page.sheets, 1);
    const a = page.views[0];
    assert.lengthOf(a.querySelectorAll("hdml-cartesian-plane"), 3);
    assert.lengthOf(page.views[1].children, 2);
    // Nothing here is deferred: the page declares no legend at all.
    assert.isEmpty(DEFERRED_TO_SLICE_H);
    assert.lengthOf(page.root.querySelectorAll("hdml-legend"), 0);
    assertRenders(a);
    assert.isAbove(io.subscriptions.length, 0);
  });

  test("★ three panels, three boxes", async () => {
    // The first view in the project with siblings at the PLANE
    // level. `resolve.ts` walks view → plane → chain → tip, so
    // three planes are three chains and three mark groups — and
    // each panel's plot box is its own third of the view, inset by
    // the padding its class declares.
    const page = await mountCorpus("11-multi-plane");
    const scene = goldenA(page.views[0]);
    const bars = scene.groups.filter((g) => g.tag === "hdml-bar");
    assert.lengthOf(bars, 3);
    // `33.333%`, which is the page's number — not `1 / 3`, which
    // is 2.6 × 10⁻³ px away from it and would need a looser
    // tolerance than the engine disagreement itself.
    const width = VIEW_W * OFFSETS[1] - PAD_LEFT - PAD_RIGHT;
    bars.forEach((g, k) => {
      assert.closeTo(g.box.w, width, 0.02);
      assert.closeTo(g.box.x, OFFSETS[k] * VIEW_W + PAD_LEFT, 0.02);
      assert.strictEqual(g.box.y, bars[0].box.y);
      assert.strictEqual(g.box.h, bars[0].box.h);
    });
    // Three DIFFERENT boxes, which is the claim a shared domain
    // would otherwise hide.
    assert.isAbove(bars[1].box.x, bars[0].box.x);
    assert.isAbove(bars[2].box.x, bars[1].box.x);
  });

  test("★ one domain, three ranges", async () => {
    // §4.8, both halves. The three y scales are three objects in
    // three planes and their domains are byte-identical, because
    // all three read `values="series_max"` — the page's own
    // caption, *"cross-panel comparability is explicit, never
    // inferred"*. The three x scales' RANGES are three different
    // intervals, because a range is its plane's geometry and
    // cannot cross a boundary.
    const page = await mountCorpus("11-multi-plane");
    const a = page.views[0];
    const ys = PANELS.map((c) =>
      scale(a, `.${c} hdml-continuous-scale`),
    );
    const domains = ys.map((s) => JSON.stringify(s?.domain()));
    assert.strictEqual(domains[1], domains[0]);
    assert.strictEqual(domains[2], domains[0]);
    assert.deepEqual(ys[0]?.domain()?.extent, [0, 800000]);
    const xs = PANELS.map((c) =>
      scale(a, `.${c} hdml-ordinal-scale`),
    );
    const ranges = xs.map((s) => JSON.stringify(s?.range()));
    assert.notStrictEqual(ranges[1], ranges[0]);
    assert.notStrictEqual(ranges[2], ranges[1]);
    // …and each range IS its own plane's plot box, edge for edge.
    const bars = goldenA(a).groups.filter(
      (g) => g.tag === "hdml-bar",
    );
    xs.forEach((s, k) => {
      const range = s?.range() ?? [NaN, NaN];
      assert.closeTo(range[0], bars[k].box.x, 0.01);
      assert.closeTo(range[1], bars[k].box.x + bars[k].box.w, 0.01);
    });
    // The y ranges DO coincide — the panels differ only in x — so
    // the range half of §4.8 is asserted on x, deliberately.
    assert.deepEqual(ys[1]?.range(), ys[0]?.range());
  });

  test("★ a panel's guide stays in its panel", async () => {
    // The `north` panel writes a y axis and a y label; `south` and
    // `east` write neither. An inherited guide would look like a
    // nicer chart, so the difference is asserted in exactly that
    // shape — from the document AND from the scene.
    const page = await mountCorpus("11-multi-plane");
    const a = page.views[0];
    assert.lengthOf(a.querySelectorAll(".north hdml-axis"), 2);
    assert.lengthOf(a.querySelectorAll(".south hdml-axis"), 1);
    assert.lengthOf(a.querySelectorAll(".east hdml-axis"), 1);
    assert.lengthOf(
      a.querySelectorAll('.north hdml-label[channel="y"]'),
      1,
    );
    assert.lengthOf(
      a.querySelectorAll('.south hdml-label[channel="y"]'),
      0,
    );
    assert.deepEqual(
      panelGroups(a, "north").map((g) => g.tag),
      [
        "hdml-axis",
        "hdml-axis",
        "hdml-label",
        "hdml-label",
        "hdml-bar",
      ],
    );
    ["south", "east"].forEach((c) => {
      assert.deepEqual(
        panelGroups(a, c).map((g) => g.tag),
        ["hdml-axis", "hdml-label", "hdml-bar"],
      );
    });
  });

  test("★ count is a target, never a promise", async () => {
    // The y label writes `count="4"` and paints five: §4.8's
    // ladder answers with its own multiples of `{1, 2, 5} × 10ⁿ`
    // over the resolved domain, and the count only chooses which
    // rung. Asserted against the scale's own `ticks(spec)`, never
    // against a transcribed five.
    const page = await mountCorpus("11-multi-plane");
    const a = page.views[0];
    const label = el(a, '.north hdml-label[channel="y"]');
    const spec = tickSpecOf(label);
    assert.strictEqual(spec.count, 4);
    const ticks =
      scale(a, ".north hdml-continuous-scale")?.ticks(spec) ?? [];
    const group = panelGroups(a, "north")[3];
    assert.strictEqual(group.tag, "hdml-label");
    assert.strictEqual(group.n, ticks.length);
    assert.notStrictEqual(ticks.length, spec.count);
  });

  test("★ one source on the view, one ref", async () => {
    // §4.8's coalescing claim is about REFS. The document says it
    // once: `source` is on the view and no plane repeats it. The
    // registry then holds one entry per binding SITE — twelve, six
    // distinct column reads — over exactly one ref, which is what
    // makes three panels one query.
    const src = await pageSource("11-multi-plane");
    assert.match(src, /<hdml-view source="\?hdml-frame=regional_m"/);
    const page = await mountCorpus("11-multi-plane");
    const a = page.views[0];
    assert.lengthOf(a.querySelectorAll("[source]"), 0);
    assert.isTrue(a.hasAttribute("source"));
    const mine = io.subscriptions.filter((s) => s.ref === REF_A);
    assert.lengthOf(mine, 12);
    const pairs = new Set(mine.map((s) => `${s.column}:${s.raw}`));
    assert.strictEqual(pairs.size, 6);
    assert.lengthOf(new Set(mine.map((s) => s.ref)), 1);
    // The page as a whole: two views, two refs, nineteen sites.
    assert.lengthOf(io.subscriptions, 19);
    assert.deepEqual(
      [...new Set(io.subscriptions.map((s) => s.ref))],
      [REF_A, REF_B],
    );
  });

  test("the golden holds on every engine", async () => {
    const page = await mountCorpus("11-multi-plane");
    assert.deepEqual(
      stripText(goldenA(page.views[0])),
      stripText(GOLDEN_A),
    );
  });

  test("the text holds on chromium", async () => {
    assert.notStrictEqual(ENGINE, "unclassified");
    if (ENGINE !== "chromium") {
      return;
    }
    const page = await mountCorpus("11-multi-plane");
    assert.deepEqual(goldenA(page.views[0]), GOLDEN_A);
  });

  test("it round-trips, is -0 free and fits", async () => {
    const page = await mountCorpus("11-multi-plane");
    const view = page.views[0];
    const scene = goldenA(view);
    assert.deepEqual(structuredClone(scene), scene);
    assert.deepEqual(negativeZeros(sceneOf(view)), []);
    // Eleven groups: four guides and a bar for `north`, two guides
    // and a bar for each of the other two.
    assert.lengthOf(scene.groups, 11);
    assert.strictEqual(nodeCount(scene), 45);
    assert.isBelow(nodeCount(scene), 20000);
  });
});

/**
 * ★ **`11-multi-plane` B — two plot regions on one canvas, which
 * is not `07-mixed`'s two coordinate systems on one** (SPEC §4.8).
 *
 * `07`'s dual axis is two sibling y scales under **one** plane: one
 * plot region, two domains, and a month lands on one x for both.
 * Here the two planes have their own boxes — the context is
 * full-bleed (`padding: 0`), the detail is padded — so the same
 * category projects to two different pixels and each plane carries
 * its own guides. The gate asserts that difference numerically,
 * which is the only way to tell the two constructions apart from a
 * scene.
 *
 * ★ **Document order is paint order across planes**, which §1.1 has
 * only ever been asserted for widgets inside one chain. The detail
 * plane is written second, so its groups follow the context's.
 */

/** B's index in the page's two views. */
const OVERLAY = 1;

suite("corpus 11-multi-plane (B, overlay)", () => {
  setup(() => {
    installSceneRecorder();
    seed();
  });

  teardown(() => {
    restoreRenderers();
  });

  test("★ B renders two planes, one canvas", async () => {
    const page = await mountCorpus("11-multi-plane");
    const b = page.views[OVERLAY];
    assert.lengthOf(b.querySelectorAll("hdml-cartesian-plane"), 2);
    assertRenders(b);
    const scene = goldenOf(b);
    const area = scene.groups.filter((g) => g.tag === "hdml-area")[0];
    const line = scene.groups.filter((g) => g.tag === "hdml-line")[0];
    // The context is full-bleed and the detail is padded: two
    // boxes, and neither is the other's.
    assert.deepEqual(area.box, {
      x: 0,
      y: 0,
      w: VIEW_W,
      h: scene.height,
    });
    assert.isAbove(line.box.x, area.box.x);
    assert.isBelow(line.box.w, area.box.w);
  });

  test("★ one month, two x positions", async () => {
    // The claim `07-mixed` cannot make. Two planes are two
    // geometries, so the same ordinal value resolves to two
    // different pixels — and each is its own plane's band centre,
    // read back off the scale rather than off the golden.
    const page = await mountCorpus("11-multi-plane");
    const b = page.views[OVERLAY];
    const ctx = scale(b, ".context hdml-ordinal-scale");
    const det = scale(b, ".detail hdml-ordinal-scale");
    assert.deepEqual(ctx?.domain(), det?.domain());
    assert.notDeepEqual(ctx?.range(), det?.range());
    MONTHS.forEach((m) => {
      assert.notStrictEqual(
        ctx?.bandOf(m)?.centre,
        det?.bandOf(m)?.centre,
      );
    });
    // …and the two y scales are unrelated: revenue against margin.
    assert.deepEqual(
      scale(b, ".context hdml-continuous-scale")?.domain()?.extent,
      [0, 1220000],
    );
    assert.deepEqual(
      scale(b, ".detail hdml-continuous-scale")?.domain()?.extent,
      [0, 0.4],
    );
  });

  test("★ document order is paint order", async () => {
    // Across PLANES, not just widgets: the detail plane is written
    // second, so every group it owns follows every group the
    // context owns. Nothing sorts — `resolve.ts` lists a view's
    // elements in document order and `schedule.ts` walks that list.
    const page = await mountCorpus("11-multi-plane");
    const tags = goldenOf(page.views[OVERLAY]).groups.map(
      (g) => g.tag,
    );
    assert.deepEqual(tags, [
      "hdml-area",
      "hdml-axis",
      "hdml-axis",
      "hdml-label",
      "hdml-label",
      "hdml-line",
    ]);
  });

  test("★ bandwidth 0 is point placement", async () => {
    // `--hdml-bandwidth: 0` on `hdml-ordinal-scale.points` — the
    // polyline idiom. §4.4's denominator is `n − 1 + b`, so at
    // `b = 0` a band has no width and its centre IS its boundary:
    // the first category lands on the range's start and the last
    // on its end. Correct here because nothing on this page fills
    // a band; on a bar it would stack every rect on a line.
    const page = await mountCorpus("11-multi-plane");
    const b = page.views[OVERLAY];
    const ctx = scale(b, ".context hdml-ordinal-scale");
    const range = ctx?.range() ?? [NaN, NaN];
    MONTHS.forEach((m) => {
      const band = ctx?.bandOf(m);
      assert.strictEqual(band?.width, 0);
      assert.strictEqual(band?.centre, band?.start);
    });
    assert.strictEqual(ctx?.bandOf(MONTHS[0])?.centre, range[0]);
    assert.strictEqual(ctx?.bandOf(MONTHS[5])?.centre, range[1]);
    // …and the line's vertices sit on the DETAIL plane's centres.
    const det = scale(b, ".detail hdml-ordinal-scale");
    const line = goldenOf(b).groups.filter(
      (g) => g.tag === "hdml-line",
    )[0].nodes[0];
    assert.strictEqual(line.k, "path");
    const vertices = line.k === "path" ? line.vertices : [];
    assert.lengthOf(vertices, MONTHS.length);
    vertices.forEach((v, i) => {
      assert.strictEqual(v.x, det?.bandOf(MONTHS[i])?.centre);
    });
  });

  test("★ two curve types in one view", async () => {
    // §6.2's segment kinds, on a page: `step` emits `line`
    // segments and `monotone` emits `cubic` ones, so the two
    // marks' paths are structurally different and the CSS that
    // says so is scoped by plane class.
    const page = await mountCorpus("11-multi-plane");
    const scene = goldenOf(page.views[OVERLAY]);
    const area = scene.groups.filter((g) => g.tag === "hdml-area")[0]
      .nodes[0];
    const line = scene.groups.filter((g) => g.tag === "hdml-line")[0]
      .nodes[0];
    assert.strictEqual(area.k, "path");
    assert.strictEqual(line.k, "path");
    const kinds = (n: typeof area): string[] =>
      n.k === "path"
        ? n.subpaths.flatMap((s) => s.segments.map((g) => g.k))
        : [];
    assert.deepEqual([...new Set(kinds(area))], ["line"]);
    assert.deepEqual([...new Set(kinds(line))], ["cubic"]);
    // The area closes over both edges; the line does not close.
    assert.isTrue(area.k === "path" && area.closed);
    assert.isFalse(line.k === "path" && line.closed);
  });

  test("the golden holds on every engine", async () => {
    const page = await mountCorpus("11-multi-plane");
    assert.deepEqual(
      stripText(goldenOf(page.views[OVERLAY])),
      stripText(GOLDEN_B),
    );
  });

  test("the text holds on chromium", async () => {
    assert.notStrictEqual(ENGINE, "unclassified");
    if (ENGINE !== "chromium") {
      return;
    }
    const page = await mountCorpus("11-multi-plane");
    assert.deepEqual(goldenOf(page.views[OVERLAY]), GOLDEN_B);
  });

  test("it round-trips, is -0 free and fits", async () => {
    const page = await mountCorpus("11-multi-plane");
    const view = page.views[OVERLAY];
    const scene = goldenOf(view);
    assert.deepEqual(structuredClone(scene), scene);
    assert.deepEqual(negativeZeros(sceneOf(view)), []);
    assert.strictEqual(nodeCount(scene), 15);
    assert.isBelow(nodeCount(scene), 20000);
  });
});

/**
 * ★ **The corpus is closed** (RFC §10.1).
 *
 * With `11-multi-plane` gated, every page under `html/hdvl/` is
 * mounted by a suite under `src/hdvl/corpus/`. The claim is
 * asserted rather than written down: each page is fetched (a
 * missing one is a 404 and throws) and each suite's **source** is
 * fetched off the runner's own static serving and searched for the
 * `mountCorpus` call that names that page.
 *
 * What it cannot do is discover a **fourteenth** page: the runner
 * serves no directory index (`/html/hdvl/` is a 404, measured), so
 * the list of thirteen is a literal here exactly as it is a count
 * in `CLAUDE.md` and in the corpus README. A page added without a
 * gate would have to be added to this list too — which is the same
 * hand step, in a place a test fails from.
 */
suite("corpus (the set is closed)", () => {
  test("★ thirteen pages, and each has a gate", async () => {
    assert.lengthOf(CORPUS, 13);
    for (const [name, suiteFile] of CORPUS) {
      const page = await pageSource(name);
      assert.match(page, /<hdml-view/);
      const res = await fetch(
        `/src/hdvl/corpus/${suiteFile}.test.ts`,
      );
      assert.isTrue(res.ok, `${suiteFile} is not served`);
      const src = await res.text();
      // The function's name is a constant, never spelled next to
      // an open paren: this file's own source is one of the
      // thirteen the second test below scans, so a needle written
      // literally would BE a call site in it.
      assert.include(src, `${CALL}(${JSON.stringify(name)})`);
    }
  });

  test("★ every gate names exactly one page", async () => {
    // A suite that mounted two pages would make the mapping above
    // pass while leaving a page ungated somewhere else.
    for (const [name, suiteFile] of CORPUS) {
      const res = await fetch(
        `/src/hdvl/corpus/${suiteFile}.test.ts`,
      );
      const src = await res.text();
      const mounted = new Set(
        [...src.matchAll(/mountCorpus\("([^"]+)"\)/g)].map(
          (m) => m[1],
        ),
      );
      assert.deepEqual([...mounted], [name]);
    }
  });
});

const GOLDEN_A: Scene = {
  width: 780,
  height: 280,
  groups: [
    {
      widget: "",
      tag: "hdml-axis",
      role: "guide",
      box: { x: 44, y: 248, w: 203.98, h: 24 },
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
              start: { x: 44, y: 248 },
              segments: [{ k: "line", to: { x: 247.98, y: 248 } }],
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
      box: { x: 44, y: 16, w: 40, h: 232 },
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
              start: { x: 84, y: 248 },
              segments: [{ k: "line", to: { x: 84, y: 16 } }],
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
      box: { x: 44, y: 248, w: 203.98, h: 24 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: false,
      clipPath: null,
      nodes: [
        {
          k: "text",
          i: -1,
          x: 58.07,
          y: 248,
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
          x: 93.24,
          y: 248,
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
          x: 128.41,
          y: 248,
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
          x: 163.58,
          y: 248,
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
          x: 198.75,
          y: 248,
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
          x: 233.92,
          y: 248,
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
      tag: "hdml-label",
      role: "guide",
      box: { x: 4, y: 16, w: 40, h: 232 },
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
          y: 248,
          text: "0K",
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
          x: 44,
          y: 190,
          text: "200K",
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
          x: 44,
          y: 132,
          text: "400K",
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
          x: 44,
          y: 74,
          text: "600K",
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
          x: 44,
          y: 16,
          text: "800K",
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
      box: { x: 44, y: 16, w: 203.98, h: 232 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: true,
      clipPath: null,
      nodes: [
        {
          k: "rect",
          i: 0,
          x: 44,
          y: 68.2,
          w: 28.14,
          h: 179.8,
          fill: "rgb(28, 140, 244)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 1,
          x: 79.17,
          y: 79.8,
          w: 28.14,
          h: 168.2,
          fill: "rgb(28, 140, 244)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 2,
          x: 114.34,
          y: 45,
          w: 28.14,
          h: 203,
          fill: "rgb(28, 140, 244)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 3,
          x: 149.51,
          y: 56.6,
          w: 28.14,
          h: 191.4,
          fill: "rgb(28, 140, 244)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 4,
          x: 184.68,
          y: 33.4,
          w: 28.14,
          h: 214.6,
          fill: "rgb(28, 140, 244)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 5,
          x: 219.85,
          y: 42.1,
          w: 28.14,
          h: 205.9,
          fill: "rgb(28, 140, 244)",
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
      box: { x: 303.98, y: 248, w: 203.98, h: 24 },
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
              start: { x: 303.98, y: 248 },
              segments: [{ k: "line", to: { x: 507.97, y: 248 } }],
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
      box: { x: 303.98, y: 248, w: 203.98, h: 24 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: false,
      clipPath: null,
      nodes: [
        {
          k: "text",
          i: -1,
          x: 318.05,
          y: 248,
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
          x: 353.22,
          y: 248,
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
          x: 388.39,
          y: 248,
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
          x: 423.56,
          y: 248,
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
          x: 458.73,
          y: 248,
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
          x: 493.9,
          y: 248,
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
      tag: "hdml-bar",
      role: "mark",
      box: { x: 303.98, y: 16, w: 203.98, h: 232 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: true,
      clipPath: null,
      nodes: [
        {
          k: "rect",
          i: 0,
          x: 303.98,
          y: 117.5,
          w: 28.14,
          h: 130.5,
          fill: "rgb(245, 158, 11)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 1,
          x: 339.15,
          y: 47.9,
          w: 28.14,
          h: 200.1,
          fill: "rgb(245, 158, 11)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 2,
          x: 374.32,
          y: 97.2,
          w: 28.14,
          h: 150.8,
          fill: "rgb(245, 158, 11)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 3,
          x: 409.49,
          y: 105.9,
          w: 28.14,
          h: 142.1,
          fill: "rgb(245, 158, 11)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 4,
          x: 444.66,
          y: 36.3,
          w: 28.14,
          h: 211.7,
          fill: "rgb(245, 158, 11)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 5,
          x: 479.83,
          y: 71.1,
          w: 28.14,
          h: 176.9,
          fill: "rgb(245, 158, 11)",
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
      box: { x: 563.98, y: 248, w: 203.98, h: 24 },
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
              start: { x: 563.98, y: 248 },
              segments: [{ k: "line", to: { x: 767.97, y: 248 } }],
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
      box: { x: 563.98, y: 248, w: 203.98, h: 24 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: false,
      clipPath: null,
      nodes: [
        {
          k: "text",
          i: -1,
          x: 578.05,
          y: 248,
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
          x: 613.22,
          y: 248,
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
          x: 648.39,
          y: 248,
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
          x: 683.56,
          y: 248,
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
          x: 718.73,
          y: 248,
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
          x: 753.9,
          y: 248,
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
      tag: "hdml-bar",
      role: "mark",
      box: { x: 563.98, y: 16, w: 203.98, h: 232 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: true,
      clipPath: null,
      nodes: [
        {
          k: "rect",
          i: 0,
          x: 563.98,
          y: 158.1,
          w: 28.14,
          h: 89.9,
          fill: "rgb(16, 185, 129)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 1,
          x: 599.15,
          y: 143.6,
          w: 28.14,
          h: 104.4,
          fill: "rgb(16, 185, 129)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 2,
          x: 634.32,
          y: 21.8,
          w: 28.14,
          h: 226.2,
          fill: "rgb(16, 185, 129)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 3,
          x: 669.49,
          y: 126.2,
          w: 28.14,
          h: 121.8,
          fill: "rgb(16, 185, 129)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 4,
          x: 704.66,
          y: 117.5,
          w: 28.14,
          h: 130.5,
          fill: "rgb(16, 185, 129)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
        {
          k: "rect",
          i: 5,
          x: 739.83,
          y: 108.8,
          w: 28.14,
          h: 139.2,
          fill: "rgb(16, 185, 129)",
          stroke: null,
          strokeWidth: 0,
          dash: null,
        },
      ],
    },
  ],
};

const GOLDEN_B: Scene = {
  width: 780,
  height: 280,
  groups: [
    {
      widget: "",
      tag: "hdml-area",
      role: "mark",
      box: { x: 0, y: 0, w: 780, h: 280 },
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
              start: { x: 0, y: 91.803279 },
              segments: [
                { k: "line", to: { x: 78, y: 91.803279 } },
                { k: "line", to: { x: 78, y: 71.147541 } },
                { k: "line", to: { x: 156, y: 71.147541 } },
                { k: "line", to: { x: 234, y: 71.147541 } },
                { k: "line", to: { x: 234, y: 41.311475 } },
                { k: "line", to: { x: 312, y: 41.311475 } },
                { k: "line", to: { x: 390, y: 41.311475 } },
                { k: "line", to: { x: 390, y: 55.081967 } },
                { k: "line", to: { x: 468, y: 55.081967 } },
                { k: "line", to: { x: 546, y: 55.081967 } },
                { k: "line", to: { x: 546, y: 16.065574 } },
                { k: "line", to: { x: 624, y: 16.065574 } },
                { k: "line", to: { x: 702, y: 16.065574 } },
                { k: "line", to: { x: 702, y: 0 } },
                { k: "line", to: { x: 780, y: 0 } },
                { k: "line", to: { x: 780, y: 280 } },
                { k: "line", to: { x: 702, y: 280 } },
                { k: "line", to: { x: 702, y: 280 } },
                { k: "line", to: { x: 624, y: 280 } },
                { k: "line", to: { x: 546, y: 280 } },
                { k: "line", to: { x: 546, y: 280 } },
                { k: "line", to: { x: 468, y: 280 } },
                { k: "line", to: { x: 390, y: 280 } },
                { k: "line", to: { x: 390, y: 280 } },
                { k: "line", to: { x: 312, y: 280 } },
                { k: "line", to: { x: 234, y: 280 } },
                { k: "line", to: { x: 234, y: 280 } },
                { k: "line", to: { x: 156, y: 280 } },
                { k: "line", to: { x: 78, y: 280 } },
                { k: "line", to: { x: 78, y: 280 } },
                { k: "line", to: { x: 0, y: 280 } },
              ],
            },
          ],
          closed: true,
          vertices: [
            { x: 0, y: 91.803279, i: 0 },
            { x: 156, y: 71.147541, i: 1 },
            { x: 312, y: 41.311475, i: 2 },
            { x: 468, y: 55.081967, i: 3 },
            { x: 624, y: 16.065574, i: 4 },
            { x: 780, y: 0, i: 5 },
            { x: 780, y: 280, i: 5 },
            { x: 624, y: 280, i: 4 },
            { x: 468, y: 280, i: 3 },
            { x: 312, y: 280, i: 2 },
            { x: 156, y: 280, i: 1 },
            { x: 0, y: 280, i: 0 },
          ],
          fill: "rgb(226, 232, 240)",
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
      box: { x: 56, y: 240, w: 700, h: 24 },
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
              start: { x: 56, y: 240 },
              segments: [{ k: "line", to: { x: 756, y: 240 } }],
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
      box: { x: 56, y: 16, w: 40, h: 224 },
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
              start: { x: 96, y: 240 },
              segments: [{ k: "line", to: { x: 96, y: 16 } }],
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
      box: { x: 56, y: 240, w: 700, h: 24 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: false,
      clipPath: null,
      nodes: [
        {
          k: "text",
          i: -1,
          x: 56,
          y: 240,
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
          x: 196,
          y: 240,
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
          x: 336,
          y: 240,
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
          x: 476,
          y: 240,
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
          x: 616,
          y: 240,
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
          x: 756,
          y: 240,
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
      tag: "hdml-label",
      role: "guide",
      box: { x: 16, y: 16, w: 40, h: 224 },
      opacity: 1,
      filter: "none",
      visibility: "visible",
      clip: false,
      clipPath: null,
      nodes: [
        {
          k: "text",
          i: -1,
          x: 56,
          y: 240,
          text: "0%",
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
          x: 56,
          y: 184,
          text: "10%",
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
          x: 56,
          y: 128,
          text: "20%",
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
          x: 56,
          y: 72,
          text: "30%",
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
          x: 56,
          y: 16,
          text: "40%",
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
      box: { x: 56, y: 16, w: 700, h: 224 },
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
              start: { x: 56, y: 139.2 },
              segments: [
                {
                  k: "cubic",
                  c1: { x: 102.666667, y: 131.733333 },
                  c2: { x: 149.333333, y: 116.8 },
                  to: { x: 196, y: 116.8 },
                },
                {
                  k: "cubic",
                  c1: { x: 242.666667, y: 116.8 },
                  c2: { x: 289.333333, y: 133.6 },
                  to: { x: 336, y: 133.6 },
                },
                {
                  k: "cubic",
                  c1: { x: 382.666667, y: 133.6 },
                  c2: { x: 429.333333, y: 108.4 },
                  to: { x: 476, y: 100 },
                },
                {
                  k: "cubic",
                  c1: { x: 522.666667, y: 91.6 },
                  c2: { x: 569.333333, y: 88.8 },
                  to: { x: 616, y: 83.2 },
                },
                {
                  k: "cubic",
                  c1: { x: 662.666667, y: 77.6 },
                  c2: { x: 709.333333, y: 72 },
                  to: { x: 756, y: 66.4 },
                },
              ],
            },
          ],
          closed: false,
          vertices: [
            { x: 56, y: 139.2, i: 0 },
            { x: 196, y: 116.8, i: 1 },
            { x: 336, y: 133.6, i: 2 },
            { x: 476, y: 100, i: 3 },
            { x: 616, y: 83.2, i: 4 },
            { x: 756, y: 66.4, i: 5 },
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
