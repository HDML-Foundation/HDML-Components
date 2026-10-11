/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert, fixture } from "@open-wc/testing";
import { html } from "lit/static-html.js";
import { LitElement } from "lit";
import "./index";
import type { HdvlElement } from "./base";
import type { SceneGroup, SceneNode } from "./scene";
import {
  installSceneRecorder,
  restoreRenderers,
  sceneOf,
} from "../testing/scene-of";
import { HdmlViewElement } from "./view";
import { scaleOf } from "./scale";
import { bandOf } from "./kernel/scale-band";
import { negativeZeros, nodeCount } from "../testing/corpus";

/**
 * `hdml-cluster` — §6.4's band subdivision, and **R19 measured**.
 *
 * **The inner band is `kernel/scale-band.ts` at `b = 1`.** The test
 * that says so asserts every slot against `bandOf`'s own output
 * rather than against `outer.width / n`, because those two agree
 * numerically and are not the same claim: R19 says there is *one*
 * band formula in the project, and a second expression that happens
 * to match it is exactly what R19 forbids.
 *
 * **W = 76, n = 4, b = 0.8** gives an outer `step` of exactly 20 and
 * a width of 16; two slots at `b = 1` give 8 and 8. Every edge in
 * the pre-R2 part of this file is a dyadic rational, so the tiling
 * identity is `strictEqual` and not `closeTo`.
 *
 * ★ **019 item 10 / R2 — `--hdml-cluster-bandwidth`**, and the
 * precision rule the new cases run under. The inner `b` is no
 * longer the literal `1`, so the gap `(1 − b) · step` is a
 * **difference of two accumulations against a product**, and
 * measured over 175 (W, n, b) cells it is bit-exact in **19**. The
 * split in this file is therefore deliberate and labelled at each
 * case:
 *
 * - `b = 1` (the initial) keeps every `strictEqual` it had, because
 *   `76 / 3.8 = 20` and `16 / 2 = 8` are exact and `(1 − 1) · step`
 *   is `0` whatever `step` rounded to.
 * - a `b < 1` **gap** is `closeTo` at `1e-9`, the tolerance
 *   `scale-band.test.ts` already uses for this seam. Worst delta
 *   observed anywhere in the sweep: `1.688e-14`.
 * - ⚠⚠ **and in THIS fixture no `b < 1` cell is exact at all**,
 *   because the inner range's `r0` is the outer band's start —
 *   0, 20, 40, 60 — so three of four categories accumulate from a
 *   non-zero origin. Measured. The dyadic `===` control therefore
 *   lives in `scale-band.test.ts`, which takes `r0` as a
 *   parameter; what is observable here is the origin's effect,
 *   and one case asserts exactly that.
 * - a **far edge** is `closeTo` even at `b = 1`, because `W = 16,
 *   n = 6` already drifts one ulp — latent before this step and
 *   unreached only because the fixtures here use `n ≤ 3`.
 *
 * ⚠ Do not "tidy" a `closeTo` here into a `strictEqual`: whether a
 * cell is exact is a property of the (W, n, b) **triple**, not of
 * `b`, and `scale-band.test.ts` carries the measurement.
 */

/** The four categories every fixture here declares. */
const CATS = '["a","b","c","d"]';

/** The outer geometry, for the R19 assertion's own arithmetic. */
const W = 76;
const N = 4;
const BANDWIDTH = 0.8;

let lines: string[] = [];
let realWarn: typeof console.warn;
let realError: typeof console.error;

async function settle(root: Element): Promise<void> {
  const all = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const el of all) {
    if (el instanceof LitElement) {
      await el.updateComplete;
    }
  }
}

function tick(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

async function quiesce(view: HdmlViewElement): Promise<void> {
  let last = -1;
  let still = 0;
  for (let i = 0; i < 60 && still < 3; i++) {
    await tick();
    if (view.framesRun === last && !view.dirty) {
      still++;
    } else {
      still = 0;
      last = view.framesRun;
    }
  }
}

async function mount(
  markup: ReturnType<typeof html>,
): Promise<HdmlViewElement> {
  const view = await fixture<HdmlViewElement>(markup);
  await settle(view);
  view.markDirty();
  await quiesce(view);
  return view;
}

async function reflow(view: HdmlViewElement): Promise<void> {
  await settle(view);
  view.markDirty();
  await quiesce(view);
}

function groups(view: HdmlViewElement): readonly SceneGroup[] {
  return sceneOf(view).groups;
}

function rects(
  group: SceneGroup,
): Extract<SceneNode, { k: "rect" }>[] {
  const out: Extract<SceneNode, { k: "rect" }>[] = [];
  for (const node of group.nodes) {
    assert.strictEqual(node.k, "rect");
    out.push(<Extract<SceneNode, { k: "rect" }>>node);
  }
  return out;
}

function said(prefix: string): string[] {
  return lines.filter((l) => l.startsWith(prefix));
}

/** Two dodged series, `n` slots wide. */
function dodge(
  extra = "",
  hide = -1,
  third = false,
  cluster = "",
): ReturnType<typeof html> {
  return html`
    <hdml-view aria-label="dodge" style="width: 76px; height: 200px">
      <hdml-cartesian-plane style="padding: 0">
        <hdml-ordinal-scale channel="x" values="${CATS}">
          <hdml-continuous-scale channel="y" min="0" max="200">
            <hdml-cluster x="${CATS}" style="${cluster}">
              <hdml-bar y="[10, 20, 30, 40]"></hdml-bar>
              <hdml-bar
                y="[40, 30, 20, 10]"
                style="${extra}"
                ?hidden="${hide === 1}"
              ></hdml-bar>
              ${
                third
                  ? html`<hdml-bar y="[5, 5, 5, 5]"></hdml-bar>`
                  : ""
              }
            </hdml-cluster>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
    </hdml-view>
  `;
}

suite("hdvl/container-cluster — §6.4's subdivision", () => {
  setup(() => {
    lines = [];
    realWarn = console.warn;
    realError = console.error;
    console.warn = (...args: unknown[]): void => {
      lines.push(String(args[0]));
    };
    console.error = (...args: unknown[]): void => {
      lines.push(String(args[0]));
    };
    installSceneRecorder();
  });

  teardown(() => {
    console.warn = realWarn;
    console.error = realError;
    restoreRenderers();
  });

  test("★ R19 — the inner band is bandOf at b = 1", async () => {
    const view = await mount(dodge());
    const all = groups(view);
    assert.lengthOf(all, 2);
    for (let slot = 0; slot < 2; slot++) {
      const nodes = rects(all[slot]);
      for (let i = 0; i < N; i++) {
        const outer = bandOf(i, N, [0, W], BANDWIDTH);
        assert.isNotNull(outer);
        const box = outer;
        // ★ The SAME function, at `b = 1` — not `outer.width / 2`,
        // which would agree here and be a second implementation of
        // §4.4 (R19). "There is no authorable inner gap" is what
        // the `1` says.
        const inner = bandOf(
          slot,
          2,
          [box.start, box.start + box.width],
          1,
        );
        assert.isNotNull(inner);
        const cell = inner;
        assert.strictEqual(nodes[i].x, cell.start);
        assert.strictEqual(nodes[i].w, cell.width);
      }
    }
  });

  test("★ the slots exactly tile their outer band", async () => {
    const view = await mount(dodge());
    const all = groups(view).map(rects);
    for (let i = 0; i < N; i++) {
      const outer = bandOf(i, N, [0, W], BANDWIDTH);
      const box = <NonNullable<typeof outer>>outer;
      // Slot 0's left edge is the band's start and slot n−1's
      // right edge is `start + width` — `strictEqual`, because at
      // the INITIAL `b = 1` with n = 2 every number here is a
      // dyadic rational (76 / 3.8 = 20, 16 / 2 = 8). ⚠ That is the
      // whole licence for `===` in this test: it is a property of
      // this (W, n, b) triple and not of `b = 1`, which at
      // W = 16, n = 6 drifts one ulp in the far edge. R2's cases
      // below use `closeTo` and say why.
      assert.strictEqual(all[0][i].x, box.start);
      assert.strictEqual(
        all[1][i].x + all[1][i].w,
        box.start + box.width,
      );
      // …and the two slots meet with no gap and no overlap.
      assert.strictEqual(all[0][i].x + all[0][i].w, all[1][i].x);
    }
  });

  test("★ slot and count are structural, not CSS", async () => {
    // `order` is the strongest available statement of "CSS does
    // not decide this": on a flex/grid child it reorders paint,
    // and SPEC §7 says the slot is the CHILD INDEX.
    const plain = await mount(dodge());
    const styled = await mount(dodge("order: -1"));
    assert.deepEqual(
      groups(styled).map((g) => ({ ...g, widget: "" })),
      groups(plain).map((g) => ({ ...g, widget: "" })),
    );
  });

  test("★ a hidden child re-derives the subdivision", async () => {
    const view = await mount(dodge("", -1, true));
    assert.lengthOf(groups(view), 3);
    // Three slots: step 16/3, so this half is `closeTo`.
    assert.closeTo(rects(groups(view)[0])[0].w, 16 / 3, 1e-9);
    const middle = <HTMLElement>view.querySelectorAll("hdml-bar")[1];
    middle.setAttribute("hidden", "");
    await reflow(view);
    const after = groups(view);
    // Two RENDERED children, so two slots — and the third child
    // moved into slot 1, which is the whole of "re-derives".
    assert.lengthOf(after, 2);
    assert.strictEqual(rects(after[0])[0].w, 8);
    assert.strictEqual(rects(after[1])[0].x, 8);
    assert.strictEqual(rects(after[1])[0].h, 5);
  });

  test("★ stack-in-cluster composes", async () => {
    // V17's only legal nesting: the inner stack's baseline derive
    // runs INSIDE the outer band subdivision, and the two stacks
    // bind no channel at all — `x` is the cluster's (04-E).
    const view = await mount(html`
      <hdml-view aria-label="both" style="width: 76px; height: 200px">
        <hdml-cartesian-plane style="padding: 0">
          <hdml-ordinal-scale channel="x" values="${CATS}">
            <hdml-continuous-scale channel="y" min="0" max="200">
              <hdml-cluster x="${CATS}">
                <hdml-stack>
                  <hdml-bar y="[10, 10, 10, 10]"></hdml-bar>
                  <hdml-bar y="[20, 20, 20, 20]"></hdml-bar>
                </hdml-stack>
                <hdml-stack>
                  <hdml-bar y="[30, 30, 30, 30]"></hdml-bar>
                  <hdml-bar y="[40, 40, 40, 40]"></hdml-bar>
                </hdml-stack>
              </hdml-cluster>
            </hdml-continuous-scale>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const all = groups(view).map(rects);
    assert.lengthOf(all, 4);
    assert.lengthOf(said("hdml V"), 0);
    for (let i = 0; i < N; i++) {
      const outer = bandOf(i, N, [0, W], BANDWIDTH);
      const box = <NonNullable<typeof outer>>outer;
      // Both bars of stack 0 share slot 0's x and width…
      assert.strictEqual(all[0][i].x, box.start);
      assert.strictEqual(all[1][i].x, box.start);
      assert.strictEqual(all[0][i].w, 8);
      assert.strictEqual(all[1][i].w, 8);
      // …and both bars of stack 1 share slot 1's.
      assert.strictEqual(all[2][i].x, box.start + 8);
      assert.strictEqual(all[3][i].x, box.start + 8);
      // The baseline derive ran inside each slot: 0..10, 10..30
      // and 0..30, 30..70.
      assert.strictEqual(all[0][i].y, 190);
      assert.strictEqual(all[1][i].y, 170);
      assert.strictEqual(all[2][i].y, 170);
      assert.strictEqual(all[3][i].y, 130);
    }
  });

  test("★ the cluster declares no channel", async () => {
    const view = await mount(dodge());
    // SPEC §7: the inner band is "internal machinery, no channel
    // declared — invisible to V1 and to channel resolution". So a
    // valid clustered page needs no extra scale…
    assert.lengthOf(said("hdml V"), 0);
    assert.isFalse(view.matches(":state(error)"));
    // …and the scale everything ELSE resolves is untouched: its
    // band is still the category's, so a guide over it addresses
    // `a`..`d` and never a slot.
    const scale = <HdvlElement>(
      (<unknown>view.querySelector('[channel="x"]'))
    );
    const resolved = scaleOf(scale);
    assert.isNotNull(resolved);
    const band = resolved?.bandOf("a") ?? null;
    assert.deepEqual(band, { start: 0, width: 16, centre: 8 });
    assert.strictEqual(resolved?.project("b"), 28);
  });
  /* ---- 019 item 10 / R2 — the inner band is authorable ------- */

  /** The outer band every R2 case subdivides: start 0, width 16. */
  const OUTER = <NonNullable<ReturnType<typeof bandOf>>>(
    bandOf(0, N, [0, W], BANDWIDTH)
  );

  test("★ R2 — the gap is (1 − b) · step, b = 0.9", async () => {
    // ⚠ `closeTo`, and NOT caution. Written with `strictEqual`
    // first, as the step's control 3, and it went red on all three
    // engines by **2.2e-16** (0.8421052631578947 against
    // ...45). Two reasons compound, and the second is the one that
    // makes the tolerance unavoidable rather than prudent:
    //
    //   1. the gap the slots leave is `step − b · step`, two
    //      roundings against the identity's single
    //      `(1 − b) · step`;
    //   2. ⚠⚠ the inner range's `r0` is the OUTER band's start —
    //      0, 20, 40, 60 here — so for three of the four
    //      categories both edges are offsets from a non-zero
    //      origin. Measured over b ∈ {0.9, 0.8, 0.75, 0.5, 0.25}
    //      × n ∈ {2, 3} × those four origins: **not one cell** is
    //      bit-exact at every origin, and the dyadic b that is
    //      exact at origin 0 is not at 20. The dyadic positive
    //      control therefore lives in `scale-band.test.ts`, where
    //      `r0` is choosable; see the next case for the half of it
    //      that is observable here.
    const view = await mount(
      dodge("", -1, false, "--hdml-cluster-bandwidth: 0.9"),
    );
    const all = groups(view).map(rects);
    assert.lengthOf(all, 2);
    const step = OUTER.width / (2 - 1 + 0.9);
    for (let i = 0; i < N; i++) {
      assert.closeTo(
        all[1][i].x - (all[0][i].x + all[0][i].w),
        (1 - 0.9) * step,
        1e-9,
      );
      // …and the slots NARROWED: b · step, not the full step.
      assert.closeTo(all[0][i].w, 0.9 * step, 1e-9);
    }
  });

  test("★★ R2 — the ORIGIN costs the exactness", async () => {
    // The positive control for the tolerance above, and the
    // measured reason it cannot be a `strictEqual` loop: at a
    // dyadic b the gap IS bit-exact in the category whose outer
    // band starts at **0**, and is not in the three that start at
    // 20, 40 and 60. Same b, same n, same width — only the origin
    // differs, so this is the arithmetic and not the formula, and
    // `closeTo` above is demonstrably not hiding a wrong one.
    //
    // ⚠ This is also why the dyadic `===` control lives in
    // `scale-band.test.ts` rather than here: the kernel takes `r0`
    // as a parameter and a cluster takes it from its band.
    const view = await mount(
      dodge("", -1, false, "--hdml-cluster-bandwidth: 0.5"),
    );
    const all = groups(view).map(rects);
    const step = OUTER.width / (2 - 1 + 0.5);
    const want = (1 - 0.5) * step;
    const gap = (i: number): number =>
      all[1][i].x - (all[0][i].x + all[0][i].w);
    // Category 0 — the outer band starts at 0. Exact.
    assert.strictEqual(all[0][0].x, 0);
    assert.strictEqual(gap(0), want);
    // Categories 1..3 — the outer band starts at 20, 40, 60.
    for (let i = 1; i < N; i++) {
      assert.notStrictEqual(all[0][i].x, 0);
      assert.notStrictEqual(gap(i), want);
      assert.closeTo(gap(i), want, 1e-9);
    }
    // …and the slots narrowed to b · step everywhere.
    for (let i = 0; i < N; i++) {
      assert.closeTo(all[0][i].w, 0.5 * step, 1e-9);
    }
  });

  test("★★ R2 — the OUTER band does not move", async () => {
    // THE POINT OF R2, and the control a naive inner-gap test
    // passes without: an inner gap must not touch the gutter
    // between categories. Slot 0's left edge and slot n−1's right
    // edge are the outer band's own at EVERY b, so the group keeps
    // its place and its width while its bars narrow inside it.
    const one = await mount(dodge());
    const half = await mount(
      dodge("", -1, false, "--hdml-cluster-bandwidth: 0.5"),
    );
    for (const view of [one, half]) {
      const all = groups(view).map(rects);
      for (let i = 0; i < N; i++) {
        const outer = <NonNullable<ReturnType<typeof bandOf>>>(
          bandOf(i, N, [0, W], BANDWIDTH)
        );
        assert.strictEqual(all[0][i].x, outer.start);
        // ⚠ `closeTo` on the far edge even at b = 1 — W = 16,
        // n = 6 drifts one ulp and n = 2 happens not to; the
        // assertion should not depend on which.
        assert.closeTo(
          all[1][i].x + all[1][i].w,
          outer.start + outer.width,
          1e-9,
        );
      }
    }
    // …and `--hdml-bandwidth` DOES still move them, so the two
    // properties are not accidentally the same read.
    const wide = await mount(
      dodge("", -1, false, "--hdml-bandwidth: 1"),
    );
    const got = groups(wide).map(rects);
    assert.notStrictEqual(got[0][1].x, OUTER.width + 0);
    assert.strictEqual(got[0][0].x, 0);
    assert.strictEqual(got[1][3].x + got[1][3].w, W);
  });

  test("★★ R2 — the initial IS the literal replaced", async () => {
    // R2's argument 2, and what makes the step additive: the
    // registered initial `1` must be bit-identical to the literal
    // `subdivide` used to pass, or 29 goldens move. Asserted twice
    // — on the PARSED computed value with `===`, and on the whole
    // scene against a cluster that declares the property
    // explicitly.
    const probe = document.createElement("div");
    document.body.appendChild(probe);
    const raw = getComputedStyle(probe)
      .getPropertyValue("--hdml-cluster-bandwidth")
      .trim();
    probe.remove();
    assert.strictEqual(Number.parseFloat(raw), 1);
    assert.strictEqual(Math.min(1, Math.max(0, 1)), 1);

    const plain = await mount(dodge());
    const stated = await mount(
      dodge("", -1, false, "--hdml-cluster-bandwidth: 1"),
    );
    assert.deepEqual(
      groups(stated).map((g) => ({ ...g, widget: "" })),
      groups(plain).map((g) => ({ ...g, widget: "" })),
    );
  });

  test("★ R2 — a garbage value falls back silently", async () => {
    // `<number>` has no keyword, so `wide` is
    // invalid-at-computed-value-time and the property computes to
    // its initial. There is NO diagnostic: the platform struck the
    // declaration through and the runtime cannot tell that from an
    // author who wrote nothing. Recorded in `docs/decisions.md`
    // alongside the `--hdml-bandwidth` near-miss, which has the
    // same undiagnosable shape for a different reason.
    const view = await mount(
      dodge("", -1, false, "--hdml-cluster-bandwidth: wide"),
    );
    const plain = await mount(dodge());
    assert.deepEqual(
      groups(view).map((g) => ({ ...g, widget: "" })),
      groups(plain).map((g) => ({ ...g, widget: "" })),
    );
    assert.lengthOf(said("hdml"), 0);
  });

  test("★★ R2 — read at the CLUSTER, not the child", async () => {
    // The property `inherits`, so a clustered bar's own computed
    // value is normally its cluster's — but a child carrying its
    // OWN declaration computes something else, and n slots derived
    // from n different bandwidths do not tile the band they
    // subdivide. `chainScaleOf` asks `bandSlotOwnerOf`, so the
    // child's declaration is unreachable rather than merely
    // unread.
    const plain = await mount(dodge());
    const styled = await mount(
      dodge("--hdml-cluster-bandwidth: 0.25"),
    );
    assert.deepEqual(
      groups(styled).map((g) => ({ ...g, widget: "" })),
      groups(plain).map((g) => ({ ...g, widget: "" })),
    );
  });

  test("★★★ R2 — the ANCESTOR theming path works", async () => {
    // ★ CONTROL 5 — the gap nothing in the step's own list asked
    // for. "Read at the cluster, never at the child" is one half of
    // an asymmetry, and the OTHER half is the documented idiom for
    // every inheriting property in the registry: declare it high
    // and let it reach down. Here that path runs through two
    // mechanisms, not one — the cascade carries the value from the
    // view to the cluster, and MEASURE harvests it off the cluster
    // into `Measured.props` — and if the second one missed a
    // container (it loops `HDVL_PROPERTIES` over every element, so
    // it should not, but nothing asserted that for a *container*
    // before this step) the result would be a silent fall back to
    // the initial: correct-looking, untestable from a golden, and
    // exactly the class 017 exists to close.
    //
    // ⚠ It is also the one path where the asymmetry could read as
    // a bug rather than a design: an ANCESTOR declaration applies
    // and a CHILD one does not. Both are asserted, adjacently.
    const view = await mount(html`
      <hdml-view
        aria-label="themed"
        style="width: 76px; height: 200px;
               --hdml-cluster-bandwidth: 0.5"
      >
        <hdml-cartesian-plane style="padding: 0">
          <hdml-ordinal-scale channel="x" values="${CATS}">
            <hdml-continuous-scale channel="y" min="0" max="200">
              <hdml-cluster x="${CATS}">
                <hdml-bar y="[10, 20, 30, 40]"></hdml-bar>
                <hdml-bar y="[40, 30, 20, 10]"></hdml-bar>
              </hdml-cluster>
            </hdml-continuous-scale>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const all = groups(view).map(rects);
    const step = OUTER.width / (2 - 1 + 0.5);
    // Declared on the VIEW, three levels up, and it arrives.
    assert.closeTo(all[0][0].w, 0.5 * step, 1e-9);
    assert.closeTo(
      all[1][0].x - (all[0][0].x + all[0][0].w),
      (1 - 0.5) * step,
      1e-9,
    );
    // …and it is not the initial, or this would prove nothing.
    assert.notStrictEqual(all[0][0].w, OUTER.width / 2);
  });

  test("★★★ R2 — a stack-in-cluster reads the CLUSTER", async () => {
    // ★ CONTROL 5's second half. `bandSlotOf` walks the container
    // chain, so a bar inside a clustered stack finds its slot on
    // the STACK — one step up — and the entry's owner is the
    // cluster that wrote it. So `bandSlotOwnerOf` must answer the
    // *cluster* and not the intermediate stack, and a declaration
    // on the stack must therefore be inert.
    //
    // Nothing else in the suite distinguishes the two: in the
    // plain `dodge` fixture the slot's owner IS the child's
    // parent, so a lookup that returned `el.parentElement` would
    // pass every other case in this file.
    const onCluster = await mount(html`
      <hdml-view
        aria-label="s-in-c"
        style="width: 76px; height: 200px"
      >
        <hdml-cartesian-plane style="padding: 0">
          <hdml-ordinal-scale channel="x" values="${CATS}">
            <hdml-continuous-scale channel="y" min="0" max="200">
              <hdml-cluster
                x="${CATS}"
                style="--hdml-cluster-bandwidth: 0.5"
              >
                <hdml-stack>
                  <hdml-bar y="[10, 10, 10, 10]"></hdml-bar>
                </hdml-stack>
                <hdml-stack>
                  <hdml-bar y="[30, 30, 30, 30]"></hdml-bar>
                </hdml-stack>
              </hdml-cluster>
            </hdml-continuous-scale>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const step = OUTER.width / (2 - 1 + 0.5);
    const got = groups(onCluster).map(rects);
    assert.lengthOf(got, 2);
    assert.closeTo(got[0][0].w, 0.5 * step, 1e-9);

    // The same declaration on the STACK is inert — the cluster
    // owns the subdivision, so the bands stay at the initial.
    const onStack = await mount(html`
      <hdml-view
        aria-label="s-in-c2"
        style="width: 76px; height: 200px"
      >
        <hdml-cartesian-plane style="padding: 0">
          <hdml-ordinal-scale channel="x" values="${CATS}">
            <hdml-continuous-scale channel="y" min="0" max="200">
              <hdml-cluster x="${CATS}">
                <hdml-stack style="--hdml-cluster-bandwidth: 0.5">
                  <hdml-bar y="[10, 10, 10, 10]"></hdml-bar>
                </hdml-stack>
                <hdml-stack>
                  <hdml-bar y="[30, 30, 30, 30]"></hdml-bar>
                </hdml-stack>
              </hdml-cluster>
            </hdml-continuous-scale>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const inert = groups(onStack).map(rects);
    assert.strictEqual(inert[0][0].w, OUTER.width / 2);
    assert.strictEqual(inert[0][0].x + inert[0][0].w, inert[1][0].x);
  });

  test("★★ R2 — cyclic is now load-bearing arithmetic", async () => {
    // The executable evidence for the step's one untested edit —
    // `subdivide`'s doc comment used to argue that the explicit
    // `false` was an arithmetic no-op, because at `b = 1` the
    // cyclic denominator `n` and the inclusive `n − 1 + b` are the
    // same number. Below 1 they are not, and this asserts the
    // difference the flag now makes, so a later reader who deletes
    // the `false` on the old comment's authority gets a red.
    const view = await mount(
      dodge("", -1, true, "--hdml-cluster-bandwidth: 0.5"),
    );
    const all = groups(view).map(rects);
    assert.lengthOf(all, 3);
    // Inclusive: step = 16 / (3 − 1 + 0.5) = 6.4, width 3.2.
    const inclusive = OUTER.width / (3 - 1 + 0.5);
    assert.closeTo(all[0][0].w, 0.5 * inclusive, 1e-9);
    // Cyclic would be step = 16 / 3, width 8 / 3 — a DIFFERENT
    // number, which is the whole assertion.
    const cyclic = OUTER.width / 3;
    assert.notStrictEqual(inclusive, cyclic);
    assert.isAbove(Math.abs(0.5 * inclusive - 0.5 * cyclic), 1e-9);
  });

  test("★ R20 — the densest fixture is sixteen nodes", async () => {
    // Two stacks of two bars over four categories: the densest
    // scene this step builds, against R20's 20 000. Exact, not a
    // bound. It also carries no signed zero (rule 9) and is a
    // plain data structure (R2/R26).
    const view = await mount(html`
      <hdml-view
        aria-label="dense"
        style="width: 76px; height: 200px"
      >
        <hdml-cartesian-plane style="padding: 0">
          <hdml-ordinal-scale channel="x" values="${CATS}">
            <hdml-continuous-scale channel="y" min="0" max="200">
              <hdml-cluster x="${CATS}">
                <hdml-stack>
                  <hdml-bar y="[10, 10, 10, 10]"></hdml-bar>
                  <hdml-bar y="[20, 20, 20, 20]"></hdml-bar>
                </hdml-stack>
                <hdml-stack>
                  <hdml-bar y="[30, 30, 30, 30]"></hdml-bar>
                  <hdml-bar y="[40, 40, 40, 40]"></hdml-bar>
                </hdml-stack>
              </hdml-cluster>
            </hdml-continuous-scale>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const scene = sceneOf(view);
    assert.strictEqual(nodeCount(scene), 16);
    assert.lengthOf(said("hdml W4"), 0);
    assert.doesNotThrow(() => structuredClone(scene));
    assert.deepEqual(negativeZeros(scene), []);
  });
});
