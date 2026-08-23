/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The eight curve values (RFC 016/001 §6.2, §9.1, §9.4, R3, R12).
 *
 * `--hdml-curve-type` is a closed enum and each value reads exactly
 * **one** already-resolved parameter. This module is the single
 * implementation of all eight (R12): `hdml-line` and `hdml-area`
 * call it, `closed` radar lines call it, and a stack's shared edges
 * call it — none of them re-derives a control point.
 *
 * **This module is pure.** No DOM, no `getComputedStyle`, no import
 * side effect, and it never reads a CSS value: a caller resolves
 * each parameter to a number or a plain string first, exactly as
 * `scale.ts` resolves `bandOf`'s bandwidth. It also works in
 * **range space** — the points it is handed are already projected,
 * so it knows nothing of a plane, a scale or a projection.
 *
 * **`linear` and `step` emit `line` segments; the other six emit
 * `cubic`.** `Segment` carries two kinds precisely so the *initial
 * value* of `--hdml-curve-type` does not triple the payload of the
 * most common path in the corpus — step-plan S2 / E3, and RFC §6.2's
 * `linear` row was corrected to match §2.5 at step 10.
 *
 * **A gap is a subpath boundary, and every run is curved
 * independently.** The input is a list of *runs*, not one flat list
 * with a sentinel: what "missing" means is data-space knowledge the
 * mark has (a `Delivery`'s nulls, plus a non-finite check) and the
 * kernel must not encode. Splitting first is also the only reading
 * that satisfies §4.7's *"never bridged by interpolation"* —
 * `natural`'s tridiagonal solve is global over its run, so a bridged
 * gap would bend the whole curve around data that is not there.
 *
 * **Hand-written rather than taken from a shape library, and three
 * of the eight are the reason** (§9.4, R3):
 *
 * - `--hdml-curve-cubic-monotonicity` is a `<number>` 0..1 — a
 *   *blend* between the Catmull–Rom tangent and the Fritsch–Carlson
 *   limited one — where d3 ships an **axis switch**
 *   (`curveMonotoneX` / `curveMonotoneY`) and no parameter at all.
 * - `--hdml-curve-basis-beta` maps to `curveBundle`, which is
 *   **open-curve only**, while SPEC allows curves on `hdml-area` and
 *   on `closed` radar lines. Here β is an ordinary argument to a
 *   pure function over a run, so nothing forbids either.
 * - `--hdml-curve-bezier-tangents` has an **"auto" initial** — the
 *   dominant axis is chosen per *segment* — where `curveBumpX` /
 *   `curveBumpY` are axis-fixed for the whole path.
 *
 * **Whose computed style supplied the parameters is not this
 * module's question.** §6.2's last paragraph makes a child of
 * `hdml-stack` read its curve properties from the **stack** (band
 * k's top is band k+1's baseline, so per-child curves would tear the
 * shared edges, and a child's own curve properties are inert). That
 * is a resolution rule, and it belongs to `container-stack.ts`.
 *
 * @module hdvl/kernel/curves
 */

import type { Point, Segment, Subpath } from "../scene";

/** §6.2's eight values, in the order the registry lists them. */
export const CURVE_TYPES = [
  "linear",
  "natural",
  "basis",
  "bezier",
  "cardinal",
  "catmull-rom",
  "monotone",
  "step",
] as const;

/** The resolved value of `--hdml-curve-type`. */
export type CurveType = (typeof CURVE_TYPES)[number];

/**
 * The already-resolved curve parameters, one per value. Every member
 * is optional and falls back to the registered initial value, so a
 * caller passes only what its curve type reads.
 */
export interface CurveOptions {
  /** `--hdml-curve-basis-beta`, 0..1. Initial `1`. */
  basisBeta?: number;
  /**
   * `--hdml-curve-bezier-tangents`. Initial is **omitted** — the
   * empty "auto" sentinel — and the property registers with syntax
   * `*`, so the UA validates nothing: any value that is not
   * `horizontal` or `vertical` is auto.
   */
  bezierTangents?: string;
  /** `--hdml-curve-cardinal-tension`, 0..1. Initial `0`. */
  cardinalTension?: number;
  /** `--hdml-curve-catmull-rom-alpha`, 0..1. Initial `0.5`. */
  catmullRomAlpha?: number;
  /** `--hdml-curve-cubic-monotonicity`, 0..1. Initial `1`. */
  monotonicity?: number;
  /** `--hdml-curve-step-change`. Initial `middle`. */
  stepChange?: string;
}

/** A tangent, which is a vector and not a position. */
interface Vec {
  x: number;
  y: number;
}

/**
 * A signed zero is `===` zero but is neither `Object.is`-equal nor
 * `deepEqual` to it, and serializes to `"-0"` (plan rule 9).
 *
 * **Measured, and the answer is "propagator, not producer".** Swept
 * over all eight values × eighteen parameter settings × ten
 * fixtures (descending runs, runs through the origin, coincident
 * points, zero-length intervals, flats at zero): with the
 * normalisation removed, a `-0`-free input yields **zero** signed
 * zeros. Internal ones do arise — `cardinal` at tension 1 computes
 * `0 * -d` — but never escape, because `p + -0` is `p` and
 * `x - x` is `+0`.
 *
 * The one live route is a `-0` **arriving**, which `linear` and
 * `step` copy straight through and `bezier` carries into `c1`.
 * Upstream normalises at its own source, so it should not; this is
 * the last stop before the scene and the cost is one comparison.
 */
function num(v: number): number {
  return v === 0 ? 0 : v;
}

/** The one constructor for an emitted coordinate pair. */
function pt(x: number, y: number): Point {
  return { x: num(x), y: num(y) };
}

/**
 * Turns a list of runs into subpaths.
 *
 * Each run is curved **on its own**: the boundary between two runs
 * is §4.7's gap, and no segment ever crosses it. A run shorter than
 * two points is **dropped** — it has no segment on any of the eight
 * values, and a zero-segment subpath would put a pen-down that
 * strokes nothing into every scene and force each consumer (the
 * renderer's diff, `hdml-area`'s forward/reversed edge assembly) to
 * special-case it.
 *
 * @param runs - Runs of points in view coordinates.
 * @param type - The resolved `--hdml-curve-type`.
 * @param options - The already-resolved curve parameters.
 * @returns One subpath per run of two or more points.
 */
export function curve(
  runs: readonly (readonly Point[])[],
  type: CurveType,
  options: CurveOptions = {},
): Subpath[] {
  const out: Subpath[] = [];
  for (const run of runs) {
    if (run.length < 2) {
      continue;
    }
    out.push(subpathOf(run, type, options));
  }
  return out;
}

/** Curves one run. */
function subpathOf(
  run: readonly Point[],
  type: CurveType,
  o: CurveOptions,
): Subpath {
  const start = pt(run[0].x, run[0].y);
  switch (type) {
    case "linear":
      return { start, segments: linearSegments(run) };
    case "step":
      return { start, segments: stepSegments(run, o.stepChange) };
    case "basis":
      return basisSubpath(run, o.basisBeta ?? 1);
    case "bezier":
      return {
        start,
        segments: bezierSegments(run, o.bezierTangents ?? ""),
      };
    case "natural":
      return { start, segments: naturalSegments(run) };
    case "cardinal":
      return {
        start,
        segments: uniform(run, cardinal(run, o.cardinalTension ?? 0)),
      };
    case "monotone":
      return {
        start,
        segments: uniform(run, monotone(run, o.monotonicity ?? 1)),
      };
    case "catmull-rom":
      return {
        start,
        segments: catmullRom(run, o.catmullRomAlpha ?? 0.5),
      };
  }
}

/* -------------------------------------------------------------- */
/* linear and step — the two that emit `line`                      */
/* -------------------------------------------------------------- */

/** One segment per interval, `to` the input point verbatim. */
function linearSegments(run: readonly Point[]): Segment[] {
  const out: Segment[] = [];
  for (let i = 1; i < run.length; i++) {
    out.push({ k: "line", to: pt(run[i].x, run[i].y) });
  }
  return out;
}

/**
 * `start` / `middle` / `end` name **where the riser sits**: at the
 * interval's own x, at its midpoint, or at the next point's x. The
 * midpoint form therefore emits three segments per interval and the
 * other two emit two — a step function cannot express an interval in
 * one segment, so this is the one value where a two-point run is not
 * a single segment.
 */
function stepSegments(
  run: readonly Point[],
  change: string | undefined,
): Segment[] {
  const mode =
    change === "start" || change === "end" ? change : "middle";
  const out: Segment[] = [];
  for (let i = 0; i + 1 < run.length; i++) {
    const a = run[i];
    const b = run[i + 1];
    if (mode === "start") {
      out.push({ k: "line", to: pt(a.x, b.y) });
    } else if (mode === "end") {
      out.push({ k: "line", to: pt(b.x, a.y) });
    } else {
      const m = (a.x + b.x) / 2;
      out.push({ k: "line", to: pt(m, a.y) });
      out.push({ k: "line", to: pt(m, b.y) });
    }
    out.push({ k: "line", to: pt(b.x, b.y) });
  }
  return out;
}

/* -------------------------------------------------------------- */
/* the tangent-based cubics                                        */
/* -------------------------------------------------------------- */

/** One cubic per interval, from per-point tangents. */
function hermite(
  run: readonly Point[],
  m: readonly Vec[],
  h: readonly number[],
): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i + 1 < run.length; i++) {
    const a = run[i];
    const b = run[i + 1];
    const s = h[i];
    out.push({
      k: "cubic",
      c1: pt(a.x + (m[i].x * s) / 3, a.y + (m[i].y * s) / 3),
      c2: pt(b.x - (m[i + 1].x * s) / 3, b.y - (m[i + 1].y * s) / 3),
      to: pt(b.x, b.y),
    });
  }
  return out;
}

/** `hermite` with a knot spacing of 1 on every interval. */
function uniform(
  run: readonly Point[],
  m: readonly Vec[],
): Segment[] {
  return hermite(run, m, new Array<number>(run.length - 1).fill(1));
}

/**
 * Catmull–Rom tangents scaled by (1 − tension). At tension 1 every
 * tangent is the zero vector, so each control point lands **exactly**
 * on its own endpoint and the result is visually a straight line; at
 * tension 0 it is uniform Catmull–Rom.
 *
 * The end conditions duplicate the run's own first and last point,
 * so nothing reads past the run.
 */
function cardinal(run: readonly Point[], tension: number): Vec[] {
  const k = 1 - tension;
  const n = run.length;
  const out: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const p = run[i > 0 ? i - 1 : 0];
    const q = run[i + 1 < n ? i + 1 : n - 1];
    out.push({
      x: (k * (q.x - p.x)) / 2,
      y: (k * (q.y - p.y)) / 2,
    });
  }
  return out;
}

/**
 * Fritsch–Carlson limiting, applied **per component** rather than
 * along a chosen axis: the interpolant is made monotone in x and in
 * y at once, which is what lets the parameter be a number instead of
 * the axis switch §9.4 rejects.
 *
 * The unlimited tangent is the uniform Catmull–Rom one — the mean of
 * the two neighbouring secants — so the limited tangent is that
 * tangent clamped, and the blend between them is a straight lerp.
 */
function limited(run: readonly Point[], key: "x" | "y"): number[] {
  const n = run.length;
  const s: number[] = [];
  for (let i = 0; i + 1 < n; i++) {
    s.push(run[i + 1][key] - run[i][key]);
  }
  const out = new Array<number>(n).fill(0);
  out[0] = s[0];
  out[n - 1] = s[n - 2];
  for (let i = 1; i + 1 < n; i++) {
    const a = s[i - 1];
    const b = s[i];
    if (a === 0 || b === 0 || a > 0 !== b > 0) {
      out[i] = 0;
      continue;
    }
    const t = (a + b) / 2;
    const cap = 3 * Math.min(Math.abs(a), Math.abs(b));
    out[i] = t > 0 ? Math.min(t, cap) : Math.max(t, -cap);
  }
  return out;
}

/** `t = lerp(tCatmullRom, tLimited, m)` — §6.2, verbatim. */
function monotone(run: readonly Point[], m: number): Vec[] {
  const cr = cardinal(run, 0);
  const lx = limited(run, "x");
  const ly = limited(run, "y");
  return cr.map((t, i) => ({
    x: t.x + m * (lx[i] - t.x),
    y: t.y + m * (ly[i] - t.y),
  }));
}

/* -------------------------------------------------------------- */
/* catmull-rom — the non-uniform one                               */
/* -------------------------------------------------------------- */

/**
 * The knot spacing between two points, `‖q − p‖ ^ α`. α = 0 is
 * uniform, 0.5 centripetal (the initial) and 1 chordal.
 *
 * `Math.pow(0, 0)` is 1, which is what makes α = 0 agree with
 * `cardinal` at tension 0 through the duplicated end points rather
 * than needing a second end condition.
 */
function knot(p: Point, q: Point, alpha: number): number {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  return Math.pow(dx * dx + dy * dy, alpha / 2);
}

/**
 * Barry–Goldman tangents over the α-parameterised knots, scaled per
 * segment by that segment's own spacing.
 *
 * A zero spacing — a duplicated end point at α > 0, or two
 * coincident rows — falls back to the one-sided difference, and to
 * the zero vector when both sides are degenerate. Nothing divides by
 * zero and nothing reads past the run.
 */
function catmullRom(run: readonly Point[], alpha: number): Segment[] {
  const n = run.length;
  const h: number[] = [];
  for (let i = 0; i + 1 < n; i++) {
    h.push(knot(run[i], run[i + 1], alpha));
  }
  const m: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const p = run[i > 0 ? i - 1 : 0];
    const q = run[i];
    const r = run[i + 1 < n ? i + 1 : n - 1];
    const a = i > 0 ? h[i - 1] : knot(q, p, alpha);
    const b = i + 1 < n ? h[i] : knot(q, r, alpha);
    m.push({
      x: tangent(p.x, q.x, r.x, a, b),
      y: tangent(p.y, q.y, r.y, a, b),
    });
  }
  return hermite(run, m, h);
}

/** One component of a Barry–Goldman tangent. */
function tangent(
  p: number,
  q: number,
  r: number,
  a: number,
  b: number,
): number {
  if (a === 0) {
    return b === 0 ? 0 : (r - q) / b;
  }
  if (b === 0) {
    return (q - p) / a;
  }
  return (q - p) / a - (r - p) / (a + b) + (r - q) / b;
}

/* -------------------------------------------------------------- */
/* natural — the tridiagonal solve                                 */
/* -------------------------------------------------------------- */

/**
 * The natural cubic spline's second derivatives, with M₀ and
 * M(n−1) pinned to zero — that pin **is** §6.2's *"zero second
 * derivative at both ends"*, and it is why the first segment
 * satisfies `c2 − 2·c1 + start = 0` and the last
 * `to − 2·c2 + c1 = 0`.
 *
 * The interior system is `M(i−1) + 4·M(i) + M(i+1) =
 * 6·(v(i−1) − 2·v(i) + v(i+1))`, solved by the Thomas algorithm over
 * the n − 2 unknowns. A run of two points has no unknown at all, so
 * both derivatives are zero and the segment is the chord.
 */
function second(v: readonly number[]): number[] {
  const n = v.length;
  const out = new Array<number>(n).fill(0);
  const k = n - 2;
  if (k < 1) {
    return out;
  }
  const b = new Array<number>(k).fill(4);
  const r: number[] = [];
  for (let i = 0; i < k; i++) {
    r.push(6 * (v[i] - 2 * v[i + 1] + v[i + 2]));
  }
  for (let i = 1; i < k; i++) {
    const f = 1 / b[i - 1];
    b[i] -= f;
    r[i] -= f * r[i - 1];
  }
  for (let i = k - 1; i >= 0; i--) {
    out[i + 1] = (r[i] - out[i + 2]) / b[i];
  }
  return out;
}

/** One cubic per interval, from the splined second derivatives. */
function naturalSegments(run: readonly Point[]): Segment[] {
  const mx = second(run.map((p) => p.x));
  const my = second(run.map((p) => p.y));
  const out: Segment[] = [];
  for (let i = 0; i + 1 < run.length; i++) {
    const a = run[i];
    const b = run[i + 1];
    out.push({
      k: "cubic",
      c1: pt(
        a.x + enter(b.x - a.x, mx[i], mx[i + 1]) / 3,
        a.y + enter(b.y - a.y, my[i], my[i + 1]) / 3,
      ),
      c2: pt(
        b.x - leave(b.x - a.x, mx[i], mx[i + 1]) / 3,
        b.y - leave(b.y - a.y, my[i], my[i + 1]) / 3,
      ),
      to: pt(b.x, b.y),
    });
  }
  return out;
}

/** The interval's tangent at its first point. */
function enter(d: number, ma: number, mb: number): number {
  return d - (2 * ma + mb) / 6;
}

/** The interval's tangent at its second point. */
function leave(d: number, ma: number, mb: number): number {
  return d + (ma + 2 * mb) / 6;
}

/* -------------------------------------------------------------- */
/* basis — the β-blended uniform B-spline                          */
/* -------------------------------------------------------------- */

/**
 * Blends every point toward the run's chord by (1 − β). At β = 1 the
 * points are returned unchanged and the curve is the pure B-spline;
 * at β = 0 every control point lands **on** the chord, so the curve
 * is the straight line from the first point to the last.
 */
function toChord(run: readonly Point[], beta: number): Point[] {
  const n = run.length;
  const a = run[0];
  const z = run[n - 1];
  const w = 1 - beta;
  return run.map((p, i) => {
    const t = i / (n - 1);
    return {
      x: beta * p.x + w * (a.x + t * (z.x - a.x)),
      y: beta * p.y + w * (a.y + t * (z.y - a.y)),
    };
  });
}

/**
 * A uniform cubic B-spline over the blended control points, clamped
 * at both ends by a triple knot — which is what makes the path start
 * on the first point and finish on the last, as a chart requires and
 * an unclamped B-spline does not.
 *
 * A run of n ≥ 3 points therefore yields **n + 1** cubics, two of
 * them the collapsed end pieces. A run of two points reduces to the
 * chord and is emitted as the single cubic it is.
 *
 * The two clamped endpoints are emitted directly rather than through
 * the `(a + 4b + c) / 6` join, which is exact only in real
 * arithmetic: a line whose last point misses its own datum by an ulp
 * is a seam no one should have to explain.
 */
function basisSubpath(run: readonly Point[], beta: number): Subpath {
  const q = toChord(run, beta);
  const n = q.length;
  const start = pt(q[0].x, q[0].y);
  if (n === 2) {
    const dx = q[1].x - q[0].x;
    const dy = q[1].y - q[0].y;
    return {
      start,
      segments: [
        {
          k: "cubic",
          c1: pt(q[0].x + dx / 3, q[0].y + dy / 3),
          c2: pt(q[1].x - dx / 3, q[1].y - dy / 3),
          to: pt(q[1].x, q[1].y),
        },
      ],
    };
  }
  const pad = [q[0], q[0], ...q, q[n - 1], q[n - 1]];
  const out: Segment[] = [];
  const last = pad.length - 4;
  for (let j = 0; j <= last; j++) {
    const a = pad[j + 1];
    const b = pad[j + 2];
    const c = pad[j + 3];
    out.push({
      k: "cubic",
      c1: pt((2 * a.x + b.x) / 3, (2 * a.y + b.y) / 3),
      c2: pt((a.x + 2 * b.x) / 3, (a.y + 2 * b.y) / 3),
      to:
        j === last
          ? pt(q[n - 1].x, q[n - 1].y)
          : pt((a.x + 4 * b.x + c.x) / 6, (a.y + 4 * b.y + c.y) / 6),
    });
  }
  return { start, segments: out };
}

/* -------------------------------------------------------------- */
/* bezier — the per-segment dominant axis                          */
/* -------------------------------------------------------------- */

/**
 * Tangents along one axis, chosen **per segment** when the value is
 * the empty "auto" sentinel: whichever of |dx| and |dy| is larger,
 * with a tie going to horizontal. `horizontal` and `vertical` force
 * it for the whole run.
 *
 * The property registers with syntax `*`, so the UA validates
 * nothing and any other string is auto.
 */
function bezierSegments(
  run: readonly Point[],
  tangents: string,
): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i + 1 < run.length; i++) {
    const a = run[i];
    const b = run[i + 1];
    let mode = tangents;
    if (mode !== "horizontal" && mode !== "vertical") {
      mode =
        Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)
          ? "horizontal"
          : "vertical";
    }
    if (mode === "horizontal") {
      const m = (a.x + b.x) / 2;
      out.push({
        k: "cubic",
        c1: pt(m, a.y),
        c2: pt(m, b.y),
        to: pt(b.x, b.y),
      });
    } else {
      const m = (a.y + b.y) / 2;
      out.push({
        k: "cubic",
        c1: pt(a.x, m),
        c2: pt(b.x, m),
        to: pt(b.x, b.y),
      });
    }
  }
  return out;
}
