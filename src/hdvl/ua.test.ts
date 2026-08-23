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
import {
  SENTINEL_MARKER,
  SENTINEL_PROPERTIES,
  adoptDocumentSheet,
  documentSheet,
  elementSheet,
} from "./ua";
import { HDVL_PROPERTIES } from "./properties";

/** The five box properties the sentinel carries beyond §9's set. */
const BOX_PROPS = [
  "color",
  "inset",
  "margin",
  "padding",
  "width",
  "height",
];

/**
 * Two sheets, two scopes (R28), and one host-qualified sheet
 * shared by every shadow root (R33).
 *
 * Both invariants are proven **negatively**, which is the only way
 * they can be proven: a mark adopts the very same sheet as the view
 * and must compute none of the view's or the plane's defaults, and
 * a document rule must fail to reach a shadow-root `.plot`.
 */

/** A tag defined mid-test, to exercise the `:defined` half. */
const SCRATCH_VIEW = "hdvl-scratch-view";

let planted: Element[] = [];
let scratchSheets: CSSStyleSheet[] = [];

function plant<T extends Element>(el: T): T {
  document.body.appendChild(el);
  planted.push(el);
  return el;
}

function adoptScratch(css: string): CSSStyleSheet {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  document.adoptedStyleSheets = [
    ...document.adoptedStyleSheets,
    sheet,
  ];
  scratchSheets.push(sheet);
  return sheet;
}

function ratioOf(el: Element): string {
  return getComputedStyle(el).aspectRatio.replace(/\s+/g, "");
}

function containerOf(el: Element): string {
  return getComputedStyle(el)
    .getPropertyValue("container-type")
    .trim();
}

async function settle(root: Element): Promise<void> {
  const all = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const el of all) {
    if (el instanceof LitElement) {
      await el.updateComplete;
    }
  }
}

/** A box in the view's own coordinates (§2.7), rounded to px. */
function rectOf(
  view: Element,
  el: Element,
): { x: number; y: number; w: number; h: number } {
  const origin = view.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return {
    x: Math.round(r.left - origin.left),
    y: Math.round(r.top - origin.top),
    w: Math.round(r.width),
    h: Math.round(r.height),
  };
}

/**
 * A view carrying one zero-CSS `hdml-axis` on a channel, with the
 * UA plane gutter in force.
 */
async function placed(
  channel: "x" | "y",
): Promise<[HdmlViewElement, ReturnType<typeof rectOf>]> {
  const view = await fixture<HdmlViewElement>(html`
    <hdml-view style="width: 400px; height: 200px">
      <hdml-cartesian-plane>
        ${channel === "x"
          ? html`<hdml-axis channel="x"></hdml-axis>`
          : html`<hdml-axis channel="y"></hdml-axis>`}
      </hdml-cartesian-plane>
    </hdml-view>
  `);
  await settle(view);
  const axis = <Element>view.querySelector("hdml-axis");
  return [view, rectOf(view, axis)];
}

suite("hdvl/ua — the element sheet", () => {
  teardown(() => {
    planted.forEach((el) => el.remove());
    planted = [];
    const drop = new Set<CSSStyleSheet>(scratchSheets);
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
      (s) => !drop.has(s),
    );
    scratchSheets = [];
  });

  test("one sheet instance serves every host", async () => {
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-bar x="a" y="b"></hdml-bar>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    await settle(view);
    const bar = <HdvlElement>view.querySelector("hdml-bar");
    const plane = <HdvlElement>(
      view.querySelector("hdml-cartesian-plane")
    );
    const sheetOf = (el: HdvlElement): CSSStyleSheet =>
      (<ShadowRoot>el.shadowRoot).adoptedStyleSheets[0];

    assert.strictEqual(sheetOf(bar), elementSheet);
    assert.strictEqual(sheetOf(plane), elementSheet);
    assert.strictEqual(
      (<ShadowRoot>view.shadowRoot).adoptedStyleSheets[0],
      elementSheet,
    );
    assert.strictEqual(sheetOf(bar), sheetOf(plane));
  });

  test("every rule is host-qualified but two", () => {
    // R33: one sheet reaches every host, so an unqualified rule
    // would put the view's aspect-ratio on marks and the plane's
    // padding on guides. `.plot` and the generic `:host` box rule
    // are the deliberate exceptions.
    const selectors: string[] = [];
    for (const rule of Array.from(elementSheet.cssRules)) {
      selectors.push((<CSSStyleRule>rule).selectorText);
    }
    assert.isAbove(selectors.length, 0);
    for (const sel of selectors) {
      const generic =
        sel === ".plot" || sel === ":host" || sel === ":host()";
      assert.isTrue(
        generic || sel.includes(":host("),
        `unqualified rule: ${sel}`,
      );
    }
  });

  test("the sentinel is longhands, never shorthand", () => {
    // R24: RFC §3.2 writes the frame sentinel as the `transition`
    // SHORTHAND, which a later rule of ours would replace wholesale
    // and silently kill. Step 09 asserted the sheet carried no
    // transition at all, because the sentinel had not landed; this
    // is the positive form of the same rule.
    let host: CSSStyleRule | null = null;
    for (const rule of Array.from(elementSheet.cssRules)) {
      const styleRule = <CSSStyleRule>rule;
      assert.notMatch(
        styleRule.cssText.toLowerCase(),
        /transition\s*:/,
        styleRule.cssText,
      );
      if (styleRule.selectorText === ":host") {
        host = styleRule;
      }
    }
    assert.isNotNull(host);
    const declared = host.style;
    assert.strictEqual(
      declared.getPropertyValue("transition-duration"),
      "1ms",
    );
    const listed = declared
      .getPropertyValue("transition-property")
      .split(",")
      .map((s) => s.trim());
    // Built from HDVL_PROPERTIES, never by hand: a thirty-sixth
    // registered property must not be able to go unobserved.
    for (const def of HDVL_PROPERTIES) {
      assert.include(listed, def.name);
    }
    for (const box of BOX_PROPS) {
      assert.include(listed, box);
    }
    assert.strictEqual(listed.length, SENTINEL_PROPERTIES.length);
  });

  test("the sentinel reaches every host", async () => {
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-bar x="a" y="b"></hdml-bar>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    await settle(view);
    const bar = <Element>view.querySelector("hdml-bar");
    for (const el of [view, bar]) {
      const listed = getComputedStyle(el)
        .transitionProperty.split(",")
        .map((s) => s.trim());
      assert.include(listed, SENTINEL_MARKER);
      assert.include(listed, "width");
    }
  });

  test("a mark computes none of the view defaults", async () => {
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-line x="a" y="b"></hdml-line>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    await settle(view);
    const line = <Element>view.querySelector("hdml-line");
    const plane = <Element>view.querySelector("hdml-cartesian-plane");
    const lineStyle = getComputedStyle(line);
    const planeStyle = getComputedStyle(plane);

    // What the mark rule DOES give it.
    assert.strictEqual(lineStyle.overflowX, "hidden");
    assert.strictEqual(lineStyle.overflowY, "hidden");
    // And what it must not inherit from a sibling's rule.
    assert.strictEqual(ratioOf(line), "auto");
    assert.strictEqual(containerOf(line), "normal");
    assert.strictEqual(lineStyle.paddingLeft, "0px");
    assert.strictEqual(lineStyle.paddingBottom, "0px");

    // The plane's own defaults, for contrast.
    assert.strictEqual(containerOf(plane), "size");
    assert.strictEqual(planeStyle.paddingLeft, "40px");
    assert.strictEqual(planeStyle.paddingBottom, "24px");
    assert.strictEqual(ratioOf(plane), "auto");

    // And the view's.
    assert.strictEqual(getComputedStyle(view).position, "relative");
    assert.strictEqual(getComputedStyle(view).display, "block");
  });

  test("the view's ratio reaches no other host", async () => {
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view>
        <hdml-cartesian-plane>
          <hdml-axis channel="y"></hdml-axis>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    await settle(view);
    const axis = <Element>view.querySelector("hdml-axis");
    assert.strictEqual(ratioOf(view), "2/1");
    assert.strictEqual(ratioOf(axis), "auto");
    assert.strictEqual(getComputedStyle(axis).paddingLeft, "0px");
  });

  test("★ a zero-CSS x guide lands in the gutter", async () => {
    // SPEC §3: "x-channel guides just below the plot (the
    // `top: 100%` idiom)". The trap the rule exists to dodge is the
    // generic `:host { inset: 0 }`: `top: 100%` alone leaves
    // `bottom: 0` in force, which over-constrains the box to a used
    // height of ZERO — it renders, silently, measuring nothing.
    const [view, box] = await placed("x");
    const axis = <Element>view.querySelector("hdml-axis");
    assert.strictEqual(getComputedStyle(axis).position, "absolute");
    assert.strictEqual(getComputedStyle(axis).height, "24px");
    assert.strictEqual(getComputedStyle(axis).width, "352px");
    // …and the box that produces: the full plot width, in the
    // plane's 24px bottom gutter, immediately below the plot.
    assert.isAbove(box.h, 0);
    assert.deepEqual(box, { x: 40, y: 176, w: 352, h: 24 });
  });

  test("★ a zero-CSS y guide lands left of the plot", async () => {
    const [view, box] = await placed("y");
    const axis = <Element>view.querySelector("hdml-axis");
    assert.strictEqual(getComputedStyle(axis).width, "40px");
    assert.strictEqual(getComputedStyle(axis).height, "168px");
    assert.isAbove(box.w, 0);
    assert.deepEqual(box, { x: 0, y: 8, w: 40, h: 168 });
  });

  test("★ an author rule beats it, on both rows", async () => {
    // §3.2's cascade fact, which is the whole reason SPEC §3's
    // defaults are `:host` rules: an outer-document rule matching
    // the element wins, wherever it was written.
    adoptScratch(
      'hdml-axis[channel="x"] { top: 0; height: 12px }\n' +
        'hdml-axis[channel="y"] { right: auto; left: 0; width: 9px }',
    );
    const [xView, xBox] = await placed("x");
    assert.deepEqual(xBox, { x: 40, y: 8, w: 352, h: 12 });
    const [yView, yBox] = await placed("y");
    assert.deepEqual(yBox, { x: 40, y: 8, w: 9, h: 168 });
    assert.isNotNull(xView.shadowRoot);
    assert.isNotNull(yView.shadowRoot);
  });

  test("★ the placement rules keep the sentinel", async () => {
    // R24, mechanically. A `transition` shorthand in either new
    // rule would replace the generic `:host` declaration WHOLESALE
    // and silently force the fallback observer on for the view.
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-axis channel="x"></hdml-axis>
          <hdml-axis channel="y"></hdml-axis>
          <hdml-grid channel="x"></hdml-grid>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    await settle(view);
    for (const el of Array.from(view.querySelectorAll("*"))) {
      const listed = getComputedStyle(el)
        .transitionProperty.split(",")
        .map((s) => s.trim());
      assert.include(listed, SENTINEL_MARKER, el.localName);
      assert.include(listed, "inset", el.localName);
    }
    assert.isFalse(view.observingFallback);
  });

  test("★ no other host picks up a guide's box", async () => {
    // R33: one sheet reaches every host, so a rule that was not
    // host-qualified would put the gutter on marks and on the view.
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-bar x="a" y="b" channel="x"></hdml-bar>
          <hdml-grid channel="x"></hdml-grid>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    await settle(view);
    const bar = <Element>view.querySelector("hdml-bar");
    const grid = <Element>view.querySelector("hdml-grid");
    // The bar even carries a `channel="x"` attribute — the selector
    // is host-qualified by TAG as well, so it still does not match.
    assert.strictEqual(getComputedStyle(bar).height, "168px");
    assert.strictEqual(rectOf(view, bar).y, 8);
    // SPEC §3's grid row is `inset: 0`, which the generic `:host`
    // rule already is — no rule of its own, and none needed.
    assert.deepEqual(rectOf(view, grid), {
      x: 40,
      y: 8,
      w: 352,
      h: 168,
    });
    // And the view keeps its own row.
    assert.strictEqual(getComputedStyle(view).position, "relative");
  });

  test("a document rule cannot reach a shadow plot", async () => {
    // R28, measured: `document.adoptedStyleSheets` does not cross a
    // shadow boundary, which is exactly why the two `hdml-fallback`
    // rules — and only they — live in the document sheet.
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane></hdml-cartesian-plane>
      </hdml-view>
    `);
    await settle(view);
    adoptScratch(".plot { width: 33px }");
    const plane = <HdvlElement>(
      view.querySelector("hdml-cartesian-plane")
    );
    const plot = <Element>(
      (<ShadowRoot>plane.shadowRoot).querySelector(".plot")
    );
    assert.notStrictEqual(getComputedStyle(plot).width, "33px");
    assert.strictEqual(plot.getBoundingClientRect().width, 352);
  });
});

suite("hdvl/ua — the document sheet", () => {
  teardown(() => {
    planted.forEach((el) => el.remove());
    planted = [];
    const drop = new Set<CSSStyleSheet>(scratchSheets);
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
      (s) => !drop.has(s),
    );
    scratchSheets = [];
  });

  test("it is adopted, exactly once", () => {
    const count = document.adoptedStyleSheets.filter(
      (s) => s === documentSheet,
    ).length;
    assert.strictEqual(count, 1);
    adoptDocumentSheet();
    adoptDocumentSheet();
    assert.strictEqual(
      document.adoptedStyleSheets.filter((s) => s === documentSheet)
        .length,
      1,
    );
  });

  test("it carries the two fallback rules only", () => {
    const rules = Array.from(documentSheet.cssRules).map((r) =>
      (<CSSStyleRule>r).selectorText.replace(/\s+/g, " ").trim(),
    );
    assert.lengthOf(rules, 2);
    assert.include(rules[0], "hdml-view:not(:defined)");
    assert.include(rules[0], "hdml-fallback");
    assert.include(rules[1], "hdml-view:defined");
    assert.include(rules[1], "hdml-fallback");
  });

  test("an upgraded view hides its fallback", async () => {
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-fallback>no chart here</hdml-fallback>
      </hdml-view>
    `);
    await settle(view);
    const fb = <Element>view.querySelector("hdml-fallback");
    assert.strictEqual(getComputedStyle(fb).display, "none");
  });

  test("the not-defined half flips on upgrade", () => {
    // By the time this suite runs `hdml-view` IS defined, so the
    // pre-upgrade half of the pair can never match. Assert the
    // rule's mechanism instead, on a tag defined mid-test.
    adoptScratch(
      `${SCRATCH_VIEW}:not(:defined) > hdml-fallback ` +
        "{ display: block }\n" +
        `${SCRATCH_VIEW}:defined > hdml-fallback ` +
        "{ display: none }",
    );
    const host = plant(document.createElement(SCRATCH_VIEW));
    const fb = document.createElement("hdml-fallback");
    fb.textContent = "no chart here";
    host.appendChild(fb);

    assert.strictEqual(getComputedStyle(fb).display, "block");
    customElements.define(SCRATCH_VIEW, class extends HTMLElement {});
    assert.strictEqual(getComputedStyle(fb).display, "none");
  });

  test("hdml-fallback is not an HdvlElement", () => {
    // H3: the element sheet opens with a generic
    // `:host { position: absolute; inset: 0 }`. Adopting it would
    // absolutely position the author's flow content in precisely
    // the window the element exists for.
    const fb = plant(document.createElement("hdml-fallback"));
    assert.isNull(fb.shadowRoot);
    assert.isFalse(fb instanceof HdvlElement);
    assert.isFalse(fb instanceof LitElement);
    assert.notStrictEqual(getComputedStyle(fb).position, "absolute");
  });
});
