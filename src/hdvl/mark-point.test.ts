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
import { HdmlPointElement } from "./mark-point";
import { scaleOf } from "./scale";
import type { HdvlElement } from "./base";

/**
 * `hdml-point` — §6.1's glyph, and §4.3's `size` range.
 *
 * Two things here are easy to get wrong and neither is visible in a
 * transcribed number, so both are asserted against the source of
 * truth rather than against a literal:
 *
 * - **`--hdml-tick-style`'s registered initial is `rect`**, not
 *   `ellipse`. An unstyled page gets squares. Asserted as a pair —
 *   the same fixture in both styles, same centres, same extent.
 * - **The extent is a DIAMETER.** A radius reading draws every glyph
 *   twice its declared size and every scene assertion still passes,
 *   so the extent is asserted against the **computed property**.
 *
 * And the `size` ramp is the **scale's** (R12): `--hdml-size-min` /
 * `-max` are the channel's range (§4.3), so the test compares
 * against a real `scale.project(v)` call and never re-interpolates.
 *
 * **Literal-only fixtures, `padding: 0`**, at 400 × 200 with an `x`
 * domain of `[0, 4]` and a `y` domain of `[0, 200]` — so `at(x)` is
 * `x · 100` and `at(y)` is `200 − y`, both exact.
 */

/** Rule 3's precision, in one place. */
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

/** The one group a single-mark fixture paints. */
function only(view: HdmlViewElement): SceneGroup {
  const groups = sceneOf(view, P).groups;
  assert.lengthOf(groups, 1, "expected exactly one group");
  return groups[0];
}

function ellipses(
  view: HdmlViewElement,
): Extract<SceneNode, { k: "ellipse" }>[] {
  const out: Extract<SceneNode, { k: "ellipse" }>[] = [];
  for (const node of only(view).nodes) {
    assert.strictEqual(node.k, "ellipse");
    out.push(<Extract<SceneNode, { k: "ellipse" }>>node);
  }
  return out;
}

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

function pointOf(view: HdmlViewElement): HdmlPointElement {
  return <HdmlPointElement>view.querySelector("hdml-point");
}

/** A computed `--hdml-*` value, read off the element under test. */
function prop(el: Element, name: string): number {
  return Number.parseFloat(
    getComputedStyle(el).getPropertyValue(name).trim(),
  );
}

/** The same, with `currentcolor` resolved as R16 makes MEASURE do. */
function paintProp(el: Element, name: string): string {
  const style = getComputedStyle(el);
  const raw = style.getPropertyValue(name).trim();
  return raw.toLowerCase() === "currentcolor" ? style.color : raw;
}

function said(prefix: string): string[] {
  return lines.filter((l) => l.startsWith(prefix));
}

/**
 * The 400 × 200 cartesian fixture. `style` goes on the point, so a
 * test can switch `--hdml-tick-style` without a second helper.
 */
function page(
  x: string,
  y: string,
  style = "",
): ReturnType<typeof html> {
  return html`
    <hdml-view aria-label="pt" style="width: 400px; height: 200px">
      <hdml-cartesian-plane style="padding: 0">
        <hdml-continuous-scale channel="x" min="0" max="4">
          <hdml-continuous-scale channel="y" min="0" max="200">
            <hdml-point
              x="${x}"
              y="${y}"
              style="${style}"
            ></hdml-point>
          </hdml-continuous-scale>
        </hdml-continuous-scale>
      </hdml-cartesian-plane>
    </hdml-view>
  `;
}

/**
 * The same, with a `size` scale in the chain whose range is
 * `[4px, 20px]` over a `[0, 10]` domain.
 */
function sized(size: string, style = ""): ReturnType<typeof html> {
  return html`
    <hdml-view aria-label="sz" style="width: 400px; height: 200px">
      <hdml-cartesian-plane style="padding: 0">
        <hdml-continuous-scale channel="x" min="0" max="4">
          <hdml-continuous-scale channel="y" min="0" max="200">
            <hdml-continuous-scale
              channel="size"
              min="0"
              max="10"
              style="--hdml-size-min: 4px; --hdml-size-max: 20px"
            >
              <hdml-point
                x="[0, 1, 2]"
                y="[0, 100, 200]"
                size="${size}"
                style="${style}"
              ></hdml-point>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-continuous-scale>
      </hdml-cartesian-plane>
    </hdml-view>
  `;
}

/** The `size` scale's own `Scale`, for R12's assertion. */
function sizeScale(view: HdmlViewElement): (v: number) => number {
  const el = <HdvlElement>(
    (<unknown>(
      view.querySelector('hdml-continuous-scale[channel="size"]')
    ))
  );
  const scale = scaleOf(el);
  assert.isNotNull(scale);
  return (v: number): number => <number>scale?.project(v);
}

suite("hdvl/mark-point — §6.1's glyph", () => {
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

  test("★ the registered initial style is rect", async () => {
    // SPEC §9's registry table and `properties.ts` both say `rect`,
    // and §6.1's prose names the two forms rather than the default.
    const view = await mount(
      page("[0, 1, 2, 3]", "[50, 100, 150, 200]"),
    );
    const point = pointOf(view);
    const fill = paintProp(point, "--hdml-fill-color");
    const w = prop(point, "--hdml-tick-width");
    const h = prop(point, "--hdml-tick-height");
    const expected: Scene = {
      width: 400,
      height: 200,
      groups: [
        {
          widget: point.uid,
          tag: "hdml-point",
          role: "mark",
          box: { x: 0, y: 0, w: 400, h: 200 },
          opacity: 1,
          filter: "none",
          visibility: "visible",
          clip: true,
          clipPath: null,
          nodes: [0, 1, 2, 3].map((i) => ({
            k: "rect",
            i,
            x: i * 100 - w / 2,
            y: 150 - i * 50 - h / 2,
            w,
            h,
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

  test("★ ellipse and rect share centre and extent", async () => {
    const round = await mount(
      page(
        "[0, 1, 2, 3]",
        "[50, 100, 150, 200]",
        "--hdml-tick-style: ellipse",
      ),
    );
    const square = await mount(
      page("[0, 1, 2, 3]", "[50, 100, 150, 200]"),
    );
    const dots = ellipses(round);
    const boxes = rects(square);
    assert.lengthOf(dots, 4);
    assert.lengthOf(boxes, 4);
    for (let i = 0; i < 4; i++) {
      // Same centre — a rect's is derived, an ellipse's is carried.
      assert.strictEqual(boxes[i].x + boxes[i].w / 2, dots[i].cx);
      assert.strictEqual(boxes[i].y + boxes[i].h / 2, dots[i].cy);
      // Same extent, and the ellipse takes HALF of it.
      assert.strictEqual(dots[i].rx, boxes[i].w / 2);
      assert.strictEqual(dots[i].ry, boxes[i].h / 2);
      assert.strictEqual(boxes[i].i, i);
      assert.strictEqual(dots[i].i, i);
    }
  });

  test("★ the unbound extent is a diameter", async () => {
    // Against the COMPUTED properties, never a transcribed number:
    // a radius reading would double every glyph and every other
    // assertion in this file would still pass.
    const view = await mount(
      page(
        "[0, 1]",
        "[0, 200]",
        "--hdml-tick-width: 8px;" +
          " --hdml-tick-height: 6px; --hdml-tick-style: ellipse",
      ),
    );
    const point = pointOf(view);
    const dots = ellipses(view);
    assert.strictEqual(prop(point, "--hdml-tick-width"), 8);
    assert.strictEqual(prop(point, "--hdml-tick-height"), 6);
    for (const dot of dots) {
      assert.strictEqual(dot.rx, 4);
      assert.strictEqual(dot.ry, 3);
    }
  });

  test("★ a bound size resolves through the size SCALE", async () => {
    // R12 + §4.3: --hdml-size-min/-max are the channel's RANGE, read
    // once, in `scale.ts`, from the SIZE SCALE's own snapshot. This
    // asserts against a real `project()` call, so a second
    // interpolation in the widget could not pass.
    const view = await mount(
      sized("[0, 5, 10]", "--hdml-tick-style: ellipse"),
    );
    const project = sizeScale(view);
    const dots = ellipses(view);
    assert.lengthOf(dots, 3);
    assert.deepEqual(
      dots.map((d) => d.rx),
      [0, 5, 10].map((v) => project(v) / 2),
    );
    // A circle: one channel value, one diameter, both extents.
    for (const dot of dots) {
      assert.strictEqual(dot.rx, dot.ry);
    }
    // And the range really is the two properties, at this fixture.
    assert.deepEqual(
      dots.map((d) => d.rx * 2),
      [4, 12, 20],
    );
  });

  test("★ a size outside the domain is not clamped", async () => {
    const view = await mount(
      sized("[0, 15, 10]", "--hdml-tick-style: ellipse"),
    );
    const project = sizeScale(view);
    const dots = ellipses(view);
    // 15 is half a domain past `max`, so it projects past
    // --hdml-size-max exactly as any continuous channel does.
    assert.strictEqual(dots[1].rx * 2, project(15));
    assert.strictEqual(dots[1].rx * 2, 28);
    assert.isAbove(dots[1].rx * 2, 20);
  });

  test("a bound size ignores the tick properties", async () => {
    const view = await mount(
      sized(
        "[0, 5, 10]",
        "--hdml-tick-style: ellipse; --hdml-tick-width: 40px;" +
          " --hdml-tick-height: 2px",
      ),
    );
    const dots = ellipses(view);
    assert.deepEqual(
      dots.map((d) => [d.rx, d.ry]),
      [
        [2, 2],
        [6, 6],
        [10, 10],
      ],
    );
  });

  test("missing omits the mark, never draws a zero", async () => {
    const view = await mount(
      page("[0, 1, 2, 3]", "[50, null, 150, 200]"),
    );
    const boxes = rects(view);
    assert.lengthOf(boxes, 3);
    assert.deepEqual(
      boxes.map((r) => r.i),
      [0, 2, 3],
    );
    // §4.7's "absent, never zero": nothing sits at the gap row's x.
    for (const r of boxes) {
      assert.notStrictEqual(r.x + r.w / 2, 100);
    }
  });

  test("a non-finite drops the row as a null does", async () => {
    // §4.7 says "a null OR NON-FINITE"; `1e999` is valid JSON.
    const view = await mount(
      page("[0, 1e999, 2, 3]", "[50, 100, 150, 200]"),
    );
    assert.deepEqual(
      rects(view).map((r) => r.i),
      [0, 2, 3],
    );
  });

  test("a missing size drops the row too", async () => {
    // `size` is a bound channel, so §4.7 quantifies over it.
    const view = await mount(
      sized("[0, null, 10]", "--hdml-tick-style: ellipse"),
    );
    assert.deepEqual(
      ellipses(view).map((d) => d.i),
      [0, 2],
    );
  });

  test("★ a per-row color is honest on a point", async () => {
    // It emits one node per row, so the `varying-path-color` rule —
    // `hdml-line`/`hdml-area`'s alone — excludes it. No V3.
    const view = await mount(html`
      <hdml-view aria-label="hue" style="width: 400px; height: 200px">
        <hdml-cartesian-plane style="padding: 0">
          <hdml-continuous-scale channel="x" min="0" max="4">
            <hdml-continuous-scale channel="y" min="0" max="200">
              <hdml-ordinal-scale
                channel="color"
                values='["North","South"]'
              >
                <hdml-point
                  x="[0, 1]"
                  y="[0, 200]"
                  color='["North","South"]'
                ></hdml-point>
              </hdml-ordinal-scale>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    assert.lengthOf(said("hdml V3 "), 0);
    const boxes = rects(view);
    assert.lengthOf(boxes, 2);
    assert.isNotNull(boxes[0].fill);
    assert.notStrictEqual(boxes[0].fill, boxes[1].fill);
  });

  test("a scalar color paints every row the same", async () => {
    const view = await mount(html`
      <hdml-view aria-label="one" style="width: 400px; height: 200px">
        <hdml-cartesian-plane style="padding: 0">
          <hdml-continuous-scale channel="x" min="0" max="4">
            <hdml-continuous-scale channel="y" min="0" max="200">
              <hdml-ordinal-scale
                channel="color"
                values='["North","South"]'
              >
                <hdml-point
                  x="[0, 1]"
                  y="[0, 200]"
                  color='"North"'
                  style="--hdml-fill-color: red"
                ></hdml-point>
              </hdml-ordinal-scale>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const boxes = rects(view);
    assert.lengthOf(said("hdml V3 "), 0);
    assert.strictEqual(boxes[0].fill, boxes[1].fill);
    // §6.1: a bound `color` channel wins over --hdml-fill-color.
    assert.notStrictEqual(boxes[0].fill, "red");
  });

  test("it is filled and does not stroke", async () => {
    const view = await mount(page("[0, 1]", "[0, 200]"));
    for (const r of rects(view)) {
      assert.isNotNull(r.fill);
      assert.strictEqual(r.stroke, null);
      assert.strictEqual(r.strokeWidth, 0);
      assert.strictEqual(r.dash, null);
    }
  });

  test("bindings() covers every published slot", async () => {
    const view = await mount(html`
      <hdml-view
        aria-label="bind"
        source="?hdml-frame=t"
        style="width: 400px; height: 200px"
      >
        <hdml-cartesian-plane style="padding: 0">
          <hdml-continuous-scale channel="x" min="0" max="4">
            <hdml-continuous-scale channel="y" min="0" max="200">
              <hdml-continuous-scale channel="size" min="0" max="10">
                <hdml-ordinal-scale channel="color" values='["a"]'>
                  <hdml-point
                    x="u"
                    y="m"
                    size="rev"
                    color="reg"
                  ></hdml-point>
                </hdml-ordinal-scale>
              </hdml-continuous-scale>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    assert.deepEqual(pointOf(view).bindings(), [
      { slot: "x", ref: "?hdml-frame=t", column: "u", raw: true },
      { slot: "y", ref: "?hdml-frame=t", column: "m", raw: true },
      {
        slot: "color",
        ref: "?hdml-frame=t",
        column: "reg",
        raw: true,
      },
      {
        slot: "size",
        ref: "?hdml-frame=t",
        column: "rev",
        raw: true,
      },
    ]);
  });

  test("datumAt names this widget's bound channels", async () => {
    const view = await mount(page("[0, 1]", "[0, 200]"));
    assert.deepEqual(pointOf(view).datumAt(1), { x: 1, y: 200 });
  });

  test("its scene round-trips structuredClone", async () => {
    // R2/R26.
    const view = await mount(
      page(
        "[0, 1, 2, 3]",
        "[50, 100, 150, 200]",
        "--hdml-tick-style: ellipse",
      ),
    );
    const scene = sceneOf(view);
    assert.deepEqual(structuredClone(scene), scene);
  });
});
