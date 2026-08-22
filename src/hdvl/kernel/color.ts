/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * SPEC §9's colour resolution — the palette and the ramp
 * (RFC 016/001 §5.5, §6.1, R30).
 *
 * This module is pure. It takes **already-resolved strings** — the
 * computed value of a registered `<color>+` property, read once per
 * element per frame by `measure.ts` — and returns strings. It reads
 * no DOM, resolves nothing against a cascade, and has no import
 * side effect.
 *
 * **It does no colour-space math, deliberately** (§5.5). `oklch()`
 * and `color-mix()` are supported on all three engines, so stop *k*
 * of *n* at fraction k / (n − 1) is expressible as
 * `color-mix(in <space>, A <p>%, B)` — a value the platform
 * interpolates in the space SPEC names. Re-implementing OKLCh here
 * would be a second interpolator that disagrees with the one the
 * page's own CSS uses.
 *
 * **The returned ramp string is unresolved, and that is a
 * contract.** `color-mix()` is legal wherever a `<color>` is, so a
 * mark painting one paints correctly; §5.5's *"read back resolved"*
 * matters only to the legend's ramp bar, which is a computed-style
 * read and therefore MEASURE's — and MEASURE runs once per
 * **element**, while the ramp's `t` is per **row**. A per-value
 * read-back could not go through MEASURE at all. The legend owns it
 * at step 31.
 *
 * @module hdvl/kernel/color
 */

/**
 * A signed zero is `===` zero but is neither `Object.is`-equal nor
 * `deepEqual` to it, and serializes to `"-0"` (plan rule 9) — here
 * it would reach a stylesheet as the literal percentage `-0%`.
 *
 * Measured: `t = -0` gives `u = -0` and `u - 0` is `-0`, so the
 * producer is reachable from the very first fraction a reversed or
 * clamped ramp computes.
 */
function num(v: number): number {
  return v === 0 ? 0 : v;
}

/**
 * Splits a `<color>+` computed value into its colours.
 *
 * **Not `value.split(" ")`.** A computed `<color>` is serialized in
 * a functional form on every engine — `rgb(28, 140, 244)`,
 * `oklch(0.7 0.1 240)`, `color-mix(in oklch, red, blue)` — and each
 * of those contains both spaces and commas *inside* its
 * parentheses. The split is therefore over **top-level** separators
 * only, tracking parenthesis depth; a naive implementation passes
 * every hex-colour fixture and fails every real stylesheet.
 *
 * Commas are accepted as separators alongside whitespace because
 * `<color>+` is space-separated but an author may write a list with
 * commas and some engines round-trip it verbatim.
 *
 * @param value - A registered `<color>+` property's computed value.
 * @returns The colours, in order. Empty for an empty value.
 */
export function splitColorList(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let token = "";
  for (const ch of value) {
    if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth = depth > 0 ? depth - 1 : 0;
    }
    if (depth === 0 && (ch === "," || /\s/.test(ch))) {
      if (token !== "") {
        out.push(token);
        token = "";
      }
      continue;
    }
    token += ch;
  }
  if (token !== "") {
    out.push(token);
  }
  return out;
}

/**
 * §5.5's ordinal palette assignment: domain slot *k* takes palette
 * entry *k*.
 *
 * **An exhausted palette returns `null`, and does not wrap.** Two
 * series sharing one colour is a silent wrong chart — precisely
 * §1.5's failure mode — where `null` lets the mark fall back to
 * `--hdml-fill-color` visibly and uniformly. RFC §6.6 makes
 * exhaustion an **error on the scale**, raised in COMPUTE once the
 * domain resolves; that diagnostic lands with the legend (Slice H),
 * because the closed `RuleId` union has no V-number for it and SPEC
 * §11 gives it none.
 *
 * @param palette - The colours, already split.
 * @param index - The domain slot.
 * @returns The colour, or `null` when the slot is outside the
 *   palette or outside the domain.
 */
export function paletteColor(
  palette: readonly string[],
  index: number,
): string | null {
  if (!Number.isInteger(index) || index < 0) {
    return null;
  }
  return index < palette.length ? palette[index] : null;
}

/**
 * §5.5's ramp: the colour at fraction `t` across `stops`.
 *
 * Stop *k* of *n* sits at k / (n − 1), so `t` lands inside one
 * segment and the result is that segment's `color-mix()`. **A
 * single stop paints the whole range that colour** (§5.5), and an
 * exact stop fraction returns that stop **verbatim** rather than a
 * degenerate mix — which is what makes `t = 0` the first stop and
 * `t = 1` the last as *strings*, not merely as rendered colours.
 *
 * @param stops - The ramp stops, already split, in order.
 * @param space - An interpolation space —
 *   `--hdml-color-interpolate-space`'s computed value.
 * @param t - The fraction, clamped into `[0, 1]` by this function.
 * @returns A CSS `<color>`. Empty string when there are no stops.
 */
export function rampStops(
  stops: readonly string[],
  space: string,
  t: number,
): string {
  if (stops.length === 0) {
    return "";
  }
  if (stops.length === 1) {
    return stops[0];
  }
  const clamped = Number.isFinite(t)
    ? Math.min(Math.max(t, 0), 1)
    : 0;
  const last = stops.length - 1;
  const u = num(clamped * last);
  const i = Math.min(Math.floor(u), last - 1);
  const f = num(u - i);
  if (f === 0) {
    return stops[i];
  }
  if (f === 1) {
    return stops[i + 1];
  }
  const pct = num(f * 100);
  return `color-mix(in ${space}, ${stops[i + 1]} ${pct}%, ${
    stops[i]
  })`;
}
