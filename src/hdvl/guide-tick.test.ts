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
import { HdmlTickElement } from "./guide-tick";
import { chainScaleOf } from "./scale";

/**
 * `hdml-tick` — §6.5's glyph repeated at scale positions.
 *
 * Three claims carry the suite. **R12**: every position is compared
 * against a real `scale.ticks(spec)` call made from the test.
 * **The extent is a DIAMETER**, in both `--hdml-tick-style` forms —
 * asserted against the *computed property* rather than a
 * transcribed number, because reading a width as a radius draws
 * every glyph at twice its size and both readings are internally
 * consistent. **Placement is CSS**: the glyphs sit on the edge of
 * the tick's own box nearest the scale, so moving that box with one
 * rule moves them.
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

function tickOf(
  view: HdmlViewElement,
  channel = "y",
): HdmlTickElement {
  return <HdmlTickElement>(
    view.querySelector(`hdml-tick[channel="${channel}"]`)
  );
}

function groupOf(view: HdmlViewElement, channel = "y"): SceneGroup {
  const uid = tickOf(view, channel).uid;
  const group = sceneOf(view, P).groups.find((g) => g.widget === uid);
  assert.isDefined(group, "the tick painted no group");
  return group;
}

function nodesOf(
  view: HdmlViewElement,
  channel = "y",
): readonly SceneNode[] {
  return groupOf(view, channel).nodes;
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

/** A computed `<length>` custom property, in CSS px. */
function lengthOf(el: Element, name: string): number {
  return Number.parseFloat(
    getComputedStyle(el).getPropertyValue(name).trim(),
  );
}

/** Where each glyph sits along the tick's own channel. */
function along(view: HdmlViewElement, horizontal: boolean): number[] {
  return nodesOf(view).map((n) => {
    if (n.k === "ellipse") {
      return horizontal ? n.cx : n.cy;
    }
    assert.strictEqual(n.k, "rect");
    const r = <Extract<SceneNode, { k: "rect" }>>n;
    return horizontal ? r.x + r.w / 2 : r.y + r.h / 2;
  });
}

/**
 * A continuous fixture on the UA gutter — a zero-CSS guide lands in
 * it, and its own box is half of what the edge derivation reads.
 */
function page(attrs: string, style = "") {
  // Step 13's T1 / step 23's T2: `lit/static-html` interpolates a
  // raw string nowhere, an attribute LIST least of all.
  const spec = unsafeStatic(attrs);
  return html`
    <hdml-view aria-label="tick" style="width: 400px; height: 200px">
      <hdml-cartesian-plane>
        <hdml-continuous-scale channel="x" min="0" max="4">
          <hdml-continuous-scale channel="y" min="0" max="0.2">
            <hdml-tick
              channel="y"
              ${spec}
              style="${style}"
            ></hdml-tick>
            <hdvl-probe></hdvl-probe>
          </hdml-continuous-scale>
        </hdml-continuous-scale>
      </hdml-cartesian-plane>
    </hdml-view>
  `;
}

suite("hdvl/guide-tick — §6.5's repeated glyph", () => {
  setup(() => {
    installSceneRecorder();
  });

  teardown(() => {
    restoreRenderers();
  });

  test("★ one glyph per tick at scale.ticks(spec)", async () => {
    // R12: a tick that re-derived §4.8's ladder could not pass, at
    // any distance from the real one.
    const view = await mount(page('step="0.05"'));
    assert.lengthOf(<SceneNode[]>nodesOf(view), 5);
    assert.deepEqual(
      <number[]>roundDeep(along(view, false), P.precision),
      expected(view, "y", { step: 0.05 }),
    );
    for (const node of nodesOf(view)) {
      // §2.5: a guide has no rows, so no node carries one.
      assert.strictEqual(node.i, -1);
      assert.isNotNull(node.fill);
      assert.isNull(node.stroke);
    }
  });

  test("★ the registered initial is rect, not ellipse", async () => {
    const view = await mount(page('count="3"'));
    const el = tickOf(view);
    assert.strictEqual(
      getComputedStyle(el)
        .getPropertyValue("--hdml-tick-style")
        .trim(),
      "rect",
    );
    for (const node of nodesOf(view)) {
      assert.strictEqual(node.k, "rect");
    }
  });

  test("★ width and height are DIAMETERS in both forms", async () => {
    // Asserted against the COMPUTED property, never a transcribed
    // number: reading a width as a radius doubles every glyph and
    // both readings are internally consistent.
    const styled = "--hdml-tick-width: 3px; --hdml-tick-height: 9px;";
    const rects = await mount(page('count="3"', styled));
    const el = rects.querySelector("hdml-tick");
    assert.isNotNull(el);
    const w = lengthOf(el, "--hdml-tick-width");
    const h = lengthOf(el, "--hdml-tick-height");
    assert.strictEqual(w, 3);
    assert.strictEqual(h, 9);
    for (const node of nodesOf(rects)) {
      assert.strictEqual(node.k, "rect");
      const r = <Extract<SceneNode, { k: "rect" }>>node;
      assert.strictEqual(r.w, w);
      assert.strictEqual(r.h, h);
    }

    const ovals = await mount(
      page('count="3"', `${styled} --hdml-tick-style: ellipse;`),
    );
    for (const node of nodesOf(ovals)) {
      assert.strictEqual(node.k, "ellipse");
      const e = <Extract<SceneNode, { k: "ellipse" }>>node;
      assert.strictEqual(e.rx, w / 2);
      assert.strictEqual(e.ry, h / 2);
    }

    // …and switching the style moves NOTHING: both forms are
    // centred on the same point.
    assert.deepEqual(along(rects, false), along(ovals, false));
  });

  test("★ it sits on its own near edge", async () => {
    // SPEC §7: "placement is pure CSS… no `position` attribute".
    const left = await mount(page('count="3"'));
    const box = tickOf(left).getBoundingClientRect();
    assert.isAbove(box.width, 0, "the tick measured a zero box");

    const across = (v: HdmlViewElement): number[] =>
      nodesOf(v).map((n) => {
        const r = <Extract<SceneNode, { k: "rect" }>>n;
        return r.x + r.w / 2;
      });
    const right = await mount(
      page('count="3"', "left: 100%; right: auto; width: 40px;"),
    );
    // The y guide's near edge is its RIGHT one on the left of the
    // plot and its LEFT one on the right of it, so the crossing
    // moves and the positions along y do not.
    const a = across(left)[0];
    const b = across(right)[0];
    assert.isAbove(b, a);
    assert.deepEqual(along(left, false), along(right, false));
  });

  test("its role is guide, so empty still counts marks", async () => {
    const view = await mount(page('count="3"'));
    assert.strictEqual(groupOf(view).role, "guide");
    // §3.4.1: a chart of ticks over no data is EMPTY, not full.
    assert.isTrue(view.matches(":state(empty)"));
    const scene = sceneOf(view, P);
    for (const group of scene.groups) {
      assert.notStrictEqual(group.role, "mark");
    }
    // R2/R26: a produced scene is plain serializable data.
    assert.deepEqual(structuredClone(<unknown>scene), <unknown>scene);
  });

  test("★ every glyph is decoration — it emits no text", async () => {
    // §6.5 calls a tick glyph `decorative: true`, but §2.5 puts
    // `decorative` on the `text` node ALONE. A tick's
    // decorative-ness is therefore carried by the node kind it
    // emits, and this is that invariant: nothing it paints is text,
    // so §5.10's aria-hidden floor has nothing to apply to.
    const view = await mount(page('count="3"'));
    for (const node of nodesOf(view)) {
      assert.notStrictEqual(node.k, "text");
      assert.oneOf(node.k, ["rect", "ellipse"]);
    }
  });

  test("an ordinal tick lands on band centres", async () => {
    const view = await mount(html`
      <hdml-view aria-label="ord" style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-ordinal-scale channel="x" values='["a","b","c","d"]'>
            <hdml-continuous-scale channel="y" min="0" max="100">
              <hdml-tick channel="x"></hdml-tick>
              <hdvl-probe></hdvl-probe>
            </hdml-continuous-scale>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const at = <number[]>roundDeep(
      nodesOf(view, "x").map((n) => {
        const r = <Extract<SceneNode, { k: "rect" }>>n;
        return r.x + r.w / 2;
      }),
      P.precision,
    );
    assert.deepEqual(at, expected(view, "x", {}));
    // §4.4: every non-band-filling lookup resolves to the CENTRE.
    const scale = scaleOf(view, "x");
    assert.deepEqual(
      at,
      <number[]>roundDeep(
        ["a", "b", "c", "d"].map((v) => scale.bandOf(v)?.centre),
        P.precision,
      ),
    );
    assert.notDeepEqual(
      at,
      <number[]>roundDeep(
        ["a", "b", "c", "d"].map((v) => scale.bandOf(v)?.start),
        P.precision,
      ),
    );
  });

  test("★ its density is its own", async () => {
    // SPEC §7's corpus idiom: mark every division, label every
    // other. Each element reads its own `tickSpecOf`.
    const view = await mount(html`
      <hdml-view
        aria-label="both"
        style="width: 400px; height: 200px"
      >
        <hdml-cartesian-plane>
          <hdml-continuous-scale channel="x" min="0" max="4">
            <hdml-continuous-scale channel="y" min="0" max="0.2">
              <hdml-tick channel="y" step="0.05"></hdml-tick>
              <hdml-label channel="y" values="[0, 0.1]"></hdml-label>
              <hdvl-probe></hdvl-probe>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    assert.lengthOf(<SceneNode[]>nodesOf(view), 5);
    assert.deepEqual(
      <number[]>roundDeep(along(view, false), P.precision),
      expected(view, "y", { step: 0.05 }),
    );
    const label = <Element>view.querySelector("hdml-label");
    const labels = sceneOf(view, P).groups.find(
      (g) => g.tag === label.localName,
    );
    assert.isDefined(labels);
    assert.lengthOf(<SceneNode[]>labels.nodes, 2);
  });

  test("★ an angular channel paints a glyph per tick", async () => {
    // Step 24's placeholder asserted the opposite. This element
    // needed NO change at step 27: `guideAcross` and `guidePoint`
    // own both halves of where a glyph sits, so it does not know
    // which plane it is under.
    const view = await mount(html`
      <hdml-view aria-label="pol" style="width: 400px; height: 200px">
        <hdml-polar-plane>
          <hdml-continuous-scale channel="angle" min="0" max="4">
            <hdml-continuous-scale channel="radius" min="0" max="10">
              <hdml-tick channel="angle" count="4"></hdml-tick>
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
    const uid = tickOf(view, "angle").uid;
    const group = groups.find((g) => g.widget === uid);
    assert.isDefined(group);
    assert.isAbove(group.nodes.length, 0);
    assert.isTrue(groups.some((g) => g.widget === probe.uid));
  });
});
