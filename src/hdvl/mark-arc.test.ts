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
import { HdmlArcElement } from "./mark-arc";
import { createSvgRenderer } from "./renderer-svg";
import type { Renderer } from "./renderer";

/**
 * `hdml-arc` — §2.5's parameterised annulus sector, and §4.6's
 * default-extent floor.
 *
 * **Three radial cases, and they are not one rule** (§6.1, SPEC §7):
 * `r0`+`r1` bound is the author's on both edges; `radius` bound is
 * sugar for `r1` with a synthetic lower edge; nothing bound is the
 * **full radius range**, which `rangedValuesOf` cannot express since
 * `null` is exactly what it returns for an unbound channel.
 *
 * **`--hdml-inner-radius` replaces the SYNTHETIC `r0` only.** The
 * pair of assertions is the rule: with the floor set, an unbound
 * `r0` starts at it, and an authored `r0` still paints inside the
 * hole — §4.6's *"authored data is sacred"*.
 *
 * **The node is parameterised, not pre-serialized**, so the 360°
 * two-command case is invisible to a scene assertion and is proven
 * through the real renderer instead (R36).
 *
 * **Literal-only fixtures, `padding: 0`**, on a 200 × 200 polar
 * plane: the radius scale's content box is the plane's, so the pole
 * is `(100, 100)` and the radial ceiling `min(200, 200) / 2 = 100`.
 * Both scales take a `[0, 1]` fraction domain — `hdml-pie`'s own,
 * which is why the pure `a0`/`a1` form is interchangeable with it —
 * so `at(angle) = v · 360` degrees and `at(radius) = v · 100` px,
 * every intermediate exact.
 */

/** Rule 3's precision, in one place. */
const P = { precision: 6 };

/** The pole and the radial ceiling this fixture geometry gives. */
const CX = 100;
const CY = 100;
const CEILING = 100;

let lines: string[] = [];
let realWarn: typeof console.warn;
let realError: typeof console.error;
let planted: HTMLElement[] = [];
let live: Renderer[] = [];

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

/** That group's nodes, asserted to be arcs. */
function arcs(
  view: HdmlViewElement,
): Extract<SceneNode, { k: "arc" }>[] {
  const out: Extract<SceneNode, { k: "arc" }>[] = [];
  for (const node of only(view).nodes) {
    assert.strictEqual(node.k, "arc");
    out.push(<Extract<SceneNode, { k: "arc" }>>node);
  }
  return out;
}

function arcOf(view: HdmlViewElement): HdmlArcElement {
  return <HdmlArcElement>view.querySelector("hdml-arc");
}

/** A group with its instance identity removed, for #10's pair. */
function shape(group: SceneGroup): Record<string, unknown> {
  return { ...group, widget: "" };
}

/** The `(r0, r1, a0, a1)` of every node, for a compact assertion. */
function extents(
  view: HdmlViewElement,
): [number, number, number, number][] {
  return arcs(view).map((a) => [a.r0, a.r1, a.a0, a.a1]);
}

/**
 * Every arc node **unquantized**.
 *
 * §4.4's band is asserted against its own formula rather than
 * against a captured number, and rule 3's six decimals are coarser
 * than that comparison wants: `360 / 3.8` is `94.73684210526316`,
 * whose sixth decimal already sits 1e-7 away.
 */
function rawArcs(
  view: HdmlViewElement,
): Extract<SceneNode, { k: "arc" }>[] {
  const groups = sceneOf(view).groups;
  assert.lengthOf(groups, 1, "expected exactly one group");
  const out: Extract<SceneNode, { k: "arc" }>[] = [];
  for (const node of groups[0].nodes) {
    assert.strictEqual(node.k, "arc");
    out.push(<Extract<SceneNode, { k: "arc" }>>node);
  }
  return out;
}

/** The `--hdml-fill-color` a fixture's arc actually resolves. */
function fillOf(arc: HdmlArcElement): string {
  const fill = getComputedStyle(arc)
    .getPropertyValue("--hdml-fill-color")
    .trim();
  return fill.toLowerCase() === "currentcolor"
    ? getComputedStyle(arc).color
    : fill;
}

/**
 * The ordinal-angle fixture — SPEC §7's **second** angle form, on
 * the same 200 × 200 polar plane.
 *
 * `--hdml-bandwidth` is read from the **scale**, not from the mark,
 * so it is styled there; the angular range is
 * `--hdml-angle-start`/`-end`, whose registered initials are already
 * `0deg`/`360deg`, so a full turn needs no declaration.
 */
function rose(
  cats: string,
  radius = "",
  r0 = "",
  r1 = "",
  band = "",
  style = "",
): ReturnType<typeof html> {
  return html`
    <hdml-view aria-label="rose" style="width: 200px; height: 200px">
      <hdml-polar-plane style="padding: 0">
        <hdml-ordinal-scale
          channel="angle"
          values="${cats}"
          style="${band}"
        >
          <hdml-continuous-scale channel="radius" min="0" max="1">
            <hdml-arc
              angle="${cats}"
              radius="${radius}"
              r0="${r0}"
              r1="${r1}"
              style="${style}"
            ></hdml-arc>
          </hdml-continuous-scale>
        </hdml-ordinal-scale>
      </hdml-polar-plane>
    </hdml-view>
  `;
}

/**
 * The 200 × 200 polar fixture. Every attribute is always present,
 * empty where the test does not want it — an empty attribute reads
 * as unbound, which is how one helper spells all three radial cases.
 */
function page(
  a0: string,
  a1: string,
  radius = "",
  r0 = "",
  r1 = "",
  style = "",
): ReturnType<typeof html> {
  return html`
    <hdml-view aria-label="arc" style="width: 200px; height: 200px">
      <hdml-polar-plane style="padding: 0">
        <hdml-continuous-scale channel="angle" min="0" max="1">
          <hdml-continuous-scale channel="radius" min="0" max="1">
            <hdml-arc
              a0="${a0}"
              a1="${a1}"
              radius="${radius}"
              r0="${r0}"
              r1="${r1}"
              style="${style}"
            ></hdml-arc>
          </hdml-continuous-scale>
        </hdml-continuous-scale>
      </hdml-polar-plane>
    </hdml-view>
  `;
}

suite("hdvl/mark-arc — §2.5's parameterised sector", () => {
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
    for (const r of live) {
      r.unmount();
    }
    live = [];
    for (const el of planted) {
      el.remove();
    }
    planted = [];
  });

  test("★ one arc per row, angles in degrees", async () => {
    // a0/a1 are `projection.at("angle", v)` DIRECTLY — the range is
    // --hdml-angle-start/-end, so a [0, 1] fraction domain is
    // already degrees and nothing here converts. The radians live
    // in kernel/project-polar.ts and in the renderer.
    const view = await mount(
      page("[0, 0.25, 0.5]", "[0.25, 0.5, 1]"),
    );
    const arc = arcOf(view);
    const fill = fillOf(arc);
    const expected: Scene = {
      width: 200,
      height: 200,
      groups: [
        {
          widget: arc.uid,
          tag: "hdml-arc",
          role: "mark",
          box: { x: 0, y: 0, w: 200, h: 200 },
          opacity: 1,
          filter: "none",
          visibility: "visible",
          clip: true,
          clipPath: null,
          nodes: [
            [0, 90],
            [90, 180],
            [180, 360],
          ].map((deg, i) => ({
            k: "arc",
            i,
            cx: CX,
            cy: CY,
            // Fully unbound radially: the full radius range.
            r0: 0,
            r1: CEILING,
            a0: deg[0],
            a1: deg[1],
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

  test("★ radius is sugar for r1, with r0 at 0", async () => {
    // SPEC §7: "bound radius ≡ r1 with r0 defaulting to 0",
    // mirroring the area's `y` sugar — and it is the SAME resolver,
    // so the two spellings are one scene, not two that agree.
    const sugar = await mount(
      page("[0, 0.5]", "[0.5, 1]", "[0.4, 0.8]"),
    );
    const ranged = await mount(
      page("[0, 0.5]", "[0.5, 1]", "", "[0, 0]", "[0.4, 0.8]"),
    );
    assert.deepEqual(shape(only(sugar)), shape(only(ranged)));
    assert.deepEqual(extents(sugar), [
      [0, 40, 0, 180],
      [0, 80, 180, 360],
    ]);
  });

  test("★ the floor supplies the SYNTHETIC r0 only", async () => {
    // §4.6, both halves. With --hdml-inner-radius set, an arc that
    // bound no lower edge starts at the floor...
    const floored = await mount(
      page(
        "[0, 0.5]",
        "[0.5, 1]",
        "[0.8, 0.8]",
        "",
        "",
        "--hdml-inner-radius: 40%",
      ),
    );
    assert.deepEqual(extents(floored), [
      [40, 80, 0, 180],
      [40, 80, 180, 360],
    ]);
    // ...and an AUTHORED r0 wins, even inside the hole. "Authored
    // data is sacred" — the floor is a default extent, never a
    // range remap, so `r0 = 0.1` paints at 10 px, well within 40.
    const authored = await mount(
      page(
        "[0, 0.5]",
        "[0.5, 1]",
        "",
        "[0.1, 0.1]",
        "[0.8, 0.8]",
        "--hdml-inner-radius: 40%",
      ),
    );
    assert.deepEqual(extents(authored), [
      [10, 80, 0, 180],
      [10, 80, 180, 360],
    ]);
  });

  test("★ a length floor resolves without the ceiling", async () => {
    // The property is a <length-percentage> and a registered one
    // computes to a percentage UNRESOLVED, so the two forms are
    // separated at the widget: a percentage takes §4.6's ceiling,
    // a length is already px. 30% of 100 and 30px agree here by
    // construction, which is what makes the pair assertable.
    const pct = await mount(
      page("[0]", "[1]", "", "", "", "--hdml-inner-radius: 30%"),
    );
    const len = await mount(
      page("[0]", "[1]", "", "", "", "--hdml-inner-radius: 30px"),
    );
    assert.deepEqual(extents(pct), [[30, CEILING, 0, 360]]);
    assert.deepEqual(extents(len), [[30, CEILING, 0, 360]]);
  });

  test("★ unbound radially is the full range, floored", async () => {
    // §6.1's third case — the one `rangedValuesOf` cannot express,
    // and what makes 08-C's pure arc interchangeable with a pie.
    const open = await mount(page("[0, 0.5]", "[0.5, 1]"));
    assert.deepEqual(extents(open), [
      [0, CEILING, 0, 180],
      [0, CEILING, 180, 360],
    ]);
    const doughnut = await mount(
      page(
        "[0, 0.5]",
        "[0.5, 1]",
        "",
        "",
        "",
        "--hdml-inner-radius: 60%",
      ),
    );
    assert.deepEqual(extents(doughnut), [
      [60, CEILING, 0, 180],
      [60, CEILING, 180, 360],
    ]);
  });

  test("★ under a cartesian plane it paints nothing", async () => {
    // There is no pole, and inventing one would be doing the polar
    // plane's job wrong. The widget asks whether the plane projects
    // ITS channels — not what kind of plane it is (H7).
    const view = await mount(html`
      <hdml-view
        aria-label="flat"
        style="width: 200px; height: 200px"
      >
        <hdml-cartesian-plane style="padding: 0">
          <hdml-continuous-scale channel="angle" min="0" max="1">
            <hdml-continuous-scale channel="radius" min="0" max="1">
              <hdml-arc a0="[0]" a1="[1]"></hdml-arc>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    assert.lengthOf(sceneOf(view, P).groups, 0);
    // And V9 says why: those are not that plane's channels.
    assert.strictEqual(
      lines.filter((l) => l.startsWith("hdml V9 ")).length,
      1,
    );
  });

  test("★ an ordinal angle gives equal slices", async () => {
    // §6.1's SECOND angle form. `--hdml-bandwidth: 1` makes the
    // step and the width the same 90°, so every number here is
    // exact and the whole scene can be asserted.
    const view = await mount(
      rose('["a","b","c","d"]', "", "", "", "--hdml-bandwidth: 1"),
    );
    const arc = arcOf(view);
    const expected: Scene = {
      width: 200,
      height: 200,
      groups: [
        {
          widget: arc.uid,
          tag: "hdml-arc",
          role: "mark",
          box: { x: 0, y: 0, w: 200, h: 200 },
          opacity: 1,
          filter: "none",
          visibility: "visible",
          clip: true,
          clipPath: null,
          nodes: [
            [0, 90],
            [90, 180],
            [180, 270],
            [270, 360],
          ].map((deg, i) => ({
            k: "arc",
            i,
            cx: CX,
            cy: CY,
            // Radially unbound: the full range, as on a
            // continuous angle. The forms share that code.
            r0: 0,
            r1: CEILING,
            a0: deg[0],
            a1: deg[1],
            fill: fillOf(arc),
            stroke: null,
            strokeWidth: 0,
            dash: null,
          })),
        },
      ],
    };
    assert.deepEqual(sceneOf(view, P), expected);
  });

  test("★ a slice is §4.4's band, not a whole step", async () => {
    // ★ The step-26 D1 decision, asserted against §4.4's FORMULA
    // and never against a captured number. The denominator is
    // `n − 1 + b` and not `n`, so at the initial bandwidth the
    // slices are 75.79° wide on a 94.74° step — the 20 % gap the
    // escalation was about — and the last slice's high edge still
    // lands exactly on the range's own r1.
    const view = await mount(rose('["a","b","c","d"]'));
    const n = 4;
    const b = 0.8;
    const step = 360 / (n - 1 + b);
    const width = b * step;
    const got = rawArcs(view);
    assert.lengthOf(got, n);
    for (let k = 0; k < n; k++) {
      assert.closeTo(got[k].a0, k * step, 1e-9, `a0 ${k}`);
      assert.closeTo(got[k].a1, k * step + width, 1e-9, `a1 ${k}`);
    }
    assert.closeTo(got[n - 1].a1, 360, 1e-9, "last high edge");
    // And the gap is real: consecutive slices do NOT touch.
    assert.isAbove(got[1].a0 - got[0].a1, 18);
  });

  test("★ --hdml-bandwidth: 1 tiles the circle exactly", async () => {
    // Rule 1's step-15 amendment — the seam identity is exact only
    // where the arithmetic is, so this is FIXTURE-SCOPED: 360 / 4
    // is 90 exactly and `k · 90` is exact for every k here.
    // `scale-band.ts`'s JSDoc records the general bound (2.3e-13).
    const view = await mount(
      rose('["a","b","c","d"]', "", "", "", "--hdml-bandwidth: 1"),
    );
    const got = rawArcs(view);
    for (let k = 0; k + 1 < got.length; k++) {
      assert.strictEqual(got[k].a1, got[k + 1].a0, `seam ${k}`);
    }
    assert.strictEqual(got[0].a0, 0);
    assert.strictEqual(got[got.length - 1].a1, 360);
  });

  test("an ordinal slice is degrees, 0 at noon, cw", async () => {
    // §4.6's convention is CSS's: the first slice STARTS at 12
    // o'clock and sweeps to 3 o'clock, with SVG's sweep flag 1.
    // The scene cannot show it — the node is parameterised — so
    // this reads it off the real renderer's own `d` (R36).
    const view = await mount(
      rose('["a","b","c","d"]', "", "", "", "--hdml-bandwidth: 1"),
    );
    const box = document.createElement("div");
    box.style.cssText = "position:relative;width:200px;height:200px";
    document.body.appendChild(box);
    planted.push(box);
    const root = box.attachShadow({ mode: "open" });
    const renderer = createSvgRenderer();
    renderer.mount(root);
    renderer.resize(200, 200, 1);
    live.push(renderer);
    renderer.render(sceneOf(view));

    const d = root.querySelector("path")?.getAttribute("d") ?? "";
    const m = /^M (\S+) (\S+) /.exec(d);
    assert.isNotNull(m, `no leading M in ${d}`);
    // 12 o'clock: straight up from the pole. Rule 2 — the x is a
    // `cos(-π/2)` residual and is never exactly the pole's own.
    assert.closeTo(Number(m?.[1]), CX, 1e-9);
    assert.closeTo(Number(m?.[2]), CY - CEILING, 1e-9);
    // …sweeping CLOCKWISE (flag 1) to 3 o'clock, then back to the
    // pole. Flip either half of §4.6 and this lands at 9 o'clock.
    assert.include(d, `A ${CEILING} ${CEILING} 0 0 1 200 100`);
    assert.include(d, `L ${CX} ${CY}`);
  });

  test("an out-of-domain category drops its row", async () => {
    // §4.7 through the SAME clause the continuous form uses: the
    // band lookup answers null and the row produces no mark, with
    // the notice named per value.
    const view = await mount(
      rose('["a","zz","c"]', "", "", "", "--hdml-bandwidth: 1"),
    );
    // The scale's domain is the arc's own literal, so "zz" IS in
    // it. Re-point the mark alone at a category the scale rejects.
    arcOf(view).setAttribute("angle", '["a","nope","c"]');
    await quiesce(view);
    assert.deepEqual(
      arcs(view).map((a) => a.i),
      [0, 2],
    );
    assert.lengthOf(
      lines.filter((l) => l.includes('"nope"')),
      1,
    );
  });

  test("ordinal + unbound radius is the full range", async () => {
    // §6.1's third radial case, under the second angle form. The
    // two forms share every line of it — that is the point of
    // resolving the angle to a `(a0, a1)` pair first.
    const view = await mount(
      rose('["a","b"]', "", "", "", "--hdml-bandwidth: 1"),
    );
    assert.deepEqual(extents(view), [
      [0, CEILING, 0, 180],
      [0, CEILING, 180, 360],
    ]);
  });

  test("ordinal + `radius` is still sugar for r1", async () => {
    const view = await mount(
      rose('["a","b"]', "[0.25, 0.5]", "", "", "--hdml-bandwidth: 1"),
    );
    assert.deepEqual(extents(view), [
      [0, 25, 0, 180],
      [0, 50, 180, 360],
    ]);
  });

  test("ordinal + authored r0/r1 still beats the floor", async () => {
    // §4.6's "authored data is sacred" — the floor replaces the
    // SYNTHETIC lower edge only, on either angle form.
    const view = await mount(
      rose(
        '["a","b"]',
        "",
        "[0.1, 0.2]",
        "[0.6, 0.8]",
        "--hdml-bandwidth: 1",
        "--hdml-inner-radius: 60%",
      ),
    );
    assert.deepEqual(extents(view), [
      [10, 60, 0, 180],
      [20, 80, 180, 360],
    ]);
  });

  test("★ a 12-slice rose stays inside R20's budget", async () => {
    const cats = JSON.stringify([
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ]);
    const view = await mount(
      rose(cats, "", "", "", "--hdml-bandwidth: 1"),
    );
    const scene = sceneOf(view);
    const nodes = scene.groups.reduce(
      (n, g) => n + g.nodes.length,
      0,
    );
    // 12 nodes against a 20 000 budget: W4 must stay silent, and
    // the count is reported rather than assumed (R20).
    assert.strictEqual(nodes, 12);
    assert.lengthOf(
      lines.filter((l) => l.startsWith("hdml W4 ")),
      0,
    );
    // R2/R26 — the ordinal form's scene is serializable too.
    assert.deepEqual(structuredClone(scene), scene);
  });

  test("missing omits the sector, never draws a zero", async () => {
    const view = await mount(
      page("[0, null, 0.5]", "[0.25, 0.5, 1]"),
    );
    assert.deepEqual(
      arcs(view).map((a) => a.i),
      [0, 2],
    );
  });

  test("a per-row color is honest on an arc", async () => {
    const view = await mount(html`
      <hdml-view aria-label="hue" style="width: 200px; height: 200px">
        <hdml-polar-plane style="padding: 0">
          <hdml-continuous-scale channel="angle" min="0" max="1">
            <hdml-continuous-scale channel="radius" min="0" max="1">
              <hdml-ordinal-scale
                channel="color"
                values='["North","South"]'
              >
                <hdml-arc
                  a0="[0, 0.5]"
                  a1="[0.5, 1]"
                  color='["North","South"]'
                ></hdml-arc>
              </hdml-ordinal-scale>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-polar-plane>
      </hdml-view>
    `);
    assert.lengthOf(
      lines.filter((l) => l.startsWith("hdml V3 ")),
      0,
    );
    const got = arcs(view);
    assert.lengthOf(got, 2);
    assert.isNotNull(got[0].fill);
    assert.notStrictEqual(got[0].fill, got[1].fill);
    assert.strictEqual(got[0].stroke, null);
    assert.strictEqual(got[0].strokeWidth, 0);
  });

  test("bindings() covers both ranged pairs", async () => {
    const view = await mount(html`
      <hdml-view
        aria-label="bind"
        source="?hdml-frame=t"
        style="width: 200px; height: 200px"
      >
        <hdml-polar-plane style="padding: 0">
          <hdml-continuous-scale channel="angle" min="0" max="1">
            <hdml-continuous-scale channel="radius" min="0" max="1">
              <hdml-arc a0="lo" a1="hi" r0="near" r1="far"></hdml-arc>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-polar-plane>
      </hdml-view>
    `);
    assert.deepEqual(arcOf(view).bindings(), [
      { slot: "a0", ref: "?hdml-frame=t", column: "lo", raw: true },
      { slot: "a1", ref: "?hdml-frame=t", column: "hi", raw: true },
      { slot: "r0", ref: "?hdml-frame=t", column: "near", raw: true },
      { slot: "r1", ref: "?hdml-frame=t", column: "far", raw: true },
    ]);
  });

  test("★ the produced scene survives the renderer", async () => {
    // R36: `arc` is parameterised, so the annulus and the 360°
    // split are the RENDERER's business and no scene assertion can
    // see them. This is the round-trip that proves a scene this
    // widget produced actually serializes — including the full
    // ring, which cannot be one `A` command because start and end
    // coincide and SVG draws nothing.
    const view = await mount(
      page("[0, 0]", "[1, 0.25]", "", "[0.4, 0]", "[1, 0.8]"),
    );
    const scene = sceneOf(view);
    assert.deepEqual(structuredClone(scene), scene);

    const box = document.createElement("div");
    box.style.cssText = "position:relative;width:200px;height:200px";
    document.body.appendChild(box);
    planted.push(box);
    const root = box.attachShadow({ mode: "open" });
    const renderer = createSvgRenderer();
    renderer.mount(root);
    renderer.resize(200, 200, 1);
    live.push(renderer);
    renderer.render(scene);

    const paths = Array.from(root.querySelectorAll("path"));
    assert.lengthOf(paths, 2);
    const full = paths[0].getAttribute("d") ?? "";
    const wedge = paths[1].getAttribute("d") ?? "";
    // The 360° annulus: two half-arcs per radius, four in all.
    assert.lengthOf(full.match(/A /g) ?? [], 4);
    assert.isTrue(full.trimEnd().endsWith("Z"));
    // The 90° wedge: r0 = 0 on the second row, so it is one arc
    // out and a line back through the pole, not a ring walked
    // twice — the other of `arcToD`'s two shapes.
    assert.lengthOf(wedge.match(/A /g) ?? [], 1);
    assert.include(wedge, `L ${CX} ${CY}`);
    // R2/R26 — the renderer never wrote to what it was handed.
    assert.deepEqual(sceneOf(view), scene);
  });
});
