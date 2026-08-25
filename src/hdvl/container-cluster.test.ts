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
 * this file is a dyadic rational, so the tiling identity is
 * `strictEqual` and not `closeTo`.
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
): ReturnType<typeof html> {
  return html`
    <hdml-view aria-label="dodge" style="width: 76px; height: 200px">
      <hdml-cartesian-plane style="padding: 0">
        <hdml-ordinal-scale channel="x" values="${CATS}">
          <hdml-continuous-scale channel="y" min="0" max="200">
            <hdml-cluster x="${CATS}">
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
      // right edge is `start + width` — `strictEqual`, because
      // every number here is a dyadic rational.
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
