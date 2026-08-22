/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import { paletteColor, rampStops, splitColorList } from "./color";

/**
 * `kernel/color.ts` (§5.5) — a pure fixture table.
 *
 * The splitter is the one place in the module where a naive
 * implementation passes every hex-colour fixture and fails every
 * real stylesheet, so it carries most of the table: a computed
 * `<color>` is serialized functionally on every engine and those
 * forms contain both spaces and commas inside their parentheses.
 */

suite("hdvl/kernel/color — splitColorList", () => {
  test("hex colours split on whitespace", () => {
    assert.deepEqual(splitColorList("#111 #222 #333"), [
      "#111",
      "#222",
      "#333",
    ]);
  });

  test("an empty value has no colours", () => {
    assert.deepEqual(splitColorList(""), []);
    assert.deepEqual(splitColorList("   "), []);
  });

  test("one colour is a list of one", () => {
    assert.deepEqual(splitColorList(" #1c8cf4 "), ["#1c8cf4"]);
  });

  test("a functional form keeps its inner spaces", () => {
    assert.deepEqual(splitColorList("oklch(0.7 0.1 240)"), [
      "oklch(0.7 0.1 240)",
    ]);
  });

  test("a functional form keeps its inner commas", () => {
    assert.deepEqual(splitColorList("rgb(28, 140, 244)"), [
      "rgb(28, 140, 244)",
    ]);
  });

  test("two rgb() forms are two colours", () => {
    assert.deepEqual(
      splitColorList("rgb(28, 140, 244) rgb(245, 158, 11)"),
      ["rgb(28, 140, 244)", "rgb(245, 158, 11)"],
    );
  });

  test("a nested color-mix() stays one colour", () => {
    const value =
      "color-mix(in oklch, rgb(1, 2, 3) 50%, oklch(0.5 0 0))";
    assert.deepEqual(splitColorList(value), [value]);
  });

  test("a comma between top-level colours separates", () => {
    assert.deepEqual(splitColorList("#111, #222"), ["#111", "#222"]);
  });

  test("an unbalanced ) does not go negative", () => {
    assert.deepEqual(splitColorList("a) b"), ["a)", "b"]);
  });

  test("newlines separate as whitespace does", () => {
    assert.deepEqual(splitColorList("#111\n  #222"), [
      "#111",
      "#222",
    ]);
  });
});

suite("hdvl/kernel/color — paletteColor", () => {
  const palette = ["#a", "#b", "#c"];

  test("slot k takes entry k", () => {
    assert.strictEqual(paletteColor(palette, 0), "#a");
    assert.strictEqual(paletteColor(palette, 2), "#c");
  });

  test("an exhausted palette is null, never a wrap", () => {
    assert.isNull(paletteColor(palette, 3));
    assert.isNull(paletteColor(palette, 9));
  });

  test("a value outside the domain is null", () => {
    assert.isNull(paletteColor(palette, -1));
  });

  test("an empty palette is null throughout", () => {
    assert.isNull(paletteColor([], 0));
  });
});

suite("hdvl/kernel/color — rampStops", () => {
  const two = ["#000", "#fff"];
  const three = ["#a", "#b", "#c"];

  test("no stops is the empty string", () => {
    assert.strictEqual(rampStops([], "oklch", 0.5), "");
  });

  test("a single stop paints the whole range", () => {
    for (const t of [0, 0.25, 0.5, 1]) {
      assert.strictEqual(
        rampStops(["#123456"], "oklch", t),
        "#123456",
      );
    }
  });

  test("t = 0 is the first stop, verbatim", () => {
    assert.strictEqual(rampStops(two, "oklch", 0), "#000");
  });

  test("t = 1 is the last stop, verbatim", () => {
    assert.strictEqual(rampStops(two, "oklch", 1), "#fff");
  });

  test("t = 0.5 is neither endpoint", () => {
    const mid = rampStops(two, "oklch", 0.5);
    assert.notStrictEqual(mid, "#000");
    assert.notStrictEqual(mid, "#fff");
    assert.strictEqual(mid, "color-mix(in oklch, #fff 50%, #000)");
  });

  test("the space is the one it was handed", () => {
    assert.include(
      rampStops(two, "srgb-linear", 0.25),
      "in srgb-linear,",
    );
  });

  test("an interior stop of three is verbatim", () => {
    assert.strictEqual(rampStops(three, "oklch", 0.5), "#b");
  });

  test("three stops pick the segment t falls in", () => {
    assert.strictEqual(
      rampStops(three, "oklch", 0.25),
      "color-mix(in oklch, #b 50%, #a)",
    );
    assert.strictEqual(
      rampStops(three, "oklch", 0.75),
      "color-mix(in oklch, #c 50%, #b)",
    );
  });

  test("t outside [0, 1] clamps to an endpoint", () => {
    assert.strictEqual(rampStops(two, "oklch", -3), "#000");
    assert.strictEqual(rampStops(two, "oklch", 7), "#fff");
  });

  test("a non-finite t reads as 0", () => {
    assert.strictEqual(rampStops(two, "oklch", NaN), "#000");
  });

  // Plan rule 9. `-0` is a REACHABLE producer here: `t = -0` gives
  // `u = -0` and `u - 0` is `-0`, which would print `-0%`.
  test("a -0 fraction never reaches a percentage", () => {
    assert.isTrue(Object.is(-0 - 0, -0), "the producer is real");
    assert.strictEqual(rampStops(two, "oklch", -0), "#000");
    assert.notInclude(rampStops(three, "oklch", -0), "-0");
  });
});
