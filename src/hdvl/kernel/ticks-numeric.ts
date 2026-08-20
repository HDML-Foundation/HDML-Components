/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The numeric tick ladders (RFC 016/001 §4.2 step 5, §4.8).
 *
 * §4.8 is normative and this module is its whole implementation:
 * the `{1, 2, 5} × 10ⁿ` ladder, the log / pow / symlog ladders
 * built **on** it, and continuous `nice`. R12's one-implementation
 * rule lives here — `ticksLog`, `ticksPow` and `ticksSymlog` all
 * call {@link tickStep} / {@link ticksNumeric} rather than
 * re-deriving a ladder, so a guide can only ever call one.
 *
 * **Two properties are load-bearing and easy to lose.**
 *
 * 1. **The integer-reciprocal form.** At a negative power the step
 *    is a *divisor*: dividing by an integer keeps 0.1 / 0.2 / 0.5
 *    exact where multiplying by `10^power` drifts, "and
 *    implementations that skip this disagree at domain boundaries"
 *    (§4.8). Measured: `3 * 0.2` is `0.6000000000000001`, `3 / 5`
 *    is `0.6`. A tick 4 ulp outside an endpoint is a tick that
 *    exists on one engine and not another.
 * 2. **Generation, never accumulation.** Ticks come from `i · step`
 *    or `i / divisor` over an **integer index range**. A
 *    `for (v = start; v <= end; v += step)` loop accumulates float
 *    error and silently loses the last element on a hundred-step
 *    domain — the exact bug §4.8's last line forbids.
 *
 * `count` is a **target, never a promise** (§4.8's first line):
 * round values win over an exact count.
 *
 * **This module is pure.** No DOM, no `getComputedStyle`, no
 * import side effect, and no import at all — `src/hdvl/kernel/`
 * carries that rule as a directory-wide invariant, asserted by
 * grep.
 *
 * @module hdvl/kernel/ticks-numeric
 */

/**
 * §4.8's step, in the form the ladder must generate from.
 *
 * `divisor` is **not** an optimisation — see the module note. At a
 * negative power the step is `−(10^−power) / mult`, and every such
 * divisor is an integer, which is the whole point.
 */
export interface TickStep {
  /** The step as a number, for callers that need only one. */
  step: number;
  /** Non-null at negative powers: generate `i / divisor`. */
  divisor: number | null;
  /** The `{1, 2, 5, 10}` multiplier chosen. */
  mult: number;
  /** `floor(log10(raw))`. */
  power: number;
}

/**
 * The decade multipliers §4.8 subdivides a log decade by, with the
 * implicit 1 that names the power itself.
 *
 * §4.8 writes `{2, 5}`, which is decimal-shaped: at `base = 2`,
 * `2 · 2^p` **is** the next power and `5 · 2^p` is outside the
 * decade entirely. The set is therefore filtered to `k < base`,
 * which is the only generalisation that keeps the result inside one
 * decade and free of duplicates for any base. At base 10 it is
 * exactly §4.8's rule.
 */
const LOG_SUBDIVISIONS = [1, 2, 5];

/**
 * A signed zero is `===` zero but is neither `Object.is`-equal nor
 * `deepEqual` to it, and serializes to `"-0"` (plan rule 9).
 *
 * A ladder crossing zero produces one: `Math.ceil(x)` for
 * `x ∈ (−1, 0)` returns `-0`, so a domain whose first tick index is
 * a negative fraction — `ticksNumeric(-0.4, 2, 4)` — starts at
 * `-0` unless normalised. `Math.floor`/`Math.ceil` in
 * {@link niceNumeric} do the same to an endpoint.
 */
function num(v: number): number {
  return v === 0 ? 0 : v;
}

/** `log_base(v)`, snapped to an integer it is within 1e-12 of. */
function logBase(v: number, base: number): number {
  const x =
    base === 10 ? Math.log10(v) : Math.log(v) / Math.log(base);
  const r = Math.round(x);
  return Math.abs(x - r) < 1e-12 ? r : x;
}

/**
 * §4.8's `tickStep`.
 *
 * ```
 * raw   = (d1 − d0) / max(1, count)
 * power = floor(log10(raw))
 * err   = raw / 10^power
 * mult  = err > 5 ? 10 : err > 2 ? 5 : err > 1 ? 2 : 1
 * return power >= 0 ? mult · 10^power
 *                   : −(10^−power) / mult      # a divisor
 * ```
 *
 * The comparisons are **strict**: `power = floor(log10(raw))` puts
 * `err` in `[1, 10)`, so a `>=` chain could never return 1 and the
 * ladder would be permanently one rung coarse — `[0, 1]` at a
 * target of 10 would step by 0.2. *(RFC §4.8 amended 2026-08-20;
 * the pseudocode transcribes the classic ceiling rule, which uses
 * strict comparisons.)*
 *
 * The ladder is over an **interval**, so a descending `[d1, d0]`
 * gives the same step as `[d0, d1]`.
 *
 * @param d0 - One domain endpoint.
 * @param d1 - The other domain endpoint.
 * @param count - The target tick count.
 * @returns The chosen step, in both forms.
 */
export function tickStep(
  d0: number,
  d1: number,
  count: number,
): TickStep {
  const raw =
    (Math.max(d0, d1) - Math.min(d0, d1)) / Math.max(1, count);
  const power = Math.floor(Math.log10(raw));
  const err = raw / Math.pow(10, power);
  const mult = err > 5 ? 10 : err > 2 ? 5 : err > 1 ? 2 : 1;
  if (power >= 0) {
    return {
      step: mult * Math.pow(10, power),
      divisor: null,
      mult,
      power,
    };
  }
  const divisor = Math.pow(10, -power) / mult;
  return { step: 1 / divisor, divisor, mult, power };
}

/** `i · step`, or `i / divisor` in the integer-reciprocal form. */
function at(i: number, spec: TickStep): number {
  return spec.divisor === null ? i * spec.step : i / spec.divisor;
}

/** The integer index of `v` on the ladder, before rounding. */
function indexOf(v: number, spec: TickStep): number {
  return spec.divisor === null ? v / spec.step : v * spec.divisor;
}

/** Whether a step is usable — a degenerate domain gives none. */
function usable(spec: TickStep): boolean {
  return Number.isFinite(spec.step) && spec.step > 0;
}

/**
 * §4.8's numeric ladder: every multiple of the step within the
 * domain.
 *
 * Generated as `i · step` (or `i / divisor`) over an integer index
 * range — **never by repeated addition**.
 *
 * @param d0 - One domain endpoint.
 * @param d1 - The other domain endpoint.
 * @param count - The target tick count.
 * @returns The ticks, always **ascending**, even for `d0 > d1`.
 */
export function ticksNumeric(
  d0: number,
  d1: number,
  count: number,
): number[] {
  const lo = Math.min(d0, d1);
  const hi = Math.max(d0, d1);
  const spec = tickStep(lo, hi, count);
  if (!usable(spec)) {
    return [];
  }
  const i0 = Math.ceil(indexOf(lo, spec));
  const i1 = Math.floor(indexOf(hi, spec));
  if (!Number.isFinite(i0) || !Number.isFinite(i1)) {
    return [];
  }
  const out: number[] = [];
  for (let i = i0; i <= i1; i++) {
    out.push(num(at(i, spec)));
  }
  return out;
}

/**
 * §4.8's log ladder: powers of `base` within the domain.
 *
 * If there are **fewer** powers than `count`, each decade the
 * domain touches is subdivided by {@link LOG_SUBDIVISIONS}; if
 * there are as many or more, every `⌈P / count⌉`-th power is kept,
 * starting at index 0 — the same thinning shape §4.8 gives ordinal
 * guides. Subdivision is all-decades-or-none: §4.8 states one
 * condition over the whole domain, and a per-decade test would make
 * a ladder whose spacing changes across the axis.
 *
 * A non-positive `d0` yields no ticks. That is not a diagnosis —
 * §4.5's V2 is step 18's, from the domain — it is simply that the
 * powers of a base do not reach there.
 *
 * @param d0 - One domain endpoint.
 * @param d1 - The other domain endpoint.
 * @param count - The target tick count.
 * @param base - The log base.
 * @returns The ticks, ascending.
 */
export function ticksLog(
  d0: number,
  d1: number,
  count: number,
  base: number,
): number[] {
  const lo = Math.min(d0, d1);
  const hi = Math.max(d0, d1);
  if (!(lo > 0) || !Number.isFinite(hi) || !(base > 1)) {
    return [];
  }
  const p0 = Math.ceil(logBase(lo, base));
  const p1 = Math.floor(logBase(hi, base));
  const powers = Math.max(0, p1 - p0 + 1);
  if (powers >= Math.max(1, count)) {
    const keep = Math.ceil(powers / Math.max(1, count));
    const out: number[] = [];
    for (let p = p0; p <= p1; p += keep) {
      out.push(Math.pow(base, p));
    }
    return out;
  }
  const out: number[] = [];
  const from = Math.floor(logBase(lo, base));
  const to = Math.floor(logBase(hi, base));
  for (let p = from; p <= to; p++) {
    const decade = Math.pow(base, p);
    for (const k of LOG_SUBDIVISIONS) {
      if (k >= base) {
        continue;
      }
      const v = k * decade;
      if (v >= lo && v <= hi) {
        out.push(v);
      }
    }
  }
  return out;
}

/**
 * §4.8's pow / sqrt ladder — the numeric ladder applied in **value
 * space**, not transform space, so a sqrt size scale's labels read
 * as round values.
 *
 * It takes **no exponent**, and that is not an omission: the ladder
 * chooses *which values* to label, and in value space the transform
 * has no say in that. The exponent re-enters only when
 * {@link project} places the chosen value.
 *
 * @param d0 - One domain endpoint.
 * @param d1 - The other domain endpoint.
 * @param count - The target tick count.
 * @returns The ticks, ascending.
 */
export function ticksPow(
  d0: number,
  d1: number,
  count: number,
): number[] {
  return ticksNumeric(d0, d1, count);
}

/**
 * §4.8's symlog ladder: the numeric ladder inside the linear region
 * `|v| ≤ C`, the log ladder outside it, **always including 0 when
 * the domain spans it**.
 *
 * Two things §4.8 leaves open, decided here and stated so a later
 * reader does not read them as accidents:
 *
 * - **The join.** The linear region's last tick and the log
 *   region's first are both `C`, so they coincide. They are
 *   de-duplicated by value, keeping one — the same answer the plan
 *   gives DST-collapsed calendar ticks at step 16.
 * - **The budget.** Each region is asked for `count` ticks of its
 *   own rather than sharing one budget, because the two regions are
 *   qualitatively different scales and splitting the target would
 *   make the linear region's spacing depend on how far the log
 *   region reaches. `count` is a target, so the sum may exceed it.
 *
 * @param d0 - One domain endpoint.
 * @param d1 - The other domain endpoint.
 * @param count - The target tick count, per region.
 * @param constant - §4.5's `C`.
 * @param base - The log base used outside the linear region.
 * @returns The ticks, ascending and duplicate-free.
 */
export function ticksSymlog(
  d0: number,
  d1: number,
  count: number,
  constant: number,
  base: number,
): number[] {
  const lo = Math.min(d0, d1);
  const hi = Math.max(d0, d1);
  const c = Math.abs(constant);
  const out: number[] = [];
  const linLo = Math.max(lo, -c);
  const linHi = Math.min(hi, c);
  if (linLo <= linHi) {
    out.push(...ticksNumeric(linLo, linHi, count));
  }
  if (lo < -c) {
    for (const v of ticksLog(c, -lo, count, base)) {
      out.push(-v);
    }
  }
  if (hi > c) {
    out.push(...ticksLog(c, hi, count, base));
  }
  if (lo <= 0 && hi >= 0) {
    out.push(0);
  }
  const seen = new Set<number>();
  return out
    .map(num)
    .filter((v) => v >= lo && v <= hi)
    .sort((a, b) => a - b)
    .filter((v) => {
      if (seen.has(v)) {
        return false;
      }
      seen.add(v);
      return true;
    });
}

/**
 * §4.2 step 5's `nice`: move the endpoints **outward** to the next
 * multiple of the tick step for the given target count. Bare `nice`
 * is count 10.
 *
 * **Layout-independent by construction** — the step comes from the
 * domain and the count, never from pixels, which is what lets the
 * whole of domain resolution happen in COMPUTE.
 *
 * It may only widen, and it preserves the orientation it was given:
 * a descending `[d1, d0]` comes back descending.
 *
 * @param d0 - One domain endpoint.
 * @param d1 - The other domain endpoint.
 * @param count - The target tick count.
 * @returns The widened endpoints, in the input's orientation.
 */
export function niceNumeric(
  d0: number,
  d1: number,
  count: number,
): [number, number] {
  const lo = Math.min(d0, d1);
  const hi = Math.max(d0, d1);
  const spec = tickStep(lo, hi, count);
  if (!usable(spec)) {
    return [num(d0), num(d1)];
  }
  const nLo = num(at(Math.floor(indexOf(lo, spec)), spec));
  const nHi = num(at(Math.ceil(indexOf(hi, spec)), spec));
  if (!Number.isFinite(nLo) || !Number.isFinite(nHi)) {
    return [num(d0), num(d1)];
  }
  return d0 <= d1 ? [nLo, nHi] : [nHi, nLo];
}
