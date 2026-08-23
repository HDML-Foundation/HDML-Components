/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert, fixture } from "@open-wc/testing";
import { html } from "lit/static-html.js";
import { LitElement } from "lit";
import "./index";
import type { SceneGroup, SceneNode } from "./scene";
import { HdvlProbeElement, PROBE_TAG } from "../testing/probe";
import {
  installSceneRecorder,
  restoreRenderers,
  sceneOf,
} from "../testing/scene-of";
import { HdmlViewElement } from "./view";
import { HdmlRuleElement } from "./mark-rule";
import { chainScaleOf } from "./scale";

/**
 * `hdml-rule` — §6.1's last row, and R20's node budget.
 *
 * The rule is the **other half of §2.5's `i` contract**: one node
 * per row, each carrying a real source row index, where a line
 * emits one node for the whole series and carries `-1`. It is also
 * where the plan's scheduled D1 escalation lands — a rule needs a
 * scale for the channel it did **not** bind, or it has nothing to
 * span.
 *
 * A probe rides beside the rule in the geometry fixtures so the
 * expected span can be read off `scale.range()` itself rather than
 * off the box, which is what §4.3 makes the contract.
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

function ruleOf(view: HdmlViewElement): HdmlRuleElement {
  return <HdmlRuleElement>view.querySelector("hdml-rule");
}

/** The rule's group, from the scene the frame actually painted. */
function groupOf(view: HdmlViewElement): SceneGroup {
  const uid = ruleOf(view).uid;
  const group = sceneOf(view, P).groups.find((g) => g.widget === uid);
  assert.isDefined(group, "the rule painted no group");
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

/** The range the chain resolved for a channel, read via the probe. */
function rangeOf(
  view: HdmlViewElement,
  channel: "x" | "y",
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

/** The two-scale fixture, with the rule bound on one channel. */
function page(bound: "x" | "y", values: string) {
  const x = bound === "x" ? values : "";
  const y = bound === "y" ? values : "";
  return html`
    <hdml-view aria-label="rule" style="width: 400px; height: 200px">
      <hdml-cartesian-plane style="padding: 0">
        <hdml-continuous-scale channel="x" min="0" max="4">
          <hdml-continuous-scale channel="y" min="0" max="200">
            ${bound === "x"
              ? html`<hdml-rule x="${x}"></hdml-rule>`
              : html`<hdml-rule y="${y}"></hdml-rule>`}
            <hdvl-probe></hdvl-probe>
          </hdml-continuous-scale>
        </hdml-continuous-scale>
      </hdml-cartesian-plane>
    </hdml-view>
  `;
}

suite("hdvl/mark-rule — §6.1's spanning line", () => {
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

  test("one path per row, each with its own source row", async () => {
    const view = await mount(page("y", "[0, 100, 200]"));
    const nodes = paths(view);
    assert.lengthOf(nodes, 3);
    // §2.5: a per-row node carries a REAL index, where a line's
    // whole-series node carries -1.
    assert.deepEqual(
      nodes.map((n) => n.i),
      [0, 1, 2],
    );
    for (const node of nodes) {
      assert.lengthOf(node.subpaths, 1);
      assert.lengthOf(node.subpaths[0].segments, 1);
      assert.strictEqual(node.subpaths[0].segments[0].k, "line");
      assert.isNull(node.fill);
      assert.isNotNull(node.stroke);
    }
  });

  test("each spans the other range end to end", async () => {
    const view = await mount(page("y", "[0, 100, 200]"));
    const span = rangeOf(view, "x");
    for (const node of paths(view)) {
      assert.strictEqual(node.subpaths[0].start.x, span[0]);
      assert.strictEqual(node.subpaths[0].segments[0].to.x, span[1]);
    }
    // …at its own projected position: y ∈ [0, 200] over a
    // bottom-to-top range is `200 − v`.
    assert.deepEqual(
      paths(view).map((n) => n.subpaths[0].start.y),
      [200, 100, 0],
    );
  });

  test("x spans vertically and y spans horizontally", async () => {
    const vertical = await mount(page("x", "[1, 2]"));
    const yRange = rangeOf(vertical, "y");
    for (const node of paths(vertical)) {
      // The x is fixed; the y runs the whole other range.
      assert.strictEqual(
        node.subpaths[0].start.x,
        node.subpaths[0].segments[0].to.x,
      );
      assert.strictEqual(node.subpaths[0].start.y, yRange[0]);
      assert.strictEqual(
        node.subpaths[0].segments[0].to.y,
        yRange[1],
      );
    }
    assert.deepEqual(
      paths(vertical).map((n) => n.subpaths[0].start.x),
      [100, 200],
    );

    const horizontal = await mount(page("y", "[50, 150]"));
    for (const node of paths(horizontal)) {
      assert.strictEqual(
        node.subpaths[0].start.y,
        node.subpaths[0].segments[0].to.y,
      );
    }
    assert.deepEqual(
      paths(horizontal).map((n) => n.subpaths[0].start.y),
      [150, 50],
    );
  });

  test("a scalar broadcasts to one row", async () => {
    // SPEC §7 gives the rule "exactly one of x/y (scalar or
    // column)", and §5 gives an all-scalar widget N = 1.
    const view = await mount(page("y", "80"));
    const nodes = paths(view);
    assert.lengthOf(nodes, 1);
    assert.strictEqual(nodes[0].i, 0);
    assert.strictEqual(nodes[0].subpaths[0].start.y, 120);
  });

  test("a missing value omits the mark", async () => {
    const view = await mount(page("y", "[0, null, 200]"));
    const nodes = paths(view);
    assert.lengthOf(nodes, 2);
    assert.deepEqual(
      nodes.map((n) => n.i),
      [0, 2],
    );
  });

  test("V1 — a rule needs the unbound channel's scale", async () => {
    // The plan's scheduled D1 escalation, decided with the user:
    // `hdml-rule` alone, reported as V1 with its existing message.
    const view = await mount(html`
      <hdml-view aria-label="d1" style="width: 400px; height: 200px">
        <hdml-cartesian-plane style="padding: 0">
          <hdml-continuous-scale channel="y" min="0" max="200">
            <hdml-rule y="80"></hdml-rule>
            <hdvl-probe></hdvl-probe>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const rule = ruleOf(view);
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
    // The unit is the rule itself, and it paints nothing…
    assert.isTrue(rule.matches(":state(error)"));
    assert.isFalse(view.matches(":state(error)"));
    const groups = sceneOf(view, P).groups;
    assert.isFalse(groups.some((g) => g.widget === rule.uid));
    // …while the sibling still renders.
    assert.isTrue(groups.some((g) => g.widget === probe.uid));
  });

  test("W4 — over budget it warns, keeping every node", async () => {
    const rows = 20001;
    const view = await mount(html`
      <hdml-view aria-label="w4" style="width: 400px; height: 200px">
        <hdml-cartesian-plane style="padding: 0">
          <hdml-continuous-scale channel="x" min="0" max="4">
            <hdml-continuous-scale channel="y" min="0" max="20000">
              <hdml-rule y="[0]"></hdml-rule>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    assert.lengthOf(said("hdml W4 "), 0);

    const many = new Array<number>(rows);
    for (let i = 0; i < rows; i++) {
      many[i] = i;
    }
    ruleOf(view).setAttribute("y", JSON.stringify(many));
    await quiesce(view);

    const warned = said("hdml W4 ");
    assert.lengthOf(warned, 1);
    assert.strictEqual(
      messageOf(warned[0]),
      "20001 scene nodes, over the 20000 budget — " +
        "rendering all of them",
    );
    // R20: "never decimate, never truncate silently". The warning
    // alone would pass on a truncating implementation, so the claim
    // asserted here is about the SCENE.
    const uid = ruleOf(view).uid;
    const group = sceneOf(view).groups.find((g) => g.widget === uid);
    assert.isDefined(group);
    assert.lengthOf(<SceneNode[]>group.nodes, rows);

    // R25: dropping back below the budget dispatches NOTHING.
    ruleOf(view).setAttribute("y", "[0, 1, 2]");
    await quiesce(view);
    assert.lengthOf(said("hdml W4 "), 1);
  });
});
