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
import type { Scale } from "./scale";
import type { SceneGroup, SceneNode } from "./scene";
import { HdvlProbeElement, PROBE_TAG } from "../testing/probe";
import {
  installSceneRecorder,
  restoreRenderers,
  roundDeep,
  sceneOf,
} from "../testing/scene-of";
import { ENGINE, negativeZeros } from "../testing/corpus";
import { HdmlViewElement } from "./view";
import { HdmlLegendElement } from "./guide-legend";
import { chainScaleOf, localeOf } from "./scale";
import { formatCompactSet } from "./kernel/format-skeleton";
import { measureText } from "./measure-text";
import { diagnosticsOf } from "./validate";

/**
 * `hdml-legend` — §6.6's key, in both modes.
 *
 * Four claims carry the suite. **The mode is DERIVED**: the same
 * markup under an ordinal scale is a swatch key and under a
 * continuous one a labeled ramp, with no attribute naming either.
 * **One entry is one datum**: entry *k*'s swatch is
 * `paint(domain[k])` and its text is `domain[k]`, generated
 * together, which is finding 17's whole reason for a dedicated
 * element. **R18**: every ramp colour is a real `paint()` call, and
 * a mark bound to the same scale returns the same string. And
 * **the key is the scale's, not the marks'** — it renders a domain
 * value no row uses, on a page with no data provider at all.
 */

const P = { precision: 6 };

/** The domain every ordinal fixture below declares. */
const DOMAIN = ["North", "South", "East"];

/** Three colours, one per {@link DOMAIN} entry. */
const PALETTE = "#ff0000 #00ff00 #0000ff";

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

function legendOf(view: HdmlViewElement): HdmlLegendElement {
  const el = view.querySelector("hdml-legend");
  assert.isNotNull(el, "the page declares no legend");
  return <HdmlLegendElement>el;
}

function groupOf(view: HdmlViewElement): SceneGroup {
  const uid = legendOf(view).uid;
  const group = sceneOf(view, P).groups.find((g) => g.widget === uid);
  assert.isDefined(group, "the legend painted no group");
  return group;
}

function nodesOf(view: HdmlViewElement): readonly SceneNode[] {
  return groupOf(view).nodes;
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

/** A computed `<length>` custom property, in CSS px. */
function lengthOf(el: Element, name: string): number {
  return Number.parseFloat(
    getComputedStyle(el).getPropertyValue(name).trim(),
  );
}

function texts(nodes: readonly SceneNode[]): string[] {
  return nodes.filter((n) => n.k === "text").map((n) => n.text);
}

function swatches(
  nodes: readonly SceneNode[],
): Extract<SceneNode, { k: "rect" | "ellipse" }>[] {
  return nodes.filter((n) => n.k === "rect" || n.k === "ellipse");
}

/** A swatch's centre, whichever shape it took. */
function centre(
  node: Extract<SceneNode, { k: "rect" | "ellipse" }>,
): [number, number] {
  return node.k === "ellipse"
    ? [node.cx, node.cy]
    : [node.x + node.w / 2, node.y + node.h / 2];
}

const KEY_BOX = "top: 0; left: 0; width: 140px; height: 120px;";

/** An ordinal colour scale, and nothing bound to it. */
function keyPage(attrs = "", style = "", palette = PALETTE) {
  // Step 13's T1: `lit/static-html` interpolates a raw string
  // nowhere, an attribute LIST least of all.
  const spec = unsafeStatic(attrs);
  return html`
    <hdml-view aria-label="key" style="width: 400px; height: 200px">
      <hdml-cartesian-plane style="padding: 0">
        <hdml-continuous-scale channel="x" min="0" max="10">
          <hdml-ordinal-scale
            channel="color"
            values='["North","South","East"]'
            style="--hdml-palette: ${palette}"
          >
            <hdml-legend
              channel="color"
              ${spec}
              style="${KEY_BOX} ${style}"
            ></hdml-legend>
            <hdvl-probe></hdvl-probe>
          </hdml-ordinal-scale>
        </hdml-continuous-scale>
      </hdml-cartesian-plane>
    </hdml-view>
  `;
}

const STOPS = "--hdml-color-interpolate: #dbeafe #1c8cf4 #1e3a8a;";

/**
 * A continuous colour scale over `[0, 64]`, so that `2i + 1` is
 * sample *i*'s exact midpoint — which is what lets the R18
 * assertion be a `strictEqual` on a colour string rather than a
 * comparison of two roundings.
 */
function rampPage(attrs = "", style = "") {
  const spec = unsafeStatic(attrs);
  return html`
    <hdml-view aria-label="ramp" style="width: 400px; height: 200px">
      <hdml-cartesian-plane style="padding: 0">
        <hdml-continuous-scale channel="x" min="0" max="10">
          <hdml-continuous-scale channel="y" min="0" max="10">
            <hdml-continuous-scale
              channel="color"
              min="0"
              max="64"
              style="${STOPS}"
            >
              <hdml-point
                x="[1, 2]"
                y="[3, 4]"
                color="[21, 43]"
              ></hdml-point>
              <hdml-legend
                channel="color"
                ${spec}
                style="${KEY_BOX} ${style}"
              ></hdml-legend>
              <hdvl-probe></hdvl-probe>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-continuous-scale>
      </hdml-cartesian-plane>
    </hdml-view>
  `;
}

suite("hdvl/guide-legend — §6.6's ordinal key", () => {
  setup(() => {
    installSceneRecorder();
  });

  teardown(() => {
    restoreRenderers();
  });

  test("★ one entry per domain value, whole domain", async () => {
    // §6: a scale is never fed by widgets, so the key is the
    // SCALE's — this page binds no colour at all and still gets
    // all three entries, in domain order.
    const view = await mount(keyPage());
    const nodes = nodesOf(view);
    assert.lengthOf(<SceneNode[]>nodes, 6);
    assert.deepEqual(texts(nodes), DOMAIN);
    assert.lengthOf(swatches(nodes), 3);
    for (const node of nodes) {
      // §2.5: a domain value is not a source row.
      assert.strictEqual(node.i, -1);
    }
  });

  test("★ entry k is swatch k and name k", async () => {
    const view = await mount(keyPage());
    const nodes = nodesOf(view);
    const scale = scaleOf(view, "color");
    const marks = swatches(nodes);
    for (let k = 0; k < DOMAIN.length; k++) {
      // The pair is generated together, from one value, so the
      // correspondence is positional rather than contractual.
      assert.strictEqual(marks[k].fill, scale.paint(DOMAIN[k]));
      assert.strictEqual(texts(nodes)[k], DOMAIN[k]);
      assert.strictEqual(nodes[k * 2].k, marks[k].k);
      assert.strictEqual(nodes[k * 2 + 1].k, "text");
    }
  });

  test("★ the swatch is legend-swatch-size", async () => {
    // Asserted against the COMPUTED property, and against a
    // DIFFERENT --hdml-tick-width, because SPEC §9's tick-width row
    // says a swatch is not sized by it and both readings draw a
    // plausible square.
    const styled =
      "--hdml-legend-swatch-size: 14px; --hdml-tick-width: 3px;";
    const view = await mount(keyPage("", styled));
    const el = legendOf(view);
    const size = lengthOf(el, "--hdml-legend-swatch-size");
    assert.strictEqual(size, 14);
    assert.strictEqual(lengthOf(el, "--hdml-tick-width"), 3);
    for (const node of swatches(nodesOf(view))) {
      assert.strictEqual(node.k, "rect");
      const r = <Extract<SceneNode, { k: "rect" }>>node;
      assert.strictEqual(r.w, size);
      assert.strictEqual(r.h, size);
    }
  });

  test("★ tick-style shapes it, and moves nothing", async () => {
    const rects = await mount(keyPage());
    const el = legendOf(rects);
    assert.strictEqual(
      getComputedStyle(el)
        .getPropertyValue("--hdml-tick-style")
        .trim(),
      "rect",
    );
    const ovals = await mount(
      keyPage("", "--hdml-tick-style: ellipse;"),
    );
    const size = lengthOf(
      legendOf(ovals),
      "--hdml-legend-swatch-size",
    );
    for (const node of swatches(nodesOf(ovals))) {
      assert.strictEqual(node.k, "ellipse");
      const e = <Extract<SceneNode, { k: "ellipse" }>>node;
      assert.strictEqual(e.rx, size / 2);
      assert.strictEqual(e.ry, size / 2);
    }
    assert.deepEqual(
      swatches(nodesOf(ovals)).map(centre),
      swatches(nodesOf(rects)).map(centre),
    );
  });

  test("★ the swatch is decoration, the name is not", async () => {
    // §2.5 gives `decorative` to `text` ALONE, so a swatch has no
    // such field: its decorative-ness is the node kind it emits.
    // The invariant asserted is therefore the structural one.
    const view = await mount(keyPage());
    const nodes = nodesOf(view);
    assert.lengthOf(
      nodes.filter((n) => n.k === "text"),
      DOMAIN.length,
    );
    for (const node of nodes) {
      if (node.k === "text") {
        assert.isFalse(node.decorative);
      } else {
        assert.notProperty(node, "decorative");
      }
    }
  });

  test("★ entries flow along the direction property", async () => {
    const down = await mount(keyPage());
    const el = legendOf(down);
    const gap = lengthOf(el, "--hdml-legend-gap");
    const size = lengthOf(el, "--hdml-legend-swatch-size");
    assert.strictEqual(gap, 4);
    assert.strictEqual(
      getComputedStyle(el)
        .getPropertyValue("--hdml-legend-direction")
        .trim(),
      "column",
    );
    const marks = swatches(nodesOf(down)).map(centre);
    // Column: one x, y advancing by the line height plus the gap.
    assert.strictEqual(marks[0][0], marks[1][0]);
    assert.strictEqual(marks[1][0], marks[2][0]);
    const step = marks[1][1] - marks[0][1];
    assert.isAbove(step, 0);
    assert.closeTo(marks[2][1] - marks[1][1], step, 1e-9);

    const across = await mount(
      keyPage("", "--hdml-legend-direction: row;"),
    );
    const rowed = swatches(nodesOf(across)).map(centre);
    assert.strictEqual(rowed[0][1], rowed[1][1]);
    assert.isAbove(rowed[1][0], rowed[0][0]);
    // ★ ONE property for both gaps (§9): the swatch↔name gap is
    // the same `--hdml-legend-gap` the entries are spaced by.
    const name = nodesOf(across).filter((n) => n.k === "text")[0];
    assert.closeTo(
      name.x - (rowed[0][0] - size / 2),
      size + gap,
      1e-9,
    );
  });

  test("★ an exhausted palette still gets its entry", async () => {
    // `paletteColor` returns null past the end rather than
    // wrapping, and the entry falls back to --hdml-fill-color —
    // visibly and uniformly, exactly as the marks do. The count is
    // the SCALE's error (V2 / palette-exhausted), asserted here as
    // present so the two halves cannot drift apart.
    const view = await mount(keyPage("", "", "#ff0000 #00ff00"));
    const nodes = nodesOf(view);
    const scale = scaleOf(view, "color");
    assert.lengthOf(<SceneNode[]>nodes, 6);
    assert.deepEqual(texts(nodes), DOMAIN);
    assert.isNull(scale.paint("East"));
    // `--hdml-fill-color`'s initial is `currentColor`, which R16
    // resolves in MEASURE — and computes as the literal on two
    // engines and as `rgb()` on webkit, so the expectation is the
    // element's own resolved `color`.
    const fallback = getComputedStyle(legendOf(view)).color;
    assert.strictEqual(swatches(nodes)[2].fill, fallback);
    const found = diagnosticsOf(view).filter(
      (d) => d.code === "palette-exhausted",
    );
    assert.lengthOf(found, 1);
  });

  test("★ it is not a Binder, and needs no provider", async () => {
    // SPEC §6.6: "binds no columns and takes no `source`". The page
    // has no `hdml-io` and no FakeIo, and the key renders.
    const view = await mount(keyPage());
    const el: object = legendOf(view);
    assert.notProperty(el, "bindings");
    assert.isUndefined(
      (<{ bindings?: unknown }>el).bindings,
      "hdml-legend must not implement Binder",
    );
    assert.isNull(view.querySelector("hdml-io"));
    assert.lengthOf(<SceneNode[]>nodesOf(view), 6);
  });

  test("★ the group is a guide, clipped by its own CSS", async () => {
    // §9's legend overflow, and v1's no-scrollport: nothing in the
    // element implements either — `guideGroup` transfers
    // `Measured.clip` and the renderer clips the group to its box,
    // which is §5.4's reach rule applied to every widget alike.
    const spill = await mount(keyPage());
    assert.strictEqual(groupOf(spill).role, "guide");
    assert.isFalse(groupOf(spill).clip);

    for (const value of ["hidden", "auto", "scroll"]) {
      const view = await mount(keyPage("", `overflow: ${value};`));
      assert.isTrue(groupOf(view).clip, value);
      const el = legendOf(view);
      // No scrollport: the entries are on the VIEW's surface, so
      // this element's own box has nothing to scroll.
      assert.strictEqual(el.scrollHeight, el.clientHeight, value);
      assert.strictEqual(el.scrollWidth, el.clientWidth, value);
    }
  });

  test("★ the UA default, and the corpus idiom over it", async () => {
    // SPEC §3: "top-right inside the plot area (top: 8px;
    // right: 8px against its scale box); width: max-content".
    const bare = await mount(html`
      <hdml-view aria-label="ua" style="width: 400px; height: 200px">
        <hdml-cartesian-plane style="padding: 0">
          <hdml-ordinal-scale
            channel="color"
            values='["North","South","East"]'
          >
            <hdml-legend channel="color"></hdml-legend>
            <hdvl-probe></hdvl-probe>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const el = legendOf(bare);
    const style = getComputedStyle(el);
    assert.strictEqual(style.top, "8px");
    assert.strictEqual(style.right, "8px");
    // `left` resolves to a USED value, so `left: auto` cannot be
    // read back — what proves it is the box below: had the rule
    // left `inset: 0`'s `left: 0` in force, the box would be
    // over-constrained, `right` would be ignored, and the key
    // would anchor to the plot's LEFT edge.
    // ★ The finding: `max-content` over an empty shadow tree is 0,
    // so the row anchors the key rather than hugging it. Recorded
    // rather than worked around — see `ua.ts`.
    assert.strictEqual(el.getBoundingClientRect().width, 0);
    const plot = <HTMLElement>(
      bare.querySelector("hdml-cartesian-plane")
    );
    const box = plot.getBoundingClientRect();
    const own = el.getBoundingClientRect();
    assert.closeTo(own.right, box.right - 8, 1e-6);
    assert.closeTo(own.top, box.top + 8, 1e-6);

    // …and one author rule beats it, which is what all five corpus
    // pages that carry a legend write.
    const gutter = await mount(
      keyPage("", "top: 8px; left: 100%; width: 110px;"),
    );
    const moved = legendOf(gutter).getBoundingClientRect();
    const plane = <HTMLElement>(
      gutter.querySelector("hdml-cartesian-plane")
    );
    assert.strictEqual(moved.width, 110);
    assert.closeTo(
      moved.left,
      plane.getBoundingClientRect().right,
      1e-6,
    );
  });

  test("★ the densest key: nodes, W4 and -0", async () => {
    const view = await mount(keyPage());
    const scene = sceneOf(view);
    const group = scene.groups.find(
      (g) => g.widget === legendOf(view).uid,
    );
    assert.isDefined(group);
    assert.lengthOf(<SceneNode[]>group.nodes, 6);
    // R20's budget is 20 000 and W4 is console-only, so the
    // assertion that it is silent is that no warning is a
    // diagnostic — `diagnosticsOf` carries errors only here.
    assert.deepEqual(diagnosticsOf(view), []);
    assert.deepEqual(negativeZeros(scene), []);
  });
});

suite("hdvl/guide-legend — §6.6's continuous ramp", () => {
  setup(() => {
    installSceneRecorder();
  });

  teardown(() => {
    restoreRenderers();
  });

  test("★ the mode is the tag, not an attribute", async () => {
    // The identical markup: one page's legend sits under an
    // ordinal colour scale and the other's under a continuous one,
    // and neither says which mode it wants.
    const key = await mount(keyPage());
    const ramp = await mount(rampPage());
    assert.deepEqual(texts(nodesOf(key)), DOMAIN);
    assert.lengthOf(swatches(nodesOf(key)), 3);
    // A bar of 32 samples, and no swatch-and-name pairing at all.
    assert.isAbove(swatches(nodesOf(ramp)).length, 3);
    assert.notDeepEqual(texts(nodesOf(ramp)), DOMAIN);
  });

  test("★ every sample is a paint() call", async () => {
    const view = await mount(rampPage());
    const scale = scaleOf(view, "color");
    const bar = swatches(nodesOf(view));
    assert.lengthOf(bar, 32);
    // Sample i spans [2i, 2i + 2] of the [0, 64] domain, so its
    // midpoint is 2i + 1 exactly — a formula this test states and
    // the element must agree with, colour string for colour string.
    for (const i of [0, 7, 16, 31]) {
      assert.strictEqual(bar[i].fill, scale.paint(2 * i + 1));
    }
    assert.include(<string>bar[7].fill, "color-mix(");
  });

  test("★ R18 — the bar and the mark agree", async () => {
    // The same claim the marks make, not a re-derivation: the
    // point is bound to the SAME continuous colour scale, so its
    // fill must be a sample's fill, byte for byte.
    const view = await mount(rampPage());
    const scale = scaleOf(view, "color");
    const point = sceneOf(view).groups.find(
      (g) => g.tag === "hdml-point",
    );
    assert.isDefined(point, "the point painted no group");
    const bar = swatches(nodesOf(view));
    assert.strictEqual(point.nodes[0].fill, scale.paint(21));
    assert.strictEqual(bar[10].fill, point.nodes[0].fill);
    assert.strictEqual(point.nodes[1].fill, scale.paint(43));
    assert.strictEqual(bar[21].fill, point.nodes[1].fill);
  });

  test("★ the bar's axis is the ramp fraction", async () => {
    const view = await mount(rampPage());
    const scale = scaleOf(view, "color");
    const box = legendOf(view).getBoundingClientRect();
    const bar = <Extract<SceneNode, { k: "rect" }>[]>(
      swatches(nodesOf(view))
    );
    // Column direction: a vertical bar, thickness from the swatch
    // property, running the box's whole height.
    const size = lengthOf(
      legendOf(view),
      "--hdml-legend-swatch-size",
    );
    assert.strictEqual(bar[0].w, size);
    assert.closeTo(bar[0].y, 0, 1e-6);
    const end = bar[31].y + bar[31].h;
    assert.closeTo(end, box.height, 1e-6);
    // Sample i starts where project(2i) says, which on a linear
    // scale is i / 32 of the bar.
    for (const i of [1, 11, 29]) {
      const f = scale.project(2 * i);
      assert.isNotNull(f);
      assert.closeTo(bar[i].y, f * box.height, 1e-6);
    }
  });

  test("★ the direction orients the bar", async () => {
    const view = await mount(
      rampPage("", "--hdml-legend-direction: row;"),
    );
    const size = lengthOf(
      legendOf(view),
      "--hdml-legend-swatch-size",
    );
    const bar = <Extract<SceneNode, { k: "rect" }>[]>(
      swatches(nodesOf(view))
    );
    const box = legendOf(view).getBoundingClientRect();
    assert.strictEqual(bar[0].h, size);
    assert.closeTo(bar[0].x, 0, 1e-6);
    assert.closeTo(bar[31].x + bar[31].w, box.width, 1e-6);
    for (const node of bar) {
      assert.strictEqual(node.y, 0);
    }
  });

  test("★ graduations come from scale.ticks(spec)", async () => {
    // R12: the positions are compared against a real ticks() call
    // made from the test, so a legend with a ladder of its own
    // could not pass at any distance from the real one.
    const view = await mount(rampPage('count="4"'));
    const scale = scaleOf(view, "color");
    const box = legendOf(view).getBoundingClientRect();
    const want = scale.ticks({ count: 4 });
    const runs = nodesOf(view).filter((n) => n.k === "text");
    assert.lengthOf(<SceneNode[]>runs, want.length);
    assert.deepEqual(
      <number[]>roundDeep(
        runs.map((n) => n.y),
        P.precision,
      ),
      <number[]>roundDeep(
        want.map((t) => t.at * box.height),
        P.precision,
      ),
    );
  });

  test("★ the values are formatted as a SET", async () => {
    // SPEC §7 makes coherence a property of the label set: value
    // by value, one colorbar reads `900K, 1.2M, 1.5M`.
    const view = await mount(
      rampPage('count="4" format="compact-short"'),
    );
    const scale = scaleOf(view, "color");
    const want = formatCompactSet(
      scale.ticks({ count: 4 }).map((t) => <number>t.value),
      "compact-short",
      localeOf(legendOf(view)),
    );
    // Rule 4: a rendered Intl string is ICU data.
    if (ENGINE === "chromium") {
      assert.deepEqual(texts(nodesOf(view)), want);
    }
    assert.lengthOf(texts(nodesOf(view)), want.length);
  });

  test("★ count is a target, not a guarantee", async () => {
    // Four round numbers beat four arbitrary ones, so a domain of
    // [0, 100] answers `count="4"` with three ticks — and the
    // assertion is the ROUNDNESS, never the cardinality.
    const view = await mount(
      html`
        <hdml-view aria-label="t" style="width: 400px; height: 200px">
          <hdml-cartesian-plane style="padding: 0">
            <hdml-continuous-scale
              channel="color"
              min="0"
              max="100"
              style="${STOPS}"
            >
              <hdml-legend
                channel="color"
                count="4"
                style="${KEY_BOX}"
              ></hdml-legend>
              <hdvl-probe></hdvl-probe>
            </hdml-continuous-scale>
          </hdml-cartesian-plane>
        </hdml-view>
      `,
    );
    const values = scaleOf(view, "color")
      .ticks({ count: 4 })
      .map((t) => <number>t.value);
    assert.deepEqual(values, [0, 50, 100]);
    assert.notStrictEqual(values.length, 4);
    assert.lengthOf(texts(nodesOf(view)), values.length);
  });

  test("★ the ramp: nodes, W4 and -0", async () => {
    const view = await mount(rampPage('count="4"'));
    const scene = sceneOf(view);
    assert.lengthOf(<SceneNode[]>nodesOf(view), 36);
    assert.deepEqual(diagnosticsOf(view), []);
    assert.deepEqual(negativeZeros(scene), []);
  });

  test("★ a zero-extent box paints no bar", async () => {
    // The UA default's cross axis is `max-content` over an empty
    // shadow tree, and a row-direction ramp then has no length —
    // which is nothing to paint, not a guess at one.
    const view = await mount(
      rampPage(
        "",
        "--hdml-legend-direction: row; width: 0px; left: 0;",
      ),
    );
    assert.lengthOf(<SceneNode[]>nodesOf(view), 0);
  });
});

/** The one seam a legend needs that a positional guide also uses. */
suite("hdvl/guide-legend — the text-metric seam", () => {
  setup(() => {
    installSceneRecorder();
  });

  teardown(() => {
    restoreRenderers();
  });

  test("★ an entry's line height is its metrics'", async () => {
    // §5.3's seam exists for exactly this: a legend cannot advance
    // its flow without knowing how tall a name is. Both the
    // renderer and the recording stub delegate to one module
    // (H10), so the number here is the number that ships.
    const view = await mount(keyPage());
    const group = groupOf(view);
    const marks = swatches(group.nodes).map(centre);
    const font = (<Extract<SceneNode, { k: "text" }>>group.nodes[1])
      .font;
    const m = measureText("North", font);
    const size = lengthOf(
      legendOf(view),
      "--hdml-legend-swatch-size",
    );
    const gap = lengthOf(legendOf(view), "--hdml-legend-gap");
    const line = Math.max(size, m.ascent + m.descent);
    assert.closeTo(marks[1][1] - marks[0][1], line + gap, 1e-2);
  });
});
