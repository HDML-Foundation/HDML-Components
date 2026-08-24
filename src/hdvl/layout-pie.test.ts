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
import type { BufferRef } from "../hdio/delivery";
import { mountFakeIo } from "../testing/FakeIo";
import { numberCol, result } from "../testing/corpus";
import {
  installSceneRecorder,
  restoreRenderers,
  sceneOf,
} from "../testing/scene-of";
import { HdmlViewElement } from "./view";
import { diagnosticsOf } from "./validate";

/**
 * `hdml-pie` — §6.3's **one cross-row `derive()` in data space**.
 *
 * **What the file is really asserting.** SPEC §7 claims 08-A's pie
 * and 08-C's `hdml-arc a0/a1` over the same numbers are
 * *interchangeable*; step 27 made that mechanical rather than
 * aspirational by giving the two tags one `sectorScene` and letting
 * the pie differ only in its `AngleForm`. The interchangeability
 * test below is therefore a test of that decision and not a
 * coincidence between two implementations.
 *
 * **Geometry, in one place.** A 200 × 200 view, `padding: 0`, so
 * the pole is `(100, 100)` and §4.3's radial ceiling is `100`. The
 * angle scale is `min="0" max="1"` — fractions, authored, exactly
 * as every corpus pie writes it — over the default full turn, so a
 * fraction `f` projects to `f · 360` degrees.
 *
 * **Rule 2** does not bind on `a0`/`a1`: they are a linear scale's
 * output, not a trig one's, so the sector angles are compared with
 * `closeTo(…, 1e-12)` against the arithmetic and the closing
 * identity `a1 === 360` is asserted **exactly**, which is the
 * point of §6.3's running-quotient spelling.
 */

const P = { precision: 6 };

/** The turn the fixture's angle range spans, in degrees. */
const TURN = 360;

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

/** A polar page carrying whatever the caller spells. */
function polar(
  widget: ReturnType<typeof html>,
): ReturnType<typeof html> {
  return html`
    <hdml-view aria-label="pie" style="width: 200px; height: 200px">
      <hdml-polar-plane style="padding: 0">
        <hdml-continuous-scale channel="angle" min="0" max="1">
          <hdml-continuous-scale channel="radius" min="0" max="100">
            ${widget}
          </hdml-continuous-scale>
        </hdml-continuous-scale>
      </hdml-polar-plane>
    </hdml-view>
  `;
}

function groupOf(view: HdmlViewElement, tag: string): SceneGroup {
  const el = <HdmlViewElement>view.querySelector(tag);
  assert.isNotNull(el, `no ${tag}`);
  const group = sceneOf(view).groups.find((g) => g.widget === el.uid);
  assert.isDefined(group, `${tag} painted no group`);
  return group;
}

function arcs(
  view: HdmlViewElement,
  tag = "hdml-pie",
): Extract<SceneNode, { k: "arc" }>[] {
  return groupOf(view, tag).nodes.map((node) => {
    assert.strictEqual(node.k, "arc");
    return <Extract<SceneNode, { k: "arc" }>>node;
  });
}

suite("hdvl/layout-pie — §6.3's derive", () => {
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

  test("★ a value column becomes cumulative fractions", async () => {
    // [1, 2, 3, 4] over a total of 10: the boundaries are 0, .1,
    // .3, .6, 1 — and the LAST one closes the turn exactly.
    const view = await mount(
      polar(html`<hdml-pie angle="[1, 2, 3, 4]"></hdml-pie>`),
    );
    const slices = arcs(view);
    assert.lengthOf(slices, 4);
    const edges = [0, 0.1, 0.3, 0.6, 1];
    slices.forEach((slice, i) => {
      assert.closeTo(slice.a0, edges[i] * TURN, 1e-12, `a0 ${i}`);
      assert.closeTo(slice.a1, edges[i + 1] * TURN, 1e-12, `a1 ${i}`);
      // Contiguous: no gap and no overlap between neighbours.
      if (i > 0) {
        assert.strictEqual(slice.a0, slices[i - 1].a1);
      }
    });
    // ★ EXACTLY the range's end, not a float's width short of it.
    // This is what `acc / total` buys over `a0 + v / total`.
    assert.strictEqual(slices[3].a1, TURN);
  });

  test("★ a null takes no slice and no share", async () => {
    // SPEC: "excluded from the total and produce no slice" is ONE
    // statement — the slices either side of it stay adjacent and
    // the remaining slices still close the circle.
    const view = await mount(
      polar(html`<hdml-pie angle="[1, null, 3]"></hdml-pie>`),
    );
    const slices = arcs(view);
    assert.lengthOf(slices, 2);
    // Total is 4, so the shares are ¼ and ¾ — the null contributed
    // nothing to the denominator either.
    assert.closeTo(slices[0].a0, 0, 1e-12);
    assert.closeTo(slices[0].a1, 0.25 * TURN, 1e-12);
    assert.strictEqual(slices[1].a0, slices[0].a1);
    assert.strictEqual(slices[1].a1, TURN);
    // Row identity survives the hole: the second slice is row 2.
    assert.deepEqual(
      slices.map((s) => s.i),
      [0, 2],
    );
  });

  test("★ a negative value is a V7 error and blanks", async () => {
    const view = await mount(
      polar(html`<hdml-pie angle="[3, -1, 2]"></hdml-pie>`),
    );
    const found = diagnosticsOf(view).filter((d) => d.rule === "V7");
    assert.lengthOf(found, 1);
    assert.strictEqual(found[0].severity, "error");
    assert.strictEqual(found[0].code, "negative-pie-value");
    assert.include(found[0].message, "-1");
    // §1.5's all-or-nothing: no partial pie is drawn.
    const groups = sceneOf(view).groups;
    assert.isFalse(groups.some((g) => g.role === "mark"));
    // §3.5: the UNIT blanks, and a widget's unit is its own tip —
    // not the view, which is why the rest of a page survives one
    // bad pie.
    const unit = <Element>found[0].unit;
    assert.isTrue(unit.matches(":state(error)"));
    assert.strictEqual(
      found[0].element,
      view.querySelector("hdml-pie"),
    );
  });

  test("★ V7 is edge-triggered, and silent on recovery", async () => {
    // R25: no event on recovery, and nothing re-dispatched while
    // the violation stands.
    const view = await mount(
      polar(html`<hdml-pie angle="[3, -1, 2]"></hdml-pie>`),
    );
    const seen: string[] = [];
    view.addEventListener("hdml-error", () => seen.push("e"));
    view.markDirty();
    await quiesce(view);
    view.markDirty();
    await quiesce(view);
    // Same identity, two more frames: nothing.
    assert.lengthOf(seen, 0);
    const pie = <Element>view.querySelector("hdml-pie");
    pie.setAttribute("angle", "[3, 1, 2]");
    await settle(view);
    view.markDirty();
    await quiesce(view);
    // Recovered — no event, and the state is gone.
    assert.lengthOf(seen, 0);
    assert.deepEqual(diagnosticsOf(view), []);
    assert.lengthOf(arcs(view), 3);
  });

  test("★ a zero total is empty, not a full ring", async () => {
    const view = await mount(
      polar(html`<hdml-pie angle="[0, 0, 0]"></hdml-pie>`),
    );
    // §3.4.1 / R34: `empty` is decided on emitted MARK nodes, and
    // the pie emitted none — it did not throw and it did not draw
    // one slice of 360°.
    assert.lengthOf(arcs(view), 0);
    assert.isTrue(view.matches(":state(empty)"));
    assert.isFalse(view.matches(":state(error)"));
    assert.deepEqual(diagnosticsOf(view), []);
  });

  test("★ row order is slice order, and nothing sorts", async () => {
    // A deliberately unsorted column. If anything sorted, the
    // widest slice would not be second.
    const view = await mount(
      polar(html`<hdml-pie angle="[10, 50, 20, 20]"></hdml-pie>`),
    );
    const slices = arcs(view);
    const widths = slices.map((s) => s.a1 - s.a0);
    assert.deepEqual(
      widths.map((w) => Math.round(w)),
      [36, 180, 72, 72],
    );
    // …and the row indices run 0, 1, 2, 3 in emission order.
    assert.deepEqual(
      slices.map((s) => s.i),
      [0, 1, 2, 3],
    );
  });

  test("★ --hdml-inner-radius: widget and plane agree", async () => {
    // 08-B declares it on the pie, 08-D on the plane. The property
    // INHERITS, and the widget is the one that reads it, so the two
    // resolve to the same computed value and the same geometry.
    const onWidget = await mount(
      polar(
        html`<hdml-pie
          angle="[1, 1]"
          style="--hdml-inner-radius: 60%"
        ></hdml-pie>`,
      ),
    );
    const onPlane = await mount(html`
      <hdml-view aria-label="pie" style="width: 200px; height: 200px">
        <hdml-polar-plane
          style="padding: 0; --hdml-inner-radius: 60%"
        >
          <hdml-continuous-scale channel="angle" min="0" max="1">
            <hdml-continuous-scale channel="radius" min="0" max="100">
              <hdml-pie angle="[1, 1]"></hdml-pie>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-polar-plane>
      </hdml-view>
    `);
    assert.deepEqual(
      sceneOf(onPlane, P).groups.map((g) => g.nodes),
      sceneOf(onWidget, P).groups.map((g) => g.nodes),
    );
    // …and it is a doughnut, not a pie: 60 % of the 100 px ceiling.
    for (const slice of arcs(onWidget)) {
      assert.closeTo(slice.r0, 60, 1e-9);
      assert.closeTo(slice.r1, 100, 1e-9);
    }
  });

  test("★ §12 duty 4 — the delivered buffer is kept", async () => {
    // The column arrives as a typed-array VIEW over a buffer the
    // worker still owns. The prefix sum allocates its own array;
    // this asserts that against the column itself rather than
    // trusting the comment that says so.
    const rows = [4, 1, 3, 2];
    const column = numberCol(rows);
    mountFakeIo({ "?hdml-frame=g": result(4, { v: column }) });
    const ref = <BufferRef>column.values;
    const cells = (): number[] =>
      Array.from(
        new Float64Array(ref.buffer, ref.byteOffset, rows.length),
      );
    const before = cells();
    const view = await mount(html`
      <hdml-view
        aria-label="pie"
        source="?hdml-frame=g"
        style="width: 200px; height: 200px"
      >
        <hdml-polar-plane style="padding: 0">
          <hdml-continuous-scale channel="angle" min="0" max="1">
            <hdml-continuous-scale channel="radius" min="0" max="100">
              <hdml-pie angle="v"></hdml-pie>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-polar-plane>
      </hdml-view>
    `);
    assert.lengthOf(arcs(view), 4);
    const after = cells();
    assert.deepEqual(after, before);
    assert.deepEqual(after, rows);
  });

  test("★ 08-A's pie and 08-C's arc agree, node-wise", async () => {
    // SPEC's own interchangeability claim, made mechanical. The
    // prefix sum computed in the data layer (08-C's window-clause
    // fields) and the one the widget derives are the same numbers,
    // and the two tags share `sectorScene`, so the ARC nodes must
    // be identical — colour excepted, which neither binds here.
    const pie = await mount(
      polar(html`<hdml-pie angle="[1, 2, 3, 4]"></hdml-pie>`),
    );
    const arc = await mount(
      polar(
        html`<hdml-arc
          a0="[0, 0.1, 0.3, 0.6]"
          a1="[0.1, 0.3, 0.6, 1]"
        ></hdml-arc>`,
      ),
    );
    assert.deepEqual(
      sceneOf(pie, P).groups[0].nodes,
      sceneOf(arc, P).groups[0].nodes,
    );
  });

  test("its role is mark, and the scene round-trips", async () => {
    // R2/R26. Its family is `mark` and not `container`: §6.3 makes
    // it a layout WIDGET, so its slices count for §3.4.1's `empty`
    // rather than being excluded from the question.
    const view = await mount(
      polar(html`<hdml-pie angle="[1, 1, 2]"></hdml-pie>`),
    );
    assert.strictEqual(groupOf(view, "hdml-pie").role, "mark");
    const scene = sceneOf(view, P);
    assert.deepEqual(structuredClone(<unknown>scene), <unknown>scene);
  });
});
