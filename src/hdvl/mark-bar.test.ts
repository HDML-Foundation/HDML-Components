/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert, fixture } from "@open-wc/testing";
import { html } from "lit/static-html.js";
import { LitElement } from "lit";
import "./index";
import type { Scene, SceneGroup, SceneNode } from "./scene";
import {
  installSceneRecorder,
  restoreRenderers,
  sceneOf,
} from "../testing/scene-of";
import { HdmlViewElement } from "./view";
import { HdmlBarElement } from "./mark-bar";
import { bandOf } from "./kernel/scale-band";

/**
 * `hdml-bar` — §6.1's band-filling rect, and **H8**.
 *
 * **The ranged form is the primitive and the simple form is sugar**
 * (§6.4). The sharpest assertion in the file is that `y="v"` and
 * `y0="0" y1="v"` produce the same scene: not two code paths that
 * agree, but one — which is what let `hdml-stack` supply `y0ₖ` at
 * step 29 with a **zero-line** diff to `mark-bar.ts`. The two
 * "step 29" references in that file are deliberately not retired:
 * retiring them would change the file whose not changing is the
 * whole of what they predict.
 *
 * **Its orientation is derived**, so the same tag with `x`/`y`
 * swapped lays the bars down, from a fixture that names no
 * orientation.
 *
 * **Literal-only fixtures, `padding: 0`, and dimensions chosen so
 * every expected number is exactly representable.** With
 * `width: 76`, four categories and the initial
 * `--hdml-bandwidth: 0.8` the band `step` is exactly `20` — the
 * plan's rule-1 amendment, which binds hard here because this is
 * the widget that reads `bandOf().width`. `width: 100` would give
 * `26.315789473684212`.
 */

/** Rule 3's precision, in one place. */
const P = { precision: 6 };

/** The vertical fixture's geometry: W = 76, n = 4, b = 0.8. */
const W = 76;
const N = 4;

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

/** The one group a single-mark fixture paints. */
function only(view: HdmlViewElement): SceneGroup {
  const groups = sceneOf(view, P).groups;
  assert.lengthOf(groups, 1, "expected exactly one group");
  return groups[0];
}

/** That group's nodes, asserted to be rects. */
function rects(
  view: HdmlViewElement,
): Extract<SceneNode, { k: "rect" }>[] {
  const out: Extract<SceneNode, { k: "rect" }>[] = [];
  for (const node of only(view).nodes) {
    assert.strictEqual(node.k, "rect");
    out.push(<Extract<SceneNode, { k: "rect" }>>node);
  }
  return out;
}

function barOf(view: HdmlViewElement): HdmlBarElement {
  return <HdmlBarElement>view.querySelector("hdml-bar");
}

/** A computed `--hdml-*` value, read off the element under test. */
function prop(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

/** The same, with `currentcolor` resolved as R16 makes MEASURE do. */
function paintProp(el: Element, name: string): string {
  const style = getComputedStyle(el);
  const raw = style.getPropertyValue(name).trim();
  return raw.toLowerCase() === "currentcolor" ? style.color : raw;
}

/** The message half of a `hdml … — <message>` console line. */
function messageOf(line: string): string {
  const at = line.indexOf(" — ");
  return at < 0 ? line : line.slice(at + 3);
}

function said(prefix: string): string[] {
  return lines.filter((l) => l.startsWith(prefix));
}

/**
 * The 76 × 200 vertical fixture: an ordinal `x` of four categories
 * over a `[0, 200]` continuous `y`.
 *
 * Every channel attribute is always present, empty where the test
 * does not want it — an empty attribute reads as unbound, which is
 * how one helper can express both the simple and the ranged form.
 */
function page(
  y: string,
  y0 = "",
  y1 = "",
  scaleStyle = "",
  cats = '["a","b","c","d"]',
): ReturnType<typeof html> {
  return html`
    <hdml-view aria-label="bar" style="width: 76px; height: 200px">
      <hdml-cartesian-plane style="padding: 0">
        <hdml-ordinal-scale
          channel="x"
          values='["a","b","c","d"]'
          style="${scaleStyle}"
        >
          <hdml-continuous-scale channel="y" min="0" max="200">
            <hdml-bar
              x="${cats}"
              y="${y}"
              y0="${y0}"
              y1="${y1}"
            ></hdml-bar>
          </hdml-continuous-scale>
        </hdml-ordinal-scale>
      </hdml-cartesian-plane>
    </hdml-view>
  `;
}

/** The same chart lying down: a continuous `x`, an ordinal `y`. */
function sideways(x: string): ReturnType<typeof html> {
  return html`
    <hdml-view aria-label="flat" style="width: 200px; height: 76px">
      <hdml-cartesian-plane style="padding: 0">
        <hdml-continuous-scale channel="x" min="0" max="200">
          <hdml-ordinal-scale channel="y" values='["a","b","c","d"]'>
            <hdml-bar x="${x}" y='["a","b","c","d"]'></hdml-bar>
          </hdml-ordinal-scale>
        </hdml-continuous-scale>
      </hdml-cartesian-plane>
    </hdml-view>
  `;
}

/** A group with its instance identity removed, for H8's #1. */
function shape(group: SceneGroup): Record<string, unknown> {
  return { ...group, widget: "" };
}

suite("hdvl/mark-bar — §6.1's band-filling rect", () => {
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

  test("a literal page paints one rect per row", async () => {
    const view = await mount(page("[50, 100, 150, 200]"));
    const bar = barOf(view);
    const fill = paintProp(bar, "--hdml-fill-color");
    // y's range is bottom → top, so at(v) = 200 − v, and the sugar
    // y0 = 0 projects to 200 — the baseline every bar starts from.
    const expected: Scene = {
      width: 76,
      height: 200,
      groups: [
        {
          widget: bar.uid,
          tag: "hdml-bar",
          role: "mark",
          box: { x: 0, y: 0, w: 76, h: 200 },
          opacity: 1,
          filter: "none",
          visibility: "visible",
          clip: true,
          clipPath: null,
          nodes: [0, 1, 2, 3].map((i) => ({
            k: "rect",
            i,
            x: i * 20,
            y: 150 - i * 50,
            w: 16,
            h: 50 + i * 50,
            fill,
            stroke: null,
            strokeWidth: 0,
            dash: null,
          })),
        },
      ],
    };
    assert.deepEqual(sceneOf(view, P), expected);
  });

  test("the ordinal side spans the band, never a point", async () => {
    // §4.4: a bar spans `width_k`, centred by construction. Asserted
    // against a real `bandOf` call rather than transcribed numbers
    // (R12) — and against `start`/`width`, never `centre`, which is
    // what every OTHER lookup in the project resolves to.
    const view = await mount(page("[50, 100, 150, 200]"));
    const got = rects(view);
    assert.lengthOf(got, N);
    for (let k = 0; k < N; k++) {
      const band = bandOf(k, N, [0, W], 0.8);
      assert.isNotNull(band);
      assert.strictEqual(got[k].x, band?.start);
      assert.strictEqual(got[k].w, band?.width);
      assert.notStrictEqual(got[k].x, band?.centre);
    }
  });

  test("orientation is derived, not authored", async () => {
    // ONE fixture shape, x and y swapped, no attribute naming an
    // orientation anywhere — and the bars rotate ninety degrees.
    const up = rects(await mount(page("[50, 100, 150, 200]")));
    const flat = rects(await mount(sideways("[50, 100, 150, 200]")));
    assert.deepEqual(
      up.map((r) => [r.x, r.y, r.w, r.h]),
      [
        [0, 150, 16, 50],
        [20, 100, 16, 100],
        [40, 50, 16, 150],
        [60, 0, 16, 200],
      ],
    );
    assert.deepEqual(
      flat.map((r) => [r.x, r.y, r.w, r.h]),
      [
        [0, 60, 50, 16],
        [0, 40, 100, 16],
        [0, 20, 150, 16],
        [0, 0, 200, 16],
      ],
    );
    // The band is 16 across on BOTH, and it is a different axis.
    for (const r of up) {
      assert.strictEqual(r.w, 16);
    }
    for (const r of flat) {
      assert.strictEqual(r.h, 16);
    }
  });

  test("the band arithmetic is exact on this fixture", async () => {
    // Rule 1's 2026-08-20 amendment, both halves. The FIXTURE-SCOPED
    // half: W = 76, n = 4, b = 0.8 makes step exactly 20, so the
    // edge-to-edge identity holds bit-for-bit here. Asserting it
    // over arbitrary geometry would compare two roundings against
    // one and hold in only 32 % of configurations.
    const got = rects(await mount(page("[50, 100, 150, 200]")));
    for (let k = 0; k < N - 1; k++) {
      assert.strictEqual(got[k + 1].x - got[k].x, 20);
    }
    for (const r of got) {
      assert.strictEqual(r.w, 16);
    }
  });

  test("at bandwidth 1 the width IS the step", async () => {
    // The UNIVERSALLY-true half: `width_k = b · step`, so at b = 1
    // every width is the step, for every k. On this fixture the step
    // is 76 / 4 = 19 exactly, so the seam closes too.
    const view = await mount(
      page("[50, 100, 150, 200]", "", "", "--hdml-bandwidth: 1"),
    );
    const got = rects(view);
    const step = W / N;
    for (let k = 0; k < N; k++) {
      assert.strictEqual(got[k].w, step);
      assert.strictEqual(got[k].x, k * step);
    }
    for (let k = 0; k < N - 1; k++) {
      // No gap: the next band's low edge IS this one's high edge.
      assert.strictEqual(got[k].x + got[k].w, got[k + 1].x);
    }
  });

  test("★ y='v' and y0='0' y1='v' are one scene", async () => {
    // H8's whole claim, as one deepEqual. The ranged form is the
    // primitive; the simple form is sugar for `y0="0"`, resolved
    // into it BEFORE any geometry exists.
    const sugar = await mount(page("[50, 100, 150, 200]"));
    const ranged = await mount(page("", "0", "[50, 100, 150, 200]"));
    assert.deepEqual(shape(only(sugar)), shape(only(ranged)));
  });

  test("floating bars never touch the baseline", async () => {
    // Page 03-C: `<hdml-bar x="month" y0="t_min" y1="t_max">`.
    const view = await mount(
      page("", "[50, 60, 70, 80]", "[150, 160, 170, 180]"),
    );
    const got = rects(view);
    assert.deepEqual(
      got.map((r) => [r.y, r.h]),
      [
        [50, 100],
        [40, 100],
        [30, 100],
        [20, 100],
      ],
    );
    // The y domain's zero projects to 200; no rect reaches it.
    for (const r of got) {
      assert.isBelow(r.y + r.h, 200);
    }
  });

  test("a row whose ends are equal is zero-extent", async () => {
    // A real datum, not a missing one: §4.7's "absent, never zero"
    // is the OPPOSITE case, and dropping this row would lose it.
    const view = await mount(
      page("", "[100, 100, 100, 100]", "[100, 150, 100, 50]"),
    );
    const got = rects(view);
    assert.lengthOf(got, 4);
    assert.deepEqual(
      got.map((r) => r.h),
      [0, 50, 0, 50],
    );
    assert.deepEqual(
      got.map((r) => r.i),
      [0, 1, 2, 3],
    );
  });

  test("missing omits the mark, never draws a zero", async () => {
    const view = await mount(page("[50, null, 150, 200]"));
    const got = rects(view);
    assert.lengthOf(got, 3);
    assert.deepEqual(
      got.map((r) => r.i),
      [0, 2, 3],
    );
    // The y domain's zero is 200 px. Nothing sits there with h = 0,
    // and the gap row's band (x = 20) carries no rect at all.
    for (const r of got) {
      assert.notStrictEqual(r.x, 20);
    }
  });

  test("a non-finite drops the row as a null does", async () => {
    // §4.7 says "a null OR NON-FINITE"; `1e999` is valid JSON.
    const view = await mount(page("[50, 1e999, 150, 200]"));
    assert.deepEqual(
      rects(view).map((r) => r.i),
      [0, 2, 3],
    );
  });

  test("an out-of-domain ordinal notices once", async () => {
    const view = await mount(
      page("[50, 100, 150, 200]", "", "", "", '["a","b","zz","d"]'),
    );
    const notices = said("hdml hdml-bar —");
    assert.lengthOf(notices, 1);
    assert.strictEqual(
      messageOf(notices[0]),
      '"zz" is outside the "x" domain — the row produces no mark',
    );
    // R25: the same frame twice notices once. And it is a NOTICE,
    // not a warning — no `hdml W…` line accompanies it.
    view.markDirty();
    await quiesce(view);
    assert.lengthOf(said("hdml hdml-bar —"), 1);
    assert.lengthOf(said("hdml W"), 0);
    assert.deepEqual(
      rects(view).map((r) => r.i),
      [0, 1, 3],
    );
  });

  test("every row dropped errors on the scale", async () => {
    const view = await mount(
      page("[50, 100, 150, 200]", "", "", "", '["p","q","r","s"]'),
    );
    const scale = <Element>view.querySelector("hdml-ordinal-scale");
    const errors = said("hdml V2 ");
    assert.lengthOf(errors, 1);
    assert.strictEqual(
      messageOf(errors[0]),
      'every row is outside the "x" domain — check the bound column',
    );
    assert.isTrue(scale.matches(":state(error)"));
    assert.isFalse(view.matches(":state(error)"));
  });

  test("with no ordinal scale it paints nothing", async () => {
    // Orientation is DERIVED from which channel is ordinal, so a
    // chart with two continuous scales has no band and therefore no
    // honest width to give a bar.
    const view = await mount(html`
      <hdml-view aria-label="none" style="width: 76px; height: 200px">
        <hdml-cartesian-plane style="padding: 0">
          <hdml-continuous-scale channel="x" min="0" max="4">
            <hdml-continuous-scale channel="y" min="0" max="200">
              <hdml-bar x="[0, 1]" y="[50, 100]"></hdml-bar>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    assert.lengthOf(sceneOf(view, P).groups, 0);
  });

  test("a per-row color is honest on a bar", async () => {
    // The D1 escalation excludes `hdml-bar` deliberately: it emits
    // one node per row and resolves each row's colour separately,
    // so nothing is silently collapsed. No V3 error, and the two
    // rects carry DIFFERENT fills.
    const view = await mount(html`
      <hdml-view aria-label="hue" style="width: 76px; height: 200px">
        <hdml-cartesian-plane style="padding: 0">
          <hdml-ordinal-scale channel="x" values='["a","b"]'>
            <hdml-continuous-scale channel="y" min="0" max="200">
              <hdml-ordinal-scale
                channel="color"
                values='["North","South"]'
              >
                <hdml-bar
                  x='["a","b"]'
                  y="[50, 100]"
                  color='["North","South"]'
                ></hdml-bar>
              </hdml-ordinal-scale>
            </hdml-continuous-scale>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    assert.lengthOf(said("hdml V3 "), 0);
    const got = rects(view);
    assert.lengthOf(got, 2);
    assert.isNotNull(got[0].fill);
    assert.notStrictEqual(got[0].fill, got[1].fill);
  });

  test("a bound color wins over --hdml-fill-color", async () => {
    const view = await mount(html`
      <hdml-view
        aria-label="paint"
        style="width: 76px; height: 200px"
      >
        <hdml-cartesian-plane style="padding: 0">
          <hdml-ordinal-scale channel="x" values='["a","b"]'>
            <hdml-continuous-scale channel="y" min="0" max="200">
              <hdml-ordinal-scale
                channel="color"
                values='["North","South"]'
              >
                <hdml-bar
                  x='["a","b"]'
                  y="[50, 100]"
                  color='"North"'
                  style="--hdml-fill-color: red;
                         --hdml-fill-color_hover: lime"
                ></hdml-bar>
              </hdml-ordinal-scale>
            </hdml-continuous-scale>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const bar = barOf(view);
    const fill = rects(view)[0].fill;
    // §6.1: the channel wins — over `--hdml-fill-color` AND over its
    // `_hover` variant (SPEC §9 has no state exception).
    assert.notStrictEqual(fill, prop(bar, "--hdml-fill-color"));
    assert.notStrictEqual(fill, prop(bar, "--hdml-fill-color_hover"));
    // And a filled mark does not also stroke.
    assert.strictEqual(rects(view)[0].stroke, null);
    assert.strictEqual(rects(view)[0].strokeWidth, 0);
  });

  test("bindings() covers the ranged slots too", async () => {
    const view = await mount(html`
      <hdml-view
        aria-label="bind"
        source="?hdml-frame=t"
        style="width: 76px; height: 200px"
      >
        <hdml-cartesian-plane style="padding: 0">
          <hdml-ordinal-scale channel="x" values='["a","b"]'>
            <hdml-continuous-scale channel="y" min="0" max="200">
              <hdml-bar x="cat" y0="lo" y1="hi"></hdml-bar>
            </hdml-continuous-scale>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    assert.deepEqual(barOf(view).bindings(), [
      { slot: "x", ref: "?hdml-frame=t", column: "cat", raw: true },
      { slot: "y0", ref: "?hdml-frame=t", column: "lo", raw: true },
      { slot: "y1", ref: "?hdml-frame=t", column: "hi", raw: true },
    ]);
  });

  test("its scene round-trips structuredClone", async () => {
    // R2/R26.
    const view = await mount(page("[50, 100, 150, 200]"));
    const scene = sceneOf(view);
    assert.deepEqual(structuredClone(scene), scene);
  });
});
