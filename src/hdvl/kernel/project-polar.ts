/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import type { Point } from "../scene";

/**
 * The polar projection (RFC 016/001 §4.3, §4.6).
 *
 * §4.6 is normative and these three functions are its whole
 * implementation:
 *
 * ```
 * θ(a)   = (a − 90) · π / 180        a in degrees
 * x(a,r) = cx + r · cos θ(a)
 * y(a,r) = cy + r · sin θ(a)
 * radial range = [0, min(w, h) / 2]
 * ```
 *
 * **The convention is CSS's, not maths'** — see
 * {@link polarTheta}. That is the one thing in this module a
 * reader will otherwise "correct", and getting it half right
 * produces a chart mirrored about the horizontal axis, which looks
 * almost right.
 *
 * **The kernel never reads a CSS value.** `--hdml-angle-start` and
 * `--hdml-angle-end` are `<angle>`s, but resolving `"0deg"` to `0`
 * is `measure.ts`'s job; every argument here is already a number.
 *
 * **There is no inverse.** §5.7 rejects recovering a datum by
 * inverting a scale — "wrong for any non-injective scale and
 * rounds for the rest" — so a `polarInverse` would have no
 * consumer in v1 and is deliberately absent.
 *
 * **This module is pure.** No DOM, no `getComputedStyle`, no
 * import side effect, and its one import is **type-only** —
 * `src/hdvl/kernel/` carries that rule as a directory-wide
 * invariant, asserted by grep.
 *
 * @module hdvl/kernel/project-polar
 */

/**
 * The rotation that turns the maths convention into CSS's.
 *
 * A unit circle puts 0 at 3 o'clock and increases
 * counter-clockwise. CSS angles put **0 at 12 o'clock** and
 * increase **clockwise** — the `conic-gradient()` convention — and
 * §4.6 says CSS angles mean what CSS angles mean. Subtracting a
 * quarter turn before taking `cos`/`sin` moves zero from 3 to 12
 * o'clock; §2.7's **y-down** view coordinates are what then make
 * `+ r · sin θ` read *clockwise* on screen rather than
 * counter-clockwise.
 *
 * Both halves are required. Flip one and the chart mirrors about
 * the horizontal axis — a radar chart drawn the wrong way round is
 * still recognisably a radar chart, which is why the corpus alone
 * would not catch it and `project-polar.test.ts` asserts all four
 * axis-aligned angles by name.
 */
const CSS_ZERO_AT_NOON_DEG = 90;

/**
 * A signed zero is `===` zero but is neither `Object.is`-equal nor
 * `deepEqual` to it, and serializes to `"-0"` (plan rule 9).
 *
 * `r · cos θ` and `r · sin θ` **do** produce one at an
 * axis-aligned angle — `0 · Math.sin(−π/2)` is `-0` — but adding
 * it to a pole coordinate normalises it, because `x + (-0)` is
 * `x`. The case that survives is a pole whose own coordinate is
 * `-0`: then `-0 + -0` is `-0`. Every returned number goes through
 * here regardless.
 */
function num(v: number): number {
  return v === 0 ? 0 : v;
}

/**
 * §4.6's `θ(a)` — a CSS angle in degrees to radians.
 *
 * `0deg` points at 12 o'clock and angles increase **clockwise**.
 * See {@link CSS_ZERO_AT_NOON_DEG} for why the `− 90` is there and
 * what breaks without it.
 *
 * Degrees → radians is one subtraction, one multiply and one
 * divide, so this is exact wherever the arithmetic is: the four
 * axis-aligned angles land on exactly `−π/2`, `+0`, `π/2` and `π`.
 * The transcendental is downstream, in {@link polarPoint}.
 *
 * @param degrees - The CSS angle, already resolved to a number.
 * @returns The angle in radians, in the maths convention.
 */
export function polarTheta(degrees: number): number {
  return num(((degrees - CSS_ZERO_AT_NOON_DEG) * Math.PI) / 180);
}

/**
 * §4.6's `x(a, r)` / `y(a, r)`, about a pole.
 *
 * The pole is the centre of the radius-channel scale's content
 * box, or the plane's where no radius scale exists (§4.6);
 * resolving *which* box is step 26's, and this function takes the
 * answer.
 *
 * `radius = 0` lands on the pole **exactly** at every angle:
 * `0 · anything finite` is zero, so the result is the pole's own
 * coordinates rather than an approximation of them. That is the
 * one place in this module where a trig path yields an exact
 * answer.
 *
 * @param pole - `(cx, cy)` in view coordinates.
 * @param degrees - The CSS angle, already resolved to a number.
 * @param radius - The radius, in CSS px.
 * @returns The point, in view coordinates (§2.7: y down).
 */
export function polarPoint(
  pole: Point,
  degrees: number,
  radius: number,
): Point {
  const theta = polarTheta(degrees);
  return {
    x: num(pole.x + radius * Math.cos(theta)),
    y: num(pole.y + radius * Math.sin(theta)),
  };
}

/**
 * §4.3 / §4.6's radial ceiling — `min(w, h) / 2`.
 *
 * It is two things at once: the top of the range a `radius` scale
 * spans (§4.3's `[0, min(contentW, contentH) / 2]`) and the
 * reference a percentage in any radial `<length-percentage>`
 * resolves against (§4.6). `--hdml-inner-radius` resolves against
 * it too, but is a *default-extent floor* read at the polar mark
 * widget and never remaps this range — that is step 26's.
 *
 * Total: a zero-width or zero-height box gives `0`, because an
 * unlaid-out plane is a normal frame-zero state and not an error.
 * It validates nothing else — a non-finite dimension propagates,
 * since the return type has no `null` to report one with.
 *
 * @param w - The box's width, in CSS px.
 * @param h - The box's height, in CSS px.
 * @returns The largest radius the box can hold.
 */
export function radialCeiling(w: number, h: number): number {
  return num(Math.min(w, h) / 2);
}
