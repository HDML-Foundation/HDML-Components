/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert, fixture } from "@open-wc/testing";
import { html } from "lit/static-html.js";
import { LitElement } from "lit";
import "./index";
import type { BufferRef } from "../hdio/delivery";
import type { HdvlElement } from "./base";
import type { SceneGroup, SceneNode } from "./scene";
import {
  installSceneRecorder,
  restoreRenderers,
  sceneOf,
} from "../testing/scene-of";
import { mountFakeIo } from "../testing/FakeIo";
import {
  negativeZeros,
  nodeCount,
  numberCol,
  result,
  stringCol,
} from "../testing/corpus";
import { HdmlViewElement } from "./view";
import { scaleOf } from "./scale";

/**
 * `hdml-stack` — §6.4's baseline derive, and **H8 measured**.
 *
 * The sharpest assertion in the file is the one that names no
 * number: **band *k*'s top IS band *k+1*'s baseline**, `strictEqual`
 * on the raw scene. A stack that computed each child's endpoints
 * from the same source but by two roundings would pass a
 * `closeTo` and leave a hairline gap at every seam; the identity is
 * what says the two are one number.
 *
 * **Every number here is exactly representable.** `width: 76`, four
 * categories and the initial `--hdml-bandwidth: 0.8` give a band
 * `step` of exactly `20`; the `y` range is `[0, 200]` over a 200 px
 * plane, so `at(v) = 200 − v` and every baseline is an integer sum
 * of integers. Rule 1: the assertions are identities between two
 * expressions, not transcribed coordinates.
 *
 * **`mark-bar.ts` and `mark-area.ts` are not imported and did not
 * change.** H8's claim is that a stack re-parameterises two widgets
 * that know nothing about it; the `git diff` half of that is in the
 * landed note, and this file is the behavioural half.
 */

/** The vertical fixture: W = 76, n = 4, b = 0.8 → step 20. */
const CATS = '["a","b","c","d"]';

/** The three series every stacked fixture uses. */
const A = [20, 25, 22, 28];
const B = [15, 18, 21, 17];
const C = [30, 27, 24, 33];

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

/** Re-runs the frame after a declarative change. */
async function reflow(view: HdmlViewElement): Promise<void> {
  await settle(view);
  view.markDirty();
  await quiesce(view);
}

/** The mark groups, in paint order — the containers emit none. */
function groups(view: HdmlViewElement): readonly SceneGroup[] {
  return sceneOf(view).groups;
}

/** One group's nodes, asserted to be rects. */
function rects(
  group: SceneGroup,
): Extract<SceneNode, { k: "rect" }>[] {
  const out: Extract<SceneNode, { k: "rect" }>[] = [];
  for (const node of group.nodes) {
    assert.strictEqual(node.k, "rect");
    out.push(<Extract<SceneNode, { k: "rect" }>>node);
  }
  return out;
}

/** One group's single `path` node. */
function path(group: SceneGroup): Extract<SceneNode, { k: "path" }> {
  assert.lengthOf(group.nodes, 1);
  assert.strictEqual(group.nodes[0].k, "path");
  return <Extract<SceneNode, { k: "path" }>>group.nodes[0];
}

/** A computed `--hdml-*` value, read off the element under test. */
function prop(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

function said(prefix: string): string[] {
  return lines.filter((l) => l.startsWith(prefix));
}

/**
 * The 76 × 200 bar fixture: three literal series under one stack.
 *
 * `offset` and the stack's own style are parameters so one helper
 * expresses the zero-baseline form, the normalized form and the
 * curve-inertness fixture alike; an empty attribute reads as absent.
 */
function bars(
  offset = "",
  series: readonly string[] = [
    JSON.stringify(A),
    JSON.stringify(B),
    JSON.stringify(C),
  ],
  hide = -1,
  max = "200",
): ReturnType<typeof html> {
  return html`
    <hdml-view aria-label="stack" style="width: 76px; height: 200px">
      <hdml-cartesian-plane style="padding: 0">
        <hdml-ordinal-scale channel="x" values="${CATS}">
          <hdml-continuous-scale channel="y" min="0" max="${max}">
            <hdml-stack x="${CATS}" offset="${offset}">
              <hdml-bar
                y="${series[0]}"
                ?hidden="${hide === 0}"
              ></hdml-bar>
              <hdml-bar
                y="${series[1]}"
                ?hidden="${hide === 1}"
              ></hdml-bar>
              <hdml-bar
                y="${series[2]}"
                ?hidden="${hide === 2}"
              ></hdml-bar>
            </hdml-stack>
          </hdml-continuous-scale>
        </hdml-ordinal-scale>
      </hdml-cartesian-plane>
    </hdml-view>
  `;
}

/**
 * The 75 × 200 area fixture: `--hdml-bandwidth: 0` puts the four
 * vertices on `0, 25, 50, 75` exactly, and the curve declarations
 * are what criteria 5 and 6 turn on.
 */
function areas(
  stackStyle = "",
  childStyle = "",
): ReturnType<typeof html> {
  return html`
    <hdml-view aria-label="band" style="width: 75px; height: 200px">
      <hdml-cartesian-plane style="padding: 0">
        <hdml-ordinal-scale
          channel="x"
          values="${CATS}"
          style="--hdml-bandwidth: 0"
        >
          <hdml-continuous-scale channel="y" min="0" max="200">
            <hdml-stack x="${CATS}" style="${stackStyle}">
              <hdml-area
                y="${JSON.stringify(A)}"
                style="${childStyle}"
              ></hdml-area>
              <hdml-area y="${JSON.stringify(B)}"></hdml-area>
            </hdml-stack>
          </hdml-continuous-scale>
        </hdml-ordinal-scale>
      </hdml-cartesian-plane>
    </hdml-view>
  `;
}

suite("hdvl/container-stack — §6.4's baseline derive", () => {
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

  test("★ H8 — the children are ordinary ranged marks", async () => {
    const view = await mount(bars());
    // The stack emits no group of its own (§6.4); the three
    // children do, in DOM order, and each is a plain `hdml-bar`.
    const all = groups(view);
    assert.lengthOf(all, 3);
    assert.deepEqual(
      all.map((g) => g.tag),
      ["hdml-bar", "hdml-bar", "hdml-bar"],
    );
    const series = [A, B, C];
    for (let k = 0; k < 3; k++) {
      const nodes = rects(all[k]);
      assert.lengthOf(nodes, 4);
      for (let i = 0; i < 4; i++) {
        // y0ₖ = Σ_{j<k} yⱼ, and the y range runs bottom → top.
        let low = 0;
        for (let j = 0; j < k; j++) {
          low += series[j][i];
        }
        assert.strictEqual(nodes[i].x, 20 * i);
        assert.strictEqual(nodes[i].w, 16);
        assert.strictEqual(nodes[i].h, series[k][i]);
        assert.strictEqual(nodes[i].y, 200 - low - series[k][i]);
      }
    }
  });

  test("★ band k's top IS band k+1's baseline", async () => {
    const view = await mount(bars());
    const all = groups(view).map(rects);
    for (let k = 0; k + 1 < all.length; k++) {
      for (let i = 0; i < 4; i++) {
        // One number, not two roundings that agree to six places.
        // §2.7's view coordinates run y-DOWN while §4.3 gives `y` a
        // bottom → top range, so a later child sits ABOVE an
        // earlier one: band k's top edge is `y`, and band k+1's
        // bottom edge is its own `y + h`.
        assert.strictEqual(
          all[k][i].y,
          all[k + 1][i].y + all[k + 1][i].h,
        );
      }
    }
  });

  test("★ §12 duty 4 — the delivered buffer is kept", async () => {
    // The derive allocates its own `Float64Array`; the delivered
    // one is a view over a buffer the worker still owns. Asserted
    // against the column, not against the comment saying so.
    const column = numberCol(A);
    mountFakeIo({
      "?hdml-frame=s": result(4, {
        m: stringCol(["a", "b", "c", "d"]),
        v: column,
      }),
    });
    const ref = <BufferRef>column.values;
    const cells = (): number[] =>
      Array.from(new Float64Array(ref.buffer, ref.byteOffset, 4));
    const before = cells();
    const view = await mount(html`
      <hdml-view
        aria-label="fed"
        source="?hdml-frame=s"
        style="width: 76px; height: 200px"
      >
        <hdml-cartesian-plane style="padding: 0">
          <hdml-ordinal-scale channel="x" values="m">
            <hdml-continuous-scale channel="y" min="0" max="200">
              <hdml-stack x="m">
                <hdml-bar y="v"></hdml-bar>
                <hdml-bar y="v"></hdml-bar>
              </hdml-stack>
            </hdml-continuous-scale>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const all = groups(view);
    assert.lengthOf(all, 2);
    // The second child sits on the first: 2 × A, top edge.
    for (let i = 0; i < 4; i++) {
      assert.strictEqual(rects(all[1])[i].h, A[i]);
      assert.strictEqual(rects(all[1])[i].y, 200 - 2 * A[i]);
    }
    const after = cells();
    assert.deepEqual(after, before);
    assert.deepEqual(after, A);
  });

  test("★ hidden rebases, and no scale domain moves", async () => {
    const view = await mount(bars());
    const scale = <HdvlElement>(
      (<unknown>view.querySelector('[channel="y"]'))
    );
    const domain = JSON.stringify(scaleOf(scale)?.domain());
    const before = groups(view).map(rects);
    assert.strictEqual(before[2][0].y, 200 - (A[0] + B[0] + C[0]));
    const middle = <HTMLElement>view.querySelectorAll("hdml-bar")[1];
    // A real attribute write: step 24's trap is that setting an
    // attribute to the value it already has fires no callback.
    middle.setAttribute("hidden", "");
    await reflow(view);
    const after = groups(view);
    // Two groups, and the third series rebased onto the first.
    assert.lengthOf(after, 2);
    assert.strictEqual(rects(after[1])[0].y, 200 - (A[0] + C[0]));
    assert.strictEqual(rects(after[1])[0].h, C[0]);
    // §6: a domain is the author's statement, never a live union.
    assert.strictEqual(
      JSON.stringify(scaleOf(scale)?.domain()),
      domain,
    );
    middle.removeAttribute("hidden");
    await reflow(view);
    assert.lengthOf(groups(view), 3);
  });

  test("★ a stacked area's shared edges do not tear", async () => {
    const view = await mount(areas("--hdml-curve-type: natural"));
    const all = groups(view);
    assert.lengthOf(all, 2);
    const lower = path(all[0]);
    const upper = path(all[1]);
    // The curve is really in play: `natural` emits cubics, and a
    // `linear` fixture would emit lines (§6.2).
    for (const seg of upper.subpaths[0].segments) {
      assert.oneOf(seg.k, ["cubic", "line"]);
    }
    assert.isTrue(
      upper.subpaths[0].segments.some((s) => s.k === "cubic"),
    );
    // §6.1: an area's vertices run upper forward then lower
    // reversed, so band k+1's lower edge is band k's upper edge
    // read backwards — the SAME points, not points that agree.
    const top = lower.vertices.slice(0, 4);
    const bottom = upper.vertices.slice(4).reverse();
    assert.deepEqual(
      bottom.map((v) => [v.x, v.y]),
      top.map((v) => [v.x, v.y]),
    );
  });

  test("★ the curve is the stack's, a child's is inert", async () => {
    const declared = "--hdml-curve-type: step";
    const view = await mount(
      areas("--hdml-curve-type: natural", declared),
    );
    const child = <HTMLElement>view.querySelector("hdml-area");
    // The child's own declaration COMPUTES — it is a registered
    // inheriting property and CSS is not being lied to…
    assert.strictEqual(prop(child, "--hdml-curve-type"), "step");
    // …and is never read (SPEC §9's reader column, §7's tearing
    // argument). The scene is the one the stack's `natural` makes.
    const plain = await mount(areas("--hdml-curve-type: natural"));
    assert.deepEqual(
      groups(view).map((g) => ({ ...g, widget: "" })),
      groups(plain).map((g) => ({ ...g, widget: "" })),
    );
  });

  test("offset absent is the zero baseline", async () => {
    const view = await mount(bars(""));
    // The first child starts at 0 and the last ends at the total.
    const all = groups(view).map(rects);
    assert.strictEqual(all[0][0].y + all[0][0].h, 200);
    assert.strictEqual(all[2][0].y, 200 - (A[0] + B[0] + C[0]));
  });

  test('offset="normalize" rescales each row to 1', async () => {
    const view = await mount(bars("normalize", undefined, -1, "1"));
    const all = groups(view).map(rects);
    for (let i = 0; i < 4; i++) {
      const total = A[i] + B[i] + C[i];
      // The `y` domain is [0, 1] here, so a full column fills the
      // plane exactly: the identity is "the stack ends at 1".
      assert.closeTo(all[0][i].y + all[0][i].h, 200, 1e-9);
      assert.closeTo(all[2][i].y, 0, 1e-9);
      assert.closeTo(all[0][i].h, (200 * A[i]) / total, 1e-9);
    }
  });

  test("normalize over a zero total paints none", async () => {
    // SPEC §7: "a row whose total is 0 (or all-null) produces no
    // bands for that row" — the pie's zero-total rule, per row.
    const view = await mount(
      bars(
        "normalize",
        ["[0, 25, 22, 28]", "[0, 18, 21, 17]", "[0, 27, 24, 33]"],
        -1,
        "1",
      ),
    );
    for (const group of groups(view)) {
      const nodes = rects(group);
      assert.lengthOf(nodes, 3);
      // Row 0 is gone; the survivors are rows 1..3.
      assert.deepEqual(
        nodes.map((n) => n.i),
        [1, 2, 3],
      );
    }
  });

  test("a null contributes 0 and anchors the rest", async () => {
    // SPEC §7: "a null in child k at row i renders no band for
    // child k and contributes 0 to the baselines above it — the
    // remaining series stay anchored rather than collapsing".
    const view = await mount(
      bars("", [
        JSON.stringify(A),
        "[null, 18, 21, 17]",
        JSON.stringify(C),
      ]),
    );
    const all = groups(view).map(rects);
    assert.lengthOf(all[1], 3);
    assert.deepEqual(
      all[1].map((n) => n.i),
      [1, 2, 3],
    );
    // The third series sits directly on the first at row 0…
    assert.strictEqual(all[2][0].y, 200 - (A[0] + C[0]));
    // …and where nothing is missing it is unchanged.
    assert.strictEqual(all[2][1].y, 200 - (A[1] + B[1] + C[1]));
  });

  test("a single child is a legal no-op", async () => {
    const view = await mount(html`
      <hdml-view aria-label="one" style="width: 76px; height: 200px">
        <hdml-cartesian-plane style="padding: 0">
          <hdml-ordinal-scale channel="x" values="${CATS}">
            <hdml-continuous-scale channel="y" min="0" max="200">
              <hdml-stack x="${CATS}">
                <hdml-bar y="${JSON.stringify(A)}"></hdml-bar>
              </hdml-stack>
            </hdml-continuous-scale>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const nodes = rects(groups(view)[0]);
    assert.lengthOf(nodes, 4);
    // Its baseline is zero — the same chart the bar draws alone.
    for (let i = 0; i < 4; i++) {
      assert.strictEqual(nodes[i].y + nodes[i].h, 200);
    }
    assert.lengthOf(said("hdml V17"), 0);
    assert.isFalse(
      (<HTMLElement>view.querySelector("hdml-stack")).matches(
        ":state(error)",
      ),
    );
  });

  test("★ an empty container is an error, and blanks", async () => {
    const view = await mount(html`
      <hdml-view aria-label="nil" style="width: 76px; height: 200px">
        <hdml-cartesian-plane style="padding: 0">
          <hdml-ordinal-scale channel="x" values="${CATS}">
            <hdml-continuous-scale channel="y" min="0" max="200">
              <hdml-stack x="${CATS}"></hdml-stack>
            </hdml-continuous-scale>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const stack = <HTMLElement>view.querySelector("hdml-stack");
    assert.deepEqual(said("hdml V17 hdml-stack").map(messageOf), [
      "hdml-stack has no children — an empty container is an " +
        "error, a single child is a legal no-op",
    ]);
    // Step 27's T2: the error unit of a container's subtree is the
    // CONTAINER, so the view is not in error.
    assert.isTrue(stack.matches(":state(error)"));
    assert.isFalse(view.matches(":state(error)"));
  });
  test("★ R2/R26 and rule 9 — every scene is clean", async () => {
    // A scene is a plain data structure (R2/R26) and carries no
    // signed zero (rule 9). It is a real risk in a derive: a
    // baseline is a running sum starting at zero, and `0 / total`
    // under `normalize` is another producer.
    for (const page of [bars(), bars("normalize"), areas()]) {
      const scene = sceneOf(await mount(page));
      assert.doesNotThrow(() => structuredClone(scene));
      assert.deepEqual(negativeZeros(scene), []);
    }
  });

  test("★ R20 — the stack fixture is twelve nodes", async () => {
    const view = await mount(bars());
    // Three children × four rows, against R20's 20 000 — an exact
    // count, not a bound, so a widget that started emitting twice
    // fails here rather than in the budget.
    assert.strictEqual(nodeCount(sceneOf(view)), 12);
    assert.lengthOf(said("hdml W4"), 0);
    assert.isFalse(view.matches(":state(error)"));
  });
});

/** The message half of a `hdml … — <message>` console line. */
function messageOf(line: string): string {
  const at = line.indexOf(" — ");
  return at < 0 ? line : line.slice(at + 3);
}
