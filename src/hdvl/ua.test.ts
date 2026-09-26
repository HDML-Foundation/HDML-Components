/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert, fixture } from "@open-wc/testing";
import { html, unsafeStatic } from "lit/static-html.js";
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

/**
 * 017 R4's two halves of the `--hdml-line-width` cascade: the eight
 * hosts whose paint comes from `fillPaint` and whose initial the UA
 * sheet neutralises, and the four whose paint comes from
 * `strokePaint` and which must keep the registry's `1.5px`.
 *
 * **`hdml-pie` is in the first list and has no `fillPaint` call of
 * its own** — `layout-pie` hands its `Measured` to `mark-arc`'s
 * `sectorScene` (§6.3), so one call site serves two hosts. It was
 * missing from the first draft of this fix and NO corpus golden
 * could catch it, because every page with a pie declares the width.
 * This list is the only thing that does.
 *
 * Spelled out here rather than imported from `ua.ts` on purpose:
 * importing `OUTLINED` would make "the rule covers these hosts" a
 * tautology over the same array.
 */
const OUTLINED_TAGS = [
  "hdml-point",
  "hdml-bar",
  "hdml-arc",
  "hdml-area",
  "hdml-pie",
  "hdml-tick",
  "hdml-label",
  "hdml-legend",
];

const STROKED_TAGS = [
  "hdml-line",
  "hdml-rule",
  "hdml-axis",
  "hdml-grid",
];

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
 * A view carrying one zero-CSS positional guide on a channel, with
 * the UA plane gutter in force.
 *
 * The tag is a parameter because 017 R1 split the guides into two
 * rules: `hdml-axis` and `hdml-tick` take a zero cross-axis extent
 * the author cannot reach, `hdml-label` keeps the gutter and obeys
 * the author as before. The same helper has to be able to ask both
 * halves, or the split is asserted only from the side that changed.
 */
async function placed(
  channel: "x" | "y",
  tag: "hdml-axis" | "hdml-tick" | "hdml-label" = "hdml-axis",
): Promise<[HdmlViewElement, ReturnType<typeof rectOf>]> {
  const guide = unsafeStatic(tag);
  const view = await fixture<HdmlViewElement>(html`
    <hdml-view style="width: 400px; height: 200px">
      <hdml-cartesian-plane>
        ${channel === "x"
          ? html`<${guide} channel="x"></${guide}>`
          : html`<${guide} channel="y"></${guide}>`}
      </hdml-cartesian-plane>
    </hdml-view>
  `);
  await settle(view);
  const el = <Element>view.querySelector(tag);
  return [view, rectOf(view, el)];
}

/**
 * The `:host` rule declaring one channel's cross-axis extent for
 * {@link PLACED_LINE}, found by selector rather than by index.
 */
function crossRuleFor(channel: "x" | "y"): CSSStyleRule {
  const want = `hdml-axis[channel="${channel}"]`;
  const hit = Array.from(elementSheet.cssRules).find((rule) => {
    const styleRule = <CSSStyleRule>rule;
    return (
      styleRule.selectorText.includes(want) &&
      styleRule.style.getPropertyPriority(
        channel === "x" ? "height" : "width",
      ) === "important"
    );
  });
  assert.isDefined(hit, `no important extent rule for ${channel}`);
  return <CSSStyleRule>hit;
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
    // The THIRD longhand (017 R6). Without it a transition runs
    // only on an interpolable property, and fifteen of the
    // thirty-five registered ones are not.
    assert.strictEqual(
      declared.getPropertyValue("transition-behavior"),
      "allow-discrete",
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

  test("the engine supports allow-discrete", () => {
    // ASSERTED, never trusted. `ua.ts` declares the third longhand
    // unconditionally and writes no fallback, on the measured claim
    // that all three engines implement it; and `measure.ts` treats
    // an EMPTY computed `transition-behavior` as "the engine has
    // no such property" and falls back to the marker alone. If this
    // ever fails on one engine, that dead branch has quietly become
    // the live one there and W5 is no longer detecting anything.
    assert.isTrue(
      CSS.supports("transition-behavior", "allow-discrete"),
    );
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
      assert.strictEqual(
        getComputedStyle(el).getPropertyValue("transition-behavior"),
        "allow-discrete",
        el.localName,
      );
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
    //
    // 017 R1: the AXIS's height is now deliberately zero, which is
    // the same number for the opposite reason. `bottom: auto` is
    // still what makes it deliberate — without it the zero would be
    // the over-constraint above, and the label row next door would
    // be zero too.
    const [view, box] = await placed("x");
    const axis = <Element>view.querySelector("hdml-axis");
    assert.strictEqual(getComputedStyle(axis).position, "absolute");
    assert.strictEqual(getComputedStyle(axis).height, "0px");
    assert.strictEqual(getComputedStyle(axis).width, "352px");
    // …and the box that produces: the full plot width, on the
    // plot's bottom edge, with no thickness to place.
    assert.deepEqual(box, { x: 40, y: 176, w: 352, h: 0 });

    // The label keeps the gutter, and that is what says the zero
    // above is the axis rule's and not the over-constraint's.
    const [, run] = await placed("x", "hdml-label");
    assert.deepEqual(run, { x: 40, y: 176, w: 352, h: 24 });
  });

  test("★ a zero-CSS y guide lands left of the plot", async () => {
    // 017 R1, the y row. Before it, this box was
    // `{x: 0, y: 8, w: 40, h: 168}` — 40px of gutter width the
    // runtime never read and an author could over-constrain.
    const [view, box] = await placed("y");
    const axis = <Element>view.querySelector("hdml-axis");
    assert.strictEqual(getComputedStyle(axis).width, "0px");
    assert.strictEqual(getComputedStyle(axis).height, "168px");
    assert.deepEqual(box, { x: 40, y: 8, w: 0, h: 168 });

    const [, run] = await placed("y", "hdml-label");
    assert.deepEqual(run, { x: 0, y: 8, w: 40, h: 168 });
  });

  test("★ a tick takes the axis rule, not the label's", async () => {
    // R1 covers both lines, and `hdml-tick` is the one whose length
    // is a property (`--hdml-tick-height`) rather than a box — so
    // its box across the channel is the clearest case of a number
    // nothing reads.
    const [xView, xBox] = await placed("x", "hdml-tick");
    const [, yBox] = await placed("y", "hdml-tick");
    assert.deepEqual(xBox, { x: 40, y: 176, w: 352, h: 0 });
    assert.deepEqual(yBox, { x: 40, y: 8, w: 0, h: 168 });
    assert.isNotNull(xView.shadowRoot);
  });

  test("★ the extent is out of the outer tree's reach", async () => {
    // ★ R1's ENFORCEABILITY, which is a platform claim and is
    // therefore asserted rather than assumed: for IMPORTANT
    // declarations the INNER tree wins (CSS Cascade 4's
    // encapsulation-context criterion, which inverts for
    // `!important`). Our `:host` rule is the inner tree; the page is
    // the outer one. If this ever failed on an engine, R1's fix
    // shape would not hold there and a fallback would be a design
    // decision, not an implementation one.
    //
    // It is also the attribution guard step 02's Finding 2 asks
    // for: a zero box proves nothing about WHICH declaration made
    // it zero, and an author's `!important` losing is the only
    // reading under which ours is the one in force.
    adoptScratch(
      'hdml-axis[channel="x"] { height: 40px !important }\n' +
        'hdml-tick[channel="x"] { height: 40px !important }\n' +
        'hdml-axis[channel="y"] { width: 40px !important }\n' +
        'hdml-tick[channel="y"] { width: 40px !important }',
    );
    for (const tag of <const>["hdml-axis", "hdml-tick"]) {
      const [xView, xBox] = await placed("x", tag);
      const x = <Element>xView.querySelector(tag);
      assert.strictEqual(getComputedStyle(x).height, "0px", tag);
      assert.strictEqual(xBox.h, 0, tag);
      const [yView, yBox] = await placed("y", tag);
      const y = <Element>yView.querySelector(tag);
      assert.strictEqual(getComputedStyle(y).width, "0px", tag);
      assert.strictEqual(yBox.w, 0, tag);
    }
    // And the declaration that wins is the one written here, in a
    // rule of its own that does NOT name the label — R1's second
    // reason, which is about DevTools and is only checkable as the
    // shape of the sheet.
    for (const channel of <const>["x", "y"]) {
      const rule = crossRuleFor(channel);
      assert.include(rule.selectorText, "hdml-tick[channel=");
      assert.notInclude(rule.selectorText, "hdml-label");
    }
  });

  test("★ the two offset idioms converge at zero", async () => {
    // ★ R1's mechanism, asserted directly. With no cross extent,
    // `right: 100%` (ours) and `left: 0` (what every live page
    // writes) put the line in the SAME place, so the guide can no
    // longer be shifted by which offset the author reached for.
    // Before R1 the second idiom over-constrained the box, CSS
    // dropped `right`, and the axis landed a gutter's width INSIDE
    // the plot.
    const [, base] = await placed("y");
    adoptScratch('hdml-axis[channel="y"] { left: 0 }');
    const [, swapped] = await placed("y");
    assert.deepEqual(swapped, base);

    const [, xBase] = await placed("x");
    adoptScratch('hdml-axis[channel="x"] { bottom: 0 }');
    const [, xSwapped] = await placed("x");
    assert.deepEqual(xSwapped, xBase);
  });

  test("★ an author rule beats it, on the label", async () => {
    // §3.2's cascade fact, which is the whole reason SPEC §3's
    // defaults are `:host` rules: an outer-document rule matching
    // the element wins, wherever it was written.
    //
    // 017 R1 made the axis the EXCEPTION, so this test moved onto
    // `hdml-label` — which is also the cleanest proof that the split
    // is real rather than two selectors sharing one rule: the same
    // declarations, from the same sheet, one reachable and one not.
    adoptScratch(
      'hdml-label[channel="x"] { top: 0; height: 12px }\n' +
        'hdml-label[channel="y"] { right: auto; left: 0;' +
        " width: 9px }",
    );
    const [xView, xBox] = await placed("x", "hdml-label");
    assert.deepEqual(xBox, { x: 40, y: 8, w: 352, h: 12 });
    const [yView, yBox] = await placed("y", "hdml-label");
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
      assert.strictEqual(
        getComputedStyle(el).getPropertyValue("transition-behavior"),
        "allow-discrete",
        el.localName,
      );
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

  test("★ the outline default is zero on eight hosts", async () => {
    // 017 R4. `--hdml-line-width`'s REGISTERED initial is 1.5px —
    // `properties.test.ts` still asserts that on a bare div, which
    // is the positive control saying the registry was not touched.
    // Here every host that reaches `fillPaint` must read 0 instead,
    // or the fix puts an edge on every glyph in the corpus.
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-bar x="a" y="b"></hdml-bar>
          <hdml-area x="a" y="b"></hdml-area>
          <hdml-point x="a" y="b"></hdml-point>
          <hdml-arc x="a" y="b"></hdml-arc>
          <hdml-tick channel="y"></hdml-tick>
          <hdml-label channel="y"></hdml-label>
          <hdml-legend channel="color"></hdml-legend>
          <hdml-line x="a" y="b"></hdml-line>
          <hdml-rule y="1"></hdml-rule>
          <hdml-axis channel="y"></hdml-axis>
          <hdml-grid channel="y"></hdml-grid>
        </hdml-cartesian-plane>
        <hdml-polar-plane>
          <hdml-pie angle="a"></hdml-pie>
        </hdml-polar-plane>
      </hdml-view>
    `);
    await settle(view);
    const widthOf = (tag: string): string =>
      getComputedStyle(<Element>view.querySelector(tag))
        .getPropertyValue("--hdml-line-width")
        .trim();

    for (const tag of OUTLINED_TAGS) {
      assert.strictEqual(widthOf(tag), "0px", tag);
    }
    // ★ THE CONTROL, and without it "every host reads 0px" would be
    // satisfied by a rule with no host qualification at all. The
    // four STROKED hosts must still read the registry's initial —
    // they are the ones that have always drawn a line, and zeroing
    // them would blank every axis and grid in the corpus.
    for (const tag of STROKED_TAGS) {
      assert.strictEqual(widthOf(tag), "1.5px", tag);
    }
  });

  test("★ an author beats the outline default", async () => {
    // ★ R4's cascade claim, the MIRROR IMAGE of R1's
    // (`★ the extent is out of the outer tree's reach`) and
    // asserted for the opposite outcome: this declaration is
    // NORMAL, so the outer tree wins. Trap 12 is exactly this pair
    // — two rules apart in `ua.ts`, opposite in intent — and a `0`
    // that quietly became `0 !important` would take the author's
    // outline away with NO golden moving, because no corpus page
    // uses `!important`.
    //
    // Asserted per engine rather than read from a log (trap 7): the
    // shadow cascade's normal-declaration direction is a platform
    // behaviour, and if an engine reversed it R4 would not hold.
    adoptScratch(
      "hdml-point { --hdml-line-width: 1px }\n" +
        "hdml-label { --hdml-line-width: 3px }",
    );
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-point x="a" y="b"></hdml-point>
          <hdml-label channel="y"></hdml-label>
          <hdml-bar x="a" y="b"></hdml-bar>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    await settle(view);
    const widthOf = (tag: string): string =>
      getComputedStyle(<Element>view.querySelector(tag))
        .getPropertyValue("--hdml-line-width")
        .trim();
    assert.strictEqual(widthOf("hdml-point"), "1px");
    // The founder's option (a): the three fill-painted GUIDES are
    // neutralised on the same terms, so an author reaches a label's
    // outline too.
    assert.strictEqual(widthOf("hdml-label"), "3px");
    // Unmatched by the author sheet, so still the UA default.
    assert.strictEqual(widthOf("hdml-bar"), "0px");
  });

  test("★ the outline default is not important", () => {
    // The declaration-level half of the test above. The cascade
    // result already implies it, but only for the engines and the
    // selector this suite happens to exercise; this reads the
    // priority off the rule itself, so an `!important` added to
    // `ua.ts` fails here even if some future selector shadowed the
    // cascade proof.
    const rule = Array.from(elementSheet.cssRules).find((r) => {
      const styleRule = <CSSStyleRule>r;
      return (
        typeof styleRule.selectorText === "string" &&
        styleRule.selectorText.includes(":host(hdml-point)") &&
        styleRule.style.getPropertyValue("--hdml-line-width") !== ""
      );
    });
    assert.isDefined(rule);
    const style = (<CSSStyleRule>rule).style;
    assert.strictEqual(
      style.getPropertyPriority("--hdml-line-width"),
      "",
    );
    // …and it carries ONLY the width. `--hdml-line-color` and
    // `--hdml-line-style` are deliberately left inheriting, which
    // is what lets a plane theme an outline colour once.
    assert.strictEqual(
      style.getPropertyValue("--hdml-line-color"),
      "",
    );
    assert.strictEqual(
      style.getPropertyValue("--hdml-line-style"),
      "",
    );
    // Every one of the seven hosts is in this one rule, and none of
    // the four stroked ones is.
    const selector = (<CSSStyleRule>rule).selectorText;
    for (const tag of OUTLINED_TAGS) {
      assert.include(selector, `:host(${tag})`, tag);
    }
    for (const tag of STROKED_TAGS) {
      assert.notInclude(selector, `:host(${tag})`, tag);
    }
  });

  test("★ an ancestor cannot set a filled outline", async () => {
    // ★ The consequence R4's own entry got WRONG, asserted rather
    // than described. `--hdml-line-width` INHERITS (SPEC §9: "every
    // property inherits"), but inheritance only applies where the
    // element has no declaration of its own — and the UA default IS
    // one. So a plane-level width no longer reaches a filled mark,
    // while the same declaration on a SELECTOR THAT MATCHES it does.
    //
    // R4 claimed `08-pie-doughnut` needs nothing because "08 sets
    // the properties on `hdml-pie, hdml-arc` together and they
    // inherit". The outcome is right and the mechanism is not: the
    // arc is matched DIRECTLY by that grouped selector. Had the page
    // written `hdml-pie` alone, its slice separators would still be
    // missing after R4.
    adoptScratch(
      "hdml-cartesian-plane.themed { --hdml-line-width: 5px }\n" +
        "hdml-cartesian-plane.themed hdml-area" +
        " { --hdml-line-width: 5px }",
    );
    const view = await fixture<HdmlViewElement>(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane class="themed">
          <hdml-bar x="a" y="b"></hdml-bar>
          <hdml-area x="a" y="b"></hdml-area>
          <hdml-line x="a" y="b"></hdml-line>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    await settle(view);
    const widthOf = (tag: string): string =>
      getComputedStyle(<Element>view.querySelector(tag))
        .getPropertyValue("--hdml-line-width")
        .trim();
    // The plane itself takes the author's value…
    assert.strictEqual(widthOf("hdml-cartesian-plane"), "5px");
    // …a STROKED child inherits it, having no declaration of its
    // own, which is the positive control saying inheritance is live.
    assert.strictEqual(widthOf("hdml-line"), "5px");
    // …and a FILLED child does not, because its UA default is a
    // declaration.
    assert.strictEqual(widthOf("hdml-bar"), "0px");
    // The same page, matching the filled host directly: reached.
    assert.strictEqual(widthOf("hdml-area"), "5px");
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
