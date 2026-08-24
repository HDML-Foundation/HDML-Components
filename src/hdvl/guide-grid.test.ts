/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert, fixture } from "@open-wc/testing";
import { html, unsafeStatic } from "lit/static-html.js";
import { LitElement } from "lit";
import "./index";
import type { Channel } from "./resolve";
import type { Scale, TickSpec } from "./scale";
import type { SceneGroup, SceneNode } from "./scene";
import { HdvlProbeElement, PROBE_TAG } from "../testing/probe";
import {
  installSceneRecorder,
  restoreRenderers,
  roundDeep,
  sceneOf,
} from "../testing/scene-of";
import { HdmlViewElement } from "./view";
import { HdmlGridElement } from "./guide-grid";
import { chainScaleOf } from "./scale";

/**
 * `hdml-grid` — §6.5's last row, cartesian half.
 *
 * The load-bearing assertion is **R12**: every position is compared
 * against a real `scale.ticks(spec)` call made from the test, so a
 * grid that re-derived §4.8's ladder could not pass however close
 * it came. The `--hdml-grid-shape` forms landed at step 27 and are
 * asserted in `guide-polar.test.ts`, beside the other three guides
 * under the plane they need.
 */

const P = { precision: 6 };

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

function gridOf(view: HdmlViewElement): HdmlGridElement {
  return <HdmlGridElement>view.querySelector("hdml-grid");
}

function groupOf(view: HdmlViewElement): SceneGroup {
  const uid = gridOf(view).uid;
  const group = sceneOf(view, P).groups.find((g) => g.widget === uid);
  assert.isDefined(group, "the grid painted no group");
  return group;
}

function paths(
  view: HdmlViewElement,
): Extract<SceneNode, { k: "path" }>[] {
  return groupOf(view).nodes.map((node) => {
    assert.strictEqual(node.k, "path");
    return <Extract<SceneNode, { k: "path" }>>node;
  });
}

/** The scale the chain resolved for a channel, read via the probe. */
function scaleOf(view: HdmlViewElement, channel: Channel): Scale {
  const probe = <HdvlProbeElement>view.querySelector(PROBE_TAG);
  const call = probe.last;
  assert.isNotNull(call, "the probe was never called");
  const scale = chainScaleOf(
    (<{ ctx: Parameters<typeof chainScaleOf>[0] }>call).ctx,
    probe,
    channel,
  );
  assert.isNotNull(scale, `no ${channel} scale`);
  return scale;
}

function rangeOf(
  view: HdmlViewElement,
  channel: Channel,
): [number, number] {
  const range = scaleOf(view, channel).range();
  assert.isNotNull(range, `no ${channel} range`);
  return <[number, number]>range;
}

/** ★ R12's assertion: the positions of a real `ticks(spec)` call. */
function expected(
  view: HdmlViewElement,
  channel: Channel,
  spec: TickSpec,
): number[] {
  return <number[]>roundDeep(
    scaleOf(view, channel)
      .ticks(spec)
      .map((t) => t.at),
    P.precision,
  );
}

/** Where each line sits along the grid's own channel. */
function along(view: HdmlViewElement, horizontal: boolean): number[] {
  return paths(view).map((n) =>
    horizontal ? n.subpaths[0].start.x : n.subpaths[0].start.y,
  );
}

/**
 * A continuous fixture whose y domain makes `step="0.05"` land on
 * exactly five representable positions (cross-engine rule 1).
 */
function continuous(attrs: string) {
  // Step 13's T1: a `lit/static-html` template interpolates a raw
  // string nowhere — an attribute list least of all. `unsafeStatic`
  // is the wrapper that bakes one into the template text.
  const spec = unsafeStatic(attrs);
  return html`
    <hdml-view aria-label="grid" style="width: 400px; height: 200px">
      <hdml-cartesian-plane style="padding: 0">
        <hdml-continuous-scale channel="x" min="0" max="4">
          <hdml-continuous-scale channel="y" min="0" max="0.2">
            <hdml-grid channel="y" ${spec}></hdml-grid>
            <hdvl-probe></hdvl-probe>
          </hdml-continuous-scale>
        </hdml-continuous-scale>
      </hdml-cartesian-plane>
    </hdml-view>
  `;
}

suite("hdvl/guide-grid — §6.5's repeated line", () => {
  setup(() => {
    installSceneRecorder();
  });

  teardown(() => {
    restoreRenderers();
  });

  test("one path per tick, across the other range", async () => {
    const view = await mount(continuous('step="0.05"'));
    const nodes = paths(view);
    const span = rangeOf(view, "x");
    assert.lengthOf(nodes, 5);
    for (const node of nodes) {
      assert.lengthOf(node.subpaths, 1);
      assert.strictEqual(node.subpaths[0].segments[0].k, "line");
      assert.isNull(node.fill);
      assert.isNotNull(node.stroke);
      // §4.3: the OTHER channel's range, end to end.
      assert.strictEqual(node.subpaths[0].start.x, span[0]);
      assert.strictEqual(node.subpaths[0].segments[0].to.x, span[1]);
      // §2.5: a guide has no rows and no data vertices.
      assert.strictEqual(node.i, -1);
      assert.lengthOf(<unknown[]>node.vertices, 0);
    }
  });

  test("★ the positions are scale.ticks(spec)'s", async () => {
    // R12: a grid that re-derived §4.8's ladder could not pass, at
    // any distance from the real one.
    const view = await mount(continuous('step="0.05"'));
    assert.deepEqual(
      along(view, false),
      expected(view, "y", { step: 0.05 }),
    );
    // …and step= is exact (rule 1): five lines over [0, 0.2].
    assert.deepEqual(along(view, false), [200, 150, 100, 50, 0]);
  });

  test("count, step and values each reach the scale", async () => {
    const byCount = await mount(continuous('count="3"'));
    assert.deepEqual(
      along(byCount, false),
      expected(byCount, "y", { count: 3 }),
    );
    const byStep = await mount(continuous('step="0.05"'));
    const byValues = await mount(continuous('values="[0.03, 0.07]"'));
    assert.deepEqual(
      along(byValues, false),
      expected(byValues, "y", { values: [0.03, 0.07] }),
    );
    assert.deepEqual(along(byValues, false), [170, 130]);
    // Three modes, three different tick sets on one fixture.
    assert.lengthOf(along(byStep, false), 5);
    assert.lengthOf(along(byCount, false), 3);
    assert.lengthOf(along(byValues, false), 2);
  });

  test("an empty attribute reads as absent", async () => {
    // Step 21's T4, restated for the guide half: one fixture helper
    // has to be able to spell "unset".
    const bare = await mount(continuous(""));
    const empty = await mount(continuous('step=""'));
    assert.deepEqual(along(empty, false), along(bare, false));
    // A bare grid is `ticks({})`, which Contract 2 reads as 10.
    assert.deepEqual(along(bare, false), expected(bare, "y", {}));
  });

  test("an ordinal grid lands on band centres", async () => {
    const view = await mount(html`
      <hdml-view aria-label="ord" style="width: 400px; height: 200px">
        <hdml-cartesian-plane style="padding: 0">
          <hdml-ordinal-scale channel="x" values='["a","b","c","d"]'>
            <hdml-continuous-scale channel="y" min="0" max="100">
              <hdml-grid channel="x"></hdml-grid>
              <hdvl-probe></hdvl-probe>
            </hdml-continuous-scale>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const at = along(view, true);
    assert.deepEqual(at, expected(view, "x", {}));
    // §4.4: every non-band-filling lookup resolves to the CENTRE.
    const scale = scaleOf(view, "x");
    const centres = <number[]>roundDeep(
      ["a", "b", "c", "d"].map((v) => scale.bandOf(v)?.centre),
      P.precision,
    );
    assert.deepEqual(at, centres);
    const starts = <number[]>roundDeep(
      ["a", "b", "c", "d"].map((v) => scale.bandOf(v)?.start),
      P.precision,
    );
    assert.notDeepEqual(at, starts);
  });

  test("★ an angular channel paints a spoke per tick", async () => {
    // Step 23 left a placeholder here asserting the opposite: a
    // polar plane resolved to nothing. Step 27 lifted that, and a
    // grid on the plane's FIRST channel needs no new geometry —
    // `guidePoint` composes through the plane, so the same straight
    // branch that draws a cartesian gridline draws a spoke.
    const view = await mount(html`
      <hdml-view aria-label="pol" style="width: 400px; height: 200px">
        <hdml-polar-plane style="padding: 0">
          <hdml-continuous-scale channel="angle" min="0" max="4">
            <hdml-continuous-scale channel="radius" min="0" max="10">
              <hdml-grid channel="angle" count="4"></hdml-grid>
              <hdvl-probe></hdvl-probe>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-polar-plane>
      </hdml-view>
    `);
    const probe = <HdvlProbeElement>view.querySelector(PROBE_TAG);
    probe.emit = true;
    view.markDirty();
    await quiesce(view);
    const groups = sceneOf(view, P).groups;
    assert.isTrue(groups.some((g) => g.widget === gridOf(view).uid));
    assert.isTrue(groups.some((g) => g.widget === probe.uid));
    // A spoke is still a `path`, and it runs from the pole out.
    const lines = paths(view);
    assert.isAbove(lines.length, 0);
    for (const line of lines) {
      assert.lengthOf(line.subpaths, 1);
      assert.isFalse(line.closed);
    }
  });

  test("its own box is the plot area", async () => {
    // SPEC §3's grid row is `inset: 0`, which the generic `:host`
    // rule already IS — so its lines cross the plot and never the
    // gutter, on a page with the UA gutter in force.
    const view = await mount(html`
      <hdml-view aria-label="box" style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-continuous-scale channel="x" min="0" max="4">
            <hdml-continuous-scale channel="y" min="0" max="200">
              <hdml-grid channel="y" count="4"></hdml-grid>
              <hdvl-probe></hdvl-probe>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const grid = gridOf(view);
    const scale = <Element>grid.parentElement;
    const a = grid.getBoundingClientRect();
    const b = scale.getBoundingClientRect();
    assert.strictEqual(a.left, b.left);
    assert.strictEqual(a.top, b.top);
    assert.strictEqual(a.width, b.width);
    assert.strictEqual(a.height, b.height);

    const [x0, x1] = rangeOf(view, "x");
    const [yLo, yHi] = rangeOf(view, "y");
    const lo = Math.min(yLo, yHi);
    const hi = Math.max(yLo, yHi);
    for (const node of paths(view)) {
      assert.strictEqual(node.subpaths[0].start.x, x0);
      assert.strictEqual(node.subpaths[0].segments[0].to.x, x1);
      assert.isAtLeast(node.subpaths[0].start.y, lo);
      assert.isAtMost(node.subpaths[0].start.y, hi);
    }
  });
});
