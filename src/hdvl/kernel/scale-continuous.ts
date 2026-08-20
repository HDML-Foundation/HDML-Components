/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The continuous transforms (RFC 016/001 §4.1, §4.5).
 *
 * §4.5 gives four formulae and one projection. This module is all
 * of them, and nothing else — it takes numbers, never an attribute,
 * and it is the whole of what step 18's `Scale` will call when it
 * has to turn a domain value into a range unit.
 *
 * **`sqrt` exists in exactly one place**: {@link continuousSpec}'s
 * argument union. §4.1 resolves it to `pow` with `exponent = 0.5`
 * "at parse time so exactly one code path exists", so after that
 * call there is no `sqrt` and {@link transform} has four branches.
 *
 * **The transforms are total.** `log` of a non-positive value
 * returns what the formula returns — `-Infinity` or `NaN` — and
 * does not throw. §4.5's V2 (a log domain crossing or touching
 * zero) is checked at step 18 **after domain resolution**, from the
 * domain rather than from a value; a kernel that threw would make
 * the validator unable to evaluate the very scale it has to
 * diagnose.
 *
 * **This module is pure.** No DOM, no `getComputedStyle`, no
 * import side effect, and no import at all — `src/hdvl/kernel/`
 * carries that rule as a directory-wide invariant, asserted by
 * grep.
 *
 * @module hdvl/kernel/scale-continuous
 */

/**
 * §4.1's four transform kinds.
 *
 * `sqrt` is **not** one of them — see {@link continuousSpec}.
 */
export type ContinuousType = "linear" | "log" | "pow" | "symlog";

/**
 * A resolved continuous transform.
 *
 * Every field is a **number**: the kernel never sees an attribute,
 * so parsing `type="pow" exponent="2"` off an element is step 18's
 * job and defaulting is {@link continuousSpec}'s.
 */
export interface ContinuousSpec {
  /** The transform kind. */
  type: ContinuousType;
  /** `log` only. §4.5's default is 10. */
  base: number;
  /** `pow` only. Default 1; `sqrt` arrives here as 0.5. */
  exponent: number;
  /** `symlog` only — §4.5's `C`. Default 1. */
  constant: number;
}

/** Options {@link project} understands. */
export interface ProjectOptions {
  /** Pin out-of-domain values to the **range** edge (§4.5). */
  clamp?: boolean;
  /** Reverse the range mapping (§4.2 step 6). */
  reverse?: boolean;
}

/**
 * A signed zero is `===` zero but is neither `Object.is`-equal nor
 * `deepEqual` to it, and serializes to `"-0"` — so one escaping the
 * kernel is a silent cross-engine split (plan rule 9).
 *
 * Two of §4.5's formulae produce one: `Math.sign(-0)` is `-0`, and
 * both `pow` and `symlog` multiply by it.
 */
function num(v: number): number {
  return v === 0 ? 0 : v;
}

/**
 * Builds a {@link ContinuousSpec}, applying §4.5's defaults and
 * resolving `sqrt` → `pow`.
 *
 * This is **the** place `sqrt` disappears. An `exponent` passed
 * alongside `sqrt` is ignored, because §4.1 defines `sqrt` as
 * exponent 0.5 exactly rather than as a default.
 *
 * @param type - The authored kind, `sqrt` included.
 * @param options - Overrides for `base` / `exponent` / `constant`.
 * @returns The resolved spec.
 */
export function continuousSpec(
  type: "linear" | "log" | "pow" | "sqrt" | "symlog",
  options: Partial<Omit<ContinuousSpec, "type">> = {},
): ContinuousSpec {
  const isSqrt = type === "sqrt";
  return {
    type: isSqrt ? "pow" : type,
    base: options.base ?? 10,
    exponent: isSqrt ? 0.5 : options.exponent ?? 1,
    constant: options.constant ?? 1,
  };
}

/**
 * §4.5's `t(v)`.
 *
 * ```
 * linear   t(v) = v
 * log      t(v) = log(v) / log(base)
 * pow      t(v) = sign(v) · |v|^exponent
 * symlog   t(v) = sign(v) · log1p(|v| / C)
 * ```
 *
 * Total by construction — see the module note.
 *
 * @param spec - The resolved transform.
 * @param v - A domain value.
 * @returns The value in transform space.
 */
export function transform(spec: ContinuousSpec, v: number): number {
  switch (spec.type) {
    case "log":
      return num(Math.log(v) / Math.log(spec.base));
    case "pow":
      return num(Math.sign(v) * Math.pow(Math.abs(v), spec.exponent));
    case "symlog":
      return num(
        Math.sign(v) * Math.log1p(Math.abs(v) / spec.constant),
      );
    default:
      return num(v);
  }
}

/**
 * `t⁻¹` — the inverse of {@link transform}.
 *
 * Needed by `nice` on a transformed scale (§4.2 step 5 rounds in
 * the space the ladder ran in, and hands the result back as a
 * domain value) and by step 18's inverse lookups. Sign-preserving
 * wherever its forward twin is.
 *
 * @param spec - The resolved transform.
 * @param t - A value in transform space.
 * @returns The domain value.
 */
export function untransform(spec: ContinuousSpec, t: number): number {
  switch (spec.type) {
    case "log":
      return num(Math.pow(spec.base, t));
    case "pow":
      return num(
        Math.sign(t) * Math.pow(Math.abs(t), 1 / spec.exponent),
      );
    case "symlog":
      return num(
        Math.sign(t) * spec.constant * Math.expm1(Math.abs(t)),
      );
    default:
      return num(t);
  }
}

/**
 * §4.5's `project`, plus `clamp` and `reverse`.
 *
 * ```
 * project(v) = r0 + (r1 − r0)
 *            · (t(v) − t(d0)) / (t(d1) − t(d0))
 * ```
 *
 * **`reverse` reverses the range mapping, never the domain**
 * (§4.2 step 6) — it is implemented as swapping `r0` and `r1`, and
 * `clamp` then pins to the *reversed* edges, because `clamp` is
 * about the range and the range is what moved.
 *
 * A **degenerate** domain — one where `t(d1) === t(d0)`, which
 * covers `[5, 5]` and a `log` domain of `[0, 0]` alike — maps every
 * value to `r0`. Never `NaN`, never `Infinity`: a scale whose
 * domain has not spread yet must still place a mark somewhere.
 *
 * @param spec - The resolved transform.
 * @param domain - `[d0, d1]` in value space.
 * @param range - `[r0, r1]` in the channel's range unit.
 * @param v - The value to project.
 * @param options - `clamp` and `reverse`.
 * @returns The projected value, in the range unit.
 */
export function project(
  spec: ContinuousSpec,
  domain: readonly [number, number],
  range: readonly [number, number],
  v: number,
  options: ProjectOptions = {},
): number {
  const r0 = options.reverse ? range[1] : range[0];
  const r1 = options.reverse ? range[0] : range[1];
  const t0 = transform(spec, domain[0]);
  const t1 = transform(spec, domain[1]);
  if (t1 === t0) {
    return num(r0);
  }
  const at = r0 + (r1 - r0) * ((transform(spec, v) - t0) / (t1 - t0));
  if (!options.clamp) {
    return num(at);
  }
  const lo = Math.min(r0, r1);
  const hi = Math.max(r0, r1);
  return num(Math.min(Math.max(at, lo), hi));
}
