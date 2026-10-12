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
 * import side effect — `src/hdvl/kernel/` carries that rule as a
 * directory-wide invariant.
 *
 * ⚠ **It is no longer import-free, and this sentence used to read
 * *"and no import at all … asserted by grep"*.** Since 019 step 35
 * it takes §4.5's `t(v)` from {@link transform}, because
 * {@link ticksSymlog}'s shared budget is measured in **transform
 * space** and re-deriving `sign(v) · log1p(|v| / C)` down here
 * would be a second copy of a normative formula — exactly what R12
 * forbids. This is the **second** intra-directory edge in
 * `kernel/`, and the argument is the one `ticks-calendar.ts:25-28`
 * made for the first: an edge between two pure modules is still
 * pure. `scale-continuous.ts` imports nothing at all, so there is
 * no cycle, and the purity invariant is untouched.
 *
 * @module hdvl/kernel/ticks-numeric
 */

import { continuousSpec, transform } from "./scale-continuous";

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
 *   own, because the two regions are qualitatively different
 *   scales. ⚠ **That now generates the *candidate* set, not the
 *   answer** — {@link shareBudget} thins it.
 *
 * ⚠ **AMENDED 2026-10-12, 019 step 35, item 7. The clause above
 * is kept because its reason is true; what changed is that the
 * reason is now a cost rather than a decision.** It used to end:
 * *"…rather than sharing one budget, because the two regions are
 * qualitatively different scales and splitting the target would
 * make the linear region's spacing depend on how far the log
 * region reaches. `count` is a target, so the sum may exceed it."*
 *
 * **The linear region's spacing does now depend on how far the log
 * region reaches, and that is correct**, because the two regions
 * share one axis, one pixel budget and one reader. The cost the
 * old clause named is accepted in full and stated here rather than
 * deleted: a symlog axis is **not** two independent ladders drawn
 * side by side, and pretending it was is what put five linear
 * ticks into 4.12 px of `12-coverage` D.
 *
 * ⓘ `count` remains a **target in both directions**: the thinned
 * result may fall **short** of it (candidates are dropped, never
 * invented) and may exceed it by **at most one**, since the kept
 * ticks span at most `t(hi) − t(lo)` with at least one slot
 * between each adjacent pair.
 *
 * @param d0 - One domain endpoint.
 * @param d1 - The other domain endpoint.
 * @param count - The target tick count, **shared** across the
 *                regions since 019 step 35.
 * @param constant - §4.5's `C`.
 * @param base - The log base used outside the linear region.
 * @returns The ticks, ascending, duplicate-free and thinned to one
 *          shared budget.
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
  const candidates = out
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
  return shareBudget(candidates, lo, hi, count, c, base);
}

/**
 * ★ **The shared tick budget — 019 item 7's fix, step 35.**
 *
 * {@link ticksSymlog} generates its candidates **per region**, each
 * asked for the full `count`. On a domain like `12-coverage` D's
 * `symlog constant="1" min="-10000" max="10000"` with `count="5"`
 * that is 13 ticks, five of which land inside `|v| ≤ C` — a region
 * holding **7.5 %** of the transformed extent and therefore 9.9 px
 * of a 264 px axis. This thins that set to one budget shared across
 * the whole ladder.
 *
 * ### The mechanism, and why it is a minimum pitch
 *
 * A budget of `count` ticks over a transformed extent of `span`
 * buys one tick per `span / count` of that extent. So the budget is
 * spent by **keeping no two ticks closer than one slot** —
 * `slot = span / count` — walking **outward from the origin**:
 *
 * - A region of transformed extent `E` then keeps about `E / slot`
 *   `= count · E / span` ticks — **exactly its proportional share**,
 *   which is what RFC 019 Note 005 §2.2 asks for. The
 *   proportion is a *consequence* of the pitch, not a second rule,
 *   so there is no apportionment to round and no remainder to hand
 *   out.
 * - A minimum pitch is also the only form that **guarantees** the
 *   thing the defect was: quantising each tick to a slot index
 *   would let two ticks on either side of one slot boundary survive
 *   arbitrarily close together. Measured, not assumed.
 *
 * ### ★★ It is computed in TRANSFORM space, never from pixels
 *
 * `span` is `t(hi) − t(lo)`, and a region's share of the
 * **rendered** extent *is* its share of the transformed domain,
 * because {@link transform} is what a continuous scale projects
 * through and the projection is affine in `t`. So the two
 * formulations are the same number, and the transform-space one is
 * the only one this module may compute:
 *
 * - `kernel/` reads no pixel and no CSS value. R16 confines
 *   `getComputedStyle` to `measure.ts`, and a range in px would
 *   either put a pixel in here or add a parameter every caller
 *   must thread.
 * - ★ **And it would be wrong for a second reason.** This function
 *   is handed a **domain**, and the same domain must give the same
 *   ticks whatever the viewport — §4.2's *"`nice` never reads a
 *   pixel, so a resize cannot move the data"*, one function along.
 *   A pixel budget would make a tick set a function of the window.
 *
 * ### Two decisions the mechanism needs, taken here
 *
 * 1. **A region whose share rounds to nothing gets nothing — and
 *    the origin is still labelled.** The linear region of
 *    `12-coverage` D contributes **zero** ticks of its own, because
 *    `0` is the **anchor** rather than a member of its allocation.
 *    So no floor is needed to keep the origin: §4.8's *"always
 *    including 0 when the domain spans it"* is what makes the
 *    anchor well-defined, and the anchor is what makes the floor
 *    unnecessary.
 * 2. **Nothing is thinned unless the domain actually spans more
 *    than one region.** A budget is only *shared* when there is
 *    something to share it with; a symlog domain living entirely
 *    inside `|v| ≤ C` is the numeric ladder and must stay
 *    byte-identical to it. ⚠ This is load-bearing — without it a
 *    near-linear symlog domain loses ticks to the fact that
 *    `log1p` is not linear even inside `C`.
 *
 * ⓘ **Surviving ticks keep their value and their text.** This
 * thins what the ladder produced rather than re-asking it for a
 * coarser rung — the same choice Note 005 §3.3 made for item 8,
 * and the same shape `thinOrdinal` already had.
 *
 * @param ticks - The candidates, ascending and duplicate-free.
 * @param lo - The domain's lower endpoint.
 * @param hi - The domain's upper endpoint.
 * @param count - The shared target tick count.
 * @param constant - §4.5's `C`.
 * @param base - The log base, for the transform's spec.
 * @returns The kept ticks, ascending.
 */
function shareBudget(
  ticks: readonly number[],
  lo: number,
  hi: number,
  count: number,
  constant: number,
  base: number,
): number[] {
  const regions =
    (Math.max(lo, -constant) <= Math.min(hi, constant) ? 1 : 0) +
    (lo < -constant ? 1 : 0) +
    (hi > constant ? 1 : 0);
  if (regions < 2 || ticks.length < 2) {
    return [...ticks];
  }
  const spec = continuousSpec("symlog", { base, constant });
  const t = (v: number): number => transform(spec, v);
  const span = t(hi) - t(lo);
  if (!Number.isFinite(span) || span <= 0) {
    return [...ticks];
  }
  const slot = span / Math.max(1, count);
  // The anchor is the candidate nearest the origin in transform
  // space — `0` itself whenever the domain spans it, which is the
  // one tick §4.8 guarantees. Picking it by `|t|` rather than by
  // index keeps the result independent of which end we walk from.
  let anchor = 0;
  for (let i = 1; i < ticks.length; i++) {
    if (Math.abs(t(ticks[i])) < Math.abs(t(ticks[anchor]))) {
      anchor = i;
    }
  }
  const keep = [ticks[anchor]];
  let last = t(ticks[anchor]);
  for (let i = anchor + 1; i < ticks.length; i++) {
    if (t(ticks[i]) - last >= slot) {
      keep.push(ticks[i]);
      last = t(ticks[i]);
    }
  }
  last = t(ticks[anchor]);
  for (let i = anchor - 1; i >= 0; i--) {
    if (last - t(ticks[i]) >= slot) {
      keep.push(ticks[i]);
      last = t(ticks[i]);
    }
  }
  return keep.sort((a, b) => a - b);
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

/** `base^floor(log_base(v))` — the log rung at or below `v > 0`. */
function rungBelow(v: number, base: number): number {
  return Math.pow(base, Math.floor(logBase(v, base)));
}

/** `base^ceil(log_base(v))` — the log rung at or above `v > 0`. */
function rungAbove(v: number, base: number): number {
  return Math.pow(base, Math.ceil(logBase(v, base)));
}

/**
 * §4.2 step 5's `nice` **on a log scale**: each endpoint moves
 * outward to the enclosing power of the base.
 *
 * ★ **Added 2026-08-24 at step 25, under D1, with the user.** SPEC
 * §6 defines `nice` as *"the next multiple of the tick step for its
 * own target count"* and names the calendar ladder for
 * `hdml-datetime-scale`, but says nothing about the three
 * **non-linear** continuous transforms, none of which has a uniform
 * step. Applying {@link niceNumeric} to a log scale is not merely
 * inelegant: measured on corpus page `05-scatter`, a delivered
 * domain of `[12.5, 1250]` becomes **`[0, 1400]`**, which V2 then
 * errors on (*"a log domain cannot cross or touch zero"*) and which
 * projects nothing — a legal page turned into a blank figure by an
 * opt-in modifier. The approved default is the one the datetime
 * clause already sets: **a scale's `nice` uses that scale's own
 * ladder.** Powers of the base rather than §4.8's decade
 * subdivisions, exactly as the datetime clause rounds to
 * month/year boundaries rather than to the finest rung it could.
 *
 * `count` is not a parameter, and that is not an omission: powers of
 * the base are the ladder's coarse rungs whatever count is asked
 * for, and taking a count here would make `nice="4"` and bare
 * `nice` disagree about a domain, which §4.2's layout-independence
 * exists to prevent.
 *
 * **`pow` / `sqrt` need no member here.** §4.8's pow ladder *is* the
 * numeric ladder applied in value space — `ticksPow` returns
 * {@link ticksNumeric} — so {@link niceNumeric} already **is** their
 * own ladder, and adding a `nicePow` would be a second name for one
 * function (R12).
 *
 * A non-positive endpoint is left exactly as given. `nice` may only
 * widen a domain, never invent one that is legal: a log domain
 * reaching zero is V2's to report, and a `nice` that quietly moved
 * the endpoint to a positive power would suppress the diagnosis.
 *
 * @param d0 - One domain endpoint.
 * @param d1 - The other domain endpoint.
 * @param base - The log base.
 * @returns The widened endpoints, in the input's orientation.
 */
export function niceLog(
  d0: number,
  d1: number,
  base: number,
): [number, number] {
  const lo = Math.min(d0, d1);
  const hi = Math.max(d0, d1);
  if (!(lo > 0) || !Number.isFinite(hi) || !(base > 1)) {
    return [num(d0), num(d1)];
  }
  const nLo = rungBelow(lo, base);
  const nHi = rungAbove(hi, base);
  if (!Number.isFinite(nLo) || !Number.isFinite(nHi)) {
    return [num(d0), num(d1)];
  }
  return d0 <= d1 ? [nLo, nHi] : [nHi, nLo];
}

/**
 * §4.2 step 5's `nice` **on a symlog scale** — the same D1 decision
 * applied to §4.8's two-region ladder.
 *
 * An endpoint inside the linear region `|v| ≤ C` is the numeric
 * ladder's; one outside it is the log ladder's. That is §4.8's
 * symlog rule read per endpoint, which is the only reading
 * available: the two regions are qualitatively different scales and
 * an endpoint sits in exactly one of them.
 *
 * **Outward is a direction on the number line, not away from
 * zero.** A low endpoint always moves *down* and a high endpoint
 * always moves *up*, because `nice` may only widen — so a low
 * endpoint of `3` at `C = 1` moves down to `1`, and a high endpoint
 * of `−1250` moves up to `−1000`. Reading "outward" as *away from
 * zero* would narrow a domain that lies entirely on one side of it.
 *
 * @param d0 - One domain endpoint.
 * @param d1 - The other domain endpoint.
 * @param count - The target tick count, for the linear region.
 * @param constant - §4.5's `C`.
 * @param base - The log base used outside the linear region.
 * @returns The widened endpoints, in the input's orientation.
 */
export function niceSymlog(
  d0: number,
  d1: number,
  count: number,
  constant: number,
  base: number,
): [number, number] {
  const c = Number.isFinite(constant) && constant > 0 ? constant : 1;
  const lo = Math.min(d0, d1);
  const hi = Math.max(d0, d1);
  const linear = niceNumeric(lo, hi, count);
  const log = base > 1;
  const nLo = !log
    ? linear[0]
    : lo > c
    ? rungBelow(lo, base)
    : lo < -c
    ? -rungAbove(-lo, base)
    : linear[0];
  const nHi = !log
    ? linear[1]
    : hi > c
    ? rungAbove(hi, base)
    : hi < -c
    ? -rungBelow(-hi, base)
    : linear[1];
  if (!Number.isFinite(nLo) || !Number.isFinite(nHi)) {
    return [num(d0), num(d1)];
  }
  return d0 <= d1 ? [num(nLo), num(nHi)] : [num(nHi), num(nLo)];
}
