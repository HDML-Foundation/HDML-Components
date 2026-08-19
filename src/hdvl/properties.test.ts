/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import "./index";
import { HDVL_PROPERTIES, registerProperties } from "./properties";

/**
 * SPEC §9's registry — complete at thirty-five, and intact after a
 * double registration (step-plan H5).
 *
 * Every name and initial below is **hardcoded** off SPEC §9. Read
 * back out of `HDVL_PROPERTIES` they would assert nothing, and the
 * eight-colour palette in particular is a value where a transposed
 * hex digit is a wrong chart nobody notices.
 */

/** Colour-valued initials: engines normalise these differently. */
const CURRENT = /^(currentcolor|rgba?\()/i;
const COLOR_TOKEN = /#[0-9a-f]{3,8}|rgba?\([^)]*\)|oklch\([^)]*\)/gi;

/** name → the exact computed initial, or null for "empty". */
const EXPECTED: [string, null | string][] = [
  ["--hdml-line-width", "1.5px"],
  ["--hdml-line-color", null],
  ["--hdml-line-style", "solid"],
  ["--hdml-fill-color", null],
  ["--hdml-font-family", "system-ui"],
  ["--hdml-font-size", "11px"],
  ["--hdml-font-weight", "normal"],
  ["--hdml-font-style", "normal"],
  ["--hdml-tick-style", "rect"],
  ["--hdml-tick-width", "1px"],
  ["--hdml-tick-height", "6px"],
  ["--hdml-curve-type", "linear"],
  ["--hdml-curve-basis-beta", "1"],
  ["--hdml-curve-bezier-tangents", null],
  ["--hdml-curve-cardinal-tension", "0"],
  ["--hdml-curve-catmull-rom-alpha", "0.5"],
  ["--hdml-curve-cubic-monotonicity", "1"],
  ["--hdml-curve-step-change", "middle"],
  ["--hdml-bandwidth", "0.8"],
  ["--hdml-palette", null],
  ["--hdml-color-interpolate", null],
  ["--hdml-color-interpolate-space", "oklch"],
  ["--hdml-legend-direction", "column"],
  ["--hdml-legend-swatch-size", "10px"],
  ["--hdml-legend-gap", "4px"],
  ["--hdml-size-min", "2px"],
  ["--hdml-size-max", "12px"],
  ["--hdml-angle-start", "0deg"],
  ["--hdml-angle-end", "360deg"],
  ["--hdml-inner-radius", "0%"],
  ["--hdml-grid-shape", "circle"],
  ["--hdml-line-width_hover", null],
  ["--hdml-line-color_hover", null],
  ["--hdml-line-style_hover", null],
  ["--hdml-fill-color_hover", null],
];

/** The four "no change in that state" sentinels (SPEC §9). */
const HOVER = [
  "--hdml-line-width_hover",
  "--hdml-line-color_hover",
  "--hdml-line-style_hover",
  "--hdml-fill-color_hover",
];

let probe: null | HTMLElement = null;

function valueOf(name: string): string {
  const el = <HTMLElement>probe;
  return getComputedStyle(el).getPropertyValue(name).trim();
}

suite("hdvl/properties", () => {
  setup(() => {
    probe = document.createElement("div");
    document.body.appendChild(probe);
  });

  teardown(() => {
    probe?.remove();
    probe = null;
  });

  test("the registry is exactly SPEC §9's 35", () => {
    assert.lengthOf(HDVL_PROPERTIES, 35);
    assert.deepEqual(
      HDVL_PROPERTIES.map((p) => p.name),
      EXPECTED.map(([name]) => name),
    );
  });

  test("every property inherits", () => {
    // SPEC §9: inheritance is what makes plane-level scoping and
    // theme-at-the-view work at all.
    for (const def of HDVL_PROPERTIES) {
      assert.isTrue(def.inherits, def.name);
    }
  });

  test("the sentinels carry no initial value", () => {
    // With syntax `*`, an OMITTED initialValue is the platform's
    // own spelling of "empty"; `""` is not equivalent everywhere.
    for (const name of HOVER) {
      const def = HDVL_PROPERTIES.find((p) => p.name === name);
      assert.isDefined(def);
      assert.strictEqual(def?.syntax, "*");
      assert.isUndefined(def?.initialValue, name);
    }
  });

  test("every registered property resolves", () => {
    for (const [name, expected] of EXPECTED) {
      const value = valueOf(name);
      if (expected === null) {
        continue;
      }
      assert.strictEqual(value, expected, name);
    }
  });

  test("the two currentColor initials resolve", () => {
    // R16: `currentcolor`'s computed value is not identical across
    // engines, which is why the runtime resolves paint itself
    // later. Here it only has to be a colour.
    assert.match(valueOf("--hdml-line-color"), CURRENT);
    assert.match(valueOf("--hdml-fill-color"), CURRENT);
  });

  test("the palette carries eight colours", () => {
    const value = valueOf("--hdml-palette");
    const found = value.match(COLOR_TOKEN) ?? [];
    assert.lengthOf(found, 8, value);
  });

  test("the ramp carries two stops", () => {
    const value = valueOf("--hdml-color-interpolate");
    const found = value.match(COLOR_TOKEN) ?? [];
    assert.lengthOf(found, 2, value);
  });

  test("the four hover variants are empty", () => {
    for (const name of HOVER) {
      assert.strictEqual(valueOf(name), "", name);
    }
    assert.strictEqual(valueOf("--hdml-curve-bezier-tangents"), "");
  });

  test("re-registering leaves all 35 intact", () => {
    // H5: `CSS.registerProperty` throws InvalidModificationError on
    // a duplicate, so a page that loads two builds registers twice.
    // With a LOOP-level try/catch the first duplicate would abort
    // the rest and the second build would get a truncated registry
    // — correct on first load, silently wrong afterwards, and
    // undetectable because a missing registration degrades to
    // unregistered-custom-property semantics rather than an error.
    registerProperties();
    registerProperties();
    for (const [name, expected] of EXPECTED) {
      const value = valueOf(name);
      if (expected === null) {
        continue;
      }
      assert.strictEqual(value, expected, name);
    }
    assert.match(valueOf("--hdml-line-color"), CURRENT);
    assert.lengthOf(
      valueOf("--hdml-palette").match(COLOR_TOKEN) ?? [],
      8,
    );
  });

  test("an unregistered --hdml-* stays empty", () => {
    // The negative control for V12: a name NOT in the registry
    // resolves to nothing, so "every property resolves" above is a
    // statement about registration and not about custom properties
    // in general.
    assert.strictEqual(valueOf("--hdml-not-a-property"), "");
  });
});
