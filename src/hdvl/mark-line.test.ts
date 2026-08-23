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
import type { FakeColumn, FakeResult } from "../testing/FakeIo";
import { FakeIo, mountFakeIo } from "../testing/FakeIo";
import {
  installSceneRecorder,
  restoreRenderers,
  roundDeep,
  sceneOf,
} from "../testing/scene-of";
import { HdmlViewElement } from "./view";
import { HdmlLineElement } from "./mark-line";
import { curve } from "./kernel/curves";
import { splitColorList } from "./kernel/color";

/**
 * `hdml-line` — §6.1's first row, and §4.7 whole.
 *
 * **Literal-only fixtures, `padding: 0`, and dimensions chosen so
 * every expected number is exactly representable** (the plan's
 * reduced-fixture boundary and its rule-1 amendment). With
 * `width: 400` and a `[0, 4]` x domain a projection is `v · 100`;
 * with `width: 76`, four categories and the initial
 * `--hdml-bandwidth: 0.8` a band `step` is exactly `20`. `FakeIo`
 * appears once, for the one case a literal cannot express: a
 * delivered null.
 *
 * Every scene assertion goes through `sceneOf(view, {precision: 6})`
 * (rule 3), and anything the test *computes* rather than transcribes
 * goes through `roundDeep` so both sides are quantized alike.
 */

/** Rule 3's precision, in one place. */
const P = { precision: 6 };

let lines: string[] = [];
let realWarn: typeof console.warn;
let realError: typeof console.error;
let io: FakeIo | null = null;

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

function lineOf(view: HdmlViewElement): HdmlLineElement {
  return <HdmlLineElement>view.querySelector("hdml-line");
}

/** A computed `--hdml-*` value, read off the element under test. */
function prop(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

/**
 * The same value with `currentcolor` resolved, which is what R16
 * makes MEASURE do: chromium and firefox compute the literal and
 * webkit the already-resolved `rgb()`, so an expectation that read
 * the raw value would hold on one engine of three.
 */
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

/** The 400 × 200 cartesian fixture: x ∈ [0, 4], y ∈ [0, 200]. */
function page(
  x: string,
  y: string,
  style = "",
): ReturnType<typeof html> {
  return html`
    <hdml-view aria-label="line" style="width: 400px; height: 200px">
      <hdml-cartesian-plane style="padding: 0">
        <hdml-continuous-scale channel="x" min="0" max="4">
          <hdml-continuous-scale channel="y" min="0" max="200">
            <hdml-line x="${x}" y="${y}" style="${style}"></hdml-line>
          </hdml-continuous-scale>
        </hdml-continuous-scale>
      </hdml-cartesian-plane>
    </hdml-view>
  `;
}

suite("hdvl/mark-line — §6.1's stroked path", () => {
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
    io?.unmount();
    io = null;
  });

  test("a literal page paints one stroked path", async () => {
    const view = await mount(
      page("[0, 1, 2, 3]", "[0, 50, 100, 150]"),
    );
    const line = lineOf(view);
    const points: Point[] = [
      { x: 0, y: 200 },
      { x: 100, y: 150 },
      { x: 200, y: 100 },
      { x: 300, y: 50 },
    ];
    // #3 — the subpaths are what `curve()` returns for the
    // projected runs, asserted against a real call rather than
    // against transcribed numbers (R12).
    const expected: Scene = {
      width: 400,
      height: 200,
      groups: [
        {
          widget: line.uid,
          tag: "hdml-line",
          role: "mark",
          box: { x: 0, y: 0, w: 400, h: 200 },
          opacity: 1,
          filter: "none",
          visibility: "visible",
          // §4.7's clip, from the UA sheet's `overflow: hidden`.
          clip: true,
          clipPath: null,
          nodes: [
            {
              k: "path",
              // §2.5 — a whole-series node has no source row.
              i: -1,
              subpaths: <ReturnType<typeof curve>>(
                roundDeep(curve([points], "linear"), 6)
              ),
              closed: false,
              vertices: points.map((p, i) => ({ ...p, i })),
              fill: null,
              stroke: paintProp(line, "--hdml-line-color"),
              strokeWidth: 1.5,
              dash: null,
            },
          ],
        },
      ],
    };
    assert.deepEqual(sceneOf(view, P), expected);
  });

  test("linear emits lines, a curve emits cubics", async () => {
    const straight = await mount(
      page("[0, 1, 2, 3]", "[0, 50, 100, 150]"),
    );
    for (const segment of path(straight).subpaths[0].segments) {
      assert.strictEqual(segment.k, "line");
    }
    const curved = await mount(
      page(
        "[0, 1, 2, 3]",
        "[0, 50, 100, 150]",
        "--hdml-curve-type: natural",
      ),
    );
    const segments = path(curved).subpaths[0].segments;
    assert.isAbove(segments.length, 0);
    for (const segment of segments) {
      assert.strictEqual(segment.k, "cubic");
    }
  });

  test("an ordinal x resolves to the band centre", async () => {
    // W = 76, n = 4, b = 0.8 → step = 20 exactly, so the centres
    // are 8, 28, 48, 68 and the low edges are 0, 20, 40, 60.
    const view = await mount(html`
      <hdml-view aria-label="band" style="width: 76px; height: 200px">
        <hdml-cartesian-plane style="padding: 0">
          <hdml-ordinal-scale channel="x" values='["a","b","c","d"]'>
            <hdml-continuous-scale channel="y" min="0" max="200">
              <hdml-line
                x='["a","b","c","d"]'
                y="[0, 50, 100, 150]"
              ></hdml-line>
            </hdml-continuous-scale>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    assert.deepEqual(
      path(view).vertices.map((v) => v.x),
      [8, 28, 48, 68],
    );
  });

  test("a bound color channel wins over the sheet", async () => {
    const view = await mount(html`
      <hdml-view
        aria-label="paint"
        style="width: 400px; height: 200px"
      >
        <hdml-cartesian-plane style="padding: 0">
          <hdml-continuous-scale channel="x" min="0" max="4">
            <hdml-continuous-scale channel="y" min="0" max="200">
              <hdml-ordinal-scale
                channel="color"
                values='["North","South"]'
              >
                <hdml-line
                  x="[0, 1, 2, 3]"
                  y="[0, 50, 100, 150]"
                  color='"North"'
                  style="--hdml-fill-color: red;
                         --hdml-fill-color_hover: lime;
                         --hdml-line-color: blue"
                ></hdml-line>
              </hdml-ordinal-scale>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const line = lineOf(view);
    const palette = splitColorList(prop(line, "--hdml-palette"));
    const stroke = path(view).stroke;
    // §6.1: the channel wins — over `--hdml-fill-color` and its
    // `_hover` variant (SPEC §9 has no state exception), and over
    // the stroke colour a stroked mark would otherwise take.
    assert.strictEqual(stroke, palette[0]);
    assert.notStrictEqual(stroke, prop(line, "--hdml-fill-color"));
    assert.notStrictEqual(
      stroke,
      prop(line, "--hdml-fill-color_hover"),
    );
    assert.notStrictEqual(stroke, prop(line, "--hdml-line-color"));
  });

  test("unbound, the stroke is --hdml-line-color", async () => {
    const view = await mount(
      page(
        "[0, 1, 2, 3]",
        "[0, 50, 100, 150]",
        "--hdml-line-color: rgb(1, 2, 3); --hdml-line-width: 3px;" +
          " --hdml-line-style: dashed",
      ),
    );
    const node = path(view);
    assert.strictEqual(node.stroke, "rgb(1, 2, 3)");
    assert.strictEqual(node.fill, null);
    assert.strictEqual(node.strokeWidth, 3);
    assert.deepEqual(node.dash, [12, 9]);
  });

  test("bindings() is one entry per column-bound slot", async () => {
    const view = await mount(html`
      <hdml-view
        aria-label="bind"
        source="?hdml-frame=t"
        style="width: 400px; height: 200px"
      >
        <hdml-cartesian-plane style="padding: 0">
          <hdml-continuous-scale channel="x" min="0" max="4">
            <hdml-continuous-scale channel="y" min="0" max="200">
              <hdml-line x="a" y="[0, 1]"></hdml-line>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    // Keyed by SLOT, carrying the effective (inherited) `source`,
    // `raw: true` because a mark needs values; the literal `y`
    // contributes nothing.
    assert.deepEqual(lineOf(view).bindings(), [
      { slot: "x", ref: "?hdml-frame=t", column: "a", raw: true },
    ]);
  });

  test("a null breaks the path and is never bridged", async () => {
    const view = await mount(
      page("[0, 1, 2, 3, 4]", "[0, 50, null, 150, 200]"),
    );
    const subpaths = path(view).subpaths;
    assert.lengthOf(subpaths, 2);
    // The second subpath starts at row k+1's point, so the gap is
    // a real pen-up rather than a segment nobody drew.
    assert.deepEqual(subpaths[1].start, { x: 300, y: 50 });
    assert.deepEqual(subpaths[0].start, { x: 0, y: 200 });
    // …and the gap row contributed no vertex.
    assert.deepEqual(
      path(view).vertices.map((v) => v.i),
      [0, 1, 3, 4],
    );
  });

  test("rows before a gap ignore those after", async () => {
    // The assertion that fails on a bridge-then-split
    // implementation while the previous one passes. `natural`'s
    // tridiagonal solve is global over its run, so a curve fitted
    // across the gap would return DIFFERENT control points on this
    // side of it.
    const style = "--hdml-curve-type: natural";
    const gapped = await mount(html`
      <hdml-view aria-label="gap" style="width: 600px; height: 200px">
        <hdml-cartesian-plane style="padding: 0">
          <hdml-continuous-scale channel="x" min="0" max="6">
            <hdml-continuous-scale channel="y" min="0" max="200">
              <hdml-line
                x="[0, 1, 2, 3, 4, 5, 6]"
                y="[0, 50, 100, null, 150, 200, 100]"
                style="${style}"
              ></hdml-line>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const alone = await mount(html`
      <hdml-view aria-label="run" style="width: 600px; height: 200px">
        <hdml-cartesian-plane style="padding: 0">
          <hdml-continuous-scale channel="x" min="0" max="6">
            <hdml-continuous-scale channel="y" min="0" max="200">
              <hdml-line
                x="[0, 1, 2]"
                y="[0, 50, 100]"
                style="${style}"
              ></hdml-line>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const before = path(gapped).subpaths;
    assert.lengthOf(before, 2);
    assert.deepEqual(before[0], path(alone).subpaths[0]);
  });

  test("a non-finite breaks the path as a null does", async () => {
    // §4.7 says "a null OR NON-FINITE". `1e999` is valid JSON and
    // parses to `Infinity`, so a literal-only page can express it.
    const view = await mount(
      page("[0, 1, 2, 3, 4]", "[0, 50, 1e999, 150, 200]"),
    );
    assert.lengthOf(path(view).subpaths, 2);
    assert.deepEqual(
      path(view).vertices.map((v) => v.i),
      [0, 1, 3, 4],
    );
  });

  test("missing renders as absent, never as zero", async () => {
    // The y domain's zero projects to 200. No row carries it, so
    // nothing in the scene may sit there.
    const view = await mount(
      page("[0, 1, 2, 3, 4]", "[50, 100, null, 150, 200]"),
    );
    const node = path(view);
    assert.lengthOf(node.vertices, 4);
    for (const vertex of node.vertices) {
      assert.notStrictEqual(vertex.y, 200);
    }
    for (const subpath of node.subpaths) {
      assert.notStrictEqual(subpath.start.y, 200);
      for (const segment of subpath.segments) {
        assert.notStrictEqual(segment.to.y, 200);
      }
    }
  });

  test("a continuous out-of-domain is not clamped", async () => {
    const view = await mount(
      page("[0, 1, 2, 6]", "[0, 50, 100, 150]"),
    );
    const node = path(view);
    // 6 projects to 600, two hundred px past the range's end. §4.7:
    // "a line honestly exits the frame rather than silently
    // bending" — the CLIP is the group's, not the geometry's.
    assert.strictEqual(node.vertices[3].x, 600);
    assert.isTrue(only(view).clip);
  });

  test("an out-of-domain ordinal notices once", async () => {
    const view = await mount(html`
      <hdml-view aria-label="ood" style="width: 76px; height: 200px">
        <hdml-cartesian-plane style="padding: 0">
          <hdml-ordinal-scale channel="x" values='["a","b","c","d"]'>
            <hdml-continuous-scale channel="y" min="0" max="200">
              <hdml-line
                x='["a","b","zz","d"]'
                y="[0, 50, 100, 150]"
              ></hdml-line>
            </hdml-continuous-scale>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const notices = said("hdml hdml-line —");
    assert.lengthOf(notices, 1);
    assert.strictEqual(
      messageOf(notices[0]),
      '"zz" is outside the "x" domain — the row produces no mark',
    );
    // R25: the same frame twice notices once.
    view.markDirty();
    await quiesce(view);
    assert.lengthOf(said("hdml hdml-line —"), 1);
    // The row simply produced no mark; the rest of the line did.
    assert.deepEqual(
      path(view).vertices.map((v) => v.i),
      [0, 1, 3],
    );
  });

  test("every row dropped errors on the scale", async () => {
    const view = await mount(html`
      <hdml-view
        aria-label="drop"
        style="width: 400px; height: 200px"
      >
        <hdml-cartesian-plane style="padding: 0">
          <hdml-ordinal-scale channel="x" values='["a","b","c"]'>
            <hdml-continuous-scale channel="y" min="0" max="200">
              <hdml-line
                x='["p","q","r"]'
                y="[0, 50, 100]"
              ></hdml-line>
            </hdml-continuous-scale>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
        <hdml-cartesian-plane style="padding: 0">
          <hdml-continuous-scale channel="x" min="0" max="4">
            <hdml-continuous-scale channel="y" min="0" max="200">
              <hdml-line id="ok" x="[0, 1]" y="[0, 50]"></hdml-line>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const scale = <Element>view.querySelector("hdml-ordinal-scale");
    const ok = <HdmlLineElement>view.querySelector("#ok");
    const errors = said("hdml V2 ");
    assert.lengthOf(errors, 1);
    assert.strictEqual(
      messageOf(errors[0]),
      'every row is outside the "x" domain — check the bound column',
    );
    // §4.7: "the SCALE errors", and §3.5 makes a scale its own unit.
    assert.isTrue(scale.matches(":state(error)"));
    assert.isFalse(view.matches(":state(error)"));
    // …and the sibling plane still renders.
    assert.isTrue(
      sceneOf(view, P).groups.some((g) => g.widget === ok.uid),
    );
  });

  test("a delivered null breaks the path too", async () => {
    // The one case a literal cannot express: D9's row-null bitmask
    // over a Float64Array, which is the only faithful null carrier
    // a numeric column has.
    const values = Float64Array.from([0, 50, 0, 150, 200]);
    const nulls = new Uint8Array(1);
    nulls[0] = 1 << 2;
    const column: FakeColumn = {
      values: {
        buffer: values.buffer,
        byteOffset: values.byteOffset,
        byteLength: values.byteLength,
      },
      nulls: {
        buffer: nulls.buffer,
        byteOffset: nulls.byteOffset,
        byteLength: nulls.byteLength,
      },
      domain: { kind: "extent", value: [0, 200] },
      type: { kind: "number" },
    };
    const result: FakeResult = {
      generation: 1,
      rows: 5,
      columns: { v: column },
    };
    io = mountFakeIo({ "?hdml-frame=g": result });
    const view = await mount(html`
      <hdml-view
        aria-label="deliver"
        source="?hdml-frame=g"
        style="width: 400px; height: 200px"
      >
        <hdml-cartesian-plane style="padding: 0">
          <hdml-continuous-scale channel="x" min="0" max="4">
            <hdml-continuous-scale channel="y" min="0" max="200">
              <hdml-line x="[0, 1, 2, 3, 4]" y="v"></hdml-line>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const node = path(view);
    assert.lengthOf(node.subpaths, 2);
    assert.deepEqual(
      node.vertices.map((v) => v.i),
      [0, 1, 3, 4],
    );
    // …and the row that was null is absent, not zero: the y domain's
    // zero is 200 px, and the null row's stored value IS 0.
    for (const vertex of node.vertices) {
      assert.notStrictEqual(vertex.i, 2);
    }
  });

  test("its scene round-trips structuredClone", async () => {
    // R2/R26, now with a real producer rather than a hand-built
    // literal: the scene is plain, immutable, serializable data.
    const view = await mount(
      page("[0, 1, 2, 3]", "[0, 50, 100, 150]"),
    );
    const scene = sceneOf(view);
    assert.deepEqual(structuredClone(scene), scene);
  });
});
