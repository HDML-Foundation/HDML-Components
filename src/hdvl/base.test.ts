/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert, fixture } from "@open-wc/testing";
import { html } from "lit/static-html.js";
import { LitElement } from "lit";
import "./index";
import { HdvlElement } from "./base";
import { HdmlViewElement } from "./view";
import { HDVL_TAG_NAMES } from "./vocabulary";

/**
 * Contract 1, and **the one measured claim the whole architecture
 * rests on**: a slotted, absolutely positioned child of a
 * `visibility: collapse`d slot still reports a non-zero rect, at
 * every depth, on all three engines (R1).
 *
 * If that were false, §1.2's promise — every display element owns a
 * true CSS box — would be false, R1's single `<svg>` per view would
 * be unbuildable, and nothing downstream would be worth writing. It
 * is proven here, before a renderer exists, because that is the
 * correct risk ordering; a red assertion in this file is a
 * stop-and-ask, never a fix-forward.
 */

/** Every tag whose element is an `HdvlElement`. */
const HDVL_TAGS = Object.values(HDVL_TAG_NAMES).filter(
  (tag) => tag !== HDVL_TAG_NAMES.FALLBACK,
);

/** An attribute each tag actually observes, for change tests. */
function anyAttrOf(tag: string): string {
  const ctor = <undefined | { observedAttributes?: string[] }>(
    (<unknown>customElements.get(tag))
  );
  const attrs = ctor?.observedAttributes ?? [];
  return attrs[0];
}

async function settle(root: Element): Promise<void> {
  const all = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const el of all) {
    if (el instanceof LitElement) {
      await el.updateComplete;
    }
  }
}

let planted: Element[] = [];

function plant<T extends Element>(el: T): T {
  document.body.appendChild(el);
  planted.push(el);
  return el;
}

suite("hdvl/base — the box", () => {
  teardown(() => {
    planted.forEach((el) => el.remove());
    planted = [];
  });

  test("a collapsed slot preserves slotted boxes", async () => {
    // 400 x 200 with the cartesian gutter 8/8/24/40 makes every
    // expected number an integer: the plane is 400 x 200 and the
    // scale 352 x 168. Rational arithmetic, so exact equality.
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-continuous-scale channel="y"></hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    await settle(view);

    const plane = <HTMLElement>(
      view.querySelector("hdml-cartesian-plane")
    );
    const scale = <HTMLElement>(
      view.querySelector("hdml-continuous-scale")
    );
    const root = <ShadowRoot>view.shadowRoot;
    const slot = <HTMLSlotElement>root.querySelector("slot");

    // (a) the slot really is collapsed.
    assert.strictEqual(getComputedStyle(slot).visibility, "collapse");

    const vr = view.getBoundingClientRect();
    const pr = plane.getBoundingClientRect();
    const sr = scale.getBoundingClientRect();

    // (b) + (c) non-zero, one and two levels below the slot.
    assert.strictEqual(pr.width, 400);
    assert.strictEqual(pr.height, 200);
    assert.strictEqual(sr.width, 352);
    assert.strictEqual(sr.height, 168);

    // (d) the plane IS the view's content box (`inset: 0`).
    assert.strictEqual(vr.width, 400);
    assert.strictEqual(vr.height, 200);
    assert.strictEqual(pr.left - vr.left, 0);
    assert.strictEqual(pr.top - vr.top, 0);

    // (e) R15: the scale resolves against the plane's CONTENT box,
    // not its padding box. Without the `.plot` wrapper this is 40px
    // wrong and SPEC §3's guide containing-block rule is wrong with
    // it.
    assert.strictEqual(sr.left - pr.left, 40);
    assert.strictEqual(sr.top - pr.top, 8);

    // (f) the positioning that makes document order paint order.
    assert.strictEqual(getComputedStyle(view).position, "relative");
    assert.strictEqual(getComputedStyle(plane).position, "absolute");
    assert.strictEqual(getComputedStyle(scale).position, "absolute");

    // (g) nothing in the fixture is a 0x0 box.
    const all = [view, ...Array.from(view.querySelectorAll("*"))];
    for (const el of all) {
      const r = el.getBoundingClientRect();
      assert.isAbove(r.width, 0, el.localName);
      assert.isAbove(r.height, 0, el.localName);
    }
  });

  test("each level re-expands to its parent's box", async () => {
    // §4.3: "each scale's padding insets only its own range; its
    // children re-expand to its content box through the `.plot`
    // wrapper". Four levels deep, with a padding the sheet does not
    // supply, so the inset can only come from the wrapper.
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-continuous-scale channel="y" style="padding: 10px">
            <hdml-ordinal-scale channel="x"></hdml-ordinal-scale>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    await settle(view);

    const outer = <HTMLElement>(
      view.querySelector("hdml-continuous-scale")
    );
    const inner = <HTMLElement>(
      view.querySelector("hdml-ordinal-scale")
    );
    const or = outer.getBoundingClientRect();
    const ir = inner.getBoundingClientRect();

    assert.strictEqual(or.width, 352);
    assert.strictEqual(or.height, 168);
    assert.strictEqual(ir.width, 332);
    assert.strictEqual(ir.height, 148);
    assert.strictEqual(ir.left - or.left, 10);
    assert.strictEqual(ir.top - or.top, 10);
  });
});

suite("hdvl/base — Contract 1", () => {
  teardown(() => {
    planted.forEach((el) => el.remove());
    planted = [];
  });

  test("uid is unique per instance", () => {
    const seen = new Set<string>();
    for (const tag of HDVL_TAGS) {
      const el = <HdvlElement>document.createElement(tag);
      assert.isString(el.uid);
      assert.isAbove(el.uid.length, 0);
      seen.add(el.uid);
    }
    assert.lengthOf(seen, HDVL_TAGS.length);
  });

  test("uid survives disconnect and reconnect", () => {
    const el = <HdvlElement>document.createElement("hdml-line");
    const before = el.uid;
    plant(el);
    const connected = el.uid;
    el.remove();
    const removed = el.uid;
    plant(el);
    assert.strictEqual(connected, before);
    assert.strictEqual(removed, before);
    assert.strictEqual(el.uid, before);
  });

  test("no display element fires hdom-changed", async () => {
    // §3.7: `hdom-changed` announces a change to the HDML
    // *document*, and `<hdml-io>` answers by re-POSTing all of it. A
    // `hdml-bar` whose `y` moved must never trigger that.
    let count = 0;
    const onChange = (): void => {
      count++;
    };
    document.addEventListener("hdom-changed", onChange);
    try {
      for (const tag of Object.values(HDVL_TAG_NAMES)) {
        const el = document.createElement(tag);
        document.body.appendChild(el);
        const attr = anyAttrOf(tag);
        if (attr !== undefined) {
          el.setAttribute(attr, "x");
        }
        if (el instanceof LitElement) {
          await el.updateComplete;
        }
        el.remove();
      }
    } finally {
      document.removeEventListener("hdom-changed", onChange);
    }
    assert.strictEqual(count, 0);
  });

  test("loading lands on the view and its planes", async () => {
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-line x="a" y="b"></hdml-line>
        </hdml-cartesian-plane>
        <hdml-polar-plane></hdml-polar-plane>
      </hdml-view>
    `);
    await settle(view);
    const cart = <Element>view.querySelector("hdml-cartesian-plane");
    const polar = <Element>view.querySelector("hdml-polar-plane");
    const line = <Element>view.querySelector("hdml-line");

    assert.isTrue(view.matches(":state(loading)"));
    assert.isTrue(cart.matches(":state(loading)"));
    assert.isTrue(polar.matches(":state(loading)"));
    // §3.4's table gives `loading` to the view and planes only.
    assert.isFalse(line.matches(":state(loading)"));
    // `empty` and `error` are step 11's and step 12's.
    assert.isFalse(view.matches(":state(empty)"));
    assert.isFalse(view.matches(":state(error)"));
  });

  test("view resolves three deep, null when loose", async () => {
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-continuous-scale channel="y">
            <hdml-line x="a" y="b"></hdml-line>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    await settle(view);
    const line = <HdvlElement>view.querySelector("hdml-line");
    const scale = <HdvlElement>(
      view.querySelector("hdml-continuous-scale")
    );

    assert.strictEqual(line.view, view);
    assert.strictEqual(scale.view, view);
    // A view owns itself, so `view.invalidate()` needs no special
    // case anywhere.
    assert.strictEqual(view.view, view);

    const loose = <HdvlElement>document.createElement("hdml-bar");
    assert.isNull(loose.view);
  });

  test("one attribute change, one invalidation", async () => {
    // R35: an observed change is never classified into structural
    // vs presentational. One funnel, one call site — which is what
    // makes step 11's rewire to `reindex()` a one-line edit.
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-continuous-scale channel="y"></hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    await settle(view);
    const scale = <HdvlElement>(
      view.querySelector("hdml-continuous-scale")
    );

    const before = view.dirtyCount;
    scale.setAttribute("channel", "x");
    assert.strictEqual(view.dirtyCount, before + 1);

    scale.setAttribute("min", "0");
    assert.strictEqual(view.dirtyCount, before + 2);

    // An unobserved attribute reaches no funnel at all.
    scale.setAttribute("data-note", "z");
    assert.strictEqual(view.dirtyCount, before + 2);
    assert.isTrue(view.dirty);
  });

  test("connecting invalidates the owning view", async () => {
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view style="width: 400px; height: 200px"></hdml-view>
    `);
    await settle(view);
    const before = view.dirtyCount;
    view.appendChild(document.createElement("hdml-cartesian-plane"));
    assert.strictEqual(view.dirtyCount, before + 1);
  });

  test("the view's surface is a real SVG root", async () => {
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view style="width: 400px; height: 200px"></hdml-view>
    `);
    await settle(view);
    const root = <ShadowRoot>view.shadowRoot;
    const svg = <SVGSVGElement>root.querySelector("svg");
    // `document.createElement("svg")` yields an HTMLUnknownElement
    // that lays out identically and accepts no SVG child — a
    // failure invisible until the renderer arrives.
    assert.strictEqual(
      svg.namespaceURI,
      "http://www.w3.org/2000/svg",
    );
    assert.instanceOf(svg, SVGSVGElement);
    const r = svg.getBoundingClientRect();
    assert.strictEqual(r.width, 400);
    assert.strictEqual(r.height, 200);
  });

  test("the view carries role=img", async () => {
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view style="width: 400px; height: 200px"></hdml-view>
    `);
    await settle(view);
    assert.strictEqual(view.getAttribute("role"), "img");
  });

  test("an author role is not overwritten", async () => {
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view
        role="figure"
        style="width: 400px; height: 200px"
      ></hdml-view>
    `);
    await settle(view);
    assert.strictEqual(view.getAttribute("role"), "figure");
  });
});
