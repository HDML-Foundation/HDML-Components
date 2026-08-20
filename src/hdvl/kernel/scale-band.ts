/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The band formula and ordinal thinning (RFC 016/001 §4.4, §4.8).
 *
 * §4.4 is normative and {@link bandOf} is its whole
 * implementation. Three things about it are load-bearing and are
 * the three a later reader is most likely to "simplify" away.
 *
 * 1. **The denominator is `n − 1 + b`, not `n`.** At the initial
 *    `--hdml-bandwidth: 0.8` and four categories it is 3.8, not 4 —
 *    a 5 % difference in every position on the axis. The `n` form
 *    would put the first and last band's *centres* half a band in
 *    from the range edges; this form puts the first band's low edge
 *    exactly on `r0` and the last band's high edge exactly on `r1`,
 *    which is what makes 07's line vertices sit on its bars'
 *    centrelines at any bandwidth. It is deliberately **not** the
 *    `paddingInner`/`paddingOuter` padding model the mainstream
 *    charting libraries register; R3's decision entry in
 *    `docs/decisions.md` records why we do not take theirs.
 * 2. **`centre` is what every non-band-filling lookup resolves
 *    to** — line vertices, points, rules, ranged endpoints naming a
 *    category, and tick / label / grid positions alike (§4.4).
 *    Nothing ever resolves to a band edge. At `b = 0` the centre
 *    *is* the boundary, which is why {@link Band} returns all three
 *    fields rather than the one a given caller needs.
 * 3. **`b` is an ordinary parameter with no special case.** §6.4's
 *    cluster subdivides an outer band edge-to-edge at inner `b = 1`
 *    — "there is no authorable inner gap" (R19) — so the cluster is
 *    this formula at `b = 1` rather than a second entry point. The
 *    only branch in here is §4.4's own `n = 1, b = 0`, which the
 *    general formula cannot express because its denominator is
 *    zero.
 *
 * **`start` is the LOW edge and `width` is never negative.** §4.3
 * gives `y` a bottom → top range, which is *descending* in §2.7's
 * y-down view coordinates, so a range may run either way and the
 * convention has to be stated. `{start, width}` is therefore always
 * the interval `[start, start + width]`: exactly what an SVG rect
 * wants, so no consumer can forget to normalise a negative extent
 * and silently drop a bar. `centre` is the same number under either
 * convention — it is `origin + dir · width / 2` — which is another
 * reason everything downstream reads it.
 *
 * **The edge-to-edge identity is exact only where the arithmetic
 * is.** At `b = 1`, `bandOf(k+1).start === bandOf(k).start +
 * bandOf(k).width` compares two roundings (`fl(k · step) + step`)
 * against one (`fl((k+1) · step)`), so IEEE-754 does not guarantee
 * it. Measured over 1 495 `(W, n, r0)` configurations: it holds
 * bit-for-bit in 32 % of them and the worst seam anywhere in the
 * sweep is **2.3 × 10⁻¹³ px** — seven orders below the six-decimal
 * quantization every scene assertion goes through, eleven below a
 * device pixel. §4.4's `width_k = b · step` is kept verbatim
 * (a per-`k` difference of slot edges would close every seam but
 * make the width of two bars in one chart differ by an ulp, which
 * is the more surprising of the two). *(Decided 2026-08-20, with
 * the user, at step 15.)*
 *
 * **This module is pure.** No DOM, no `getComputedStyle`, no
 * import side effect, and no import at all — `src/hdvl/kernel/`
 * carries that rule as a directory-wide invariant, asserted by
 * grep.
 *
 * @module hdvl/kernel/scale-band
 */

/**
 * §4.4's band, in the channel's range units.
 *
 * All three fields land together because seven later steps read
 * different ones: a bar spans `start`..`start + width`, a cluster
 * subdivides `start` by `width / n`, and everything else — every
 * line vertex, point, rule, ranged endpoint and tick — reads
 * `centre`.
 */
export interface Band {
  /** The band's **low** edge, whichever way the range runs. */
  start: number;
  /** `b · step`, and never negative. Zero when `b` is zero. */
  width: number;
  /**
   * `start + width / 2` — **what every non-band-filling lookup
   * resolves to** (§4.4). At `b = 0` it is the boundary itself.
   */
  centre: number;
}

/**
 * §4.8's ordinal thinning spec, already resolved.
 *
 * The three members are mutually exclusive (V16), but that is a
 * **validator** rule and it lands at step 24. This type is what a
 * resolved guide spec looks like, so it has to be able to hold any
 * of them; {@link thinOrdinal} states the precedence it applies if
 * more than one arrives anyway.
 */
export interface OrdinalThinning {
  /** Keep every `⌈N / count⌉`-th value, from index 0. */
  count?: number;
  /** Keep every *step*-th value, from index 0. */
  step?: number;
  /** Keep exactly these, in the order given. */
  values?: readonly string[];
}

/**
 * A signed zero is `===` zero but is neither `Object.is`-equal nor
 * `deepEqual` to it, and serializes to `"-0"` (plan rule 9).
 *
 * Under the low-edge convention above, no reachable band input
 * produces one — that is a *consequence* of the convention, and
 * the measured reason it was chosen over a signed width, which
 * returns `-0` for `width` at every `b = 0` on a descending range.
 * The one case that survives is the `n = 1, b = 0` midpoint of a
 * range whose endpoints are both `-0`. Every returned number goes
 * through here regardless, so the guarantee does not depend on
 * that analysis staying true.
 */
function num(v: number): number {
  return v === 0 ? 0 : v;
}

/**
 * §4.4's band geometry for slot `k` of `n`.
 *
 * ```
 * step     = W / (n − 1 + b)          W = |r1 − r0|
 * start_k  = k · step                 from the range's own r0
 * width_k  = b · step
 * centre_k = start_k + width_k / 2
 * n = 1 and b = 0 → the range midpoint
 * ```
 *
 * At `n = 1` the formula gives `width = b · W / b = W` for **any**
 * `b > 0`, so a lone category always fills the range; `b = 0` is
 * the `0 / 0` that §4.4's last line exists to answer.
 *
 * Total, and diagnoses nothing: a `k` outside `[0, n)`, an `n`
 * below 1 and a non-finite range all return `null`. §4.7's
 * out-of-domain notice is the **caller's** (steps 20–22, through
 * the validator), exactly as `transform`'s totality is
 * `transform`'s.
 *
 * @param k - The slot index, `0 ≤ k < n`.
 * @param n - The number of domain values.
 * @param range - `[r0, r1]`, ascending or descending.
 * @param bandwidth - `--hdml-bandwidth`, already resolved to a
 * number in `[0, 1]`. The kernel never reads a CSS value.
 * @returns The band, or `null` if there is no such band.
 */
export function bandOf(
  k: number,
  n: number,
  range: readonly [number, number],
  bandwidth: number,
): Band | null {
  const r0 = range[0];
  const r1 = range[1];
  if (!(n >= 1) || k < 0 || k >= n) {
    return null;
  }
  if (!Number.isFinite(r0) || !Number.isFinite(r1)) {
    return null;
  }
  if (n === 1 && bandwidth === 0) {
    const mid = num((r0 + r1) / 2);
    return { start: mid, width: 0, centre: mid };
  }
  const step = Math.abs(r1 - r0) / (n - 1 + bandwidth);
  const width = bandwidth * step;
  const ascending = r1 >= r0;
  const origin = ascending ? r0 + k * step : r0 - k * step;
  const start = ascending ? origin : origin - width;
  return {
    start: num(start),
    width: num(width),
    centre: num(start + width / 2),
  };
}

/**
 * {@link bandOf}, addressed by domain **value** rather than index.
 *
 * This is the shape step 18's `Scale.bandOf(v)` hands out, so the
 * value → index mapping has exactly one implementation (R12).
 *
 * @param value - The domain value.
 * @param domain - The resolved ordinal domain, in order.
 * @param range - `[r0, r1]`, ascending or descending.
 * @param bandwidth - `--hdml-bandwidth`, already resolved.
 * @returns The band, or `null` when the value is not in the domain
 * — §4.7's "produces no mark", reported honestly rather than
 * diagnosed here.
 */
export function bandOfValue(
  value: string,
  domain: readonly string[],
  range: readonly [number, number],
  bandwidth: number,
): Band | null {
  const k = domain.indexOf(value);
  return k < 0 ? null : bandOf(k, domain.length, range, bandwidth);
}

/**
 * A stride is a positive integer index step.
 *
 * Anything else — `0`, a negative, a fraction, `NaN`, `Infinity` —
 * falls back to **1**, which is what an absent spec means. The
 * alternative, an empty result, would silently blank an axis for
 * `step="0"`; §4.8's own numeric ladder guards the same way with
 * `max(1, count)`.
 */
function strideOf(raw: number): number {
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
}

/**
 * §4.8's ordinal thinning.
 *
 * ```
 * count  ⇒ every ⌈N / count⌉-th, starting at index 0
 * step   ⇒ every step-th, starting at index 0
 * values ⇒ exactly those, in the order given, silently
 *          dropping any not in the domain
 * ```
 *
 * **`count` is a target, never a promise** — the same rule §4.8
 * opens with for the numeric ladder. `N = 12, count = 5` gives a
 * stride of `⌈12 / 5⌉ = 3` and therefore **four** values, not
 * five: a round stride wins over an exact count.
 *
 * **Index 0 is always kept** when a stride applies. That is what
 * anchors an axis's first tick to the first category rather than
 * letting the ladder drift with `N`.
 *
 * `values` is honoured **literally**: an order that differs from
 * the domain's is the author's statement and is not sorted, and a
 * value listed twice is emitted twice. Only membership is checked.
 *
 * Mutual exclusion is V16's, at step 24 — this applies a resolved
 * spec and diagnoses nothing. If more than one member arrives
 * anyway the precedence is `values`, then `step`, then `count`,
 * stated so it is deterministic rather than incidental.
 *
 * @param domain - The resolved ordinal domain, in order.
 * @param spec - The resolved thinning spec. An empty one returns
 * the whole domain, because `hdml-axis` takes no spec at all
 * (§6.5).
 * @returns The kept values, in order.
 */
export function thinOrdinal(
  domain: readonly string[],
  spec: OrdinalThinning,
): string[] {
  if (spec.values !== undefined) {
    return spec.values.filter((v) => domain.includes(v));
  }
  const stride =
    spec.step !== undefined
      ? strideOf(spec.step)
      : spec.count !== undefined
      ? strideOf(Math.ceil(domain.length / Math.max(1, spec.count)))
      : 1;
  const kept: string[] = [];
  for (let i = 0; i < domain.length; i += stride) {
    kept.push(domain[i]);
  }
  return kept;
}
