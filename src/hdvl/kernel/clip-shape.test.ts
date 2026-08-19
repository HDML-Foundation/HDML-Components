/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import { Rect, Segment, Subpath } from "../scene";
import { clipShape, hasUrlForm } from "./clip-shape";

/**
 * RFC §5.4 — `clip-path` is resolved by the runtime into explicit
 * geometry, and `url()` is not supported.
 *
 * A pure fixture table: no DOM, no computed style, no element. That
 * is the module's own invariant, and the grep
 * `grep -rn "document\.\|window\." src/hdvl/kernel/` is what keeps
 * it true.
 */

const BOX: Rect = { x: 0, y: 0, w: 100, h: 50 };
const OFFSET: Rect = { x: 20, y: 10, w: 100, h: 50 };

function only(subpaths: readonly Subpath[] | null): Subpath {
  assert.isNotNull(subpaths);
  const list = subpaths;
  assert.lengthOf(list, 1);
  return list[0];
}

function lineTos(segments: readonly Segment[]): number[][] {
  return segments.map((s) => {
    assert.strictEqual(s.k, "line");
    const seg = <Extract<Segment, { k: "line" }>>s;
    return [seg.to.x, seg.to.y];
  });
}

suite("hdvl/kernel/clip-shape — basic shapes", () => {
  test("none resolves to no geometry", () => {
    assert.deepEqual(clipShape("none", BOX), {
      subpaths: null,
      w6: false,
    });
    assert.deepEqual(clipShape("", BOX), {
      subpaths: null,
      w6: false,
    });
  });

  test("inset insets from the box edges", () => {
    const out = clipShape("inset(10px)", BOX);
    assert.isFalse(out.w6);
    const sub = only(out.subpaths);
    // Rule 1: exact. No transcendental is involved.
    assert.deepEqual(sub.start, { x: 10, y: 10 });
    assert.deepEqual(lineTos(sub.segments), [
      [90, 10],
      [90, 40],
      [10, 40],
      [10, 10],
    ]);
  });

  test("inset takes four values and the origin", () => {
    const out = clipShape("inset(5px 10px 15px 20px)", OFFSET);
    const sub = only(out.subpaths);
    assert.deepEqual(sub.start, { x: 40, y: 15 });
    assert.deepEqual(lineTos(sub.segments), [
      [110, 15],
      [110, 45],
      [40, 45],
      [40, 15],
    ]);
  });

  test("a rounded inset is refused, not guessed", () => {
    // SPEC §1.5: a wrong chart is worse than an unstyled one, so an
    // approximate clip is never the answer.
    const out = clipShape("inset(10px round 4px)", BOX);
    assert.isNull(out.subpaths);
    assert.isFalse(out.w6);
  });

  test("circle emits four cubics at kappa", () => {
    const out = clipShape("circle(50%)", BOX);
    const sub = only(out.subpaths);
    assert.lengthOf(sub.segments, 4);
    for (const seg of sub.segments) {
      assert.strictEqual(seg.k, "cubic");
    }
    // circle()'s percentage basis is sqrt((w^2 + h^2) / 2).
    const r = 0.5 * Math.sqrt((100 * 100 + 50 * 50) / 2);
    const kappa = (4 / 3) * (Math.sqrt(2) - 1);
    // Rule 2: through Math.sqrt, so closeTo.
    assert.closeTo(sub.start.x, 50 + r, 1e-9);
    assert.closeTo(sub.start.y, 25, 1e-9);
    const first = <Extract<Segment, { k: "cubic" }>>sub.segments[0];
    assert.closeTo(first.c1.x, 50 + r, 1e-9);
    assert.closeTo(first.c1.y, 25 + r * kappa, 1e-9);
    assert.closeTo(first.to.x, 50, 1e-9);
    assert.closeTo(first.to.y, 25 + r, 1e-9);
  });

  test("a bare circle uses closest-side", () => {
    const out = clipShape("circle()", BOX);
    const sub = only(out.subpaths);
    // Nearest edge of a 100x50 box from its centre is 25.
    assert.deepEqual(sub.start, { x: 75, y: 25 });
  });

  test("ellipse takes two radii and a position", () => {
    const out = clipShape("ellipse(20px 10px at 30px 20px)", BOX);
    const sub = only(out.subpaths);
    assert.deepEqual(sub.start, { x: 50, y: 20 });
    const first = <Extract<Segment, { k: "cubic" }>>sub.segments[0];
    const kappa = (4 / 3) * (Math.sqrt(2) - 1);
    assert.closeTo(first.c1.y, 20 + 10 * kappa, 1e-9);
    assert.closeTo(first.to.y, 30, 1e-9);
  });

  test("polygon resolves percentages exactly", () => {
    const out = clipShape("polygon(0 0, 100% 0, 50% 100%)", BOX);
    const sub = only(out.subpaths);
    assert.deepEqual(sub.start, { x: 0, y: 0 });
    assert.lengthOf(sub.segments, 3);
    assert.deepEqual(lineTos(sub.segments), [
      [100, 0],
      [50, 50],
      [0, 0],
    ]);
  });

  test("polygon drops a leading fill rule", () => {
    const out = clipShape(
      "polygon(evenodd, 0 0, 100% 0, 50% 100%)",
      BOX,
    );
    const sub = only(out.subpaths);
    assert.deepEqual(sub.start, { x: 0, y: 0 });
    assert.lengthOf(sub.segments, 3);
  });

  test("url raises W6 and clips nothing", () => {
    const out = clipShape("url(#c)", BOX);
    assert.isNull(out.subpaths);
    assert.isTrue(out.w6);
    assert.isTrue(hasUrlForm("url(#c)"));
    assert.isTrue(hasUrlForm("url('a.svg#c')"));
    // §5.4 gives `filter` the same rule.
    assert.isTrue(hasUrlForm("blur(2px) url(#f)"));
    assert.isFalse(hasUrlForm("blur(2px) saturate(2)"));
    assert.isFalse(hasUrlForm("none"));
  });

  test("an unsupported shape clips nothing", () => {
    for (const v of [
      "path('M 0 0 L 1 1')",
      "circle(5em)",
      "polygon(0 0, 100% 0)",
      "margin-box",
      "rect(0 0 1 1)",
    ]) {
      const out = clipShape(v, BOX);
      assert.isNull(out.subpaths, v);
      assert.isFalse(out.w6, v);
    }
  });
});
