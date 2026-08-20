/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import { Band, bandOf, bandOfValue, thinOrdinal } from "./scale-band";

/**
 * RFC §4.4 — the band formula — and §4.8's ordinal thinning.
 *
 * A pure fixture table: no DOM, no computed style, no element, no
 * `fixture` import and no `await`. That is the module's own
 * invariant, and the grep
 * `grep -rn "document\.\|window\." src/hdvl/kernel/` is what keeps
 * it true.
 *
 * **Which cross-engine rule applies here** (plan rules 1 and 9;
 * `docs/development.md` § *Writing a kernel fixture table* is the
 * canonical table):
 *
 * - **Everything in this file is exact.** The band formula is
 *   `+ − × ÷` over numbers, and IEEE-754 specifies those four
 *   operations exactly, so all three engines agree bit-for-bit. A
 *   `closeTo` anywhere in here would hide a real defect. There is
 *   no transcendental on any path, so rule 2 never binds.
 * - The fixtures are chosen so that **every expected number is
 *   exactly representable** — `W = 76, n = 4, b = 0.8` gives
 *   `step = 76 / 3.8 = 20` exactly — which is the plan's own
 *   reduced-fixture tactic, not a convenience.
 * - A sign and a `-0` are asserted with `Object.is`.
 *   `assert.strictEqual(x, 0)` **passes for `-0`**.
 */

/* -------------------------------------------------------------- */
/* The band formula                                               */
/* -------------------------------------------------------------- */

// W = 76 and b = 0.8 is the fixture family this whole file is
// built on: 4 − 1 + 0.8 is exactly the double 3.8, and 76 / 3.8 is
// exactly 20, so step, width, every start and every centre are
// integers. Nothing here is rounded and nothing needs a tolerance.
const ASCENDING: [number, Band][] = [
  [0, { start: 0, width: 16, centre: 8 }],
  [1, { start: 20, width: 16, centre: 28 }],
  [2, { start: 40, width: 16, centre: 48 }],
  [3, { start: 60, width: 16, centre: 68 }],
];

suite("hdvl/kernel/scale-band — bandOf", () => {
  for (const [k, expected] of ASCENDING) {
    test(`slot ${k} of 4 at b = 0.8 over [0, 76]`, () => {
      assert.deepEqual(bandOf(k, 4, [0, 76], 0.8), expected);
    });
  }

  test("the fixture's arithmetic is exactly representable", () => {
    // Stated so a later reader can see the fixture was CHOSEN and
    // not merely observed: if either of these ever fails, every
    // expected number above becomes a rounded one and the exact
    // assertions in this file are no longer honest.
    assert.strictEqual(4 - 1 + 0.8, 3.8);
    assert.strictEqual(76 / 3.8, 20);
  });

  test("the denominator is n − 1 + b, never n", () => {
    // The whole of R3's band-model divergence turns on this. With
    // W = 76 and n = 4 the two forms differ by a full pixel per
    // slot: W / (n − 1 + b) is 20, W / n is 19.
    const band = bandOf(1, 4, [0, 76], 0.8) as Band;
    assert.strictEqual(band.start, 20);
    assert.notStrictEqual(band.start, 76 / 4);
    // b = 1 is the one bandwidth at which the two coincide, which
    // is why the fixture uses 0.8.
    assert.strictEqual(
      (bandOf(1, 4, [0, 76], 1) as Band).start,
      76 / 4,
    );
  });

  test("the first low edge and last high edge meet the range", () => {
    const first = bandOf(0, 4, [0, 76], 0.8) as Band;
    const last = bandOf(3, 4, [0, 76], 0.8) as Band;
    assert.strictEqual(first.start, 0);
    assert.strictEqual(last.start + last.width, 76);
  });

  // §4.4 makes `centre` what EVERYTHING non-band-filling reads, so
  // it is asserted as a property over the whole table rather than
  // at a point: a `centre` that drifts from start + width / 2
  // cannot pass.
  const CENTRE_CASES: [number, number, [number, number], number][] = [
    [0, 4, [0, 76], 0.8],
    [3, 4, [0, 76], 0.8],
    [2, 7, [12.5, 112.5], 0.5],
    [0, 1, [0, 200], 1],
    [4, 5, [200, 0], 0.8],
    [1, 3, [-50, 50], 0],
  ];

  for (const [k, n, range, b] of CENTRE_CASES) {
    test(`centre is start + width / 2 (k ${k}/${n}, b ${b})`, () => {
      const band = bandOf(k, n, range, b) as Band;
      assert.strictEqual(band.centre, band.start + band.width / 2);
    });
  }

  test("b = 0 gives width +0 and centre === start", () => {
    const band = bandOf(1, 4, [0, 75], 0) as Band;
    assert.strictEqual(band.start, 25);
    assert.strictEqual(band.centre, band.start);
    // §4.4: "at b = 0 the centre IS the boundary". The zero must
    // be POSITIVE — strictEqual would pass for -0.
    assert.isTrue(Object.is(band.width, 0));
  });

  test("b = 0 places n points across the whole range", () => {
    // The point-scale degenerate case: step is W / (n − 1), so the
    // first and last positions sit exactly on the range's ends.
    const at = [0, 1, 2, 3].map(
      (k) => (bandOf(k, 4, [0, 75], 0) as Band).centre,
    );
    assert.deepEqual(at, [0, 25, 50, 75]);
  });

  test("n = 1, b = 0 is the range midpoint", () => {
    // §4.4's explicit branch: the general formula divides by
    // n − 1 + b = 0 here, so it cannot express this case.
    assert.deepEqual(bandOf(0, 1, [0, 200], 0), {
      start: 100,
      width: 0,
      centre: 100,
    });
  });

  test("n = 1, b = 1 is the whole range", () => {
    assert.deepEqual(bandOf(0, 1, [0, 200], 1), {
      start: 0,
      width: 200,
      centre: 100,
    });
  });

  test("n = 1 fills the range at every b above 0", () => {
    // Not a special case — a consequence of the formula. At n = 1
    // the width is b · W / b = W for any b > 0, which is exactly
    // why b = 0 needs a branch and no other b does.
    assert.deepEqual(bandOf(0, 1, [0, 200], 0.5), {
      start: 0,
      width: 200,
      centre: 100,
    });
    assert.deepEqual(bandOf(0, 1, [0, 200], 0.01), {
      start: 0,
      width: 200,
      centre: 100,
    });
  });

  test("n = 2, b = 0 does not take the midpoint branch", () => {
    assert.deepEqual(bandOf(0, 2, [0, 200], 0), {
      start: 0,
      width: 0,
      centre: 0,
    });
    assert.deepEqual(bandOf(1, 2, [0, 200], 0), {
      start: 200,
      width: 0,
      centre: 200,
    });
  });

  test("returns null outside [0, n) and below n = 1", () => {
    assert.isNull(bandOf(-1, 4, [0, 76], 0.8));
    assert.isNull(bandOf(4, 4, [0, 76], 0.8));
    assert.isNull(bandOf(0, 0, [0, 76], 0.8));
  });

  test("returns null for a non-finite range", () => {
    // T5's class, decided rather than left to NaN propagation: at
    // k = 0 an infinite step gives 0 · Infinity = NaN, which would
    // travel silently. A band over a range that is not a finite
    // interval has no geometry, and null is already in the return
    // type.
    assert.isNull(bandOf(0, 4, [0, Infinity], 0.8));
    assert.isNull(bandOf(0, 4, [NaN, 76], 0.8));
  });

  test("a zero-width range gives an all-zero band", () => {
    // An unlaid-out plane is a normal frame-zero state.
    assert.deepEqual(bandOf(2, 4, [0, 0], 0.8), {
      start: 0,
      width: 0,
      centre: 0,
    });
  });
});

/* -------------------------------------------------------------- */
/* R19 — the cluster's inner band tiles edge-to-edge              */
/* -------------------------------------------------------------- */

suite("hdvl/kernel/scale-band — b = 1 tiles (R19)", () => {
  // §6.4's cluster subdivides an outer band at inner b = 1, with
  // no authorable inner gap. `b` being an ordinary parameter is
  // what makes that the formula rather than a second entry point,
  // and this is the kernel-side whole of R19.
  //
  // Every W/n below is chosen so that k · step is exactly
  // representable for every k, which is what lets the seam be
  // asserted with === rather than a tolerance.
  const TILINGS: [number, number][] = [
    [76, 4],
    [100, 4],
    [100, 5],
    [64, 8],
    [7, 3],
  ];

  for (const [W, n] of TILINGS) {
    test(`${n} bands tile [0, ${W}] with no gap`, () => {
      for (let k = 0; k + 1 < n; k++) {
        const band = bandOf(k, n, [0, W], 1) as Band;
        const next = bandOf(k + 1, n, [0, W], 1) as Band;
        assert.strictEqual(next.start, band.start + band.width);
      }
      const last = bandOf(n - 1, n, [0, W], 1) as Band;
      assert.strictEqual(last.start + last.width, W);
    });
  }

  test("width equals step exactly at b = 1, for every k", () => {
    // The half of R19 that IS universally exact: b · step with
    // b = 1 is step, so every band in a tiling is the same width
    // whatever the arithmetic does at the seams.
    const widths = [0, 1, 2, 3, 4, 5].map(
      (k) => (bandOf(k, 6, [0, 365], 1) as Band).width,
    );
    assert.strictEqual(new Set(widths).size, 1);
  });

  test("a descending range tiles in the other direction", () => {
    // Under the low-edge convention the seam identity reads
    // downward: band k's LOW edge is band k+1's HIGH edge.
    for (let k = 0; k + 1 < 4; k++) {
      const band = bandOf(k, 4, [200, 0], 1) as Band;
      const next = bandOf(k + 1, 4, [200, 0], 1) as Band;
      assert.strictEqual(band.start, next.start + next.width);
    }
  });

  test("the seam is exact only where the arithmetic is", () => {
    // Measured 2026-08-20 over 1 495 (W, n, r0) configurations:
    // the identity holds bit-for-bit in 32 % of them. It compares
    // two roundings, fl(k · step) + step, against one,
    // fl((k+1) · step) — IEEE-754 specifies each operation but not
    // that the two agree. W = 365, n = 12, k = 6 is the smallest
    // legible counter-example; the worst seam anywhere in the
    // sweep was 2.3e-13 px, seven orders below the six-decimal
    // quantization every scene assertion goes through.
    //
    // This assertion is a STANDING CHECK on that premise, in the
    // shape ticks-numeric.test.ts uses for 3 * 0.1: if it ever
    // starts passing, §4.4's formula became exact and someone
    // should hear about it. It is deterministic across engines
    // because + − × ÷ are exactly specified.
    const band = bandOf(6, 12, [0, 365], 1) as Band;
    const next = bandOf(7, 12, [0, 365], 1) as Band;
    assert.notStrictEqual(next.start, band.start + band.width);
    assert.closeTo(next.start, band.start + band.width, 1e-9);
    assert.isBelow(
      Math.abs(next.start - (band.start + band.width)),
      1e-12,
    );
  });
});

/* -------------------------------------------------------------- */
/* A descending range — what §4.3 gives every y scale             */
/* -------------------------------------------------------------- */

suite("hdvl/kernel/scale-band — descending range", () => {
  // §4.3 gives `y` a bottom → top range, which is DESCENDING in
  // §2.7's y-down view coordinates, so this is the normal case for
  // every vertical scale in the project rather than an edge case.
  //
  // The convention: `start` is the LOW edge and `width` is never
  // negative, so {start, width} is always the interval
  // [start, start + width] — what an SVG rect wants. Band 0 is
  // therefore the one nearest r0, i.e. the HIGHEST start.
  const DESCENDING: [number, Band][] = [
    [0, { start: 60, width: 16, centre: 68 }],
    [1, { start: 40, width: 16, centre: 48 }],
    [2, { start: 20, width: 16, centre: 28 }],
    [3, { start: 0, width: 16, centre: 8 }],
  ];

  for (const [k, expected] of DESCENDING) {
    test(`slot ${k} of 4 at b = 0.8 over [76, 0]`, () => {
      assert.deepEqual(bandOf(k, 4, [76, 0], 0.8), expected);
    });
  }

  test("the two directions are mirror images in centre", () => {
    const up = [0, 1, 2, 3].map(
      (k) => (bandOf(k, 4, [0, 76], 0.8) as Band).centre,
    );
    const down = [0, 1, 2, 3].map(
      (k) => (bandOf(k, 4, [76, 0], 0.8) as Band).centre,
    );
    assert.deepEqual(down, [...up].reverse());
  });

  test("a descending range never returns -0", () => {
    // Under the low-edge convention no band field can be -0: the
    // width is b · |step| and the low edge is a subtraction that
    // yields +0. Asserted over every k at b = 0, where a signed
    // width WOULD produce one.
    for (let k = 0; k < 4; k++) {
      const band = bandOf(k, 4, [200, 0], 0) as Band;
      assert.isFalse(Object.is(band.start, -0));
      assert.isFalse(Object.is(band.width, -0));
      assert.isFalse(Object.is(band.centre, -0));
    }
    const last = bandOf(3, 4, [200, 0], 0) as Band;
    assert.isTrue(Object.is(last.start, 0));
  });

  test("the signed-width alternative would return -0", () => {
    // Why the convention was chosen, stated as a measurement
    // rather than a preference. Under `width = b · (r1 − r0) /
    // (n − 1 + b)` a zero bandwidth on a descending range gives a
    // signed zero, and every rect consumer would then also have to
    // normalise a negative extent.
    const signedWidth = (0 * (0 - 200)) / (4 - 1 + 0);
    assert.isTrue(Object.is(signedWidth, -0));
    assert.isFalse(
      Object.is((bandOf(0, 4, [200, 0], 0) as Band).width, -0),
    );
  });
});

/* -------------------------------------------------------------- */
/* bandOfValue                                                    */
/* -------------------------------------------------------------- */

suite("hdvl/kernel/scale-band — bandOfValue", () => {
  const DOMAIN = ["Q1", "Q2", "Q3", "Q4"];

  test("agrees with bandOf at the value's index", () => {
    assert.deepEqual(
      bandOfValue("Q3", DOMAIN, [0, 76], 0.8),
      bandOf(2, 4, [0, 76], 0.8),
    );
  });

  test("returns null for a value outside the domain", () => {
    // §4.7: an out-of-domain ordinal value produces no mark. The
    // notice is the caller's, at steps 20–22; the kernel reports
    // the absence honestly and diagnoses nothing.
    assert.isNull(bandOfValue("Q5", DOMAIN, [0, 76], 0.8));
  });

  test("returns null for an empty domain", () => {
    assert.isNull(bandOfValue("Q1", [], [0, 76], 0.8));
  });

  test("addresses the first duplicate, as indexOf does", () => {
    const dup = ["a", "b", "a"];
    assert.deepEqual(
      bandOfValue("a", dup, [0, 100], 1),
      bandOf(0, 3, [0, 100], 1),
    );
  });
});

/* -------------------------------------------------------------- */
/* §4.8 — ordinal thinning                                        */
/* -------------------------------------------------------------- */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

suite("hdvl/kernel/scale-band — thinOrdinal by count", () => {
  test("count is a target: 12 at count 5 keeps four", () => {
    // ⌈12 / 5⌉ = 3, so indices 0, 3, 6, 9 — FOUR values for a
    // target of five. §4.8 opens with `count` being a target and
    // never a promise: a round stride wins over an exact count.
    assert.deepEqual(thinOrdinal(MONTHS, { count: 5 }), [
      "Jan",
      "Apr",
      "Jul",
      "Oct",
    ]);
  });

  test("keeps index 0 and every stride-th after it", () => {
    // ⌈12 / 4⌉ = 3 as well, so a target of 4 and a target of 5
    // give the same ladder — which is what a stride-based rule
    // means and why the count is not a promise.
    assert.deepEqual(
      thinOrdinal(MONTHS, { count: 4 }),
      thinOrdinal(MONTHS, { count: 5 }),
    );
  });

  test("count 6 over 12 keeps every second", () => {
    assert.deepEqual(thinOrdinal(MONTHS, { count: 6 }), [
      "Jan",
      "Mar",
      "May",
      "Jul",
      "Sep",
      "Nov",
    ]);
  });

  test("count above N keeps the whole domain", () => {
    assert.deepEqual(thinOrdinal(MONTHS, { count: 20 }), MONTHS);
  });

  test("count 0 is read as 1, exactly as §4.8's ladder does", () => {
    // The numeric ladder guards with max(1, count); this is the
    // same guard, so a stride of ⌈12 / 1⌉ = 12 keeps index 0
    // alone. It must not divide by zero and must not loop.
    assert.deepEqual(thinOrdinal(MONTHS, { count: 0 }), ["Jan"]);
    assert.deepEqual(thinOrdinal(MONTHS, { count: -4 }), ["Jan"]);
  });
});

suite("hdvl/kernel/scale-band — thinOrdinal by step", () => {
  test("keeps every step-th, starting at index 0", () => {
    assert.deepEqual(thinOrdinal(MONTHS, { step: 3 }), [
      "Jan",
      "Apr",
      "Jul",
      "Oct",
    ]);
  });

  test("a step of 1 keeps the whole domain", () => {
    assert.deepEqual(thinOrdinal(MONTHS, { step: 1 }), MONTHS);
  });

  test("a step of 0 falls back to 1 rather than blanking", () => {
    // A stride below 1 is not a stride. Returning nothing would
    // silently blank an axis for step="0"; returning everything is
    // what an absent spec means and is the honest degenerate
    // answer. It must not loop forever.
    assert.deepEqual(thinOrdinal(MONTHS, { step: 0 }), MONTHS);
    assert.deepEqual(thinOrdinal(MONTHS, { step: -2 }), MONTHS);
    assert.deepEqual(thinOrdinal(MONTHS, { step: NaN }), MONTHS);
  });

  test("a fractional step floors to an index stride", () => {
    assert.deepEqual(
      thinOrdinal(MONTHS, { step: 2.9 }),
      thinOrdinal(MONTHS, { step: 2 }),
    );
  });
});

suite("hdvl/kernel/scale-band — thinOrdinal by values", () => {
  test("keeps exactly those, in the order given", () => {
    assert.deepEqual(
      thinOrdinal(MONTHS, { values: ["Mar", "Jun", "Dec"] }),
      ["Mar", "Jun", "Dec"],
    );
  });

  test("an order differing from the domain is honoured", () => {
    // §4.8 says "in the order given". A guide states positions;
    // sorting them back into domain order would be this module
    // overriding the author.
    assert.deepEqual(
      thinOrdinal(MONTHS, { values: ["Dec", "Jan"] }),
      ["Dec", "Jan"],
    );
  });

  test("silently drops what is not in the domain", () => {
    // No throw, no diagnostic, no null hole — §4.8's own word is
    // "silently".
    assert.deepEqual(
      thinOrdinal(MONTHS, { values: ["Jan", "Smarch", "Feb"] }),
      ["Jan", "Feb"],
    );
  });

  test("an all-unknown values list yields an empty result", () => {
    assert.deepEqual(thinOrdinal(MONTHS, { values: ["Smarch"] }), []);
  });

  test("a value listed twice is emitted twice", () => {
    // Membership is what is checked; de-duplication is not in
    // §4.8's sentence and is not this module's to invent.
    assert.deepEqual(
      thinOrdinal(MONTHS, { values: ["Jan", "Jan"] }),
      ["Jan", "Jan"],
    );
  });
});

suite("hdvl/kernel/scale-band — thinOrdinal edges", () => {
  test("an empty spec returns the whole domain", () => {
    // `hdml-axis` takes no count/step/values at all (§6.5), so
    // this has to be a legal input here rather than a caller-side
    // branch.
    assert.deepEqual(thinOrdinal(MONTHS, {}), MONTHS);
  });

  test("the returned array is a copy, never the domain", () => {
    const out = thinOrdinal(MONTHS, {});
    assert.notStrictEqual(out, MONTHS);
  });

  test("an empty domain thins to nothing", () => {
    assert.deepEqual(thinOrdinal([], {}), []);
    assert.deepEqual(thinOrdinal([], { count: 5 }), []);
    assert.deepEqual(thinOrdinal([], { step: 2 }), []);
    assert.deepEqual(thinOrdinal([], { values: ["Jan"] }), []);
  });

  test("precedence is values, then step, then count", () => {
    // V16 makes this unreachable from a document, at step 24. It
    // is stated and asserted so the behaviour is deterministic
    // rather than incidental.
    assert.deepEqual(
      thinOrdinal(MONTHS, {
        count: 5,
        step: 2,
        values: ["Feb"],
      }),
      ["Feb"],
    );
    assert.deepEqual(thinOrdinal(MONTHS, { count: 5, step: 6 }), [
      "Jan",
      "Jul",
    ]);
  });
});
