/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert, fixture } from "@open-wc/testing";
import { html } from "lit/static-html.js";
import { LitElement } from "lit";
import "./index";
import type { HdvlElement } from "./base";
import type { Measured } from "./measure";
import type { Point } from "./scene";
import { HdmlViewElement } from "./view";
import { elementsOf } from "./resolve";
import { measureView } from "./measure";
import { frameTrace } from "./schedule";

/**
 * MEASURE (§5.4): **once per element per frame, and no writes.**
 *
 * Every fixture here runs on all three engines, which is not
 * ceremony — `getComputedStyle` is precisely where the engines
 * differ. R16's `currentcolor` split is measured, not assumed:
 * chromium and firefox compute the literal keyword and webkit the
 * already-resolved `rgb()`, so the suite asserts the **resolved**
 * value everywhere and never the raw computed string.
 */

async function settle(root: Element): Promise<void> {
  const all = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const el of all) {
    if (el instanceof LitElement) {
      await el.updateComplete;
    }
  }
}

function pick(root: Element, selector: string): HdvlElement {
  return <HdvlElement>root.querySelector(selector);
}

function snapshot(view: HdmlViewElement): Map<HdvlElement, Measured> {
  return <Map<HdvlElement, Measured>>(
    measureView(view, elementsOf(view)).measured
  );
}

function measured(view: HdmlViewElement, selector: string): Measured {
  const hit = snapshot(view).get(pick(view, selector));
  assert.isDefined(hit);
  return hit;
}

/** Every point of a resolved clip, flattened. */
function points(subpaths: readonly { start: Point }[]): Point[] {
  const out: Point[] = [];
  for (const sub of subpaths) {
    const s = <{ start: Point; segments: { to: Point }[] }>(
      (<unknown>sub)
    );
    out.push(s.start);
    for (const seg of s.segments) {
      out.push(seg.to);
    }
  }
  return out;
}

function tick(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

async function frame(view: HdmlViewElement): Promise<void> {
  const before = view.framesRun;
  for (let i = 0; i < 30 && view.framesRun === before; i++) {
    await tick();
  }
}

/** Waits until no frame has run for three consecutive rAFs. */
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

suite("hdvl/measure — the one computed-style pass", () => {
  test("currentcolor is resolved by us", async () => {
    // R16. `--hdml-fill-color` and `--hdml-line-color` both carry
    // `currentColor` as their SPEC initial. Without this, SPEC §9's
    // "an unstyled chart is legible and dark-mode-correct" holds on
    // one engine out of three.
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-bar
            x="a"
            y="b"
            style="color: rgb(1, 2, 3)"
          ></hdml-bar>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    await settle(view);
    const bar = measured(view, "hdml-bar");

    assert.strictEqual(bar.color, "rgb(1, 2, 3)");
    assert.strictEqual(
      bar.props.get("--hdml-fill-color"),
      "rgb(1, 2, 3)",
    );
    assert.strictEqual(
      bar.props.get("--hdml-line-color"),
      "rgb(1, 2, 3)",
    );
    // A paint the author DID name is untouched. (Its computed
    // serialization is engine business — only the fact that we did
    // not rewrite it to `color` is ours.)
    assert.notStrictEqual(
      bar.props.get("--hdml-color-interpolate"),
      bar.color,
    );
    assert.isAbove(
      (bar.props.get("--hdml-color-interpolate") ?? "").length,
      6,
    );
  });

  test("a box is view-relative, and never -0", async () => {
    // §2.7: every box is getBoundingClientRect() minus the view's
    // content-box origin. Plan rule 9: a flush edge is a difference
    // of equal doubles, and `-0` is deepEqual-distinct from `0`
    // forever after.
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-continuous-scale
            min="0"
            max="1"
            channel="y"
          ></hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    await settle(view);
    const all = snapshot(view);
    const plane = <Measured>(
      all.get(pick(view, "hdml-cartesian-plane"))
    );
    const scale = <Measured>(
      all.get(pick(view, "hdml-continuous-scale"))
    );

    assert.deepEqual(plane.box, { x: 0, y: 0, w: 400, h: 200 });
    assert.deepEqual(scale.box, { x: 40, y: 8, w: 352, h: 168 });
    assert.isTrue(Object.is(plane.box.x, 0));
    assert.isTrue(Object.is(plane.box.y, 0));
    assert.deepEqual((<Measured>all.get(view)).box, {
      x: 0,
      y: 0,
      w: 400,
      h: 200,
    });
  });

  test("clip-path becomes geometry, not a string", async () => {
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-bar
            x="a"
            y="b"
            style="clip-path: inset(10px)"
          ></hdml-bar>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    await settle(view);
    const bar = measured(view, "hdml-bar");
    assert.deepEqual(bar.box, { x: 40, y: 8, w: 352, h: 168 });
    assert.isNotNull(bar.clipPath);
    const pts = points(<readonly { start: Point }[]>bar.clipPath);
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    // View coordinates, inset by 10 on every side.
    assert.strictEqual(Math.min(...xs), 50);
    assert.strictEqual(Math.max(...xs), 382);
    assert.strictEqual(Math.min(...ys), 18);
    assert.strictEqual(Math.max(...ys), 166);
    assert.isFalse(bar.w6);
  });

  test("a url() clips nothing; MEASURE logs nothing", async () => {
    // §5.4: ignored, never half-applied. The flag is CARRIED, not
    // reported: a bare console.warn in this phase would re-fire
    // every frame, and §8's warnings are edge-triggered (R25). W6
    // is emitted from `validate.ts` — the only module under
    // `src/hdvl/` that writes to the console — and asserted in
    // `validate.test.ts`. What this asserts is the other half:
    // MEASURE itself still says nothing.
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-bar
            x="a"
            y="b"
            style="clip-path: url(#nope)"
          ></hdml-bar>
          <hdml-line
            x="a"
            y="b"
            style="filter: url(#nope)"
          ></hdml-line>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    await settle(view);

    const warn = console.warn;
    const error = console.error;
    let said = 0;
    console.warn = (): void => {
      said++;
    };
    console.error = (): void => {
      said++;
    };
    let bar: Measured;
    let line: Measured;
    try {
      const all = snapshot(view);
      bar = <Measured>all.get(pick(view, "hdml-bar"));
      line = <Measured>all.get(pick(view, "hdml-line"));
    } finally {
      console.warn = warn;
      console.error = error;
    }

    assert.isTrue(bar.w6);
    assert.isNull(bar.clipPath);
    assert.isTrue(line.w6);
    assert.strictEqual(line.filter, "none");
    assert.strictEqual(said, 0);
  });

  test("clip follows computed overflow", async () => {
    // SPEC §6's clip-to-the-plot-area IS the UA sheet's
    // `overflow: hidden` on the seven mark-painting hosts (§4.7),
    // so a mark gets it with no author rule.
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-bar x="a" y="b"></hdml-bar>
          <hdml-axis channel="y"></hdml-axis>
          <hdml-line
            x="a"
            y="b"
            style="overflow: visible"
          ></hdml-line>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    await settle(view);
    assert.isTrue(measured(view, "hdml-bar").clip);
    assert.isFalse(measured(view, "hdml-axis").clip);
    assert.isFalse(measured(view, "hdml-line").clip);
  });

  test("base and _hover come from one style", async () => {
    // SPEC §9's two-mechanism argument, and the whole reason ONE
    // computed style per element per frame suffices: eleven marks
    // can paint base while one paints hover.
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-bar
            x="a"
            y="b"
            style="color: rgb(1, 2, 3);
                   --hdml-fill-color_hover: rgb(7, 7, 7)"
          ></hdml-bar>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    await settle(view);
    const bar = measured(view, "hdml-bar");
    assert.strictEqual(
      bar.props.get("--hdml-fill-color"),
      "rgb(1, 2, 3)",
    );
    assert.strictEqual(
      bar.props.get("--hdml-fill-color_hover")?.trim(),
      "rgb(7, 7, 7)",
    );
    // The other three variants stay the empty "no change" sentinel.
    assert.strictEqual(
      bar.props.get("--hdml-line-color_hover")?.trim(),
      "",
    );
  });

  test("a transition shorthand kills the sentinel", async () => {
    // §5.6's three-line table, both live spellings of it.
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-bar x="a" y="b"></hdml-bar>
          <hdml-line
            x="a"
            y="b"
            style="transition: opacity 200ms"
          ></hdml-line>
          <hdml-area
            x="a"
            y="b"
            style="transition-duration: 300ms"
          ></hdml-area>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    await settle(view);
    assert.isTrue(measured(view, "hdml-bar").sentinel);
    assert.isFalse(measured(view, "hdml-line").sentinel);
    assert.isTrue(measured(view, "hdml-area").sentinel);
  });

  test("one getComputedStyle per element per frame", async () => {
    // §5.4 made mechanical. The counter is armed by the phase
    // trace, so it also asserts the OTHER half of the claim: no
    // computed style is read outside MEASURE.
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-continuous-scale min="0" max="1" channel="y">
            <hdml-bar x="a" y="b"></hdml-bar>
            <hdml-line x="a" y="b"></hdml-line>
            <hdml-axis channel="y"></hdml-axis>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    await settle(view);
    await quiesce(view);

    const elements = elementsOf(view);
    assert.strictEqual(elements.length, 6);

    const real = window.getComputedStyle;
    const counts = new Map<Element, number>();
    let counting = false;
    let total = 0;
    frameTrace.record = (phase): void => {
      counting = phase === "measure";
    };
    window.getComputedStyle = function (
      el: Element,
      pseudo?: null | string,
    ): CSSStyleDeclaration {
      if (counting) {
        counts.set(el, (counts.get(el) ?? 0) + 1);
        total++;
      }
      return real.call(window, el, pseudo);
    };
    try {
      view.markDirty();
      await frame(view);
    } finally {
      window.getComputedStyle = real;
      frameTrace.record = null;
    }

    assert.strictEqual(total, elements.length);
    for (const el of elements) {
      assert.strictEqual(counts.get(el), 1, el.localName);
    }
  });
});
