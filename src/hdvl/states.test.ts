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
import type { Scene, SceneGroup, SceneNode } from "./scene";
import type { Renderer } from "./renderer";
import { HdmlViewElement } from "./view";
import { createSvgRenderer } from "./renderer-svg";
import type { StateInput } from "./states";
import {
  HDVL_STATES,
  STATE_PROPERTIES,
  stateRules,
  suppressedOf,
} from "./states";
import { HDVL_PROPERTIES } from "./properties";

/**
 * 017 R7's generator — the **output** half of SPEC §9's state
 * variants.
 *
 * Two kinds of evidence live here, and the split is the point.
 *
 * **The rule TEXT** is asserted against a pure function with no
 * DOM, no pointer and no renderer in the picture: `stateRules` is
 * `(snapshot) → CSS`, so every claim about *which* declarations a
 * state carries is a string comparison. That is the cheap half, and
 * it is the half that can guard the `stroke-dasharray` derivation —
 * a wrongly-derived dash is invisible to every scene golden, because
 * the scene never sees a generated rule.
 *
 * **The CASCADE** is asserted against a real `<svg>`: *a CSS rule in
 * an adopted constructed sheet beats an SVG presentation attribute*.
 * The whole mechanism is void without it, and until this file it was
 * a scratchpad probe (step 09 Finding 5) rather than a regression
 * guard. It needs **no pointer**: a non-pseudo selector proves the
 * cascade and the per-group scoping, and only `:hover`/`:active`
 * themselves need real pointer input — step 09-3.
 */

const P = "--hdml-";

/** A snapshot with the base values MEASURE would have harvested. */
function input(
  props: Record<string, string>,
  over: Partial<StateInput> = {},
): StateInput {
  return {
    uid: "u1",
    suppress: new Set<string>(),
    props: new Map<string, string>([
      // The registered initials, as a real harvest carries them.
      [`${P}line-width`, "1.5px"],
      [`${P}line-color`, "rgb(0, 0, 0)"],
      [`${P}line-style`, "solid"],
      [`${P}fill-color`, "rgb(0, 0, 0)"],
      ...Object.entries(props).map(([k, v]): [string, string] => [
        k,
        v,
      ]),
    ]),
    ...over,
  };
}

/** The declarations of the one rule a snapshot produced. */
function only(text: string): string {
  const lines = text.split("\n").filter((l) => l !== "");
  assert.lengthOf(lines, 1, "expected exactly one rule");
  return lines[0];
}

suite("hdvl/states — the generated rule text", () => {
  test("no variant set generates nothing at all", () => {
    // ★ Trap 11: every variant computes to the empty sentinel
    // unless the author wrote one, so the common case is `""` —
    // not sixteen empty declarations, and not an empty rule.
    assert.strictEqual(stateRules([input({})]), "");
    assert.strictEqual(stateRules([]), "");
  });

  test("a fill variant becomes one :hover rule", () => {
    const text = stateRules([
      input({ [`${P}fill-color--hover`]: "lime" }),
    ]);
    assert.strictEqual(
      text,
      'g[data-w="u1"] > *:hover { fill: lime }',
    );
  });

  test("no BASE rule is emitted, ever", () => {
    // The load-bearing decision: the renderer already writes the
    // base paint as a presentation attribute, and that value is
    // §6.1's RESOLVED one — channel first. A base rule would
    // invert §6.1 and flatten a per-row group.
    const text = stateRules([
      input({
        [`${P}fill-color`]: "red",
        [`${P}fill-color--hover`]: "lime",
      }),
    ]);
    assert.notInclude(text, "red");
    assert.lengthOf(text.split("\n"), 1);
  });

  test("hover and active are separate rules", () => {
    const text = stateRules([
      input({
        [`${P}fill-color--hover`]: "lime",
        [`${P}fill-color--active`]: "navy",
      }),
    ]);
    assert.strictEqual(
      text,
      'g[data-w="u1"] > *:hover { fill: lime }\n' +
        'g[data-w="u1"] > *:active { fill: navy }',
    );
  });

  test("a hover-only widget emits no :active rule", () => {
    // A widget that declares one state gets one rule — the state
    // list is read per widget, not assumed.
    //
    // ★ This assertion CANNOT witness the state list itself, and its
    // earlier comment claimed it could. Measured at step 09-5: with
    // `active` dropped from `HDVL_STATES` the suite fails seven
    // tests and this is not one of them, because `notInclude(text,
    // ":active")` is trivially true once nothing can emit `:active`.
    // A negative assertion is witnessed by the two that name both
    // states — *hover and active are separate rules* and
    // *HDVL_STATES is hover then active* — never by itself.
    const text = stateRules([
      input({ [`${P}fill-color--hover`]: "lime" }),
    ]);
    assert.notInclude(text, ":active");
  });

  test("HDVL_STATES is hover then active, and only those", () => {
    assert.deepStrictEqual(Array.from(HDVL_STATES), [
      "hover",
      "active",
    ]);
  });

  test("the eight-property boundary is enforced both ways", () => {
    // ★ R7's boundary was otherwise structural-but-SILENT. A ninth
    // entry in the generator's map would look for a variant nobody
    // registered, `props.get` would return `undefined`, and nothing
    // at all would be emitted — the property would simply never
    // work, which is the defect R7 exists to close. This is the only
    // thing that fails instead.
    const registered = new Set(
      HDVL_PROPERTIES.map((def) => def.name),
    );
    assert.lengthOf(STATE_PROPERTIES, 8);
    for (const base of STATE_PROPERTIES) {
      for (const state of HDVL_STATES) {
        assert.isTrue(
          registered.has(`${base}--${state}`),
          `${base}--${state} is not registered`,
        );
      }
    }
    // …and no registered variant is left without a generator entry.
    const varied = new Set(STATE_PROPERTIES);
    for (const def of HDVL_PROPERTIES) {
      for (const state of HDVL_STATES) {
        const tail = `--${state}`;
        if (!def.name.endsWith(tail)) {
          continue;
        }
        assert.isTrue(
          varied.has(def.name.slice(0, -tail.length)),
          `${def.name} is registered but never generated`,
        );
      }
    }
  });

  test("all seven direct variants map to attributes", () => {
    const text = stateRules([
      input({
        [`${P}fill-color--hover`]: "lime",
        [`${P}line-color--hover`]: "navy",
        [`${P}line-width--hover`]: "3px",
        [`${P}font-family--hover`]: "serif",
        [`${P}font-size--hover`]: "13px",
        [`${P}font-weight--hover`]: "bold",
        [`${P}font-style--hover`]: "italic",
      }),
    ]);
    assert.strictEqual(
      only(text),
      'g[data-w="u1"] > *:hover { fill: lime; stroke: navy; ' +
        "stroke-width: 3px; font-family: serif; " +
        "font-size: 13px; font-weight: bold; " +
        "font-style: italic; stroke-dasharray: none }",
    );
  });

  test("two widgets produce two scoped rules", () => {
    const text = stateRules([
      input({ [`${P}fill-color--hover`]: "lime" }),
      input({ [`${P}fill-color--hover`]: "navy" }, { uid: "u2" }),
    ]);
    assert.strictEqual(
      text,
      'g[data-w="u1"] > *:hover { fill: lime }\n' +
        'g[data-w="u2"] > *:hover { fill: navy }',
    );
  });

  test("a value that could escape the block is dropped", () => {
    // The ONE place an author string reaches a STYLESHEET. CSS
    // already forbids an unbalanced `}` in a custom-property
    // value, so this is defence in depth — and the failure mode is
    // one dropped declaration, never a broken sheet.
    for (const bad of ["red } g { fill: navy", "a; b", "@import x"]) {
      assert.strictEqual(
        stateRules([input({ [`${P}fill-color--hover`]: bad })]),
        "",
        bad,
      );
    }
  });
});

suite("hdvl/states — what a host may not state-vary", () => {
  test("a channel-owned fill is out, its outline is in", () => {
    // SPEC §9: channel-bound paint wins over `--hdml-fill-color`
    // AND its state variants alike. `09-polar-area` is authored on
    // exactly this — a hover cue on channel-coloured wedges uses
    // what the channel does not own.
    const text = stateRules([
      input(
        {
          [`${P}fill-color--hover`]: "lime",
          [`${P}line-width--hover`]: "2.5px",
        },
        { suppress: new Set(["fill"]) },
      ),
    ]);
    assert.strictEqual(
      only(text),
      'g[data-w="u1"] > *:hover { stroke-width: 2.5px; ' +
        "stroke-dasharray: none }",
    );
  });

  test("a channel-owned stroke is out, the width is in", () => {
    const text = stateRules([
      input(
        {
          [`${P}line-color--hover`]: "lime",
          [`${P}line-width--hover`]: "3px",
        },
        { suppress: new Set(["stroke"]) },
      ),
    ]);
    assert.strictEqual(
      only(text),
      'g[data-w="u1"] > *:hover { stroke-width: 3px; ' +
        "stroke-dasharray: none }",
    );
  });

  test("an unbound widget keeps both paints", () => {
    const text = stateRules([
      input({
        [`${P}fill-color--hover`]: "lime",
        [`${P}line-color--hover`]: "navy",
      }),
    ]);
    assert.strictEqual(
      only(text),
      'g[data-w="u1"] > *:hover { fill: lime; stroke: navy }',
    );
  });

  test("suppressedOf drops fill on every stroked host", () => {
    // ★ The finding this suite grew for. `strokePaint` returns
    // `fill: null` UNCONDITIONALLY, so a `fill` variant on a stroked
    // host would fill the series path on hover — a state no base
    // state can express, and one the scene can never show, because
    // the scene's `fill` stays `null`.
    for (const tag of [
      "hdml-line",
      "hdml-rule",
      "hdml-axis",
      "hdml-grid",
    ]) {
      const el = <HdvlElement>document.createElement(tag);
      const out = suppressedOf(el);
      assert.isTrue(out.has("fill"), tag);
      assert.isFalse(out.has("stroke"), tag);
    }
  });

  test("suppressedOf drops nothing on a bare filled host", () => {
    for (const tag of ["hdml-bar", "hdml-point", "hdml-arc"]) {
      const el = <HdvlElement>document.createElement(tag);
      assert.strictEqual(suppressedOf(el).size, 0, tag);
    }
  });
});

suite("hdvl/states — the derived stroke-dasharray", () => {
  test("a width variant REGENERATES a dashed pattern", () => {
    // ★ The wrinkle. `dashOf` derives the pattern from style ×
    // width, so `stroke-width: 2.5px` alone would thicken the line
    // and keep gaps computed for 1px — a wrong picture with no
    // error, invisible to every golden. Negative control 2 removes
    // the regeneration and this is what fails.
    const text = stateRules([
      input({
        [`${P}line-style`]: "dashed",
        [`${P}line-width`]: "1px",
        [`${P}line-width--hover`]: "2.5px",
      }),
    ]);
    assert.strictEqual(
      only(text),
      'g[data-w="u1"] > *:hover { stroke-width: 2.5px; ' +
        "stroke-dasharray: 10 7.5 }",
    );
  });

  test("a style variant derives it at the BASE width", () => {
    // The same wrinkle in reverse: only the style moved, so the
    // width the pattern scales with is the base one.
    const text = stateRules([
      input({
        [`${P}line-width`]: "2px",
        [`${P}line-style--hover`]: "dotted",
      }),
    ]);
    assert.strictEqual(
      only(text),
      'g[data-w="u1"] > *:hover { stroke-dasharray: 2 4 }',
    );
  });

  test("a solid state switches a dashed base OFF", () => {
    // `none` is emitted rather than omitted, because the node
    // carries a `stroke-dasharray` ATTRIBUTE that the state has to
    // override — omitting would leave the base pattern in force.
    const text = stateRules([
      input({
        [`${P}line-style`]: "dashed",
        [`${P}line-style--hover`]: "solid",
      }),
    ]);
    assert.strictEqual(
      only(text),
      'g[data-w="u1"] > *:hover { stroke-dasharray: none }',
    );
  });

  test("a state touching neither input emits no dasharray", () => {
    const text = stateRules([
      input({
        [`${P}line-style`]: "dashed",
        [`${P}fill-color--hover`]: "lime",
      }),
    ]);
    assert.notInclude(text, "stroke-dasharray");
  });

  test("a zero effective width derives none, not `0 0`", () => {
    // R4's UA default is `--hdml-line-width: 0` on the eight filled
    // hosts, so this is the live case for every one of them.
    const text = stateRules([
      input({
        [`${P}line-width`]: "0px",
        [`${P}line-style--hover`]: "dashed",
      }),
    ]);
    assert.strictEqual(
      only(text),
      'g[data-w="u1"] > *:hover { stroke-dasharray: none }',
    );
  });
});

// ---------------------------------------------------------------
// The cascade — a real <svg>, no pointer
// ---------------------------------------------------------------

const NO_PAINT = {
  fill: null,
  stroke: null,
  strokeWidth: 0,
  dash: null,
};

const planted: HTMLElement[] = [];
const live: Renderer[] = [];

function host(): ShadowRoot {
  const el = document.createElement("div");
  el.style.cssText = "position:relative;width:400px;height:200px";
  document.body.appendChild(el);
  planted.push(el);
  return el.attachShadow({ mode: "open" });
}

function paintedRect(uid: string, fill: string): SceneGroup {
  const node: SceneNode = {
    ...NO_PAINT,
    fill,
    k: "rect",
    i: 0,
    x: 0,
    y: 0,
    w: 20,
    h: 10,
  };
  return {
    widget: uid,
    tag: "hdml-bar",
    role: "mark",
    box: { x: 0, y: 0, w: 400, h: 200 },
    opacity: 1,
    filter: "none",
    visibility: "visible",
    clip: false,
    clipPath: null,
    nodes: [node],
  };
}

function render(root: ShadowRoot, groups: SceneGroup[]): void {
  const r = createSvgRenderer();
  r.mount(root);
  r.resize(400, 200, 1);
  live.push(r);
  const scene: Scene = { width: 400, height: 200, groups };
  r.render(scene);
}

function nodeOf(root: ShadowRoot, uid: string): SVGElement {
  return <SVGElement>root.querySelector(`g[data-w="${uid}"] > *`);
}

suite("hdvl/states — the cascade assumption", () => {
  teardown(() => {
    while (live.length > 0) {
      live.pop()?.unmount();
    }
    while (planted.length > 0) {
      planted.pop()?.remove();
    }
  });

  test("an adopted rule beats a presentation attribute", () => {
    // ★ The assumption the whole mechanism is void without, and the
    // one step 09's probe proved only in a scratchpad. The renderer
    // writes `fill` as a presentation ATTRIBUTE; a presentation
    // attribute loses to any author-origin rule, so the sheet wins
    // without `!important` and without the scene knowing.
    const root = host();
    render(root, [paintedRect("a", "rgb(255, 0, 0)")]);
    const el = nodeOf(root, "a");
    assert.strictEqual(el.getAttribute("fill"), "rgb(255, 0, 0)");
    assert.strictEqual(getComputedStyle(el).fill, "rgb(255, 0, 0)");

    const sheet = new CSSStyleSheet();
    sheet.replaceSync('g[data-w="a"] > * { fill: rgb(0, 128, 0) }');
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    assert.strictEqual(
      getComputedStyle(el).fill,
      "rgb(0, 128, 0)",
      "an adopted rule must beat the presentation attribute",
    );
    // …and the ATTRIBUTE is untouched, which is why the scene and
    // every whole-`Scene` golden stay valid.
    assert.strictEqual(el.getAttribute("fill"), "rgb(255, 0, 0)");
  });

  test("a generated rule reaches ONE group, not its sibling", () => {
    // The per-group scoping half of the same claim, provable
    // without a pointer. The per-NODE half needs real pointer
    // input and is step 09-3.
    const root = host();
    render(root, [
      paintedRect("a", "rgb(255, 0, 0)"),
      paintedRect("b", "rgb(255, 0, 0)"),
    ]);
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(
      stateRules([
        {
          uid: "a",
          suppress: new Set<string>(),
          props: new Map([[`${P}fill-color--hover`, "lime"]]),
        },
      ]).replace(":hover", ""),
    );
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    assert.strictEqual(
      getComputedStyle(nodeOf(root, "a")).fill,
      "rgb(0, 255, 0)",
    );
    assert.strictEqual(
      getComputedStyle(nodeOf(root, "b")).fill,
      "rgb(255, 0, 0)",
    );
  });

  test("stroke-width overrides too, not only fill", () => {
    const root = host();
    render(root, [paintedRect("a", "rgb(255, 0, 0)")]);
    const el = nodeOf(root, "a");
    assert.strictEqual(getComputedStyle(el).strokeWidth, "0px");
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('g[data-w="a"] > * { stroke-width: 2.5px }');
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    assert.strictEqual(getComputedStyle(el).strokeWidth, "2.5px");
  });
});

// ---------------------------------------------------------------
// The live view — adoption, and the one DOM read
// ---------------------------------------------------------------

suite("hdvl/states — the sheet on a live view", () => {
  async function mount(
    markup: ReturnType<typeof html>,
  ): Promise<HdmlViewElement> {
    const view = await fixture<HdmlViewElement>(markup);
    const all = [view, ...Array.from(view.querySelectorAll("*"))];
    for (const el of all) {
      if (el instanceof LitElement) {
        await el.updateComplete;
      }
    }
    view.markDirty();
    for (let i = 0; i < 20 && view.dirty; i++) {
      await new Promise((r) => requestAnimationFrame(() => r(0)));
    }
    return view;
  }

  /** The state sheet is the LAST adopted one, by construction. */
  function sheetText(view: HdmlViewElement): string {
    const sheets = view.shadowRoot?.adoptedStyleSheets ?? [];
    const last = sheets[sheets.length - 1];
    return Array.from(last.cssRules)
      .map((r) => r.cssText)
      .join("\n");
  }

  test("a variant reaches the view's shadow root", async () => {
    const view = await mount(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-bar
            x="a"
            y="b"
            style="--hdml-fill-color--hover: rgb(0, 255, 0)"
          ></hdml-bar>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const bar = <HdvlElement>view.querySelector("hdml-bar");
    const text = sheetText(view);
    assert.include(text, `g[data-w="${bar.uid}"]`);
    assert.include(text, ":hover");
    assert.include(text, "rgb(0, 255, 0)");
    // The APPEND order, asserted rather than assumed: `elementSheet`
    // is prepended by `HdvlElement`, so a state rule the author
    // asked for must sit after it.
    const sheets = view.shadowRoot?.adoptedStyleSheets ?? [];
    assert.isAtLeast(sheets.length, 2);
  });

  test("a view nobody styled adopts an EMPTY sheet", async () => {
    const view = await mount(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-bar x="a" y="b"></hdml-bar>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    assert.strictEqual(sheetText(view), "");
  });

  test("suppressedOf reads the ATTRIBUTE, not a scale", async () => {
    // The predicate is the binding, never the resolved colour: a
    // binding with no scale in scope is V1 `no-scale-in-scope`, an
    // ERROR, so the only documents this over-suppresses on are ones
    // that already paint nothing.
    const view = await mount(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-ordinal-scale channel="color" values='["N"]'>
            <hdml-bar x="a" y="b" color='"N"'></hdml-bar>
            <hdml-line x="a" y="b" color='"N"'></hdml-line>
            <hdml-area x="a" y="b"></hdml-area>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const at = (tag: string): ReadonlySet<string> =>
      suppressedOf(<HdvlElement>view.querySelector(tag));
    assert.deepStrictEqual(at("hdml-bar"), new Set(["fill"]));
    // A stroked host bound to `color` loses BOTH: `fill` because it
    // has none, `stroke` because the channel owns it.
    assert.deepStrictEqual(
      at("hdml-line"),
      new Set(["fill", "stroke"]),
    );
    // Filled, unbound — nothing is suppressed.
    assert.strictEqual(at("hdml-area").size, 0);
  });
});
