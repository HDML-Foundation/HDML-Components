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
import {
  installSceneRecorder,
  restoreRenderers,
  sceneOf,
} from "../testing/scene-of";
import { HdmlViewElement } from "./view";

/**
 * H7 under a **polar** plane — `hdml-line`, `hdml-area` and
 * `hdml-point`, plus §6.1's `closed`.
 *
 * **★ The step-26 verdict, and this file is the evidence.** H7 says
 * a mark never names a channel: it reads
 * `Projection.channels`, which is the plane's answer. If that held,
 * the three marks step 20–22 wrote for a cartesian plane paint under
 * a polar one with **no diff at all** — and they do. Every geometry
 * assertion below runs against code that was not touched, which is
 * the only way the claim can be tested: a prediction is not proved
 * by the file that would have had to change, it is proved by the
 * fixture that runs without it changing.
 *
 * **`closed` is the one thing that IS new** (SPEC §7's *"+ `closed`
 * for radar loops"*), and it is scoped to the plane's channels
 * rather than to its kind — a cartesian line's node is asserted
 * **byte-identical** with and without the attribute.
 *
 * **Rule 2 binds hard here.** Every coordinate below is a
 * `Math.sin`/`Math.cos` away from its pole, so nothing is
 * `deepEqual` and everything is `closeTo(…, 1e-9)`. The four
 * axis-aligned angles are exactly where a residual shows: at 0° the
 * projected x is `cx + r · cos(−π/2)`, and `cos(−π/2)` is `6.1e-17`
 * and not zero.
 *
 * **Literal-only fixtures, `padding: 0`**, on a 200 × 200 polar
 * plane, so the pole is `(100, 100)` and the radial ceiling is
 * `min(200, 200) / 2 = 100`. Both scales take a `[0, 1]` fraction
 * domain, so `at(angle) = v · 360` degrees and `at(radius) = v · 100`
 * px — and `[0, 0.25, 0.5, 0.75]` is noon, 3, 6 and 9 o'clock.
 */

/** Rule 3's precision, in one place. */
const P = { precision: 6 };

/** The pole and the radial ceiling this fixture geometry gives. */
const CX = 100;
const CY = 100;
const CEILING = 100;

/** The four axis-aligned angles, as `[0, 1]` fractions. */
const QUARTERS = "[0, 0.25, 0.5, 0.75]";

/** Every row at the ceiling, so a quarter turn is a full radius. */
const OUTER = "[1, 1, 1, 1]";

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

/** The one group a single-mark fixture paints. */
function only(view: HdmlViewElement): SceneGroup {
  const groups = sceneOf(view).groups;
  assert.lengthOf(groups, 1, "expected exactly one group");
  return groups[0];
}

/** That group's one node, asserted to be a `path`. */
function pathOf(
  view: HdmlViewElement,
): Extract<SceneNode, { k: "path" }> {
  const nodes = only(view).nodes;
  assert.lengthOf(nodes, 1, "expected exactly one node");
  assert.strictEqual(nodes[0].k, "path");
  return <Extract<SceneNode, { k: "path" }>>nodes[0];
}

/**
 * §4.6's own arithmetic, restated in the test.
 *
 * It is deliberately **not** an import of `polarPoint`: an assertion
 * that calls the implementation it is checking proves only that the
 * implementation is deterministic. This is the formula off §4.6,
 * typed out.
 */
function expect(degrees: number, radius: number): [number, number] {
  const t = ((degrees - 90) * Math.PI) / 180;
  return [CX + radius * Math.cos(t), CY + radius * Math.sin(t)];
}

/** Rule 2 — a projected point, never `deepEqual`. */
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
 * A polar page carrying one mark, spelled by the caller.
 *
 * The two scales are the arc fixture's, so a reader comparing the
 * two files is comparing geometry and not setup.
 */
function polar(
  mark: ReturnType<typeof html>,
): ReturnType<typeof html> {
  return html`
    <hdml-view aria-label="polar" style="width: 200px; height: 200px">
      <hdml-polar-plane style="padding: 0">
        <hdml-continuous-scale channel="angle" min="0" max="1">
          <hdml-continuous-scale channel="radius" min="0" max="1">
            ${mark}
          </hdml-continuous-scale>
        </hdml-continuous-scale>
      </hdml-polar-plane>
    </hdml-view>
  `;
}

/** The same page over a CARTESIAN plane, for `closed`'s scoping. */
function flat(
  mark: ReturnType<typeof html>,
): ReturnType<typeof html> {
  return html`
    <hdml-view aria-label="flat" style="width: 200px; height: 200px">
      <hdml-cartesian-plane style="padding: 0">
        <hdml-continuous-scale channel="x" min="0" max="1">
          <hdml-continuous-scale channel="y" min="0" max="1">
            ${mark}
          </hdml-continuous-scale>
        </hdml-continuous-scale>
      </hdml-cartesian-plane>
    </hdml-view>
  `;
}

suite("hdvl/mark-polar — H7 under a polar plane", () => {
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

  test("★ hdml-line paints under a polar plane", async () => {
    // ZERO lines of `mark-line.ts` geometry changed for this. The
    // element reads `channels` and gets `angle`/`radius`.
    const view = await mount(
      polar(
        html`<hdml-line
          angle="${QUARTERS}"
          radius="${OUTER}"
        ></hdml-line>`,
      ),
    );
    const node = pathOf(view);
    assert.strictEqual(node.i, -1);
    assert.lengthOf(node.vertices, 4);
    assert.lengthOf(node.subpaths, 1);
    [0, 90, 180, 270].forEach((deg, i) => {
      near(node.vertices[i], deg, CEILING, `vertex ${i}`);
      assert.strictEqual(node.vertices[i].i, i);
    });
    // A stroked mark: §6.1's `fill: null`, unchanged by the plane.
    assert.strictEqual(node.fill, null);
    assert.isNotNull(node.stroke);
    noMinusZero(sceneOf(view), "scene");
  });

  test("★ `closed` closes the subpath, polar", async () => {
    const view = await mount(
      polar(
        html`<hdml-line
          closed
          angle="${QUARTERS}"
          radius="${OUTER}"
        ></hdml-line>`,
      ),
    );
    const node = pathOf(view);
    assert.isTrue(node.closed);
    // ★ The loop costs no vertex. Appending a copy of row 0 would
    // put a second `i: 0` in here and make hit resolution and
    // §4.7's accounting disagree with N.
    assert.lengthOf(node.vertices, 4);
    assert.lengthOf(node.subpaths[0].segments, 3);
    near(node.subpaths[0].start, 0, CEILING, "start");
  });

  test("★ `closed` is inert on a cartesian plane", async () => {
    // SPEC §7 grants it "for radar loops" and a cartesian line is
    // not one. The two nodes are BYTE-IDENTICAL: the attribute
    // does not reach the geometry, the paint or the vertex list.
    const bare = await mount(
      flat(
        html`<hdml-line x="${QUARTERS}" y="${OUTER}"></hdml-line>`,
      ),
    );
    const marked = await mount(
      flat(
        html`<hdml-line
          closed
          x="${QUARTERS}"
          y="${OUTER}"
        ></hdml-line>`,
      ),
    );
    assert.isFalse(pathOf(marked).closed);
    assert.deepEqual(
      sceneOf(marked, P).groups[0].nodes,
      sceneOf(bare, P).groups[0].nodes,
    );
  });

  test("★ hdml-area paints under a polar plane", async () => {
    // The ranged form is the primitive (H8), so `r0`/`r1` here is
    // `y0`/`y1` there and nothing in `mark-area.ts` knows which.
    const view = await mount(
      polar(
        html`<hdml-area
          angle="${QUARTERS}"
          r0="[0.2, 0.2, 0.2, 0.2]"
          r1="${OUTER}"
        ></hdml-area>`,
      ),
    );
    const node = pathOf(view);
    // One closed region: four upper vertices then four lower ones,
    // reversed — the same construction as a cartesian band.
    assert.isTrue(node.closed);
    assert.lengthOf(node.vertices, 8);
    [0, 90, 180, 270].forEach((deg, i) => {
      near(node.vertices[i], deg, CEILING, `upper ${i}`);
    });
    [270, 180, 90, 0].forEach((deg, i) => {
      near(node.vertices[4 + i], deg, 20, `lower ${i}`);
    });
    // A filled mark: §6.1's fill, no outline.
    assert.isNotNull(node.fill);
    assert.strictEqual(node.stroke, null);
    noMinusZero(sceneOf(view), "scene");
  });

  test("★ hdml-point paints under a polar plane", async () => {
    const view = await mount(
      polar(
        html`<hdml-point
          angle="${QUARTERS}"
          radius="[0.5, 1, 0.5, 1]"
          style="--hdml-tick-style: ellipse"
        ></hdml-point>`,
      ),
    );
    const nodes = only(view).nodes;
    assert.lengthOf(nodes, 4);
    [0, 90, 180, 270].forEach((deg, i) => {
      const node = nodes[i];
      assert.strictEqual(node.k, "ellipse");
      const dot = <Extract<SceneNode, { k: "ellipse" }>>node;
      assert.strictEqual(dot.i, i);
      near(
        { x: dot.cx, y: dot.cy },
        deg,
        i % 2 === 0 ? 50 : CEILING,
        `dot ${i}`,
      );
    });
    noMinusZero(sceneOf(view), "scene");
  });

  test("a polar scene survives structuredClone", async () => {
    // R2/R26, over the composition this step added: a closed line
    // and an area under a polar plane in one view.
    const view = await mount(
      polar(
        html`<hdml-area
            angle="${QUARTERS}"
            r0="[0, 0, 0, 0]"
            r1="${OUTER}"
          ></hdml-area>
          <hdml-line
            closed
            angle="${QUARTERS}"
            radius="${OUTER}"
          ></hdml-line>`,
      ),
    );
    const scene = sceneOf(view);
    assert.lengthOf(scene.groups, 2);
    assert.deepEqual(structuredClone(scene), scene);
  });
});
