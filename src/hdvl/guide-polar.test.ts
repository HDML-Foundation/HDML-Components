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
import type { Tick } from "./scale";
import { HdvlProbeElement, PROBE_TAG } from "../testing/probe";
import {
  installSceneRecorder,
  restoreRenderers,
  sceneOf,
} from "../testing/scene-of";
import { HdmlViewElement } from "./view";
import { chainScaleOf } from "./scale";

/**
 * ★ **The four positional guides under a polar plane** (§6.5,
 * SPEC §7, §9), plus `--hdml-grid-shape` — step 27's half of H7.
 *
 * **What this file is evidence for.** `guide-spec.ts` used to carry
 * a `readonly [Channel, Channel]` naming the cartesian pair and
 * refuse every other plane outright. It is gone: a guide now asks
 * {@link import("./mark").Projection} what it composes, exactly as
 * a mark does, and the four elements read the answer back as *"is
 * my own channel this plane's first"* and *"is there a pole"*. No
 * guide file names a channel at all — the grep in the step's §5 is
 * the mechanical half of that claim and these fixtures are the
 * behavioural half.
 *
 * **Rule 2 binds hard.** A ring is `Math.sin`/`Math.cos` all the
 * way down, so nothing here is `deepEqual` and every coordinate is
 * `closeTo(…, 1e-9)`. Rule 9 is checked by a recursive `-0` walk.
 *
 * **Geometry, in one place.** A 200 × 200 view, `padding: 0` on the
 * plane, so the pole is `(100, 100)` and §4.3's radial ceiling is
 * `min(200, 200) / 2 = 100`. The angle scale takes a `[0, 1]`
 * fraction domain over the default full turn, so `at(v) = v · 360`
 * degrees — `0.25` is 3 o'clock — and the radius scale takes
 * `[0, 100]` px directly.
 */

const P = { precision: 6 };

const CX = 100;
const CY = 100;
const CEILING = 100;

let live = false;

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

/**
 * §4.6's arithmetic, **retyped rather than imported**. An assertion
 * that calls `polarPoint` to check `polarPoint` proves only that
 * the function is deterministic.
 */
function expect(degrees: number, radius: number): [number, number] {
  const t = ((degrees - 90) * Math.PI) / 180;
  return [CX + radius * Math.cos(t), CY + radius * Math.sin(t)];
}

function near(
  got: { x: number; y: number },
  degrees: number,
  radius: number,
  what: string,
): void {
  const [x, y] = expect(degrees, radius);
  assert.closeTo(got.x, x, 1e-9, `${what} x`);
  assert.closeTo(got.y, y, 1e-9, `${what} y`);
}

/** Rule 9 — no signed zero anywhere in a scene. */
function noMinusZero(value: unknown, path: string): void {
  if (typeof value === "number") {
    assert.isFalse(Object.is(value, -0), `-0 at ${path}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => noMinusZero(v, `${path}[${i}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      noMinusZero(v, `${path}.${k}`);
    }
  }
}

/**
 * A polar page carrying whatever guides the caller spells.
 *
 * With no `angleValues` the angle scale is **continuous** over
 * `[0, 1]`, so `at(v) = v · 360`; with them it is **ordinal** at
 * `--hdml-bandwidth: 0`, which is `10-radar`'s spelling and puts
 * each category on a boundary.
 */
function polar(
  guides: ReturnType<typeof html>,
  angleValues?: string,
): ReturnType<typeof html> {
  const radial = html`
    <hdml-continuous-scale channel="radius" min="0" max="100">
      ${guides}
      <hdvl-probe></hdvl-probe>
    </hdml-continuous-scale>
  `;
  return html`
    <hdml-view aria-label="polar" style="width: 200px; height: 200px">
      <hdml-polar-plane style="padding: 0">
        ${angleValues === undefined
          ? html`
              <hdml-continuous-scale channel="angle" min="0" max="1">
                ${radial}
              </hdml-continuous-scale>
            `
          : html`
              <hdml-ordinal-scale
                channel="angle"
                values="${angleValues}"
                style="--hdml-bandwidth: 0"
              >
                ${radial}
              </hdml-ordinal-scale>
            `}
      </hdml-polar-plane>
    </hdml-view>
  `;
}

function groupFor(
  view: HdmlViewElement,
  tag: string,
  channel?: string,
): SceneGroup {
  const selector =
    channel === undefined ? tag : `${tag}[channel="${channel}"]`;
  const el = <HdvlProbeElement>view.querySelector(selector);
  assert.isNotNull(el, `no ${selector}`);
  const group = sceneOf(view).groups.find((g) => g.widget === el.uid);
  assert.isDefined(group, `${selector} painted no group`);
  return group;
}

/** The positions a real `ticks(spec)` call returns (R12/R18). */
function ticksOf(
  view: HdmlViewElement,
  channel: "angle" | "radius",
  spec: Record<string, unknown>,
): readonly Tick[] {
  const probe = <HdvlProbeElement>view.querySelector(PROBE_TAG);
  const call = probe.last;
  assert.isNotNull(call, "the probe was never called");
  const scale = chainScaleOf(
    (<{ ctx: Parameters<typeof chainScaleOf>[0] }>call).ctx,
    probe,
    channel,
  );
  assert.isNotNull(scale, `no ${channel} scale`);
  return scale.ticks(spec);
}

suite("hdvl/guide-polar — §6.5 about a pole", () => {
  setup(() => {
    installSceneRecorder();
    live = true;
  });

  teardown(() => {
    if (live) {
      restoreRenderers();
      live = false;
    }
  });

  test("★ an angular axis spans its range as a RING", async () => {
    // "One line spanning the whole range" degenerates when the
    // range is a turn: its two ends are the same point. So the
    // node is an `arc`, and its radius is the radial ceiling.
    const view = await mount(
      polar(html`<hdml-axis channel="angle"></hdml-axis>`),
    );
    const nodes = groupFor(view, "hdml-axis").nodes;
    assert.lengthOf(nodes, 1);
    assert.strictEqual(nodes[0].k, "arc");
    const ring = <Extract<SceneNode, { k: "arc" }>>nodes[0];
    assert.closeTo(ring.cx, CX, 1e-9);
    assert.closeTo(ring.cy, CY, 1e-9);
    // A zero-thickness annulus IS a stroked circle, and says so.
    assert.closeTo(ring.r0, CEILING, 1e-9);
    assert.closeTo(ring.r1, CEILING, 1e-9);
    assert.closeTo(ring.a0, 0, 1e-9);
    assert.closeTo(ring.a1, 360, 1e-9);
    assert.strictEqual(ring.i, -1);
    // A guide is stroked, never filled (§6.5).
    assert.isNotNull(ring.stroke);
    assert.strictEqual(ring.fill, null);
    noMinusZero(sceneOf(view), "scene");
  });

  test("★ a radial axis is a SPOKE, not a ring", async () => {
    // The same element, the same code path as a cartesian axis:
    // `guidePoint` composes through the plane, and `guideAcross`
    // puts it at the angular range's far end — `360deg`, which on
    // a full turn IS `0deg`, the twelve-o'clock spoke.
    const view = await mount(
      polar(html`<hdml-axis channel="radius"></hdml-axis>`),
    );
    const nodes = groupFor(view, "hdml-axis").nodes;
    assert.lengthOf(nodes, 1);
    assert.strictEqual(nodes[0].k, "path");
    const line = <Extract<SceneNode, { k: "path" }>>nodes[0];
    assert.lengthOf(line.subpaths, 1);
    assert.lengthOf(line.subpaths[0].segments, 1);
    near(line.subpaths[0].start, 360, 0, "pole end");
    const seg = line.subpaths[0].segments[0];
    assert.strictEqual(seg.k, "line");
    near(
      (<Extract<typeof seg, { k: "line" }>>seg).to,
      360,
      CEILING,
      "rim end",
    );
    noMinusZero(sceneOf(view), "scene");
  });

  test("★ --hdml-grid-shape: circle is a ring per tick", async () => {
    const view = await mount(
      polar(html`
        <hdml-grid
          channel="radius"
          count="4"
          style="--hdml-grid-shape: circle"
        ></hdml-grid>
      `),
    );
    const nodes = groupFor(view, "hdml-grid", "radius").nodes;
    // ★ R12/R18: the radii ARE `scale.ticks(spec)`'s positions.
    const at = ticksOf(view, "radius", { count: 4 }).map((t) => t.at);
    assert.isAbove(at.length, 0);
    assert.lengthOf(nodes, at.length);
    nodes.forEach((node, i) => {
      assert.strictEqual(node.k, "arc");
      const ring = <Extract<SceneNode, { k: "arc" }>>node;
      assert.closeTo(ring.r0, at[i], 1e-9);
      assert.closeTo(ring.r1, at[i], 1e-9);
      assert.closeTo(ring.a0, 0, 1e-9);
      assert.closeTo(ring.a1, 360, 1e-9);
    });
    noMinusZero(sceneOf(view), "scene");
  });

  test("★ polygon walks the ANGLE scale's positions", async () => {
    // §6.5: "a closed path through the angle-scale positions". Six
    // categories at `--hdml-bandwidth: 0` sit on the boundaries,
    // and the LAST lands on 360° — which is 0°, step 26's T4. The
    // vertex count is therefore the domain's, six, and two of them
    // coincide; that is §4.4's arithmetic and not this rule's.
    const view = await mount(
      polar(
        html`
          <hdml-grid
            channel="radius"
            count="2"
            style="--hdml-grid-shape: polygon"
          ></hdml-grid>
        `,
        '["a","b","c","d","e","f"]',
      ),
    );
    const nodes = groupFor(view, "hdml-grid", "radius").nodes;
    const at = ticksOf(view, "radius", { count: 2 }).map((t) => t.at);
    const spokes = ticksOf(view, "angle", {}).map((t) => t.at);
    assert.lengthOf(spokes, 6);
    assert.lengthOf(nodes, at.length);
    nodes.forEach((node, i) => {
      assert.strictEqual(node.k, "path");
      const poly = <Extract<SceneNode, { k: "path" }>>node;
      // ★ CLOSED, and one subpath: a ring, not a run of lines.
      assert.isTrue(poly.closed);
      assert.lengthOf(poly.subpaths, 1);
      assert.lengthOf(poly.subpaths[0].segments, spokes.length - 1);
      // A guide carries no data vertex, whatever its shape.
      assert.lengthOf(poly.vertices, 0);
      near(poly.subpaths[0].start, spokes[0], at[i], `ring ${i}`);
      poly.subpaths[0].segments.forEach((seg, j) => {
        assert.strictEqual(seg.k, "line");
        near(
          (<Extract<typeof seg, { k: "line" }>>seg).to,
          spokes[j + 1],
          at[i],
          `ring ${i} vertex ${j + 1}`,
        );
      });
    });
    noMinusZero(sceneOf(view), "scene");
  });

  test("★ a polar label places per tick, derived", async () => {
    // One predicate: the per-axis sign of the outward normal. At
    // the four axis-aligned angles the normal has one zero
    // component, and rule 9's `-0` walk plus the `middle` it
    // produces are the same fact seen twice — `cos(π / 2)` is
    // `6.1e-17`, so the deadband is doing real work here.
    const view = await mount(
      polar(html`
        <hdml-label
          channel="angle"
          values="[0, 0.25, 0.5, 0.75]"
        ></hdml-label>
      `),
    );
    const nodes = groupFor(view, "hdml-label", "angle").nodes;
    assert.lengthOf(nodes, 4);
    const runs = nodes.map(
      (n) => <Extract<SceneNode, { k: "text" }>>n,
    );
    const seen = runs.map((r) => `${r.anchor}/${r.baseline}`);
    assert.deepEqual(seen, [
      // noon: the normal is (0, −) — the text sits above.
      "middle/bottom",
      // 3 o'clock: (+, 0) — the text runs right.
      "start/middle",
      // 6 o'clock: (0, +).
      "middle/top",
      // 9 o'clock: (−, 0).
      "end/middle",
    ]);
    // And the runs sit ON the rim, which is `guideAcross`'s answer
    // for an angular guide: the radial range's far end.
    [0, 90, 180, 270].forEach((deg, i) => {
      near(runs[i], deg, CEILING, `run ${i}`);
    });
    // A label is real text (§5.10), whatever the plane.
    assert.isFalse(runs[0].decorative);
    noMinusZero(sceneOf(view), "scene");
  });

  test("★ a radial label hangs off the noon spoke", async () => {
    const view = await mount(
      polar(html`
        <hdml-label channel="radius" values="[50, 100]"></hdml-label>
      `),
    );
    const runs = groupFor(view, "hdml-label", "radius").nodes.map(
      (n) => <Extract<SceneNode, { k: "text" }>>n,
    );
    assert.lengthOf(runs, 2);
    // Every run is on the same spoke, so every normal is the same
    // — which is the polar case degenerating gracefully into the
    // constant one, not a second rule.
    for (const run of runs) {
      assert.strictEqual(run.anchor, "middle");
      assert.strictEqual(run.baseline, "bottom");
    }
    near(runs[0], 360, 50, "inner");
    near(runs[1], 360, 100, "outer");
  });

  test("★ one `step=` lands on both a grid and a label", async () => {
    // R12/R18 across two elements: they agree because there is ONE
    // generator, not because two ladders match. The grid draws
    // rings and the label draws text, from the same numbers.
    const view = await mount(
      polar(html`
        <hdml-grid
          channel="radius"
          step="25"
          style="--hdml-grid-shape: circle"
        ></hdml-grid>
        <hdml-label channel="radius" step="25"></hdml-label>
      `),
    );
    const at = ticksOf(view, "radius", { step: 25 }).map((t) => t.at);
    assert.isAbove(at.length, 2);
    const rings = groupFor(view, "hdml-grid", "radius").nodes;
    const runs = groupFor(view, "hdml-label", "radius").nodes;
    assert.lengthOf(rings, at.length);
    assert.lengthOf(runs, at.length);
    rings.forEach((node, i) => {
      assert.closeTo(
        (<Extract<SceneNode, { k: "arc" }>>node).r1,
        at[i],
        1e-9,
      );
    });
    runs.forEach((node, i) => {
      near(
        <Extract<SceneNode, { k: "text" }>>node,
        360,
        at[i],
        `${i}`,
      );
    });
  });

  test("★ a tick glyph centres on the projected point", async () => {
    const view = await mount(
      polar(html`
        <hdml-tick
          channel="angle"
          values="[0, 0.25]"
          style="--hdml-tick-style: ellipse; --hdml-tick-width: 8px;
                 --hdml-tick-height: 8px"
        ></hdml-tick>
      `),
    );
    const nodes = groupFor(view, "hdml-tick", "angle").nodes;
    assert.lengthOf(nodes, 2);
    [0, 90].forEach((deg, i) => {
      assert.strictEqual(nodes[i].k, "ellipse");
      const dot = <Extract<SceneNode, { k: "ellipse" }>>nodes[i];
      near({ x: dot.cx, y: dot.cy }, deg, CEILING, `glyph ${i}`);
      // The properties are DIAMETERS in both forms (step 24).
      assert.closeTo(dot.rx, 4, 1e-9);
      assert.closeTo(dot.ry, 4, 1e-9);
      assert.strictEqual(dot.i, -1);
    });
    noMinusZero(sceneOf(view), "scene");
  });

  test("a polar guide scene survives structuredClone", async () => {
    // R2/R26 over every node kind this step added: an `arc` ring,
    // a closed polygon `path`, and text hung off a normal.
    const view = await mount(
      polar(
        html`
          <hdml-axis channel="angle"></hdml-axis>
          <hdml-grid
            channel="radius"
            count="3"
            style="--hdml-grid-shape: polygon"
          ></hdml-grid>
          <hdml-label channel="radius" count="3"></hdml-label>
        `,
        '["a","b","c","d"]',
      ),
    );
    const scene = sceneOf(view, P);
    assert.isAbove(scene.groups.length, 2);
    assert.deepEqual(structuredClone(<unknown>scene), <unknown>scene);
  });

  test("★ a dense polygon grid stays well under R20", async () => {
    // W4 counts NODES, and a polygon is one node however many
    // vertices it carries — which is exactly why a radar's rings
    // cannot be the thing that trips a 20 000 budget.
    const view = await mount(
      polar(
        html`
          <hdml-grid
            channel="radius"
            step="1"
            style="--hdml-grid-shape: polygon"
          ></hdml-grid>
        `,
        '["a","b","c","d","e","f","g","h"]',
      ),
    );
    const scene = sceneOf(view, P);
    const nodes = scene.groups.reduce(
      (n, g) => n + g.nodes.length,
      0,
    );
    const rings = groupFor(view, "hdml-grid", "radius").nodes;
    // `step="1"` over a [0, 100] radius domain: 101 rings, and the
    // whole scene is those 101 nodes.
    assert.lengthOf(rings, 101);
    assert.strictEqual(nodes, 101);
    assert.isBelow(nodes, 20000);
    // Every one of them carries eight vertices and is still one
    // node, so the vertex count never reaches the budget at all.
    for (const node of rings) {
      const poly = <Extract<SceneNode, { k: "path" }>>node;
      assert.lengthOf(poly.subpaths[0].segments, 7);
    }
    assert.isFalse(view.matches(":state(error)"));
  });
});
