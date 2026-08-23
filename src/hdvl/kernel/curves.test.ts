/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import { Point, Segment, Subpath } from "../scene";
import { HDVL_PROPERTIES } from "../properties";
import { CURVE_TYPES, CurveType, curve } from "./curves";

/**
 * RFC §6.2 — the eight curve values, each reading exactly its own
 * parameter, as `points → Subpath[]`.
 *
 * A pure fixture table: no DOM, no computed style, no element, and
 * no consumer — nothing calls this module until step 20, so its
 * coverage comes from here and nowhere else.
 *
 * **Which rule binds where.** `linear`, `step` and `bezier` are
 * rational arithmetic on exactly-representable fixture points and
 * are asserted **exactly** (plan rule 1). `natural`, `basis`,
 * `cardinal`, `catmull-rom` and `monotone` go through a divide chain
 * or a power and are asserted with `closeTo(…, 1e-9)` (rule 2).
 * Getting that backwards is the fastest way to a one-engine red.
 */

const P = (x: number, y: number): Point => ({ x, y });

/** The workhorse run: four points, exactly representable. */
const RUN: readonly Point[] = [
  P(0, 0),
  P(10, 20),
  P(20, 10),
  P(30, 30),
];

/** A second run, used as the far side of a gap. */
const AWAY: readonly Point[] = [P(50, 0), P(60, 5), P(70, 1)];

/** Dominant axis differs between the two segments. */
const BUMP: readonly Point[] = [P(0, 0), P(100, 10), P(110, 110)];

/** Unequal spacing, so α is observable. */
const SPACED: readonly Point[] = [
  P(0, 0),
  P(1, 10),
  P(21, 12),
  P(23, 0),
];

/** A flat then a rise — the classic Catmull–Rom overshoot. */
const FLAT: readonly Point[] = [P(0, 0), P(1, 0), P(2, 10)];

const CUBICS: readonly CurveType[] = [
  "natural",
  "basis",
  "bezier",
  "cardinal",
  "catmull-rom",
  "monotone",
];

function only(list: readonly Subpath[]): Subpath {
  assert.lengthOf(list, 1);
  return list[0];
}

function lineTos(segments: readonly Segment[]): number[][] {
  return segments.map((s) => {
    assert.strictEqual(s.k, "line");
    const to = (<Extract<Segment, { k: "line" }>>s).to;
    return [to.x, to.y];
  });
}

/** Chai's assert interface has no `notCloseTo`. */
function apart(a: number, b: number, gap: number): void {
  assert.isAbove(Math.abs(a - b), gap);
}

type Cubic = Extract<Segment, { k: "cubic" }>;

function cubics(segments: readonly Segment[]): Cubic[] {
  return segments.map((s) => {
    assert.strictEqual(s.k, "cubic");
    return <Cubic>s;
  });
}

function near(a: Point, x: number, y: number): void {
  assert.closeTo(a.x, x, 1e-9);
  assert.closeTo(a.y, y, 1e-9);
}

suite("hdvl/kernel/curves — the eight values", () => {
  test("every value curves a run", () => {
    for (const t of CURVE_TYPES) {
      const sp = only(curve([RUN], t));
      assert.deepEqual(sp.start, P(0, 0));
      assert.isAtLeast(sp.segments.length, 3);
    }
    assert.lengthOf(CURVE_TYPES, 8);
  });

  test("the eight match the registered enum", () => {
    const def = HDVL_PROPERTIES.find(
      (p) => p.name === "--hdml-curve-type",
    );
    assert.isDefined(def);
    const listed = String(def?.syntax)
      .split("|")
      .map((s) => s.trim());
    assert.deepEqual(listed, [...CURVE_TYPES]);
    assert.strictEqual(def?.initialValue, "linear");
  });

  test("linear emits one line per interval", () => {
    const sp = only(curve([RUN], "linear"));
    assert.deepEqual(sp.start, P(0, 0));
    assert.deepEqual(lineTos(sp.segments), [
      [10, 20],
      [20, 10],
      [30, 30],
    ]);
  });

  test("step emits lines, riser at three x's", () => {
    const run = [P(0, 0), P(10, 20), P(20, 10)];
    assert.deepEqual(
      lineTos(
        only(curve([run], "step", { stepChange: "start" })).segments,
      ),
      [
        [0, 20],
        [10, 20],
        [10, 10],
        [20, 10],
      ],
    );
    assert.deepEqual(
      lineTos(
        only(curve([run], "step", { stepChange: "middle" })).segments,
      ),
      [
        [5, 0],
        [5, 20],
        [10, 20],
        [15, 20],
        [15, 10],
        [20, 10],
      ],
    );
    assert.deepEqual(
      lineTos(
        only(curve([run], "step", { stepChange: "end" })).segments,
      ),
      [
        [10, 0],
        [10, 20],
        [20, 20],
        [20, 10],
      ],
    );
  });

  test("step falls back to middle", () => {
    const run = [P(0, 0), P(10, 20)];
    const mid = only(curve([run], "step", { stepChange: "middle" }));
    assert.deepEqual(
      only(curve([run], "step")).segments,
      mid.segments,
    );
    assert.deepEqual(
      only(curve([run], "step", { stepChange: "?" })).segments,
      mid.segments,
    );
  });

  test("the other six emit finite cubics", () => {
    for (const t of CUBICS) {
      const sp = only(curve([RUN], t));
      for (const c of cubics(sp.segments)) {
        for (const v of [c.c1, c.c2, c.to]) {
          assert.isTrue(Number.isFinite(v.x), t);
          assert.isTrue(Number.isFinite(v.y), t);
        }
      }
    }
  });
});

suite("hdvl/kernel/curves — the parameters", () => {
  test("natural has zero 2nd derivative at ends", () => {
    for (const run of [RUN, SPACED, FLAT, [P(0, 0), P(10, 20)]]) {
      const sp = only(curve([run], "natural"));
      const segs = cubics(sp.segments);
      const f = segs[0];
      const l = segs[segs.length - 1];
      assert.closeTo(f.c2.x - 2 * f.c1.x + sp.start.x, 0, 1e-9);
      assert.closeTo(f.c2.y - 2 * f.c1.y + sp.start.y, 0, 1e-9);
      assert.closeTo(l.to.x - 2 * l.c2.x + l.c1.x, 0, 1e-9);
      assert.closeTo(l.to.y - 2 * l.c2.y + l.c1.y, 0, 1e-9);
    }
  });

  test("natural over two points is the chord", () => {
    const sp = only(curve([[P(0, 0), P(10, 20)]], "natural"));
    const c = cubics(sp.segments)[0];
    near(c.c1, 10 / 3, 20 / 3);
    near(c.c2, 20 / 3, 40 / 3);
    near(c.to, 10, 20);
  });

  test("basis at beta 1 is the pure B-spline", () => {
    const sp = only(curve([RUN], "basis", { basisBeta: 1 }));
    assert.lengthOf(sp.segments, RUN.length + 1);
    const segs = cubics(sp.segments);
    // The clamped ends are exact, not (a + 4b + c) / 6.
    assert.deepEqual(sp.start, P(0, 0));
    assert.deepEqual(segs[segs.length - 1].to, P(30, 30));
    // An interior join is the B-spline's own average.
    near(segs[1].to, (0 + 4 * 10 + 20) / 6, (0 + 4 * 20 + 10) / 6);
    near(segs[1].c1, (2 * 0 + 10) / 3, (2 * 0 + 20) / 3);
    near(segs[1].c2, (0 + 2 * 10) / 3, (0 + 2 * 20) / 3);
  });

  test("basis at beta 0 collapses onto the chord", () => {
    const sp = only(curve([RUN], "basis", { basisBeta: 0 }));
    assert.deepEqual(sp.start, P(0, 0));
    // The chord runs (0,0) → (30,30), so y = x everywhere.
    for (const c of cubics(sp.segments)) {
      for (const v of [c.c1, c.c2, c.to]) {
        assert.closeTo(v.y, v.x, 1e-9);
      }
    }
    // And beta 1 does not lie on it.
    const pure = cubics(
      only(curve([RUN], "basis", { basisBeta: 1 })).segments,
    );
    apart(pure[1].to.y, pure[1].to.x, 1e-6);
  });

  test("bezier auto picks per segment", () => {
    const segs = cubics(only(curve([BUMP], "bezier")).segments);
    // |dx| 100 > |dy| 10 — horizontal.
    assert.deepEqual(segs[0].c1, P(50, 0));
    assert.deepEqual(segs[0].c2, P(50, 10));
    // |dx| 10 < |dy| 100 — vertical, in the same path.
    assert.deepEqual(segs[1].c1, P(100, 60));
    assert.deepEqual(segs[1].c2, P(110, 60));
  });

  test("bezier horizontal and vertical force it", () => {
    const h = cubics(
      only(curve([BUMP], "bezier", { bezierTangents: "horizontal" }))
        .segments,
    );
    assert.deepEqual(h[1].c1, P(105, 10));
    assert.deepEqual(h[1].c2, P(105, 110));
    const v = cubics(
      only(curve([BUMP], "bezier", { bezierTangents: "vertical" }))
        .segments,
    );
    assert.deepEqual(v[0].c1, P(0, 5));
    assert.deepEqual(v[0].c2, P(100, 5));
    // Syntax is `*`, so an unknown value is auto.
    assert.deepEqual(
      only(curve([BUMP], "bezier", { bezierTangents: "x" })).segments,
      only(curve([BUMP], "bezier")).segments,
    );
  });

  test("cardinal at tension 1 collapses tangents", () => {
    const segs = cubics(
      only(curve([RUN], "cardinal", { cardinalTension: 1 })).segments,
    );
    segs.forEach((c, i) => {
      assert.deepEqual(c.c1, RUN[i]);
      assert.deepEqual(c.c2, RUN[i + 1]);
    });
  });

  test("cardinal at tension 0 is Catmull-Rom", () => {
    const segs = cubics(
      only(curve([RUN], "cardinal", { cardinalTension: 0 })).segments,
    );
    // m1 = (p2 - p0) / 2 = (10, 5); c1 = p1 + m1 / 3.
    near(segs[1].c1, 10 + 10 / 3, 20 + 5 / 3);
    // m2 = (p3 - p1) / 2 = (10, 5); c2 = p2 - m2 / 3.
    near(segs[1].c2, 20 - 10 / 3, 10 - 5 / 3);
  });

  test("catmull-rom alpha separates the three", () => {
    const at = (a: number) =>
      cubics(
        only(curve([SPACED], "catmull-rom", { catmullRomAlpha: a }))
          .segments,
      )[1].c1;
    const uniform = at(0);
    const centripetal = at(0.5);
    const chordal = at(1);
    near(uniform, 4.5, 12);
    apart(centripetal.x, uniform.x, 1e-3);
    apart(centripetal.x, chordal.x, 1e-3);
    assert.isTrue(centripetal.x < uniform.x);
    assert.isTrue(chordal.x < centripetal.x);
  });

  test("catmull-rom at alpha 0 is uniform", () => {
    const a = cubics(
      only(curve([SPACED], "catmull-rom", { catmullRomAlpha: 0 }))
        .segments,
    );
    const b = cubics(
      only(curve([SPACED], "cardinal", { cardinalTension: 0 }))
        .segments,
    );
    // Two expressions for one value: bit-identical in only 45.9%
    // of 4 000 random runs, worst delta 2.3e-13 (plan rule 1's
    // 2026-08-20 amendment). Asserted under rule 2.
    a.forEach((c, i) => {
      near(c.c1, b[i].c1.x, b[i].c1.y);
      near(c.c2, b[i].c2.x, b[i].c2.y);
    });
  });

  test("monotone at m 0 is Catmull-Rom, exactly", () => {
    // Not merely close: the blend is `t + 0 * (limited - t)` over
    // the same tangents, so it is `t + 0` — bit-identical in
    // 4 000 of 4 000 random runs.
    assert.deepEqual(
      only(curve([FLAT], "monotone", { monotonicity: 0 })).segments,
      only(curve([FLAT], "cardinal", { cardinalTension: 0 }))
        .segments,
    );
  });

  test("monotone at m 1 does not overshoot", () => {
    const segs = cubics(
      only(curve([FLAT], "monotone", { monotonicity: 1 })).segments,
    );
    // The first interval is flat at y = 0, so a monotone
    // interpolant may not leave it.
    assert.closeTo(segs[0].c1.y, 0, 1e-9);
    assert.closeTo(segs[0].c2.y, 0, 1e-9);
    // The second rises, and stays inside [0, 10].
    for (const v of [segs[1].c1.y, segs[1].c2.y]) {
      assert.isAtLeast(v, 0);
      assert.isAtMost(v, 10);
    }
  });

  test("monotone at m 0 overshoots, so m is real", () => {
    const c = cubics(
      only(curve([FLAT], "monotone", { monotonicity: 0 })).segments,
    )[0];
    assert.closeTo(c.c2.y, -5 / 3, 1e-9);
    assert.isBelow(c.c2.y, 0);
  });

  test("an interior m lies strictly between", () => {
    const at = (m: number) =>
      cubics(
        only(curve([FLAT], "monotone", { monotonicity: m })).segments,
      )[0].c2.y;
    const lo = at(0);
    const hi = at(1);
    const mid = at(0.5);
    assert.isBelow(lo, mid);
    assert.isBelow(mid, hi);
    assert.closeTo(mid, (lo + hi) / 2, 1e-9);
  });
});

suite("hdvl/kernel/curves — gaps and degenerates", () => {
  test("two runs make two subpaths", () => {
    for (const t of CURVE_TYPES) {
      const sp = curve([RUN, AWAY], t);
      assert.lengthOf(sp, 2, t);
      assert.deepEqual(sp[1].start, P(50, 0), t);
      // Nothing in the first subpath reaches the second's start.
      for (const s of sp[0].segments) {
        assert.notDeepEqual(s.to, P(50, 0), t);
      }
    }
  });

  test("a run is curved the same beside another", () => {
    for (const t of CURVE_TYPES) {
      const alone = curve([RUN], t);
      const beside = curve([RUN, AWAY], t);
      assert.deepEqual(beside[0], alone[0], t);
      const tail = curve([AWAY], t);
      assert.deepEqual(beside[1], tail[0], t);
    }
  });

  test("a two-point run is one segment", () => {
    const run = [P(0, 0), P(10, 20)];
    for (const t of CURVE_TYPES) {
      if (t === "step") {
        continue;
      }
      assert.lengthOf(only(curve([run], t)).segments, 1, t);
    }
  });

  test("step is the two-point exception", () => {
    // A step function cannot express an interval in one segment:
    // the riser is its own segment. start/end give two, middle
    // gives three.
    const run = [P(0, 0), P(10, 20)];
    for (const [change, n] of [
      ["start", 2],
      ["end", 2],
      ["middle", 3],
    ] as [string, number][]) {
      const sp = only(curve([run], "step", { stepChange: change }));
      assert.lengthOf(sp.segments, n, change);
    }
  });

  test("a one-point run is dropped", () => {
    for (const t of CURVE_TYPES) {
      assert.deepEqual(curve([[P(1, 2)]], t), [], t);
      // And it does not disturb its neighbours.
      const sp = curve([RUN, [P(40, 4)], AWAY], t);
      assert.lengthOf(sp, 2, t);
      assert.deepEqual(sp[1].start, P(50, 0), t);
    }
  });

  test("empty input is an empty array", () => {
    for (const t of CURVE_TYPES) {
      assert.deepEqual(curve([], t), [], t);
      assert.deepEqual(curve([[]], t), [], t);
    }
  });

  test("a signed zero never reaches a Point", () => {
    // Measured: with the normalisation removed, no -0-free input
    // produces one on any of the eight. The live route is a -0
    // ARRIVING, which linear and step copy through verbatim.
    const run = [P(-0, -0), P(10, 10)];
    for (const t of CURVE_TYPES) {
      for (const sp of curve([run], t)) {
        assert.isTrue(Object.is(sp.start.x, 0), t);
        assert.isTrue(Object.is(sp.start.y, 0), t);
        for (const s of sp.segments) {
          if (s.k === "cubic") {
            assert.isFalse(Object.is(s.c1.x, -0), t);
            assert.isFalse(Object.is(s.c1.y, -0), t);
            assert.isFalse(Object.is(s.c2.x, -0), t);
            assert.isFalse(Object.is(s.c2.y, -0), t);
          }
          assert.isFalse(Object.is(s.to.x, -0), t);
          assert.isFalse(Object.is(s.to.y, -0), t);
        }
      }
    }
  });
});
