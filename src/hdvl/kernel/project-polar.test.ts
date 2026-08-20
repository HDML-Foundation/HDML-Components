/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import {
  polarPoint,
  polarTheta,
  radialCeiling,
} from "./project-polar";

/**
 * RFC §4.6 — the polar projection — and §4.3's radial ceiling.
 *
 * A pure fixture table: no DOM, no computed style, no element, no
 * `fixture` import and no `await`. That is the module's own
 * invariant, and the grep
 * `grep -rn "document\.\|window\." src/hdvl/kernel/` is what keeps
 * it true.
 *
 * **Which cross-engine rule applies to which number** (plan rules
 * 1, 2 and 9; `docs/development.md` § *Writing a kernel fixture
 * table* is the canonical version):
 *
 * - **`closeTo(…, 1e-9)`** for every coordinate that went through
 *   `Math.sin` or `Math.cos`. ECMAScript does not require
 *   correctly-rounded transcendentals, so V8, SpiderMonkey and
 *   JavaScriptCore may differ in the last ulp — and
 *   `Math.cos(Math.PI / 2)` is `6.123233995736766e-17` rather than
 *   0 on all three, so an exact assertion at an axis-aligned angle
 *   would be wrong even on one engine.
 * - **Exact** for `polarTheta`, which is one subtraction, one
 *   multiply and one divide; for `radialCeiling`, which is a `min`
 *   and a halving; and for `radius = 0`, where `0 · anything
 *   finite` is zero and the result is the pole itself. That last
 *   one is where the two rules touch, and it is deliberate.
 * - **A sign and a `-0` are asserted exactly even on a trig
 *   path** — `Object.is` answers a question no tolerance can, and
 *   it is the whole reason plan rule 9 names polar projection.
 *   `assert.strictEqual(x, 0)` **passes for `-0`**.
 */

const POLE = { x: 50, y: 50 };

/* -------------------------------------------------------------- */
/* §4.6's angle convention                                        */
/* -------------------------------------------------------------- */

suite("hdvl/kernel/project-polar — polarTheta", () => {
  // Degrees → radians is rational arithmetic, so these are exact.
  // The transcendental is downstream, in polarPoint.
  const THETAS: [number, number, string][] = [
    [0, -Math.PI / 2, "−π/2 — 12 o'clock"],
    [90, 0, "0 — 3 o'clock"],
    [180, Math.PI / 2, "π/2 — 6 o'clock"],
    [270, Math.PI, "π — 9 o'clock"],
    [360, (3 * Math.PI) / 2, "3π/2 — 12 o'clock again"],
  ];

  for (const [degrees, expected, why] of THETAS) {
    test(`${degrees}deg is exactly ${why}`, () => {
      assert.strictEqual(polarTheta(degrees), expected);
    });
  }

  test("90deg is +0, not -0", () => {
    assert.isTrue(Object.is(polarTheta(90), 0));
  });

  test("is linear in degrees", () => {
    assert.strictEqual(polarTheta(90 + 45), Math.PI / 4);
    assert.strictEqual(polarTheta(-90), -Math.PI);
  });
});

/* -------------------------------------------------------------- */
/* §4.6's projection — the CSS convention, not the maths one      */
/* -------------------------------------------------------------- */

suite("hdvl/kernel/project-polar — polarPoint", () => {
  // The four axis-aligned angles, by name. This is the assertion
  // that would go unnoticed if a sign were flipped: 0deg at 12
  // o'clock with angles increasing CLOCKWISE is the
  // conic-gradient() convention, and a chart mirrored about the
  // horizontal axis still looks like a chart. y DECREASES at
  // 0deg because §2.7's view coordinates are y-down.
  const CLOCK: [number, number, number, string][] = [
    [0, 50, 40, "12 o'clock — straight up"],
    [90, 60, 50, "3 o'clock — clockwise from 0"],
    [180, 50, 60, "6 o'clock"],
    [270, 40, 50, "9 o'clock"],
  ];

  for (const [degrees, x, y, why] of CLOCK) {
    test(`${degrees}deg points at ${why}`, () => {
      const p = polarPoint(POLE, degrees, 10);
      assert.closeTo(p.x, x, 1e-9);
      assert.closeTo(p.y, y, 1e-9);
    });
  }

  test("Math.cos(π/2) is not 0 — hence every closeTo", () => {
    // The platform fact behind every closeTo above, asserted so a
    // later reader does not "tighten" them to strictEqual.
    assert.strictEqual(Math.cos(Math.PI / 2), 6.123233995736766e-17);
    assert.strictEqual(Math.sin(Math.PI), 1.2246467991473532e-16);
    // The residual is real and reaches the coordinate: about the
    // origin it survives intact at any radius.
    assert.strictEqual(
      polarPoint({ x: 0, y: 0 }, 0, 10).x,
      6.123233995736766e-16,
    );
  });

  test("a right angle only LOOKS exact at a small radius", () => {
    // Measured: about a pole of 50 at radius 10 the residual is
    // 6.1e-16, which is below the ulp of 50 (7.1e-15), so the
    // addition swallows it and the coordinate comes back exactly
    // 50. That is a coincidence of magnitude, not a guarantee —
    // widen the radius and it surfaces. Recorded so nobody reads
    // the exact-looking value above as licence to assert these
    // with strictEqual.
    assert.strictEqual(polarPoint(POLE, 0, 10).x, 50);
    assert.notStrictEqual(polarPoint(POLE, 0, 1e6).x, 50);
    assert.closeTo(polarPoint(POLE, 0, 1e6).x, 50, 1e-9);
  });

  test("a full turn agrees with zero", () => {
    // Guards a `% 360` that is not there: the projection is
    // periodic because sin and cos are, not because it wraps.
    const at0 = polarPoint(POLE, 0, 10);
    const at360 = polarPoint(POLE, 360, 10);
    assert.closeTo(at360.x, at0.x, 1e-9);
    assert.closeTo(at360.y, at0.y, 1e-9);
  });

  test("projects an off-axis angle", () => {
    // 45deg is halfway between 12 and 3 o'clock: equal offsets
    // right and up, of 10 · √½.
    const p = polarPoint(POLE, 45, 10);
    assert.closeTo(p.x, 57.071067811865476, 1e-9);
    assert.closeTo(p.y, 42.928932188134524, 1e-9);
  });

  test("radius scales the offset linearly", () => {
    const p = polarPoint(POLE, 90, 25);
    assert.closeTo(p.x, 75, 1e-9);
    assert.closeTo(p.y, 50, 1e-9);
  });

  test("radius 0 lands on the pole exactly, at every angle", () => {
    // The one place a trig path yields an exact answer:
    // 0 · anything finite is zero, so this is rule 1 rather than
    // rule 2. It is also a rule-9 site — 0 · a negative cosine is
    // -0 — which is why the sign is asserted alongside the value.
    for (const degrees of [0, 45, 90, 180, 270, 360]) {
      const p = polarPoint(POLE, degrees, 0);
      assert.strictEqual(p.x, 50);
      assert.strictEqual(p.y, 50);
    }
  });

  test("no axis-aligned angle returns a -0", () => {
    // Rule 9, over every angle × both coordinates × three poles,
    // including a pole that is itself a signed zero — which is the
    // one input that reaches num(), because `x + (-0)` is `x` for
    // every other x and `-0 + -0` is `-0`.
    const poles = [POLE, { x: 0, y: 0 }, { x: -0, y: -0 }];
    for (const pole of poles) {
      for (const degrees of [0, 90, 180, 270]) {
        for (const radius of [0, 10]) {
          const p = polarPoint(pole, degrees, radius);
          assert.isFalse(
            Object.is(p.x, -0),
            `x at ${degrees}deg r=${radius}`,
          );
          assert.isFalse(
            Object.is(p.y, -0),
            `y at ${degrees}deg r=${radius}`,
          );
        }
      }
    }
  });

  test("the raw product does produce a -0", () => {
    // Stated as a measurement so the num() guard above is not
    // mistaken for defensive noise and deleted.
    assert.isTrue(Object.is(0 * Math.sin(polarTheta(0)), -0));
    assert.isTrue(Object.is(0 * Math.cos(polarTheta(270)), -0));
    assert.isTrue(Object.is(0 + -0, 0));
    assert.isTrue(Object.is(-0 + -0, -0));
  });
});

/* -------------------------------------------------------------- */
/* §4.3's radial ceiling                                          */
/* -------------------------------------------------------------- */

suite("hdvl/kernel/project-polar — radialCeiling", () => {
  const CEILINGS: [number, number, number][] = [
    [400, 200, 100],
    [200, 400, 100],
    [300, 300, 150],
    [0, 100, 0],
    [100, 0, 0],
    [0, 0, 0],
  ];

  for (const [w, h, expected] of CEILINGS) {
    test(`${w} × ${h} gives ${expected}`, () => {
      // min and a halving: exact, and total. A zero-sized box is
      // an unlaid-out plane, which is a normal frame-zero state
      // and not an error.
      assert.strictEqual(radialCeiling(w, h), expected);
    });
  }

  test("a zero ceiling is +0, not -0", () => {
    assert.isTrue(Object.is(radialCeiling(0, 100), 0));
    // Math.min(-0, 100) is -0, and -0 / 2 is -0 — the producer
    // this prompt predicted, and the one that is real.
    assert.isTrue(Object.is(Math.min(-0, 100) / 2, -0));
    assert.isTrue(Object.is(radialCeiling(-0, 100), 0));
    assert.isTrue(Object.is(radialCeiling(0, -0), 0));
  });
});
