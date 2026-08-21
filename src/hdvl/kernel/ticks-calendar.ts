/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { tickStep } from "./ticks-numeric";
import {
  CalendarUnit,
  addUnits,
  ceilTo,
  fieldsOf,
  floorTo,
} from "./zone";

/**
 * §4.8's calendar tick ladder (RFC 016/001 §4.8).
 *
 * Eighteen rungs, walked **coarsest match first**, every boundary
 * computed **in the scale's zone** through {@link zone}'s
 * four-operation seam. Nothing in here imports the polyfill: the
 * seam is the only thing that does, and this module goes through it
 * exactly like every other caller will.
 *
 * **This module takes the kernel's first intra-directory import,
 * deliberately.** §4.8's last calendar rung is *"beyond a year: the
 * numeric ladder over years"*, and R12 says a ladder has **one**
 * implementation — so `import { tickStep } from "./ticks-numeric"`
 * is the *compliant* choice and re-deriving `{1, 2, 5} × 10ⁿ` in
 * here would be the violation. The directory-wide grep
 * `grep -rn 'from "\./"' src/hdvl/kernel/` returned empty from step
 * 10 to step 15 and now returns exactly this one hit. **That is not
 * a regression.** What the empty grep protected was a preference —
 * each module stands alone — where R12 is a rule. The purity
 * invariant is untouched: an edge between two pure modules is still
 * pure.
 *
 * **Three things §4.8 leaves open, decided here and stated so a
 * later reader does not decide them again per caller.**
 *
 * 1. **What "match" means.** The rungs are walked coarsest → finest
 *    and the first whose boundary count is **at least `count`**
 *    wins; if none reaches it, the finest rung (`1s`) is used. This
 *    is the reading consistent with §4.8's own first line — *"`count`
 *    is a target, never a promise"* and round values win — because
 *    it always prefers the coarser, rounder rung and lets the count
 *    overshoot rather than undershoot. The alternative reading
 *    (nearest count) would pick a finer rung on half of all ties for
 *    no stated reason.
 * 2. **Where a rung's boundaries sit.** §4.8 gives multiples
 *    (`5s`, `15m`, `3h`, `2d`, `3mo`) without saying what they are
 *    multiples *of*. Stepping from the domain's own start would
 *    produce an axis reading `07:13, 10:13, 13:13`. Instead the
 *    unit's **absolute index** — seconds, minutes, hours, days,
 *    ISO weeks, months or years since the epoch — is snapped down
 *    to a multiple of `every`. Because `every` divides its parent
 *    cycle at every rung the ladder has (60 for seconds and
 *    minutes, 24 for hours, 12 for months), that lands exactly
 *    where a reader expects: `:00 :15 :30 :45`, `00:00 03:00 06:00
 *    …`, January / April / July / October. The one rung with no
 *    parent cycle is `2d`, which therefore alternates on the
 *    absolute day number rather than re-phasing at each month
 *    start — uniform, and it never emits two boundaries a day apart
 *    at a month boundary the way per-month phasing does.
 * 3. **A DST-collapsed boundary is emitted once.** See below.
 *
 * **DST, and the one place §4.8 was genuinely silent.** With
 * `disambiguation: "compatible"` a spring-forward's nonexistent
 * 02:00 moves to 03:00 and **collides** with the next rung: both
 * resolve to one instant. Measured in `America/New_York` on
 * 2026-03-08, a `1h` rung emits the wall clocks `00 01 02 03 04`
 * and the instants `…946000000 …949600000 …953200000 …953200000
 * …956800000`. §4.8 did not say what happens, so it was escalated
 * under D1 and **the user approved de-duplicating by resulting
 * instant, keeping the first** (2026-08-21). The ladder therefore
 * shows a two-hour gap where the wall clock jumped, which is true.
 * It is the same answer step 14's §4.8 CLARIFIED banner already
 * gave symlog's join value `C` — de-duplicate by value, keep one —
 * one rung up. The **fall-back** half needs no de-duplication at
 * all: `compatible` takes the earlier instant of a repeated wall
 * time, so the repeated 01:00 is emitted once and the ladder simply
 * carries a two-hour gap there too.
 *
 * **Wall-clock arithmetic, not exact-instant.** Measured at step 16
 * and recorded in {@link zone}: exact-instant addition never lands
 * on a boundary that does not exist, so §4.8's own
 * nonexistent-boundary sentence would describe nothing, and a `3h`
 * rung across a transition drifts off the wall grid to
 * `00:00 04:00 07:00 10:00 13:00`.
 *
 * **Generation, never accumulation** — `ticks-numeric.ts`'s rule
 * binds here too, in its calendar form. Every boundary is
 * `addUnits(base, k · every, unit, zone)` over an integer index
 * range, so each is re-derived in the zone from one anchor. A
 * `t += 86_400_000` loop is wrong twice a year, and a
 * `t = addUnits(t, 1, …)` loop would re-anchor a collapsed boundary
 * and shift every later rung by an hour.
 *
 * **Every emitted boundary is an exact integer epoch-ms.** Plan
 * rule 1 governs them, and — unlike the band geometry step 15 had
 * to fixture-scope — the exactness here is **universal**, not
 * fixture-dependent: these are integers, so the two-roundings-
 * versus-one problem that makes `f(k) + d === f(k+1)` a
 * fixture-scoped claim over floats cannot arise.
 *
 * **This module is pure.** No DOM, no `getComputedStyle`, no import
 * side effect — `src/hdvl/kernel/` carries that rule as a
 * directory-wide invariant, asserted by grep.
 *
 * @module hdvl/kernel/ticks-calendar
 */

/**
 * One rung of §4.8's ladder.
 *
 * `every` is a count of `unit`, not a unit of its own: `3mo` is
 * `{unit: "month", every: 3}`. That is what lets the *beyond a
 * year* case be the same rung with an `every` the numeric ladder
 * chooses, rather than a nineteenth entry with different code
 * behind it.
 */
export interface CalendarRung {
  /** The calendar unit. */
  unit: CalendarUnit;
  /** The multiple: 1, 2, 3, 5, 6, 12, 15, 30 … */
  every: number;
}

/**
 * §4.8's ladder below a year, coarsest first.
 *
 * Verbatim from §4.8 and read backwards, because the ladder is
 * walked coarsest → finest:
 *
 * ```
 * 1s 5s 15s 30s · 1m 5m 15m 30m · 1h 3h 6h 12h
 * · 1d 2d · 1w (ISO, Monday) · 1mo 3mo · 1y
 * · beyond a year: the numeric ladder over years
 * ```
 *
 * The `1y` rung is **not** in this array — it is generalised to
 * `Ny` by {@link yearEvery}, which is what makes §4.8's last line a
 * rung rather than a special case.
 */
const LADDER: readonly CalendarRung[] = [
  { unit: "month", every: 3 },
  { unit: "month", every: 1 },
  { unit: "week", every: 1 },
  { unit: "day", every: 2 },
  { unit: "day", every: 1 },
  { unit: "hour", every: 12 },
  { unit: "hour", every: 6 },
  { unit: "hour", every: 3 },
  { unit: "hour", every: 1 },
  { unit: "minute", every: 30 },
  { unit: "minute", every: 15 },
  { unit: "minute", every: 5 },
  { unit: "minute", every: 1 },
  { unit: "second", every: 30 },
  { unit: "second", every: 15 },
  { unit: "second", every: 5 },
  { unit: "second", every: 1 },
];

/** The finest rung, used when nothing reaches the target. */
const FINEST: CalendarRung = { unit: "second", every: 1 };

/** 1970-01-01 was a **Thursday**; ISO weeks start on Monday. */
const EPOCH_DOW_OFFSET = 3;

/**
 * Days from the civil date, by Howard Hinnant's `days_from_civil`.
 *
 * Pure integer arithmetic and therefore exact — which is the point:
 * every rung's boundary **count** is decided on wall-clock indices
 * rather than on elapsed milliseconds, so no count in this module
 * depends on how long a day happened to be.
 */
function civilDays(y: number, m: number, d: number): number {
  const shifted = y - (m <= 2 ? 1 : 0);
  const era = Math.floor(shifted / 400);
  const yoe = shifted - era * 400;
  const doy =
    Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe =
    yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/**
 * The absolute index of `epochMs`'s wall clock in `unit`.
 *
 * Boundaries of a rung are the indices divisible by `every`, so
 * this is what both the count and the alignment are computed on.
 */
function unitIndex(
  epochMs: number,
  unit: CalendarUnit,
  zone: string,
): number {
  const f = fieldsOf(epochMs, zone);
  if (unit === "year") {
    return f.year;
  }
  if (unit === "month") {
    return f.year * 12 + (f.month - 1);
  }
  const days = civilDays(f.year, f.month, f.day);
  switch (unit) {
    case "week":
      return Math.floor((days + EPOCH_DOW_OFFSET) / 7);
    case "day":
      return days;
    case "hour":
      return days * 24 + f.hour;
    case "minute":
      return (days * 24 + f.hour) * 60 + f.minute;
    default:
      // `second`. `noImplicitReturns` wants a default here.
      return ((days * 24 + f.hour) * 60 + f.minute) * 60 + f.second;
  }
}

/** `a mod n`, always non-negative — day numbers go negative. */
function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** Whether a domain can carry ticks at all. */
function usable(d0: number, d1: number): boolean {
  return Number.isFinite(d0) && Number.isFinite(d1) && d0 !== d1;
}

/**
 * The tick target, sanitised.
 *
 * `Math.max(1, count)` is **not** enough: `Math.max` propagates
 * `NaN` rather than ignoring it (step 15's T4), so a `NaN` target
 * would survive into every comparison below and make every rung
 * "not a match".
 */
function targetOf(count: number): number {
  return Number.isFinite(count) && count >= 1 ? Math.floor(count) : 1;
}

/**
 * §4.8's *beyond a year*: how many years one rung spans.
 *
 * The multiple comes from `ticks-numeric.ts`'s `tickStep` — R12's
 * one ladder — so a decade axis steps by 10 and a century axis by
 * 100 for exactly the reason a numeric axis does. A step below one
 * year means the year rung was the wrong choice and the caller has
 * already established otherwise, so it clamps to 1.
 */
function yearEvery(
  lo: number,
  hi: number,
  count: number,
  zone: string,
): number {
  const raw = tickStep(
    unitIndex(lo, "year", zone),
    unitIndex(hi, "year", zone),
    count,
  ).step;
  return Number.isFinite(raw) && raw >= 1 ? Math.round(raw) : 1;
}

/** The index of the first rung boundary at or after `lo`. */
function firstIndex(
  lo: number,
  rung: CalendarRung,
  zone: string,
): number {
  const i = unitIndex(lo, rung.unit, zone);
  const onBoundary =
    floorTo(lo, rung.unit, zone) === lo && mod(i, rung.every) === 0;
  return onBoundary
    ? i
    : (Math.floor(i / rung.every) + 1) * rung.every;
}

/** The index of the last rung boundary at or before `hi`. */
function lastIndex(
  hi: number,
  rung: CalendarRung,
  zone: string,
): number {
  const i = unitIndex(hi, rung.unit, zone);
  return Math.floor(i / rung.every) * rung.every;
}

/**
 * How many of `rung`'s boundaries fall inside `[lo, hi]`.
 *
 * Counted on **wall-clock indices**, so it is exact and
 * DST-independent — which is what a rung choice should be. It can
 * exceed the number of instants {@link ticksCalendar} finally emits
 * by one per spring-forward transition inside the domain, because
 * two wall-clock boundaries there denote one instant. That is the
 * de-duplication, and selecting an axis density in wall-clock terms
 * is the right side of it.
 */
function countOf(
  lo: number,
  hi: number,
  rung: CalendarRung,
  zone: string,
): number {
  const from = firstIndex(lo, rung, zone);
  const to = lastIndex(hi, rung, zone);
  return to >= from ? (to - from) / rung.every + 1 : 0;
}

/** The instant of rung-boundary `index`, anchored off `lo`. */
function boundaryAt(
  lo: number,
  index: number,
  rung: CalendarRung,
  zone: string,
): number {
  const base = floorTo(lo, rung.unit, zone);
  const delta = index - unitIndex(base, rung.unit, zone);
  return delta === 0 ? base : addUnits(base, delta, rung.unit, zone);
}

/** `[min, max]`, so every internal step reads one way. */
function order(d0: number, d1: number): [number, number] {
  return d0 <= d1 ? [d0, d1] : [d1, d0];
}

/**
 * §4.8's ladder, coarsest match first.
 *
 * Walks the rungs from coarsest to finest and returns the first
 * whose boundary count is **at least** `count`; if none reaches it,
 * the finest rung. The `1y` rung is tried first and, when it
 * matches, is generalised to `Ny` by the numeric ladder — §4.8's
 * *beyond a year*.
 *
 * @param d0 - One domain endpoint, in epoch milliseconds.
 * @param d1 - The other domain endpoint.
 * @param count - The target tick count. Zero, negative and
 *   non-finite targets are read as 1.
 * @param zone - An IANA zone name; `"UTC"` for a zone-less domain
 *   (§4.2).
 * @returns The chosen rung, or `null` for a degenerate domain
 *   (`d0 === d1`, or either endpoint non-finite), which yields no
 *   ticks rather than throwing.
 */
export function calendarRung(
  d0: number,
  d1: number,
  count: number,
  zone: string,
): CalendarRung | null {
  if (!usable(d0, d1)) {
    return null;
  }
  const [lo, hi] = order(d0, d1);
  const target = targetOf(count);
  const year: CalendarRung = { unit: "year", every: 1 };
  if (countOf(lo, hi, year, zone) >= target) {
    return {
      unit: "year",
      every: yearEvery(lo, hi, target, zone),
    };
  }
  for (const rung of LADDER) {
    if (countOf(lo, hi, rung, zone) >= target) {
      return rung;
    }
  }
  return FINEST;
}

/**
 * §4.8's calendar ticks: every boundary of the chosen rung within
 * `[d0, d1]`, computed in `zone`.
 *
 * Always **ascending**, even for a reversed domain, and always
 * **duplicate-free** — a spring-forward collapses two wall-clock
 * boundaries onto one instant and it is emitted once, keeping the
 * first (approved under D1, 2026-08-21).
 *
 * @param d0 - One domain endpoint, in epoch milliseconds.
 * @param d1 - The other domain endpoint.
 * @param count - The target tick count.
 * @param zone - An IANA zone name.
 * @returns The boundaries, ascending, as exact integer epoch
 *   milliseconds. Empty for a degenerate domain.
 */
export function ticksCalendar(
  d0: number,
  d1: number,
  count: number,
  zone: string,
): number[] {
  const rung = calendarRung(d0, d1, count, zone);
  if (rung === null) {
    return [];
  }
  const [lo, hi] = order(d0, d1);
  const from = firstIndex(lo, rung, zone);
  const to = lastIndex(hi, rung, zone);
  if (to < from) {
    return [];
  }
  const base = boundaryAt(lo, from, rung, zone);
  const steps = (to - from) / rung.every;
  const seen = new Set<number>();
  const out: number[] = [];
  for (let k = 0; k <= steps; k++) {
    const v =
      k === 0
        ? base
        : addUnits(base, k * rung.every, rung.unit, zone);
    if (v < lo || v > hi || seen.has(v)) {
      continue;
    }
    seen.add(v);
    out.push(v);
  }
  return out;
}

/**
 * §4.8's datetime `nice`: round the endpoints **outward** to the
 * chosen rung's boundary.
 *
 * §4.2 step 5 and V15 make it the *caller's* job to decide which
 * endpoints are derived — an authored `min` is never moved. This
 * function takes two numbers and rounds both; the derived-only rule
 * lands with domain resolution at step 18.
 *
 * It may only widen, and it preserves the orientation it was given,
 * exactly as `niceNumeric` does.
 *
 * @param d0 - One domain endpoint, in epoch milliseconds.
 * @param d1 - The other domain endpoint.
 * @param count - The target tick count the rung is chosen for.
 * @param zone - An IANA zone name.
 * @returns The widened endpoints, in the input's orientation.
 *   A degenerate domain is returned unchanged.
 */
export function niceCalendar(
  d0: number,
  d1: number,
  count: number,
  zone: string,
): [number, number] {
  const rung = calendarRung(d0, d1, count, zone);
  if (rung === null) {
    return [d0, d1];
  }
  const [lo, hi] = order(d0, d1);
  const low = boundaryAt(
    lo,
    Math.floor(unitIndex(lo, rung.unit, zone) / rung.every) *
      rung.every,
    rung,
    zone,
  );
  const ceiled = ceilTo(hi, rung.unit, zone);
  const highIndex = unitIndex(ceiled, rung.unit, zone);
  const high = boundaryAt(
    hi,
    Math.ceil(highIndex / rung.every) * rung.every,
    rung,
    zone,
  );
  return d0 <= d1 ? [low, high] : [high, low];
}
