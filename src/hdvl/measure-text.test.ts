/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import { SceneFont } from "./scene";
import {
  fontString,
  measureBackend,
  measureText,
} from "./measure-text";
import { createSvgRenderer } from "./renderer-svg";
// A namespace import: prettier will not break a single-specifier
// import, and the named form is 72 columns against a 70 limit.
import * as stub from "../testing/recording-renderer";

/**
 * §5.3 — one memoised offscreen-2D measurement, shared by the SVG
 * renderer and the recording stub (step-plan H10).
 *
 * **§5.3's determinism claim is nearly, but not exactly, true, and
 * the tolerance below is the measured fact rather than a slack
 * assertion.** `"North"` at `11px system-ui` measures
 *
 * | engine | width |
 * |---|---|
 * | chromium 145 | 30.765625 |
 * | webkit 26 | 30.765625 |
 * | firefox 146 | 30.766666412353516 |
 *
 * — chromium and webkit agree bit-for-bit; firefox differs by
 * ~1.04e-3 px. (§5.3's "31px" was a rounded figure; the exact value
 * is 30.77.) So a text-derived coordinate is **not** exact across
 * all three, and a later guide slice must assert one with `closeTo`
 * at ~1e-2 rather than `deepEqual`. What survives intact is R26:
 * both renderers delegate here, so on any ONE engine the SVG
 * renderer and the stub return the identical object — which is what
 * §5.9's byte-identity check compares.
 */

const NORTH: SceneFont = {
  family: "system-ui",
  size: 11,
  weight: "400",
  style: "normal",
};

const BOLD: SceneFont = { ...NORTH, weight: "700" };
const BIG: SceneFont = { ...NORTH, size: 22 };

suite("hdvl/measure-text", () => {
  test("the backing 2D context is reported", () => {
    // Step 08 probed eight capabilities; OffscreenCanvas was not
    // one of them, so assert what was actually obtained.
    assert.oneOf(measureBackend(), ["offscreen", "canvas"]);
  });

  test("North at 11px agrees to 1e-2 everywhere", () => {
    const m = measureText("North", NORTH);
    // The suite header carries the three measured widths. The
    // tolerance is 1e-2 because firefox differs by 1.04e-3; it is
    // NOT slack, and tightening it to 1e-4 fails on firefox alone.
    assert.closeTo(m.width, 30.766, 1e-2);
    assert.strictEqual(m.ascent, 8);
    assert.isAtLeast(m.descent, 0);
  });

  test("measurement is memoised per text and font", () => {
    const a = measureText("memoised", NORTH);
    const b = measureText("memoised", NORTH);
    assert.strictEqual(a, b);
    assert.notStrictEqual(a, measureText("memoised", BOLD));
  });

  test("fontString is style weight size family", () => {
    assert.strictEqual(
      fontString(NORTH),
      "normal 400 11px system-ui",
    );
    assert.strictEqual(
      fontString({
        family: "serif",
        size: 13,
        weight: "bold",
        style: "italic",
      }),
      "italic bold 13px serif",
    );
  });

  test("a wrong shorthand order would be caught", () => {
    // The context silently keeps its previous font when the
    // shorthand does not parse, which is a WRONG measurement rather
    // than an error — so two fonts must measure differently.
    const small = measureText("North", NORTH).width;
    const big = measureText("North", BIG).width;
    assert.notStrictEqual(small, big);
    assert.isAbove(big, small);
  });

  test("an empty string measures zero, never NaN", () => {
    // chromium and firefox report an ascent of -0 here, webkit 0.
    // Both are `=== 0`, neither is deepEqual to the other, and they
    // serialize differently — so the module normalises it.
    const m = measureText("", NORTH);
    assert.deepEqual(m, { width: 0, ascent: 0, descent: 0 });
    assert.isTrue(Object.is(m.ascent, 0));
    assert.isFalse(Number.isNaN(m.width));
  });

  test("both renderers measure identically (H10)", () => {
    const svg = createSvgRenderer();
    const rec = stub.createRecordingRenderer();
    for (const text of ["North", "", "1.2M", "a longer label"]) {
      assert.strictEqual(
        svg.measureText(text, NORTH),
        rec.measureText(text, NORTH),
      );
    }
  });
});
