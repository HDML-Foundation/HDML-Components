/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert, fixture } from "@open-wc/testing";
import { html } from "lit/static-html.js";
import { LitElement } from "lit";
import { resetMouse, sendMouse } from "@web/test-runner-commands";
import "./index";
import type { HdvlElement } from "./base";
import { HdmlViewElement } from "./view";

/**
 * 017 R7's generated rules, under a **real pointer**.
 *
 * `states.test.ts` owns the half of the evidence that needs none: the
 * rule text as a pure function, and the cascade — *an adopted
 * constructed rule beats an SVG presentation attribute* — against a
 * real `<svg>` with a non-pseudo selector. This file owns the rest,
 * and every test here would pass vacuously without an OS-level mouse:
 * `:hover` and `:active` are the two things `npm test` could not move
 * before the `sendMousePlugin` landed in `.testrc.js`.
 *
 * **Why a sibling file rather than a suite in `states.test.ts`.**
 * That file documents itself as the pointer-free half and its cascade
 * suite's whole value is that it needs no pointer, so folding a
 * pointer suite in would make its own prose false. A pointer is also
 * **global mutable state** — the package's own warning is that the
 * mouse stays where it was left — so this file's `teardown` calls
 * `resetMouse()`, and that must not silently wrap tests that never
 * moved one.
 *
 * **Four claims, and the fourth is the shape of the mechanism.**
 *
 * 1. **Per datum** — one of N `rect` / `ellipse` / `path` nodes
 *    changes and its siblings do not. The aim is proved by moving to
 *    a sibling and watching the first node go back.
 * 2. **Whole series** — `hdml-line` and `hdml-area` emit **one** node
 *    with `i: -1`, so "the mark *is* the element", and the *same*
 *    selector reaches it with no special case. R7's central
 *    correction, exercised.
 * 3. **A guide** — every `hdml-tick` glyph is `i: -1` too, and it is
 *    reached by the same selector as a bar. **The mechanism needs no
 *    index at all**, which is the property a scene-level
 *    hovered-index design could not have had: it could never have
 *    reached a tick.
 * 4. **`:active`** — the first time half of the v1 state list has
 *    ever been applied anywhere.
 *
 * Plus the **two suppressions**, which until now were asserted only
 * as rule text: a channel-bound mark's fill must not move, and a
 * stroked mark must gain no fill. Both are written so the pointer
 * demonstrably landed — the declaration that *is* allowed moves in
 * the same assertion.
 */

/** A viewport point, CSS px, as `sendMouse` takes one. */
type Point = [number, number];

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

/**
 * A mounted view painted by the **real** renderer.
 *
 * No scene recorder: this file asserts the DOM the renderer wrote and
 * the style the browser computed over it, and a recording stub paints
 * neither. It is the one HDVL suite for which `sceneOf` is useless.
 */
async function mount(
  markup: ReturnType<typeof html>,
): Promise<HdmlViewElement> {
  const view = await fixture<HdmlViewElement>(markup);
  await settle(view);
  view.markDirty();
  await quiesce(view);
  return view;
}

function widget(view: HdmlViewElement, sel: string): HdvlElement {
  const el = <HdvlElement>view.querySelector(sel);
  assert.isNotNull(el, sel);
  return el;
}

/** One widget's painted nodes, in paint order. */
function nodesOf(
  view: HdmlViewElement,
  el: HdvlElement,
): SVGElement[] {
  const root = <ShadowRoot>view.shadowRoot;
  return Array.from(
    root.querySelectorAll<SVGElement>(`g[data-w="${el.uid}"] > *`),
  );
}

/** A computed presentation value off a painted node. */
function of(el: SVGElement, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

/**
 * Candidate viewport points for a node, **best first**.
 *
 * ★ An SVG node's hit area is `pointer-events: visiblePainted` and
 * nothing in this library sets that property, so a node is hovered
 * only where it actually paints. That splits two ways:
 *
 * - a **stroked** node — a `line`'s path is `fill: none` — is painted
 *   on its stroke ONLY, a 1.5 px target inside a 400 × 200 bounding
 *   box, so its own centreline is sampled with `getPointAtLength`
 *   and mapped to the viewport through `getScreenCTM`. Aiming at the
 *   centre of the box would hit nothing at all.
 * - a **filled** node is probed on a grid ordered outwards from the
 *   centre of its client rect. A `rect` and an `ellipse` hit on the
 *   first candidate; a quarter-disc `arc`, whose box centre is
 *   inside it but whose box corners are not, hits within a few.
 */
function candidates(el: SVGElement): Point[] {
  const out: Point[] = [];
  const geo = <SVGGeometryElement>el;
  const stroked =
    of(el, "fill") === "none" &&
    typeof geo.getPointAtLength === "function";
  if (stroked) {
    const len = geo.getTotalLength();
    const ctm = geo.getScreenCTM();
    for (const f of [0.5, 0.25, 0.75, 0.4, 0.6, 0.1, 0.9]) {
      const p = geo.getPointAtLength(len * f);
      const v =
        ctm === null
          ? p
          : new DOMPoint(p.x, p.y).matrixTransform(ctm);
      out.push([Math.round(v.x), Math.round(v.y)]);
    }
    return out;
  }
  const box = el.getBoundingClientRect();
  const twelfths = [6, 5, 7, 4, 8, 3, 9];
  for (const fy of twelfths) {
    for (const fx of twelfths) {
      out.push([
        Math.round(box.x + (box.width * fx) / 12),
        Math.round(box.y + (box.height * fy) / 12),
      ]);
    }
  }
  return out;
}

/**
 * A viewport point that really hits this node — **verified before
 * any pointer moves**.
 *
 * The view's `<svg>` is in a shadow root and a real pointer hits
 * whatever is topmost at those coordinates, so the arithmetic is not
 * trusted: `ShadowRoot.elementFromPoint` has to name this very node.
 * It answers about the composed tree, so it accounts for occlusion
 * as well as for geometry — which `isPointInFill` would not.
 */
function aimAt(view: HdmlViewElement, el: SVGElement): Point {
  const root = <ShadowRoot>view.shadowRoot;
  for (const point of candidates(el)) {
    if (root.elementFromPoint(point[0], point[1]) === el) {
      return point;
    }
  }
  const box = el.getBoundingClientRect();
  throw new Error(
    `no candidate point hits <${el.tagName}> at ` +
      `${box.x},${box.y} ${box.width}x${box.height}`,
  );
}

/** Moves the real pointer there, then lets style settle. */
async function hover(point: Point): Promise<void> {
  await sendMouse({ type: "move", position: point });
  await tick();
  await tick();
}

/** Holds the left button down where the pointer already is. */
async function press(): Promise<void> {
  await sendMouse({ type: "down" });
  await tick();
  await tick();
}

const HOVER = "rgb(0, 255, 0)";
const ACTIVE = "rgb(0, 0, 255)";

suite("hdvl/states — per datum, under a real pointer", () => {
  teardown(async () => {
    await resetMouse();
  });

  test("one of four bars changes, and only that one", async () => {
    // The `mark-bar` geometry: width 76, four categories and the
    // initial `--hdml-bandwidth: 0.8` make the band step exactly 20,
    // so every bar is a comfortable 16 px target.
    const view = await mount(html`
      <hdml-view aria-label="bar" style="width: 76px; height: 200px">
        <hdml-cartesian-plane style="padding: 0">
          <hdml-ordinal-scale channel="x" values='["a","b","c","d"]'>
            <hdml-continuous-scale channel="y" min="0" max="200">
              <hdml-bar
                x='["a","b","c","d"]'
                y="[50, 100, 150, 200]"
                style="--hdml-fill-color--hover: ${HOVER}"
              ></hdml-bar>
            </hdml-continuous-scale>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const nodes = nodesOf(view, widget(view, "hdml-bar"));
    assert.lengthOf(nodes, 4);
    const base = of(nodes[0], "fill");
    assert.notStrictEqual(base, HOVER, "base must differ");

    await hover(aimAt(view, nodes[1]));
    assert.isTrue(nodes[1].matches(":hover"), "node 1 hovered");
    assert.strictEqual(of(nodes[1], "fill"), HOVER);
    for (const j of [0, 2, 3]) {
      assert.isFalse(nodes[j].matches(":hover"), `node ${j}`);
      assert.strictEqual(of(nodes[j], "fill"), base, `node ${j}`);
    }

    // ★ The aim is proved by moving off it: exactly one node moves,
    // and it is the OTHER one. A test that could not tell "this
    // node" from "every node" would pass the first half alone.
    await hover(aimAt(view, nodes[2]));
    assert.strictEqual(of(nodes[2], "fill"), HOVER);
    assert.strictEqual(of(nodes[1], "fill"), base, "node 1 back");
  });

  test("one of four points changes — an ellipse", async () => {
    // A different node KIND, and `pointer-events: visiblePainted`
    // resolves per kind. R9's default glyph is a 6 px SQUARE, so the
    // round one is `--hdml-tick-style: ellipse` — asked for here
    // because `rect` is already covered twice over, by the bars
    // above and by the tick glyphs below.
    const view = await mount(html`
      <hdml-view aria-label="pt" style="width: 400px; height: 200px">
        <hdml-cartesian-plane style="padding: 0">
          <hdml-continuous-scale channel="x" min="0" max="4">
            <hdml-continuous-scale channel="y" min="0" max="200">
              <hdml-point
                x="[0.5, 1.5, 2.5, 3.5]"
                y="[50, 100, 150, 100]"
                style="--hdml-tick-style: ellipse;
                  --hdml-tick-width: 11px;
                  --hdml-tick-height: 11px;
                  --hdml-fill-color--hover: ${HOVER}"
              ></hdml-point>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const nodes = nodesOf(view, widget(view, "hdml-point"));
    assert.lengthOf(nodes, 4);
    assert.strictEqual(nodes[0].tagName, "ellipse");
    const base = of(nodes[0], "fill");

    await hover(aimAt(view, nodes[2]));
    assert.strictEqual(of(nodes[2], "fill"), HOVER);
    for (const j of [0, 1, 3]) {
      assert.strictEqual(of(nodes[j], "fill"), base, `node ${j}`);
    }
  });

  test("one of four wedges changes — an arc path", async () => {
    // Four quarter wedges from the pole. An `arc` node is serialized
    // as a `<path>`, so this is the third node kind.
    const view = await mount(html`
      <hdml-view aria-label="arc" style="width: 200px; height: 200px">
        <hdml-polar-plane style="padding: 0">
          <hdml-continuous-scale channel="angle" min="0" max="1">
            <hdml-continuous-scale channel="radius" min="0" max="1">
              <hdml-arc
                a0="[0, 0.25, 0.5, 0.75]"
                a1="[0.25, 0.5, 0.75, 1]"
                style="--hdml-fill-color--hover: ${HOVER}"
              ></hdml-arc>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-polar-plane>
      </hdml-view>
    `);
    const nodes = nodesOf(view, widget(view, "hdml-arc"));
    assert.lengthOf(nodes, 4);
    assert.strictEqual(nodes[0].tagName, "path");
    const base = of(nodes[0], "fill");

    await hover(aimAt(view, nodes[3]));
    assert.strictEqual(of(nodes[3], "fill"), HOVER);
    for (const j of [0, 1, 2]) {
      assert.strictEqual(of(nodes[j], "fill"), base, `node ${j}`);
    }
  });
});

suite("hdvl/states — whole series, under a real pointer", () => {
  teardown(async () => {
    await resetMouse();
  });

  test("a line is ONE node with i = -1, and it hovers", async () => {
    // ★ R7's central correction. `mark-line` emits one `path` for
    // the whole series, so for this element the mark IS the element
    // — and the SAME selector reaches it, with no special case and
    // no index. Nothing else in the repo exercises that.
    const view = await mount(html`
      <hdml-view
        aria-label="line"
        style="width: 400px; height: 200px"
      >
        <hdml-cartesian-plane style="padding: 0">
          <hdml-continuous-scale channel="x" min="0" max="4">
            <hdml-continuous-scale channel="y" min="0" max="200">
              <hdml-line
                x="[0, 1, 2, 3, 4]"
                y="[40, 120, 60, 160, 80]"
                style="--hdml-line-color--hover: ${HOVER}"
              ></hdml-line>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const nodes = nodesOf(view, widget(view, "hdml-line"));
    assert.lengthOf(nodes, 1, "one node for five rows");
    assert.strictEqual(nodes[0].getAttribute("data-i"), "-1");
    assert.strictEqual(of(nodes[0], "fill"), "none");
    const base = of(nodes[0], "stroke");
    assert.notStrictEqual(base, HOVER);

    await hover(aimAt(view, nodes[0]));
    assert.isTrue(nodes[0].matches(":hover"), "the series");
    assert.strictEqual(of(nodes[0], "stroke"), HOVER);
  });

  test("an area is ONE node with i = -1, and it hovers", async () => {
    const view = await mount(html`
      <hdml-view
        aria-label="area"
        style="width: 400px; height: 200px"
      >
        <hdml-cartesian-plane style="padding: 0">
          <hdml-continuous-scale channel="x" min="0" max="4">
            <hdml-continuous-scale channel="y" min="0" max="200">
              <hdml-area
                x="[0, 1, 2, 3, 4]"
                y="[40, 120, 60, 160, 80]"
                style="--hdml-fill-color--hover: ${HOVER}"
              ></hdml-area>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const nodes = nodesOf(view, widget(view, "hdml-area"));
    assert.lengthOf(nodes, 1, "one node for five rows");
    assert.strictEqual(nodes[0].getAttribute("data-i"), "-1");
    const base = of(nodes[0], "fill");
    assert.notStrictEqual(base, HOVER, "base must differ");

    await hover(aimAt(view, nodes[0]));
    assert.strictEqual(of(nodes[0], "fill"), HOVER);
  });
});

suite("hdvl/states — a guide needs NO index", () => {
  teardown(async () => {
    await resetMouse();
  });

  test("one tick glyph changes, and every i is -1", async () => {
    // ★ The property worth proving. Every guide node is `i: -1`, so
    // a scene-level hovered-INDEX design could never have reached a
    // tick at all; this mechanism reaches one through the same
    // selector as a bar, because the selector names no index. The
    // glyph is sized up from its 1 x 6 default so the target is
    // comfortably larger than a pixel.
    const view = await mount(html`
      <hdml-view
        aria-label="tick"
        style="width: 400px; height: 200px"
      >
        <hdml-cartesian-plane>
          <hdml-continuous-scale channel="x" min="0" max="4">
            <hdml-continuous-scale channel="y" min="0" max="200">
              <hdml-tick
                channel="y"
                style="--hdml-tick-width: 11px;
                  --hdml-tick-height: 11px;
                  --hdml-fill-color--hover: ${HOVER}"
              ></hdml-tick>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const nodes = nodesOf(view, widget(view, "hdml-tick"));
    assert.isAtLeast(nodes.length, 3, "several ticks");
    for (const node of nodes) {
      assert.strictEqual(node.getAttribute("data-i"), "-1");
    }
    const base = of(nodes[0], "fill");

    const j = nodes.length - 2;
    await hover(aimAt(view, nodes[j]));
    assert.strictEqual(of(nodes[j], "fill"), HOVER);
    for (let k = 0; k < nodes.length; k++) {
      if (k !== j) {
        assert.strictEqual(of(nodes[k], "fill"), base, `tick ${k}`);
      }
    }
  });
});

suite("hdvl/states — :active, on pointer-down", () => {
  teardown(async () => {
    await sendMouse({ type: "up" });
    await resetMouse();
  });

  /** The four-bar fixture again, with the states the test needs. */
  function bars(style: string): ReturnType<typeof html> {
    return html`
      <hdml-view aria-label="bar" style="width: 76px; height: 200px">
        <hdml-cartesian-plane style="padding: 0">
          <hdml-ordinal-scale channel="x" values='["a","b","c","d"]'>
            <hdml-continuous-scale channel="y" min="0" max="200">
              <hdml-bar
                x='["a","b","c","d"]'
                y="[50, 100, 150, 200]"
                style="${style}"
              ></hdml-bar>
            </hdml-continuous-scale>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `;
  }

  test("pointer-down applies :active to that node", async () => {
    // ★ Half the v1 state list had never once been applied — not on
    // a page, not in a test, not in a scratchpad probe beyond step
    // 09's platform check. This is the first time.
    const view = await mount(
      bars(`--hdml-fill-color--active: ${ACTIVE}`),
    );
    const nodes = nodesOf(view, widget(view, "hdml-bar"));
    const base = of(nodes[0], "fill");

    await hover(aimAt(view, nodes[1]));
    assert.strictEqual(
      of(nodes[1], "fill"),
      base,
      "hovering alone must not apply an :active rule",
    );
    await press();
    assert.isTrue(nodes[1].matches(":active"), "node 1 active");
    assert.strictEqual(of(nodes[1], "fill"), ACTIVE);
    assert.strictEqual(of(nodes[2], "fill"), base, "the sibling");
  });

  test(":active wins while both states hold", async () => {
    // Both rules match a pressed node and both have the same
    // specificity, so the later one wins — and the generator emits
    // `HDVL_STATES` in order, hover first. The order is therefore
    // observable, not decorative.
    const view = await mount(
      bars(
        `--hdml-fill-color--hover: ${HOVER};` +
          `--hdml-fill-color--active: ${ACTIVE}`,
      ),
    );
    const nodes = nodesOf(view, widget(view, "hdml-bar"));

    await hover(aimAt(view, nodes[0]));
    assert.strictEqual(of(nodes[0], "fill"), HOVER);
    await press();
    assert.isTrue(nodes[0].matches(":hover"), "still hovered");
    assert.strictEqual(of(nodes[0], "fill"), ACTIVE);
  });
});

suite("hdvl/states — the two suppressions, under a pointer", () => {
  teardown(async () => {
    await resetMouse();
  });

  test("a channel fill holds, its outline moves", async () => {
    // SPEC §9, as DOM rather than as rule text: channel-bound paint
    // wins over `--hdml-fill-color` AND its state variants alike, so
    // a LITERAL hover cue has to use what the channel does not own.
    // ⚠ Since 019 R1 that is no longer the only cue available — the
    // scale's `--hdml-palette--{state}` state-varies the channel's
    // own paint, asserted on its own below — but it is still the only
    // thing a literal may say, which is what this fixture authors.
    // The width variant moving in the same assertion is what proves
    // the pointer landed — without it this would pass with no pointer
    // at all.
    const view = await mount(html`
      <hdml-view aria-label="bar" style="width: 76px; height: 200px">
        <hdml-cartesian-plane style="padding: 0">
          <hdml-ordinal-scale channel="x" values='["a","b","c","d"]'>
            <hdml-ordinal-scale
              channel="color"
              values='["a","b","c","d"]'
            >
              <hdml-continuous-scale channel="y" min="0" max="200">
                <hdml-bar
                  x='["a","b","c","d"]'
                  y="[50, 100, 150, 200]"
                  color='["a","b","c","d"]'
                  style="--hdml-fill-color--hover: ${HOVER};
                    --hdml-line-width--hover: 4px"
                ></hdml-bar>
              </hdml-continuous-scale>
            </hdml-ordinal-scale>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const nodes = nodesOf(view, widget(view, "hdml-bar"));
    assert.lengthOf(nodes, 4);
    const base = of(nodes[1], "fill");
    // The channel really is painting: four rows, four fills.
    const fills = new Set(nodes.map((n) => of(n, "fill")));
    assert.isAtLeast(fills.size, 2, "the channel paints per row");

    await hover(aimAt(view, nodes[1]));
    assert.isTrue(nodes[1].matches(":hover"));
    assert.strictEqual(of(nodes[1], "stroke-width"), "4px");
    assert.strictEqual(
      of(nodes[1], "fill"),
      base,
      "the channel keeps the fill on hover",
    );
    assert.notStrictEqual(of(nodes[1], "fill"), HOVER);
  });

  test("a stroked mark gains no fill; its width moves", async () => {
    // 09-2's Finding 2, and the ONLY place it is visible at all:
    // `strokePaint` returns `fill: null` unconditionally, so a fill
    // variant here would fill the series path on hover — a state no
    // base state can express, and one no scene golden could ever
    // show, because the scene's `fill` stays `null` either way.
    const view = await mount(html`
      <hdml-view
        aria-label="line"
        style="width: 400px; height: 200px"
      >
        <hdml-cartesian-plane style="padding: 0">
          <hdml-continuous-scale channel="x" min="0" max="4">
            <hdml-continuous-scale channel="y" min="0" max="200">
              <hdml-line
                x="[0, 1, 2, 3, 4]"
                y="[40, 120, 60, 160, 80]"
                style="--hdml-fill-color--hover: ${HOVER};
                  --hdml-line-width--hover: 5px"
              ></hdml-line>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const nodes = nodesOf(view, widget(view, "hdml-line"));
    assert.lengthOf(nodes, 1);

    await hover(aimAt(view, nodes[0]));
    assert.isTrue(nodes[0].matches(":hover"));
    assert.strictEqual(of(nodes[0], "stroke-width"), "5px");
    assert.strictEqual(
      of(nodes[0], "fill"),
      "none",
      "a stroked host must never gain a fill",
    );
  });
});

suite("hdvl/states — R1: a channel palette, under a pointer", () => {
  // ★★★ **019 R1's HARD GATE, step 38** — the two halves meeting at
  // the DOM: `applyPaint` stamps the per-datum colour, the sheet's
  // channel rule reads it back with `var()`, and the browser picks
  // the node. Nothing short of a real pointer can see it.
  //
  // ⚠ **The plan row named `09-polar-area` and that page authors no
  // channel state palette** — row 40 is the step that adds one.
  // Settled with the founder on 2026-10-13: the gate runs on a
  // fixture here, which is this file's established pattern (all
  // five existing suites mount their own `html` and reach no corpus
  // page at all).
  //
  // The fixture is a polar-plane `hdml-arc` so the gate exercises
  // the shape the row asked for — four quarter wedges, coloured by
  // an ordinal `color` scale carrying `--hdml-palette` and both
  // state palettes.

  teardown(async () => {
    await resetMouse();
  });

  /** The four-wedge rose, with whatever palettes are given. */
  function wedges(scaleStyle: string): ReturnType<typeof html> {
    return html`
      <hdml-view
        aria-label="rose"
        style="width: 200px; height: 200px"
      >
        <hdml-polar-plane style="padding: 0">
          <hdml-continuous-scale channel="angle" min="0" max="1">
            <hdml-continuous-scale channel="radius" min="0" max="1">
              <hdml-ordinal-scale
                channel="color"
                values='["a","b","c","d"]'
                style="${scaleStyle}"
              >
                <hdml-arc
                  a0="[0, 0.25, 0.5, 0.75]"
                  a1="[0.25, 0.5, 0.75, 1]"
                  color='["a","b","c","d"]'
                ></hdml-arc>
              </hdml-ordinal-scale>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-polar-plane>
      </hdml-view>
    `;
  }

  const BASE =
    "--hdml-palette: rgb(10, 10, 10) rgb(20, 20, 20) " +
    "rgb(30, 30, 30) rgb(40, 40, 40);";
  const ON_HOVER =
    "--hdml-palette--hover: rgb(210, 0, 0) rgb(0, 210, 0) " +
    "rgb(0, 0, 210) rgb(210, 210, 0);";
  const ON_ACTIVE =
    "--hdml-palette--active: rgb(110, 0, 0) rgb(0, 110, 0) " +
    "rgb(0, 0, 110) rgb(110, 110, 0);";

  test("★★★ a wedge recolours PER DATUM on hover", async () => {
    const view = await mount(wedges(BASE + ON_HOVER));
    const nodes = nodesOf(view, widget(view, "hdml-arc"));
    assert.lengthOf(nodes, 4);
    const base = nodes.map((n) => of(n, "fill"));
    assert.deepEqual(base, [
      "rgb(10, 10, 10)",
      "rgb(20, 20, 20)",
      "rgb(30, 30, 30)",
      "rgb(40, 40, 40)",
    ]);

    // ★★ **Negative control 2.** Each wedge takes its OWN state
    // colour, and the three it does not own stay put. A rule that
    // recoloured the whole series would pass any single-node
    // assertion, which is why every index is checked.
    const want = [
      "rgb(210, 0, 0)",
      "rgb(0, 210, 0)",
      "rgb(0, 0, 210)",
      "rgb(210, 210, 0)",
    ];
    for (const k of [1, 2, 0, 3]) {
      await hover(aimAt(view, nodes[k]));
      assert.isTrue(nodes[k].matches(":hover"), `wedge ${k}`);
      assert.strictEqual(
        of(nodes[k], "fill"),
        want[k],
        `hovered ${k}`,
      );
      for (let j = 0; j < 4; j++) {
        if (j !== k) {
          assert.strictEqual(
            of(nodes[j], "fill"),
            base[j],
            `wedge ${j} while ${k} is hovered`,
          );
        }
      }
    }
  });

  test("★★ :active takes its own per-datum colour", async () => {
    const view = await mount(wedges(BASE + ON_HOVER + ON_ACTIVE));
    const nodes = nodesOf(view, widget(view, "hdml-arc"));
    await hover(aimAt(view, nodes[2]));
    assert.strictEqual(of(nodes[2], "fill"), "rgb(0, 0, 210)");
    await press();
    assert.isTrue(nodes[2].matches(":hover"), "still hovered");
    assert.strictEqual(of(nodes[2], "fill"), "rgb(0, 0, 110)");
  });

  test("★★ control 3 — NO frame runs per pointer move", async () => {
    // ★★ **Negative control 3**, and the whole reason the mechanism
    // is a CSS rule rather than a hovered-index in the scene. The
    // number is asserted, not observed.
    const view = await mount(wedges(BASE + ON_HOVER));
    const nodes = nodesOf(view, widget(view, "hdml-arc"));
    const before = view.framesRun;
    await hover(aimAt(view, nodes[0]));
    await hover(aimAt(view, nodes[1]));
    await hover(aimAt(view, nodes[2]));
    assert.strictEqual(of(nodes[2], "fill"), "rgb(0, 0, 210)");
    assert.strictEqual(view.framesRun, before, "no frame per move");
  });

  test("★ an unauthored :active leaves the base paint", async () => {
    // ★ Open question 5, as behaviour. `hover` is authored and
    // `active` is not, so no `active` rule is emitted at all — and
    // the stamped `--hdvl-state-active` carries the node's own base
    // paint, so even a rule that WERE emitted would be a no-op.
    // Neither route can paint the wedge a colour the scene does not
    // contain.
    const view = await mount(wedges(BASE + ON_HOVER));
    const nodes = nodesOf(view, widget(view, "hdml-arc"));
    await hover(aimAt(view, nodes[1]));
    await press();
    assert.strictEqual(of(nodes[1], "fill"), "rgb(0, 210, 0)");
  });

  test("★★ a wedge with no state colour holds", async () => {
    // ★★★ **Control 5 ⓑ, as a guard rather than a measurement.**
    // The channel rule is emitted for the whole widget, but a node
    // with no state colour carries no marker and is never matched.
    // Without the marker the `var()` would be invalid at
    // computed-value time — `unset` — and `fill` INHERITS, so the
    // wedge would hover to its group's colour.
    //
    // A SHORT `--hover` palette is how a node ends up in exactly
    // that state: wedges 0 and 1 get a hover colour, 2 and 3 get
    // none. (Row 39 adds the diagnostic for it; the behaviour is
    // this step's to get right.)
    const view = await mount(
      wedges(
        BASE +
          "--hdml-palette--hover: rgb(210, 0, 0) rgb(0, 210, 0);",
      ),
    );
    const nodes = nodesOf(view, widget(view, "hdml-arc"));
    await hover(aimAt(view, nodes[0]));
    assert.strictEqual(of(nodes[0], "fill"), "rgb(210, 0, 0)");

    await hover(aimAt(view, nodes[3]));
    assert.isTrue(nodes[3].matches(":hover"), "wedge 3 hovered");
    assert.strictEqual(
      of(nodes[3], "fill"),
      "rgb(40, 40, 40)",
      "an unmarked wedge keeps its presentation attribute",
    );
  });

  test("★ no palette state — hovering changes nothing", async () => {
    const view = await mount(wedges(BASE));
    const nodes = nodesOf(view, widget(view, "hdml-arc"));
    await hover(aimAt(view, nodes[2]));
    assert.isTrue(nodes[2].matches(":hover"));
    assert.strictEqual(of(nodes[2], "fill"), "rgb(30, 30, 30)");
  });
});

suite("hdvl/states — R1: control 5, the one nobody asked for", () => {
  // ★★★ **Negative control 5, step 38.** Three findings, two of
  // which are behaviours no other assertion in the repo reaches.

  teardown(async () => {
    await resetMouse();
  });

  const BASE =
    "--hdml-palette: rgb(10, 10, 10) rgb(20, 20, 20) " +
    "rgb(30, 30, 30) rgb(40, 40, 40);";

  test("★★★ a LIVE palette change re-stamps", async () => {
    // ★★★ **The find.** R1's mechanism is per FRAME: `applyPaint`
    // stamps from the snapshot MEASURE took, so a declarative
    // change to `--hdml-palette--hover` only reaches the DOM if a
    // frame runs — and R24's sentinel is what runs one. The four
    // channel state properties were added to the registry at item
    // 9, and `SENTINEL_PROPERTIES` is built from the registry
    // rather than by hand, so they are covered **by construction**
    // — which is exactly the shape 017 R6 found FIFTEEN silently
    // unobserved properties in.
    //
    // Nothing else asserts it: control 3 asserts a frame does NOT
    // run per pointer move, and this is its opposite half — a
    // frame MUST run per declarative change, or a live-editing
    // page shows a stale hover colour with no error.
    //
    // The pointer never moves during the change, so the recolour
    // cannot be coming from a re-hover.
    const view = await mount(html`
      <hdml-view
        aria-label="rose"
        style="width: 200px; height: 200px"
      >
        <hdml-polar-plane style="padding: 0">
          <hdml-continuous-scale channel="angle" min="0" max="1">
            <hdml-continuous-scale channel="radius" min="0" max="1">
              <hdml-ordinal-scale
                channel="color"
                values='["a","b","c","d"]'
                style="${BASE}--hdml-palette--hover: rgb(210, 0, 0)
                  rgb(0, 210, 0) rgb(0, 0, 210) rgb(210, 210, 0);"
              >
                <hdml-arc
                  a0="[0, 0.25, 0.5, 0.75]"
                  a1="[0.25, 0.5, 0.75, 1]"
                  color='["a","b","c","d"]'
                ></hdml-arc>
              </hdml-ordinal-scale>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-polar-plane>
      </hdml-view>
    `);
    const nodes = nodesOf(view, widget(view, "hdml-arc"));
    await hover(aimAt(view, nodes[1]));
    assert.strictEqual(of(nodes[1], "fill"), "rgb(0, 210, 0)");

    const scale = <HTMLElement>(
      view.querySelector("hdml-ordinal-scale")
    );
    const before = view.framesRun;
    scale.style.setProperty(
      "--hdml-palette--hover",
      "rgb(1, 1, 1) rgb(2, 2, 2) rgb(3, 3, 3) rgb(4, 4, 4)",
    );
    await quiesce(view);
    assert.isAbove(
      view.framesRun,
      before,
      "the sentinel ran a frame",
    );
    assert.strictEqual(
      of(nodes[1], "fill"),
      "rgb(2, 2, 2)",
      "the stamp followed the declaration, with no re-hover",
    );
  });

  test("★★ hdml-pie is a sixth host", async () => {
    // ★★ `layout-pie.ts` has no `channelStates` call of its own —
    // `scene()` on both tags is one call to `mark-arc.ts`'s
    // `sectorScene`, so ONE call site serves TWO hosts, exactly as
    // `fillPaint` does. `PIE_ATTRS_LIST` publishes `color`, so a
    // pie is channel-colourable, and `channelPropOf` has to agree
    // with a `prop` passed from a file that never names `hdml-pie`
    // — C298's two-ends hazard on the one tag where the two ends
    // are not even the same element type.
    const view = await mount(html`
      <hdml-view aria-label="pie" style="width: 200px; height: 200px">
        <hdml-polar-plane style="padding: 0">
          <hdml-continuous-scale channel="angle" min="0" max="1">
            <hdml-continuous-scale channel="radius" min="0" max="1">
              <hdml-ordinal-scale
                channel="color"
                values='["a","b","c","d"]'
                style="${BASE}--hdml-palette--hover: rgb(210, 0, 0)
                  rgb(0, 210, 0) rgb(0, 0, 210) rgb(210, 210, 0);"
              >
                <hdml-pie
                  angle="[1, 1, 1, 1]"
                  color='["a","b","c","d"]'
                ></hdml-pie>
              </hdml-ordinal-scale>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-polar-plane>
      </hdml-view>
    `);
    const nodes = nodesOf(view, widget(view, "hdml-pie"));
    assert.lengthOf(nodes, 4);
    assert.strictEqual(of(nodes[2], "fill"), "rgb(30, 30, 30)");
    await hover(aimAt(view, nodes[2]));
    assert.strictEqual(of(nodes[2], "fill"), "rgb(0, 0, 210)");
    assert.strictEqual(of(nodes[0], "fill"), "rgb(10, 10, 10)");
  });

  test("★★ a legend swatch follows the palette", async () => {
    // ★★ **D2's consequence, and it retires a documented
    // exception.** `suppressedOf`'s docblock records the legend as
    // the one widget for which nothing is suppressed — it binds
    // `channel="color"`, not `color` — and argues that its
    // `--hdml-fill-color--hover` reaching a swatch is *"a
    // reasonable reading"* because *"one selector cannot tell
    // those nodes apart"*.
    //
    // A per-node property plus a marker tells them apart. When BOTH
    // are authored the swatch takes the palette (the channel rule
    // carries one more attribute selector, so SPEC §9's *"channel
    // -bound paint wins … and its state variants alike"* falls out
    // of the cascade) and the two text runs take the literal. That
    // is a behaviour CHANGE for a page authoring both, and nothing
    // else in the suite looks at it.
    const view = await mount(html`
      <hdml-view aria-label="key" style="width: 400px; height: 200px">
        <hdml-cartesian-plane style="padding: 0">
          <hdml-continuous-scale channel="x" min="0" max="10">
            <hdml-ordinal-scale
              channel="color"
              values='["a","b"]'
              style="--hdml-palette: rgb(10, 10, 10) rgb(20, 20, 20);
                --hdml-palette--hover: rgb(210, 0, 0) rgb(0, 210, 0);"
            >
              <hdml-legend
                channel="color"
                style="top: 0; left: 0; width: 140px; height: 120px;
                  --hdml-fill-color--hover: rgb(9, 9, 9)"
              ></hdml-legend>
            </hdml-ordinal-scale>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const nodes = nodesOf(view, widget(view, "hdml-legend"));
    assert.lengthOf(nodes, 4, "two entries, swatch + name each");
    const swatch = nodes[0];
    const name = nodes[1];
    assert.strictEqual(name.tagName, "text");

    await hover(aimAt(view, swatch));
    assert.strictEqual(
      of(swatch, "fill"),
      "rgb(210, 0, 0)",
      "the swatch takes the PALETTE, not the literal",
    );

    await hover(aimAt(view, name));
    assert.strictEqual(
      of(name, "fill"),
      "rgb(9, 9, 9)",
      "a name has no channel colour and takes the literal",
    );
  });
});
