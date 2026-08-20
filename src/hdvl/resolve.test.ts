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
import { HdmlViewElement } from "./view";
import {
  byUid,
  elementsOf,
  resolutionIndex,
  resolutionOf,
} from "./resolve";

/**
 * §3.3's index: **one depth-first walk per structural change**,
 * carrying the chain down and the tip flag up, answering every
 * "who is my scale?" question once for the whole view.
 *
 * It is also R35's seam. `HdvlElement.view` is a read of this map
 * and of nothing else, which is what lets a *removed* element still
 * name the view it must invalidate — the one thing step 09 could
 * not do.
 */

async function settle(root: Element): Promise<void> {
  const all = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const el of all) {
    if (el instanceof LitElement) {
      await el.updateComplete;
    }
  }
}

function pick<T extends HdvlElement>(
  root: Element,
  selector: string,
  nth = 0,
): T {
  return <T>Array.from(root.querySelectorAll(selector))[nth];
}

let walks = 0;
let original: () => void;

suite("hdvl/resolve — the index", () => {
  setup(() => {
    original = HdmlViewElement.prototype.reindex;
    walks = 0;
    HdmlViewElement.prototype.reindex = function (
      this: HdmlViewElement,
    ): void {
      walks++;
      original.call(this);
    };
  });

  teardown(() => {
    HdmlViewElement.prototype.reindex = original;
  });

  test("one walk per structural change", async () => {
    // Not one per element, and not one per question. Sixteen
    // display elements with a four-deep chain: an attribute change
    // reindexes exactly once, and the walk that follows visits
    // every one of them.
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-ordinal-scale channel="x">
            <hdml-continuous-scale channel="y">
              <hdml-continuous-scale channel="color">
                <hdml-ordinal-scale channel="size">
                  <hdml-line x="a" y="b"></hdml-line>
                  <hdml-area x="a" y="b"></hdml-area>
                  <hdml-bar x="a" y="b"></hdml-bar>
                  <hdml-point x="a" y="b"></hdml-point>
                  <hdml-rule y="b"></hdml-rule>
                  <hdml-axis channel="x"></hdml-axis>
                  <hdml-tick channel="x"></hdml-tick>
                  <hdml-label channel="x"></hdml-label>
                  <hdml-grid channel="y"></hdml-grid>
                  <hdml-legend channel="color"></hdml-legend>
                </hdml-ordinal-scale>
              </hdml-continuous-scale>
            </hdml-continuous-scale>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    await settle(view);
    const scale = pick(view, "hdml-ordinal-scale");

    const before = walks;
    scale.setAttribute("channel", "x");
    assert.strictEqual(walks - before, 1);

    scale.setAttribute("reverse", "");
    assert.strictEqual(walks - before, 2);

    // An unobserved attribute reaches no funnel at all.
    scale.setAttribute("data-note", "z");
    assert.strictEqual(walks - before, 2);

    const list = elementsOf(view);
    assert.strictEqual(list.length, 16);
    assert.strictEqual(list[0], view);
    assert.strictEqual(new Set(list).size, list.length);
  });

  test("the chain stops at the plane boundary", async () => {
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane id="a">
          <hdml-ordinal-scale channel="x">
            <hdml-continuous-scale channel="y">
              <hdml-continuous-scale channel="y" id="inner">
                <hdml-line x="a" y="b"></hdml-line>
              </hdml-continuous-scale>
            </hdml-continuous-scale>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
        <hdml-cartesian-plane id="b">
          <hdml-bar x="a" y="b"></hdml-bar>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    await settle(view);
    const line = pick(view, "hdml-line");
    const bar = pick(view, "hdml-bar");
    const outer = pick(view, "hdml-continuous-scale");
    const inner = pick(view, "#inner");
    const ord = pick(view, "hdml-ordinal-scale");

    const forLine = resolutionOf(line);
    assert.isDefined(forLine);
    // Nearest ancestor wins per channel. (Two same-channel scales
    // in one chain is V1's error at step 12, not a precedence
    // question here.)
    assert.strictEqual(forLine?.chain.y, inner);
    assert.notStrictEqual(forLine?.chain.y, outer);
    assert.strictEqual(forLine?.chain.x, ord);
    assert.strictEqual(forLine?.plane?.id, "a");

    // Plane B sees none of plane A's scales.
    const forBar = resolutionOf(bar);
    assert.isUndefined(forBar?.chain.x);
    assert.isUndefined(forBar?.chain.y);
    assert.strictEqual(forBar?.plane?.id, "b");

    // A scale does not resolve itself.
    assert.isUndefined(resolutionOf(ord)?.chain.x);
    assert.strictEqual(resolutionOf(inner)?.chain.y, outer);
  });

  test("tip is a scale with no scale children", async () => {
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-ordinal-scale channel="x">
            <hdml-continuous-scale channel="y">
              <hdml-bar x="a" y="b"></hdml-bar>
            </hdml-continuous-scale>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    await settle(view);
    const ord = pick(view, "hdml-ordinal-scale");
    const cont = pick(view, "hdml-continuous-scale");
    const bar = pick(view, "hdml-bar");

    assert.isFalse(resolutionOf(ord)?.tip);
    assert.isTrue(resolutionOf(cont)?.tip);
    // Carried down: a widget at a tip reads the flag too (V13).
    assert.isTrue(resolutionOf(bar)?.tip);
    assert.isFalse(resolutionOf(view)?.tip);
  });

  test("source is nearest-ancestor-wins", async () => {
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view source="?a/b" style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-ordinal-scale channel="x" source="?c/d">
            <hdml-bar x="a" y="b"></hdml-bar>
          </hdml-ordinal-scale>
          <hdml-line x="a" y="b"></hdml-line>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    await settle(view);
    assert.strictEqual(
      resolutionOf(pick(view, "hdml-bar"))?.source,
      "?c/d",
    );
    assert.strictEqual(
      resolutionOf(pick(view, "hdml-line"))?.source,
      "?a/b",
    );
    assert.strictEqual(resolutionOf(view)?.source, "?a/b");

    const bare = await fixture<HdmlViewElement>(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane></hdml-cartesian-plane>
      </hdml-view>
    `);
    await settle(bare);
    assert.isNull(
      resolutionOf(pick(bare, "hdml-cartesian-plane"))?.source,
    );
  });

  test("a container child's unit is the container", async () => {
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-ordinal-scale channel="x">
            <hdml-stack x="m" y="v">
              <hdml-bar x="m" y="v"></hdml-bar>
            </hdml-stack>
            <hdml-line x="m" y="v"></hdml-line>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    await settle(view);
    const stack = pick(view, "hdml-stack");
    const bar = pick(view, "hdml-bar");
    const line = pick(view, "hdml-line");
    const scale = pick(view, "hdml-ordinal-scale");

    // §3.5: a stack missing a layer is a wrong chart, not a
    // degraded one, so the whole container blanks.
    assert.strictEqual(resolutionOf(bar)?.unit, stack);
    assert.strictEqual(resolutionOf(bar)?.container, stack);
    // A sibling at the tip is its own unit, and is untouched.
    assert.strictEqual(resolutionOf(line)?.unit, line);
    assert.isNull(resolutionOf(line)?.container);
    assert.strictEqual(resolutionOf(scale)?.unit, scale);
    assert.strictEqual(resolutionOf(view)?.unit, view);
  });

  test("the view getter reads the index", async () => {
    // R35's seam, proven by making the index lie: the getter has to
    // follow it, because it consults nothing else.
    const first = await fixture<HdmlViewElement>(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-bar x="a" y="b"></hdml-bar>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const second = await fixture<HdmlViewElement>(html`
      <hdml-view style="width: 400px; height: 200px"></hdml-view>
    `);
    await settle(first);
    await settle(second);
    const bar = pick(first, "hdml-bar");
    assert.strictEqual(bar.view, first);

    const entry = resolutionIndex().get(bar);
    assert.isDefined(entry);
    const restore = entry?.view;
    if (entry !== undefined) {
      entry.view = second;
    }
    assert.strictEqual(bar.view, second);
    if (entry !== undefined) {
      entry.view = restore;
    }
  });

  test("byUid round-trips every element", async () => {
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-continuous-scale channel="y">
            <hdml-bar x="a" y="b"></hdml-bar>
            <hdml-axis channel="y"></hdml-axis>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    await settle(view);
    const list = elementsOf(view);
    assert.isAbove(list.length, 4);
    for (const el of list) {
      assert.strictEqual(byUid(el.uid), el);
    }
    assert.isNull(byUid("no-such-uid"));
  });
});
