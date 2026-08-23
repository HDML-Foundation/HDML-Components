/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert, fixture } from "@open-wc/testing";
import { html } from "lit/static-html.js";
import { LitElement } from "lit";
import "./index";
import type { Channel } from "./resolve";
import type { SceneGroup, SceneNode } from "./scene";
import { HdvlProbeElement, PROBE_TAG } from "../testing/probe";
import {
  installSceneRecorder,
  restoreRenderers,
  sceneOf,
} from "../testing/scene-of";
import { HdmlViewElement } from "./view";
import { HdmlAxisElement } from "./guide-axis";
import { chainScaleOf } from "./scale";

/**
 * `hdml-axis` — §6.5's first row, and Slice E's opening.
 *
 * Two claims carry the suite. **What it spans** is the *scale's*
 * `range()` (§4.3), asserted against a real `range()` call read
 * through a probe rather than against a transcribed number. **Where
 * it sits across that span** is the edge of its *own* box nearest
 * the scale — derived from two measured boxes, because SPEC §7
 * gives the tag no `position` attribute — which the "above the
 * plot" fixture proves by moving the box and watching the edge
 * change sides.
 */

const P = { precision: 6 };

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

function axisOf(
  view: HdmlViewElement,
  channel: string,
): HdmlAxisElement {
  return <HdmlAxisElement>(
    view.querySelector(`hdml-axis[channel="${channel}"]`)
  );
}

function groupOf(view: HdmlViewElement, channel: string): SceneGroup {
  const uid = axisOf(view, channel).uid;
  const group = sceneOf(view, P).groups.find((g) => g.widget === uid);
  assert.isDefined(group, `the ${channel} axis painted no group`);
  return group;
}

function pathOf(
  view: HdmlViewElement,
  channel: string,
): Extract<SceneNode, { k: "path" }> {
  const nodes = groupOf(view, channel).nodes;
  assert.lengthOf(<SceneNode[]>nodes, 1);
  assert.strictEqual(nodes[0].k, "path");
  return <Extract<SceneNode, { k: "path" }>>nodes[0];
}

/** The range the chain resolved for a channel, read via the probe. */
function rangeOf(
  view: HdmlViewElement,
  channel: Channel,
): [number, number] {
  const probe = <HdvlProbeElement>view.querySelector(PROBE_TAG);
  const call = probe.last;
  assert.isNotNull(call, "the probe was never called");
  const scale = chainScaleOf(
    (<{ ctx: Parameters<typeof chainScaleOf>[0] }>call).ctx,
    probe,
    channel,
  );
  assert.isNotNull(scale, `no ${channel} scale`);
  const range = scale?.range() ?? null;
  assert.isNotNull(range, `no ${channel} range`);
  return <[number, number]>range;
}

function messageOf(line: string): string {
  const at = line.indexOf(" — ");
  return at < 0 ? line : line.slice(at + 3);
}

function said(prefix: string): string[] {
  return lines.filter((l) => l.startsWith(prefix));
}

/**
 * The two-scale fixture, on the UA gutter rather than `padding: 0`:
 * a zero-CSS guide lands in that gutter, and its own box is half of
 * what the edge derivation reads.
 */
function page(style: string) {
  return html`
    <hdml-view aria-label="axis" style="width: 400px; height: 200px">
      <hdml-cartesian-plane>
        <hdml-continuous-scale channel="x" min="0" max="4">
          <hdml-continuous-scale channel="y" min="0" max="200">
            <hdml-axis channel="x" style="${style}"></hdml-axis>
            <hdml-axis channel="y"></hdml-axis>
            <hdvl-probe></hdvl-probe>
          </hdml-continuous-scale>
        </hdml-continuous-scale>
      </hdml-cartesian-plane>
    </hdml-view>
  `;
}

suite("hdvl/guide-axis — §6.5's spanning line", () => {
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

  test("one stroked path over the scale's range", async () => {
    const view = await mount(page(""));
    const x = pathOf(view, "x");
    const span = rangeOf(view, "x");
    assert.isNull(x.fill);
    assert.isNotNull(x.stroke);
    assert.lengthOf(x.subpaths, 1);
    assert.lengthOf(x.subpaths[0].segments, 1);
    assert.strictEqual(x.subpaths[0].segments[0].k, "line");
    // §4.3: the SCALE's range, read off the scale itself.
    assert.strictEqual(x.subpaths[0].start.x, span[0]);
    assert.strictEqual(x.subpaths[0].segments[0].to.x, span[1]);
    // …and the y axis spans the y range, top to bottom.
    const y = pathOf(view, "y");
    const yr = rangeOf(view, "y");
    assert.strictEqual(y.subpaths[0].start.y, yr[0]);
    assert.strictEqual(y.subpaths[0].segments[0].to.y, yr[1]);
  });

  test("its role is guide, so empty counts marks", async () => {
    const view = await mount(page(""));
    assert.strictEqual(groupOf(view, "x").role, "guide");
    assert.strictEqual(groupOf(view, "y").role, "guide");
    // §3.4.1: a chart of axes over no data is EMPTY, not full. A
    // guide group counted as a mark would invert this silently.
    assert.isTrue(view.matches(":state(empty)"));
    const scene = sceneOf(view, P);
    for (const group of scene.groups) {
      assert.notStrictEqual(group.role, "mark");
    }
    // R2/R26: a produced scene is plain serializable data.
    assert.deepEqual(structuredClone(<unknown>scene), <unknown>scene);
  });

  test("★ the line sits on its own box's near edge", async () => {
    // SPEC §7: "placement is pure CSS… no `position` attribute", so
    // the edge is DERIVED from the two measured boxes. Below the
    // plot the near edge is the top one; above it, the bottom one —
    // and both are read off the y scale's own range, never
    // transcribed.
    const below = await mount(page(""));
    const [bottom, top] = rangeOf(below, "y");
    assert.strictEqual(
      pathOf(below, "x").subpaths[0].start.y,
      bottom,
    );

    const above = await mount(
      page("top: auto; bottom: 100%; height: 24px"),
    );
    assert.strictEqual(pathOf(above, "x").subpaths[0].start.y, top);
    // The span is untouched by the move: only the crossing changed.
    assert.strictEqual(
      pathOf(above, "x").subpaths[0].start.x,
      pathOf(below, "x").subpaths[0].start.x,
    );
  });

  test("a tick spec on this tag changes nothing", async () => {
    // §6.5: "takes no count/step/values". The vocabulary already
    // says so — AXIS_ATTRS_LIST has one member — and V16 reports an
    // author who writes one at step 24. Meanwhile the scene must
    // not move.
    const view = await mount(page(""));
    const before = groupOf(view, "x");
    const axis = axisOf(view, "x");
    axis.setAttribute("count", "3");
    axis.setAttribute("step", "0.5");
    axis.setAttribute("values", "[1, 2]");
    view.markDirty();
    await quiesce(view);
    assert.deepEqual(<unknown>groupOf(view, "x"), <unknown>before);
  });

  test("V1 already covers a channel with no scale", async () => {
    const view = await mount(html`
      <hdml-view aria-label="v1" style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-continuous-scale channel="y" min="0" max="200">
            <hdml-axis channel="x"></hdml-axis>
            <hdvl-probe></hdvl-probe>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const probe = <HdvlProbeElement>view.querySelector(PROBE_TAG);
    probe.emit = true;
    view.markDirty();
    await quiesce(view);

    const errors = said("hdml V1 ");
    assert.lengthOf(errors, 1);
    assert.strictEqual(
      messageOf(errors[0]),
      'no scale for channel "x" in scope',
    );
    const uid = axisOf(view, "x").uid;
    const groups = sceneOf(view, P).groups;
    assert.isFalse(groups.some((g) => g.widget === uid));
    assert.isTrue(groups.some((g) => g.widget === probe.uid));
  });

  test("the three --hdml-line-* properties reach it", async () => {
    const view = await mount(page(""));
    const axis = axisOf(view, "x");
    axis.setAttribute(
      "style",
      "--hdml-line-width: 3px; --hdml-line-style: dashed;" +
        " --hdml-line-color: rgb(1, 2, 3)",
    );
    view.markDirty();
    await quiesce(view);
    const node = pathOf(view, "x");
    assert.strictEqual(node.strokeWidth, 3);
    assert.strictEqual(node.stroke, "rgb(1, 2, 3)");
    // The dash pattern is a multiple of the width, so a 3px
    // emphasis line dashes proportionally (`mark.ts`'s `dashOf`).
    assert.deepEqual(<number[]>node.dash, [12, 9]);
  });
});
