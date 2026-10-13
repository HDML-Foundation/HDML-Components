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
  STATE_MARK,
  STATE_PROPERTIES,
  channelPropOf,
  stateProperty,
  stateRules,
  suppressedOf,
} from "./states";
import { HDVL_PROPERTIES } from "./properties";
import { CHANNEL_STATE_PROPERTIES, CHANNEL_STATES } from "./scale";
import {
  installSceneRecorder,
  restoreRenderers,
  sceneOf,
} from "../testing/scene-of";

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
    channelProp: null,
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

  test("★ R1 — CHANNEL_STATES is HDVL_STATES, exactly", () => {
    // ★★ 019 R1, step 37. `mark.ts` cannot import `HDVL_STATES`:
    // this module imports `CHANNEL_SLOTS` and `dashOf` from
    // `mark.ts`, so the import would close a `mark → states → mark`
    // cycle — tighter than the `scale → states → mark → scale` that
    // `Scale.paintState` already declined to close. `scale.ts`
    // carries a second spelling, `CHANNEL_STATES`, and THIS is what
    // makes the duplicate safe: a loop over a hand-kept list
    // asserts nothing about what the list omits, so the two are
    // asserted element-for-element and in ORDER. A state added to
    // one and not the other fails here rather than silently
    // painting nothing on every channel-coloured mark.
    assert.deepStrictEqual(
      Array.from(CHANNEL_STATES),
      Array.from(HDVL_STATES),
    );
  });

  test("the two-class boundary is enforced both ways", () => {
    // ★ R7's boundary was otherwise structural-but-SILENT. A ninth
    // entry in the generator's map would look for a variant nobody
    // registered, `props.get` would return `undefined`, and nothing
    // at all would be emitted — the property would simply never
    // work, which is the defect R7 exists to close. This is the only
    // thing that fails instead.
    //
    // ★★ 019 R1 WIDENED IT TO TWO CLASSES, and the reverse half is
    // why R1's four registrations could not land on their own. A
    // registered variant must have **a** reader; it need not have
    // `states.ts` as that reader. So:
    //
    //   class 1 `STATE_PROPERTIES`         → a generated CSS rule
    //   class 2 `CHANNEL_STATE_PROPERTIES` → `Scale.paintState`
    //
    // Both are asserted exhaustive against the registry, the
    // reverse half runs against their UNION, and they are asserted
    // DISJOINT — without which the union would be a way to satisfy
    // the boundary while naming no reader at all.
    const registered = new Set(
      HDVL_PROPERTIES.map((def) => def.name),
    );
    assert.lengthOf(STATE_PROPERTIES, 8);
    assert.lengthOf(CHANNEL_STATE_PROPERTIES, 2);
    const varied = new Set([
      ...STATE_PROPERTIES,
      ...CHANNEL_STATE_PROPERTIES,
    ]);
    // Disjoint, and therefore twenty variants over ten bases. A
    // base in both lists would be read twice with two different
    // `null` contracts.
    //
    // ⚠ Asserted as a SUM, not as `lengthOf(varied, 10)`. The
    // literal 10 was the first spelling and control 1c found it
    // weak: one base added to class 2 while still in class 1
    // leaves the union at ten, so the assertion passes on exactly
    // the input it was written to reject. The sum cannot.
    assert.strictEqual(
      varied.size,
      STATE_PROPERTIES.length + CHANNEL_STATE_PROPERTIES.length,
      "the two reader classes overlap",
    );
    assert.strictEqual(varied.size, 10);
    for (const base of varied) {
      for (const state of HDVL_STATES) {
        assert.isTrue(
          registered.has(`${base}--${state}`),
          `${base}--${state} is not registered`,
        );
      }
    }
    // …and no registered variant is left without a reader.
    for (const def of HDVL_PROPERTIES) {
      for (const state of HDVL_STATES) {
        const tail = `--${state}`;
        if (!def.name.endsWith(tail)) {
          continue;
        }
        assert.isTrue(
          varied.has(def.name.slice(0, -tail.length)),
          `${def.name} is registered but has no reader`,
        );
      }
    }
    // The twenty are exactly the registry's `--hover`/`--active`
    // entries: a count, so that a THIRD class added to `varied`
    // without registrations cannot pass the two loops above.
    const variants = HDVL_PROPERTIES.filter((def) =>
      HDVL_STATES.some((st) => def.name.endsWith(`--${st}`)),
    );
    assert.lengthOf(variants, 20);
  });

  test("the channel class is NOT in the generated sheet", () => {
    // ★ THE NEGATIVE CONTROL for the two-class split, and the one
    // thing that stops class 2 from being a list nobody honours. A
    // palette is a `<color>+` list, so `fill: #1c8cf4 #f59e0b …`
    // would be nonsense in a rule — assert the generator ignores a
    // channel variant entirely rather than emitting it badly.
    const text = stateRules([
      input({
        [`${P}palette--hover`]: "#111111 #222222",
        [`${P}color-interpolate--hover`]: "#111111, #222222",
      }),
    ]);
    assert.strictEqual(text, "");
    for (const base of CHANNEL_STATE_PROPERTIES) {
      assert.notInclude(Array.from(STATE_PROPERTIES), base);
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

suite("hdvl/states — R1's channel rule", () => {
  // ★★ 019 R1, step 38. The SECOND of the two halves that meet at
  // the DOM. This suite owns the generator half: the rule text, as
  // a pure function of the snapshot, with no view, no renderer and
  // no pointer anywhere in it. `renderer-svg.test.ts` owns the
  // stamp, and `states-pointer.test.ts` owns the two halves
  // meeting.

  const PALETTE = `${P}palette--hover`;

  test("a bound channel + a palette emits a 2nd rule", () => {
    const text = stateRules([
      input({ [PALETTE]: "red blue" }, { channelProp: "fill" }),
    ]);
    assert.strictEqual(
      text,
      `g[data-w="u1"] > *[${STATE_MARK}]:hover ` +
        `{ fill: var(${stateProperty("hover")}) }`,
    );
  });

  test("the marker is in the selector, not a bare child", () => {
    // ★★ The whole of why a node with NO state colour is safe. A
    // rule reaching `> *:hover` would resolve `var()` on an unset
    // property, which is invalid at computed-value time — `unset`,
    // and `fill` INHERITS, so an unmarked node would hover to its
    // group's colour instead of keeping its presentation attribute.
    const text = stateRules([
      input({ [PALETTE]: "red blue" }, { channelProp: "fill" }),
    ]);
    assert.include(text, `*[${STATE_MARK}]:hover`);
    assert.notInclude(text, "> *:hover");
  });

  test("a stroked host's channel rule declares stroke", () => {
    const text = stateRules([
      input({ [PALETTE]: "red blue" }, { channelProp: "stroke" }),
    ]);
    assert.include(text, "{ stroke: var(");
    assert.notInclude(text, "{ fill: var(");
  });

  test("no palette state — a bound channel emits NOTHING", () => {
    // The module's *"a widget with no state variant set contributes
    // nothing"* promise, under the one new way to break it: a
    // `color`-bound widget under a scale with no state palette must
    // still produce the empty sheet.
    assert.strictEqual(
      stateRules([input({}, { channelProp: "fill" })]),
      "",
    );
  });

  test("no bound channel — a palette state emits NOTHING", () => {
    assert.strictEqual(
      stateRules([input({ [PALETTE]: "red blue" })]),
      "",
    );
  });

  test("an unauthored state emits no rule for that state", () => {
    // ★ Open question 5. `hover` authored, `active` not: the
    // `active` rule is OMITTED rather than emitted with a `var()`
    // that could not resolve.
    const text = stateRules([
      input({ [PALETTE]: "red blue" }, { channelProp: "fill" }),
    ]);
    assert.include(text, ":hover");
    assert.notInclude(text, ":active");
  });

  test("--hdml-color-interpolate--{state} drives it too", () => {
    const text = stateRules([
      input(
        { [`${P}color-interpolate--active`]: "red, blue" },
        { channelProp: "fill" },
      ),
    ]);
    assert.include(text, `*[${STATE_MARK}]:active`);
    assert.notInclude(text, ":hover");
  });

  test("both rules coexist, channel SECOND and more specific", () => {
    // SPEC §9's *"channel-bound paint wins over --hdml-fill-color
    // and its state variants alike"* falls out of the cascade: one
    // extra attribute selector. A `color`-bound mark suppresses
    // `fill` from the DIRECT list, so the width variant is what
    // proves the first rule is still emitted.
    const text = stateRules([
      input(
        { [PALETTE]: "red blue", [`${P}line-width--hover`]: "3px" },
        { channelProp: "fill", suppress: new Set(["fill"]) },
      ),
    ]);
    const lines = text.split("\n");
    assert.lengthOf(lines, 2);
    assert.include(lines[0], "> *:hover");
    assert.include(lines[0], "stroke-width: 3px");
    assert.notInclude(lines[0], "fill:");
    assert.include(lines[1], `*[${STATE_MARK}]:hover`);
  });

  test("★ control 4 — stateRules needs no DOM at all", () => {
    // ★★ **Negative control 4**, R1 trap 4 as a measurement. Every
    // input above is a hand-built literal; this states it as the
    // claim rather than relying on it. `channelProp` is a SCALAR —
    // the resolved colours are per DATUM and live on the scene
    // node, so putting them here would need a frame, a scale and a
    // row, and this assertion could not be written.
    const built: StateInput = {
      uid: "pure",
      suppress: new Set<string>(),
      channelProp: "fill",
      props: new Map([[PALETTE, "red blue"]]),
    };
    assert.strictEqual(typeof built.channelProp, "string");
    assert.isTrue(
      Object.values(built).every((v) => !(v instanceof Element)),
      "no input member is a DOM node",
    );
    assert.include(stateRules([built]), "fill: var(");
  });
});

suite("hdvl/states — channelPropOf", () => {
  // ★ The sheet's half of C298's pair. `PaintStates.prop` is the
  // writer's, computed at the five mark call sites; this is the
  // reader's, computed from the tag. Neither can import the other,
  // so this suite is what makes them agree.

  async function mounted(
    markup: ReturnType<typeof html>,
  ): Promise<HdvlElement> {
    const view = await fixture<HdmlViewElement>(markup);
    await view.updateComplete;
    return <HdvlElement>view.querySelector("[data-probe]");
  }

  test("an unbound mark has no channel property", async () => {
    const el = await mounted(html`
      <hdml-view aria-label="v">
        <hdml-bar data-probe x='["a"]' y="[1]"></hdml-bar>
      </hdml-view>
    `);
    assert.isNull(channelPropOf(el));
  });

  test("a filled mark binding color owns the FILL", async () => {
    const el = await mounted(html`
      <hdml-view aria-label="v">
        <hdml-bar
          data-probe
          x='["a"]'
          y="[1]"
          color='["a"]'
        ></hdml-bar>
      </hdml-view>
    `);
    assert.strictEqual(channelPropOf(el), "fill");
  });

  test("hdml-line binding color owns the STROKE", async () => {
    // ★★★ C298's case. Every offered shape at row 37 would have
    // made row 38 guess, and this is the widget it guesses wrong
    // on: `strokePaint` returns `fill: null` unconditionally.
    const el = await mounted(html`
      <hdml-view aria-label="v">
        <hdml-line
          data-probe
          x='["a"]'
          y="[1]"
          color='["a"]'
        ></hdml-line>
      </hdml-view>
    `);
    assert.strictEqual(channelPropOf(el), "stroke");
  });

  test("hdml-legend binds `channel`, not `color`", async () => {
    // ★ D2. The one widget that is not a mark: its binding is
    // `channel="color"`, so the attribute read answers `null` for
    // it and it needs its own clause. Its swatches are filled.
    const el = await mounted(html`
      <hdml-view aria-label="v">
        <hdml-legend data-probe channel="color"></hdml-legend>
      </hdml-view>
    `);
    assert.strictEqual(channelPropOf(el), "fill");
  });

  test("a legend on another channel owns nothing", async () => {
    const el = await mounted(html`
      <hdml-view aria-label="v">
        <hdml-legend data-probe channel="size"></hdml-legend>
      </hdml-view>
    `);
    assert.isNull(channelPropOf(el));
  });

  test("★ it agrees with suppressedOf on bound tags", async () => {
    // ★★★ **Control 5's cross-check, and step 37 named it: the rule
    // now exists TWICE from opposite ends and neither can import
    // the other.** `suppressedOf` knows the same fact and throws it
    // away — a stroked host binding `color` suppresses BOTH, so the
    // set alone cannot say which the channel owns. This asserts the
    // one direction that is still checkable: whatever
    // `channelPropOf` names must be in the suppressed set.
    // ⚠ `lit/static-html`'s `html` will not interpolate a string
    // into tag position, so the five are written out.
    const bound: [string, ReturnType<typeof html>][] = [
      [
        "bar",
        html`<hdml-view aria-label="v">
          <hdml-bar data-probe x='["a"]' y="[1]" color='["a"]' />
        </hdml-view>`,
      ],
      [
        "area",
        html`<hdml-view aria-label="v">
          <hdml-area data-probe x='["a"]' y="[1]" color='["a"]' />
        </hdml-view>`,
      ],
      [
        "point",
        html`<hdml-view aria-label="v">
          <hdml-point data-probe x='["a"]' y="[1]" color='["a"]' />
        </hdml-view>`,
      ],
      [
        "arc",
        html`<hdml-view aria-label="v">
          <hdml-arc data-probe a0="[0]" a1="[1]" color='["a"]' />
        </hdml-view>`,
      ],
      [
        "line",
        html`<hdml-view aria-label="v">
          <hdml-line data-probe x='["a"]' y="[1]" color='["a"]' />
        </hdml-view>`,
      ],
    ];
    for (const [tag, markup] of bound) {
      const el = await mounted(markup);
      const prop = channelPropOf(el);
      assert.isNotNull(prop, tag);
      assert.isTrue(
        suppressedOf(el).has(<string>prop),
        `${tag}: ${String(prop)} is suppressed`,
      );
    }
  });
});

suite("hdvl/states — what a host may not state-vary", () => {
  test("a channel-owned fill is out, its outline is in", () => {
    // SPEC §9: channel-bound paint wins over `--hdml-fill-color`
    // AND its state variants alike, so this is what a LITERAL may
    // not say. ⚠ `09-polar-area` was authored on exactly this and no
    // longer is: since step 40 it carries a state PALETTE beside the
    // stroke variant, so its wedges take both cues — the fill from
    // the channel, the outline from what the channel does not own.
    // The suppression asserted here is unchanged; what changed is
    // that it stopped being the whole story.
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
          channelProp: null,
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

  test("★★ R1 — states.prop IS suppressedOf's drop", async () => {
    // ★★★ **Negative control 5, step 37** — the one nobody asked
    // for, and it is a genuine cross-check rather than a restated
    // assertion. The same rule is now encoded TWICE, from opposite
    // ends: `STROKE_PAINTED` here decides which presentation
    // attribute a channel-bound host may not state-vary, and
    // `PaintStates.prop` at the five `channelStates` call sites
    // decides which property the per-datum state colour lands on.
    // Neither can import the other — `mark.ts` cannot reach into
    // this module — so nothing but this test makes them agree.
    //
    // It is also the assertion that would catch the mistake the
    // field's NAME was chosen to prevent: a `stateFill` would have
    // put `hdml-line`'s hover colour on the one property a stroked
    // host structurally has none of.
    installSceneRecorder();
    try {
      const view = await mount(html`
        <hdml-view
          aria-label="prop"
          style="width: 200px; height: 200px;
                 --hdml-palette: #111111 #222222;
                 --hdml-palette--hover: #aaaaaa #bbbbbb"
        >
          <hdml-cartesian-plane style="padding: 0">
            <hdml-ordinal-scale channel="x" values='["a", "b"]'>
              <hdml-continuous-scale channel="y" min="0" max="10">
                <hdml-ordinal-scale
                  channel="color"
                  values='["N", "S"]'
                >
                  <hdml-bar
                    x='["a", "b"]'
                    y="[1, 2]"
                    color='["N", "S"]'
                  ></hdml-bar>
                  <hdml-line
                    x='["a", "b"]'
                    y="[3, 4]"
                    color='"N"'
                  ></hdml-line>
                  <hdml-area
                    x='["a", "b"]'
                    y="[5, 6]"
                    color='"N"'
                  ></hdml-area>
                  <hdml-point
                    x='["a", "b"]'
                    y="[7, 8]"
                    color='["N", "S"]'
                  ></hdml-point>
                </hdml-ordinal-scale>
              </hdml-continuous-scale>
            </hdml-ordinal-scale>
          </hdml-cartesian-plane>
        </hdml-view>
      `);
      const scene = sceneOf(view);
      let checked = 0;
      for (const tag of [
        "hdml-bar",
        "hdml-line",
        "hdml-area",
        "hdml-point",
      ]) {
        const el = <HdvlElement>view.querySelector(tag);
        const group = scene.groups.find((g) => g.widget === el.uid);
        assert.isDefined(group, `${tag} painted no group`);
        const dropped = suppressedOf(el);
        // The property the CHANNEL owns, read off `suppressedOf`
        // alone: a stroked host drops `fill` unconditionally and
        // its channel takes `stroke`, so the channel's property is
        // `stroke` exactly when both are dropped.
        const expected =
          dropped.has("fill") && dropped.has("stroke")
            ? "stroke"
            : "fill";
        // The two encodings, asserted against each other.
        assert.strictEqual(
          expected,
          tag === "hdml-line" ? "stroke" : "fill",
          `suppressedOf(${tag}) names the wrong paint`,
        );
        for (const node of group?.nodes ?? []) {
          assert.isTrue("states" in node, `${tag} carries no states`);
          assert.strictEqual(node.states?.prop, expected, tag);
          checked++;
        }
      }
      // A green loop over an empty set is not a check (C294).
      assert.isAbove(checked, 4);
    } finally {
      restoreRenderers();
    }
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
