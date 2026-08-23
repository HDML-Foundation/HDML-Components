/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert, fixture } from "@open-wc/testing";
import { html } from "lit/static-html.js";
import { LitElement } from "lit";
import "./index";
import type { Point, Scene, SceneGroup, SceneNode } from "./scene";
import {
  installSceneRecorder,
  restoreRenderers,
  roundDeep,
  sceneOf,
} from "../testing/scene-of";
import { HdmlViewElement } from "./view";
import { HdmlAreaElement } from "./mark-area";
import { curve } from "./kernel/curves";

/**
 * `hdml-area` — §6.1's filled band, and **H8**.
 *
 * §6.1: *"one `path`, filled; the upper edge forward then the lower
 * edge reversed, both curved; `y` is sugar for `y0="0"`"*. Three of
 * those clauses are separately assertable and all three are here:
 * the two edges are asserted against **two** `curve()` calls rather
 * than transcribed numbers (R12); the lower edge is asserted to be
 * `curve([reversed])` and **not** the reverse of `curve([forward])`,
 * which is the assertion a curve-then-reverse implementation fails
 * while the first one passes; and the sugar is asserted to produce
 * the same scene as the ranged form it desugars to.
 *
 * **Literal-only fixtures, `padding: 0`, exactly-representable
 * dimensions.** `width: 400` over an `x` domain of `[0, 4]` makes a
 * projection `v · 100`; the ordinal fixture uses `width: 76`, where
 * four categories at the initial `--hdml-bandwidth: 0.8` give a
 * band `step` of exactly `20`.
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

/** That group's one node, asserted to be a path. */
function path(
  view: HdmlViewElement,
): Extract<SceneNode, { k: "path" }> {
  const group = only(view);
  assert.lengthOf(group.nodes, 1);
  const node = group.nodes[0];
  assert.strictEqual(node.k, "path");
  return <Extract<SceneNode, { k: "path" }>>node;
}

function areaOf(view: HdmlViewElement): HdmlAreaElement {
  return <HdmlAreaElement>view.querySelector("hdml-area");
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

/** A group with its instance identity removed, for H8's #1. */
function shape(group: SceneGroup): Record<string, unknown> {
  return { ...group, widget: "" };
}

/**
 * The 400 × 200 cartesian fixture: `x ∈ [0, 4]`, `y ∈ [0, 200]`.
 *
 * Every channel attribute is always present, empty where the test
 * does not want it — an empty attribute reads as unbound, which is
 * how one helper expresses both the simple and the ranged form.
 */
function page(
  x: string,
  y: string,
  y0 = "",
  y1 = "",
  style = "",
): ReturnType<typeof html> {
  return html`
    <hdml-view aria-label="area" style="width: 400px; height: 200px">
      <hdml-cartesian-plane style="padding: 0">
        <hdml-continuous-scale channel="x" min="0" max="6">
          <hdml-continuous-scale channel="y" min="0" max="200">
            <hdml-area
              x="${x}"
              y="${y}"
              y0="${y0}"
              y1="${y1}"
              style="${style}"
            ></hdml-area>
          </hdml-continuous-scale>
        </hdml-continuous-scale>
      </hdml-cartesian-plane>
    </hdml-view>
  `;
}

/** The lower edge, reversed — the list §6.1 says to curve. */
function backwards(points: readonly Point[]): Point[] {
  return points.slice().reverse();
}

suite("hdvl/mark-area — §6.1's filled band", () => {
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

  test("a literal page paints one filled path", async () => {
    // x's range is [0, 400] over a [0, 6] domain, so at(v) = v · 200
    // / 3 — not exact. The 4-point fixture uses whole multiples of
    // 3 so every projection lands on an integer.
    const view = await mount(page("[0, 3, 6]", "[50, 100, 200]"));
    const area = areaOf(view);
    const upper: Point[] = [
      { x: 0, y: 150 },
      { x: 200, y: 100 },
      { x: 400, y: 0 },
    ];
    // The sugar: y0 = 0, which projects to the y range's start.
    const lower: Point[] = [
      { x: 0, y: 200 },
      { x: 200, y: 200 },
      { x: 400, y: 200 },
    ];
    const top = curve([upper], "linear");
    // TWO calls, the second over a REVERSED list (§6.1).
    const bottom = curve([backwards(lower)], "linear");
    const expected: Scene = {
      width: 400,
      height: 200,
      groups: [
        {
          widget: area.uid,
          tag: "hdml-area",
          role: "mark",
          box: { x: 0, y: 0, w: 400, h: 200 },
          opacity: 1,
          filter: "none",
          visibility: "visible",
          clip: true,
          clipPath: null,
          nodes: [
            {
              k: "path",
              // §2.5 — a whole-series node has no source row.
              i: -1,
              subpaths: <ReturnType<typeof curve>>roundDeep(
                [
                  {
                    start: top[0].start,
                    segments: [
                      ...top[0].segments,
                      { k: "line", to: bottom[0].start },
                      ...bottom[0].segments,
                    ],
                  },
                ],
                6,
              ),
              // Each region is a closed outline.
              closed: true,
              vertices: <(Point & { i: number })[]>roundDeep(
                [
                  ...upper.map((p, i) => ({ ...p, i })),
                  ...backwards(lower).map((p, i) => ({
                    ...p,
                    i: lower.length - 1 - i,
                  })),
                ],
                6,
              ),
              // FILLED, and a filled mark does not also stroke.
              fill: paintProp(area, "--hdml-fill-color"),
              stroke: null,
              strokeWidth: 0,
              dash: null,
            },
          ],
        },
      ],
    };
    assert.deepEqual(sceneOf(view, P), expected);
  });

  test("★ the lower edge is reversed BEFORE curving", async () => {
    // The assertion that fails on a curve-then-reverse
    // implementation while the previous one passes. A curve fitted
    // to a reversed point list is not the reverse of the curve
    // fitted to the forward one: `natural`'s tridiagonal solve is
    // global over its run. The lower edge must therefore be
    // ASYMMETRIC — a flat baseline would give the same answer
    // either way and prove nothing.
    const view = await mount(
      page(
        "[0, 3, 6]",
        "",
        "[10, 90, 30]",
        "[120, 140, 190]",
        "--hdml-curve-type: natural",
      ),
    );
    const lower: Point[] = [
      { x: 0, y: 190 },
      { x: 200, y: 110 },
      { x: 400, y: 170 },
    ];
    const forward = curve([lower], "natural");
    const reversed = curve([backwards(lower)], "natural");
    // The fixture is asymmetric enough that direction matters…
    assert.notDeepEqual(forward[0].segments, reversed[0].segments);
    // …and what the scene carries is the REVERSED one.
    const segments = path(view).subpaths[0].segments;
    const tail = segments.slice(segments.length - 2);
    assert.deepEqual(tail, roundDeep(reversed[0].segments, 6));
  });

  test("a gap splits both edges at the same row", async () => {
    // Three rows, a gap, three rows — `curve()` drops a one-point
    // run, and `natural` needs a real run to solve over.
    const view = await mount(
      page(
        "[0, 1, 2, 3, 4, 5, 6]",
        "[50, 60, 70, null, 90, 100, 110]",
      ),
    );
    const node = path(view);
    // TWO regions, each closed: the gap is never bridged.
    assert.lengthOf(node.subpaths, 2);
    assert.isTrue(node.closed);
    // Six surviving rows, each contributing an upper AND a lower
    // vertex — the two edges broke at the SAME row.
    assert.deepEqual(
      node.vertices.map((v) => v.i),
      [0, 1, 2, 2, 1, 0, 4, 5, 6, 6, 5, 4],
    );
  });

  test("a run of fewer than two rows has no region", async () => {
    const view = await mount(
      page("[0, 1, 2, 3, 4]", "[50, null, 70, null, 110]"),
    );
    // Every surviving stretch is one row long, so there is nothing
    // to fill and the group is empty rather than carrying a path
    // that strokes nothing.
    assert.deepEqual(only(view).nodes, []);
  });

  test("★ y='v' and y0='0' y1='v' are one scene", async () => {
    const sugar = await mount(page("[0, 3, 6]", "[50, 100, 200]"));
    const ranged = await mount(
      page("[0, 3, 6]", "", "0", "[50, 100, 200]"),
    );
    assert.deepEqual(shape(only(sugar)), shape(only(ranged)));
  });

  test("an ordinal x resolves to the band CENTRE", async () => {
    // §4.4's counterpart of `hdml-bar`'s band-filling rect:
    // *nothing ever resolves to a band edge*. W = 76, n = 4,
    // b = 0.8 → step 20, centres 8, 28, 48, 68, low edges 0, 20,
    // 40, 60. The area takes the centres.
    const view = await mount(html`
      <hdml-view aria-label="band" style="width: 76px; height: 200px">
        <hdml-cartesian-plane style="padding: 0">
          <hdml-ordinal-scale channel="x" values='["a","b","c","d"]'>
            <hdml-continuous-scale channel="y" min="0" max="200">
              <hdml-area
                x='["a","b","c","d"]'
                y="[0, 50, 100, 150]"
              ></hdml-area>
            </hdml-continuous-scale>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const xs = path(view).vertices.map((v) => v.x);
    assert.deepEqual(xs.slice(0, 4), [8, 28, 48, 68]);
    for (const x of xs) {
      assert.notStrictEqual(x, 0);
      assert.notStrictEqual(x, 60);
    }
  });

  test("a bound color wins over --hdml-fill-color", async () => {
    const view = await mount(html`
      <hdml-view
        aria-label="paint"
        style="width: 400px; height: 200px"
      >
        <hdml-cartesian-plane style="padding: 0">
          <hdml-continuous-scale channel="x" min="0" max="6">
            <hdml-continuous-scale channel="y" min="0" max="200">
              <hdml-ordinal-scale
                channel="color"
                values='["North","South"]'
              >
                <hdml-area
                  x="[0, 3, 6]"
                  y="[50, 100, 200]"
                  color='"North"'
                  style="--hdml-fill-color: red;
                         --hdml-fill-color_hover: lime;
                         --hdml-line-color: blue"
                ></hdml-area>
              </hdml-ordinal-scale>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const area = areaOf(view);
    const node = path(view);
    // §6.1: the channel wins — over `--hdml-fill-color` AND over its
    // `_hover` variant (SPEC §9 has no state exception).
    assert.notStrictEqual(node.fill, prop(area, "--hdml-fill-color"));
    assert.notStrictEqual(
      node.fill,
      prop(area, "--hdml-fill-color_hover"),
    );
    // …and a filled mark does not also stroke, so the line colour
    // reaches nothing at all.
    assert.strictEqual(node.stroke, null);
    assert.strictEqual(node.strokeWidth, 0);
  });

  test("bindings() covers the ranged slots too", async () => {
    const view = await mount(html`
      <hdml-view
        aria-label="bind"
        source="?hdml-frame=t"
        style="width: 400px; height: 200px"
      >
        <hdml-cartesian-plane style="padding: 0">
          <hdml-continuous-scale channel="x" min="0" max="6">
            <hdml-continuous-scale channel="y" min="0" max="200">
              <hdml-area x="t" y0="lo" y1="hi"></hdml-area>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    assert.deepEqual(areaOf(view).bindings(), [
      { slot: "x", ref: "?hdml-frame=t", column: "t", raw: true },
      { slot: "y0", ref: "?hdml-frame=t", column: "lo", raw: true },
      { slot: "y1", ref: "?hdml-frame=t", column: "hi", raw: true },
    ]);
  });

  test("missing renders as absent, never as zero", async () => {
    const view = await mount(
      page("[0, 1, 2, 3]", "[50, 60, null, 80]"),
    );
    for (const vertex of path(view).vertices) {
      assert.notStrictEqual(vertex.i, 2);
    }
  });

  test("its scene round-trips structuredClone", async () => {
    // R2/R26.
    const view = await mount(page("[0, 3, 6]", "[50, 100, 200]"));
    const scene = sceneOf(view);
    assert.deepEqual(structuredClone(scene), scene);
  });

  test("★ a varying color on a path widget is V3", async () => {
    // The plan's second scheduled D1 escalation, decided with the
    // user on 2026-08-23: §2.5's `path` node carries ONE `Paint`,
    // so a per-row colour on a path widget has no honest rendering
    // and taking one row's is §1.5's silent wrong chart.
    const view = await mount(html`
      <hdml-view
        aria-label="vary"
        style="width: 400px; height: 200px"
      >
        <hdml-cartesian-plane style="padding: 0">
          <hdml-continuous-scale channel="x" min="0" max="6">
            <hdml-continuous-scale channel="y" min="0" max="200">
              <hdml-ordinal-scale channel="color" values='["a","b"]'>
                <hdml-area
                  x="[0, 3, 6]"
                  y="[50, 100, 200]"
                  color='["a","b","a"]'
                ></hdml-area>
                <hdml-line id="ok" x="[0, 3]" y="[0, 50]"></hdml-line>
              </hdml-ordinal-scale>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const area = areaOf(view);
    const ok = <Element>view.querySelector("#ok");
    const errors = said("hdml V3 ");
    assert.lengthOf(errors, 1);
    assert.strictEqual(
      messageOf(errors[0]),
      'color="["a","b","a"]" varies per row — hdml-area paints ' +
        "one path with one colour; use a scalar, like " +
        "color='\"North\"'",
    );
    assert.isTrue(area.matches(":state(error)"));
    assert.isFalse(ok.matches(":state(error)"));
  });

  test("a color COLUMN on hdml-line is V3 too", async () => {
    // The rule covers both path widgets and only those. One rule,
    // two tags — which is why step 20 deferred it to here.
    const view = await mount(html`
      <hdml-view aria-label="col" style="width: 400px; height: 200px">
        <hdml-cartesian-plane style="padding: 0">
          <hdml-continuous-scale channel="x" min="0" max="6">
            <hdml-continuous-scale channel="y" min="0" max="200">
              <hdml-ordinal-scale channel="color" values='["a","b"]'>
                <hdml-line
                  x="[0, 3]"
                  y="[50, 100]"
                  color="region"
                ></hdml-line>
              </hdml-ordinal-scale>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const line = <Element>view.querySelector("hdml-line");
    assert.lengthOf(said("hdml V3 "), 1);
    assert.strictEqual(
      messageOf(said("hdml V3 ")[0]),
      'color="region" varies per row — hdml-line paints ' +
        "one path with one colour; use a scalar, like " +
        "color='\"North\"'",
    );
    assert.isTrue(line.matches(":state(error)"));
    // A SCALAR is fine, and recovery clears the state.
    line.setAttribute("color", '"a"');
    view.reindex();
    await quiesce(view);
    assert.isFalse(line.matches(":state(error)"));
  });
});
