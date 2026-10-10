/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import "./index";
import { HDVL_PROPERTIES, registerProperties } from "./properties";

/**
 * SPEC §9's registry — complete at fifty-one, and intact after a
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
  ["--hdml-text-rotate", "0deg"],
  // ★ 017 R2's fourth keyword. `auto` is the initial because a
  // registered property always computes to its initial, so a reader
  // cannot tell absence from an authored `middle` — and `middle`
  // would flatten every polar ring. See `properties.ts`.
  ["--hdml-text-anchor", "auto"],
  // ★ 019 items 18 + 19 — the two that do NOT inherit. `auto` is
  // `--hdml-tick-count`'s computed initial for the same reason
  // `--hdml-text-anchor`'s is; `--hdml-text-format` OMITS
  // `initialValue`, so its computed value is empty.
  ["--hdml-tick-count", "auto"],
  ["--hdml-text-format", null],
  ["--hdml-line-width--hover", null],
  ["--hdml-line-width--active", null],
  ["--hdml-line-color--hover", null],
  ["--hdml-line-color--active", null],
  ["--hdml-line-style--hover", null],
  ["--hdml-line-style--active", null],
  ["--hdml-fill-color--hover", null],
  ["--hdml-fill-color--active", null],
  ["--hdml-font-family--hover", null],
  ["--hdml-font-family--active", null],
  ["--hdml-font-size--hover", null],
  ["--hdml-font-size--active", null],
  ["--hdml-font-weight--hover", null],
  ["--hdml-font-weight--active", null],
  ["--hdml-font-style--hover", null],
  ["--hdml-font-style--active", null],
];

/**
 * The sixteen "no change in that state" sentinels (SPEC §9, 017 R7)
 * — the eight presentation-attribute properties × `{hover, active}`.
 *
 * Hardcoded off SPEC §9 like everything else here. Derived from
 * `HDVL_PROPERTIES` it would assert nothing, and the point of the
 * list is that **only these eight** carry variants: a ninth would
 * register a property no generated rule can ever reach.
 */
const VARIANTS = [
  "--hdml-line-width--hover",
  "--hdml-line-width--active",
  "--hdml-line-color--hover",
  "--hdml-line-color--active",
  "--hdml-line-style--hover",
  "--hdml-line-style--active",
  "--hdml-fill-color--hover",
  "--hdml-fill-color--active",
  "--hdml-font-family--hover",
  "--hdml-font-family--active",
  "--hdml-font-size--hover",
  "--hdml-font-size--active",
  "--hdml-font-weight--hover",
  "--hdml-font-weight--active",
  "--hdml-font-style--hover",
  "--hdml-font-style--active",
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

  test("the registry is exactly SPEC §9's 51", () => {
    assert.lengthOf(HDVL_PROPERTIES, 51);
    assert.deepEqual(
      HDVL_PROPERTIES.map((p) => p.name),
      EXPECTED.map(([name]) => name),
    );
  });

  test("no entry may take index 0", () => {
    // `SENTINEL_MARKER = SENTINEL_PROPERTIES[0]` (`ua.ts`) is the
    // FIRST registry entry's name, read by MEASURE to decide the
    // frame sentinel survived the author's CSS. A claimant that
    // inserted at index 0 would rename the marker, and the
    // `EXPECTED` table above is ordered and `deepEqual`'d — so the
    // failure would read as an ordering error rather than as the
    // sentinel one it is. Five 019 steps claim entries; this is the
    // assertion that holds the one index they may not have.
    assert.strictEqual(HDVL_PROPERTIES[0].name, "--hdml-line-width");
  });

  test("exactly two properties do not inherit", () => {
    // ★ 019 A1. SPEC §9's inheritance exception, as an ALLOW-LIST:
    // `--hdml-tick-count` and `--hdml-text-format` are
    // `inherits: false` because that is what makes a computed value
    // other than the initial mean "a rule matched THIS element" —
    // the detector both readers prefer the property by, and what
    // keeps `format`'s three error clauses off elements the author
    // never addressed.
    const got = HDVL_PROPERTIES.filter((def) => !def.inherits).map(
      (def) => def.name,
    );
    assert.deepEqual(got, [
      "--hdml-tick-count",
      "--hdml-text-format",
    ]);
  });

  test("the other 49 inherit", () => {
    // ★ THE POSITIVE CONTROL, and it is not redundant with the
    // allow-list above: an allow-list alone passes unchanged if a
    // THIRD property quietly stops inheriting. Counted as well as
    // iterated, because a filter that returned nothing would
    // satisfy the loop.
    const rest = HDVL_PROPERTIES.filter(
      (def) =>
        def.name !== "--hdml-tick-count" &&
        def.name !== "--hdml-text-format",
    );
    assert.lengthOf(rest, 49);
    for (const def of rest) {
      assert.isTrue(def.inherits, def.name);
    }
  });

  test("--hdml-text-format carries no initial value", () => {
    // With syntax `*`, an OMITTED initialValue is the platform's
    // own spelling of "empty"; `""` is not equivalent everywhere.
    // The sixteen state variants assert the same combination below;
    // this is the first NON-variant to rely on it alongside
    // `--hdml-curve-bezier-tangents`.
    const def = HDVL_PROPERTIES.find(
      (p) => p.name === "--hdml-text-format",
    );
    assert.isDefined(def);
    assert.strictEqual(def?.syntax, "*");
    assert.isFalse(def?.inherits);
    assert.isUndefined(def?.initialValue);
  });

  test("--hdml-tick-count is the typed shape with auto", () => {
    const def = HDVL_PROPERTIES.find(
      (p) => p.name === "--hdml-tick-count",
    );
    assert.isDefined(def);
    assert.strictEqual(def?.syntax, "auto | <integer>");
    assert.isFalse(def?.inherits);
    assert.strictEqual(def?.initialValue, "auto");
  });

  test("the sentinels carry no initial value", () => {
    // With syntax `*`, an OMITTED initialValue is the platform's
    // own spelling of "empty"; `""` is not equivalent everywhere.
    for (const name of VARIANTS) {
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

  test("the sixteen state variants are empty", () => {
    for (const name of VARIANTS) {
      assert.strictEqual(valueOf(name), "", name);
    }
    assert.strictEqual(valueOf("--hdml-curve-bezier-tangents"), "");
  });

  test("re-registering leaves all 51 intact", () => {
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

  test("the two exceptions do not reach a child", () => {
    // ★ 019 §6.3's detector, measured rather than reasoned: with
    // `inherits: false` a declaration on an ANCESTOR leaves the
    // child at the initial, which is what makes "other than the
    // initial" mean "a rule matched THIS element".
    const parent = <HTMLElement>probe;
    const child = document.createElement("div");
    parent.appendChild(child);
    parent.style.setProperty("--hdml-tick-count", "7");
    parent.style.setProperty(
      "--hdml-text-format",
      "currency/USD compact-short",
    );
    const own = getComputedStyle(parent);
    const sub = getComputedStyle(child);
    // The declaring element reads back VERBATIM — the internal
    // space and the `/` intact, which is why the syntax is `*`.
    assert.strictEqual(
      own.getPropertyValue("--hdml-tick-count").trim(),
      "7",
    );
    assert.strictEqual(
      own.getPropertyValue("--hdml-text-format").trim(),
      "currency/USD compact-short",
    );
    // The child is at the initial: `"auto"` for the typed shape and
    // EXACTLY `""` for the `*` one, raw and with no trim needed.
    assert.strictEqual(
      sub.getPropertyValue("--hdml-tick-count").trim(),
      "auto",
    );
    assert.strictEqual(
      sub.getPropertyValue("--hdml-text-format"),
      "",
    );
    child.remove();
  });

  test("a child may opt back in with `inherit`", () => {
    // ★ The bonus affordance (§6.4): a non-inheriting registered
    // property has a ONE-KEYWORD author opt-in. It is what answers
    // "how do I theme this at the plane?" without re-opening A1.
    const parent = <HTMLElement>probe;
    const child = document.createElement("div");
    parent.appendChild(child);
    parent.style.setProperty("--hdml-tick-count", "7");
    child.style.setProperty("--hdml-tick-count", "inherit");
    assert.strictEqual(
      getComputedStyle(child)
        .getPropertyValue("--hdml-tick-count")
        .trim(),
      "7",
    );
    child.remove();
  });

  test("an invalid tick count falls back to auto", () => {
    // The typed syntax is what makes the platform do the rejecting:
    // `banana` is invalid at computed-value time and substitutes
    // the initial, so a reader never sees it and needs no
    // diagnostic of its own (`--hdml-text-anchor`'s argument).
    const el = <HTMLElement>probe;
    el.style.setProperty("--hdml-tick-count", "banana");
    assert.strictEqual(valueOf("--hdml-tick-count"), "auto");
  });

  test("`*` is what exempts an omitted initial, not inherits", () => {
    // ★ THE NEGATIVE CONTROL for the omitted `initialValue`. A
    // `<length>`-typed property with `inherits: false` and no
    // `initialValue` THROWS on all three engines — so the
    // exemption `--hdml-text-format` relies on is a property of the
    // SYNTAX and not of inheritance, and `*` is load-bearing.
    //
    // ⚠ The message text differs per engine. Never match on it.
    assert.throws(() => {
      CSS.registerProperty({
        name: "--hdml-probe-typed-no-initial",
        syntax: "<length>",
        inherits: false,
      });
    });
    // And the same shape with `*` registers cleanly, which is what
    // makes the control a contrast rather than an assertion that
    // registration is simply fragile.
    CSS.registerProperty({
      name: "--hdml-probe-star-no-initial",
      syntax: "*",
      inherits: false,
    });
    assert.strictEqual(valueOf("--hdml-probe-star-no-initial"), "");
  });

  test("an unregistered --hdml-* stays empty", () => {
    // The negative control for V12: a name NOT in the registry
    // resolves to nothing, so "every property resolves" above is a
    // statement about registration and not about custom properties
    // in general.
    assert.strictEqual(valueOf("--hdml-not-a-property"), "");
  });
});
