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
    // SPEC §10, as DOM rather than as rule text: channel-bound paint
    // wins over `--hdml-fill-color` AND its state variants alike, so
    // the hover cue must use what the channel does not own. The width
    // variant moving in the same assertion is what proves the pointer
    // landed — without it this would pass with no pointer at all.
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
