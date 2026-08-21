/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import {
  calendarRung,
  niceCalendar,
  ticksCalendar,
} from "./ticks-calendar";

/**
 * RFC §4.8 — the calendar tick ladder.
 *
 * A pure fixture table: no DOM, no computed style, no element, no
 * `fixture` import and no `await`.
 *
 * **Which cross-engine rule applies where** (plan rules 1, 5, 9):
 *
 * - Every boundary is an **exact integer epoch-ms**, `deepEqual`
 *   against hand-stated integers on all three engines (rule 1).
 *   Step 15 had to fixture-scope rule 1 for band geometry because
 *   `f(k) + d === f(k+1)` compares two roundings against one; that
 *   caveat does **not** reach here, because these are integers and
 *   the exactness is universal rather than a property of the
 *   fixtures chosen. Nothing in this file is asserted with
 *   `closeTo`.
 * - Rule 5 binds through `zone.test.ts`'s source assertion, which
 *   is what makes every integer below a claim about **one**
 *   implementation rather than three that agree today.
 * - Rule 9 (`-0`) was measured rather than assumed and found to
 *   have no producer — see the last suite.
 *
 * Every expected integer here was read off the module and then
 * cross-checked against its wall-clock reading, per R23: a
 * disagreement between the ladder and a hand computation means the
 * hand computation is wrong until proved otherwise.
 */

/** The zone every DST fixture is measured in. */
const NY = "America/New_York";

/** §4.2's default for a zone-less domain. */
const UTC = "UTC";

/** 2020-06-15T00:00:00Z — a Monday, so the week rung is clean. */
const MON = 1592179200000;

/** 2020-06-15T07:13:11.500Z — deliberately off every boundary. */
const ODD = 1592205191500;

/** Local midnight on the 23-hour day, 2026-03-08 in New York. */
const SPRING = 1772946000000;

/** Local midnight on the 25-hour day, 2026-11-01 in New York. */
const FALL = 1793505600000;

/** One hour, in milliseconds — spans read better multiplied. */
const H = 3600000;

/** One day, in milliseconds. Spans only; never tick arithmetic. */
const D = 86400000;

/* -------------------------------------------------------------- */
/* The ladder — every rung reachable                              */
/* -------------------------------------------------------------- */

suite("hdvl/kernel/ticks-calendar — the rungs", () => {
  // §4.8's ladder verbatim:
  //   1s 5s 15s 30s · 1m 5m 15m 30m · 1h 3h 6h 12h
  //   · 1d 2d · 1w (ISO, Monday) · 1mo 3mo · 1y
  //   · beyond a year: the numeric ladder over years
  // EIGHTEEN rungs, plus the generalised year. Step 14's E7 is
  // why this table exists at all: a ladder with an UNREACHABLE
  // rung passed review for the whole life of the RFC, so every
  // rung is asserted at the span that selects it rather than
  // assumed to be selectable.
  const RUNGS: [number, string, number][] = [
    // span from MON, unit, every
    [6000, "second", 1],
    [30000, "second", 5],
    [90000, "second", 15],
    [180000, "second", 30],
    [360000, "minute", 1],
    [1800000, "minute", 5],
    [5400000, "minute", 15],
    [10800000, "minute", 30],
    [6 * H, "hour", 1],
    [18 * H, "hour", 3],
    [36 * H, "hour", 6],
    [72 * H, "hour", 12],
    [6 * D, "day", 1],
    [12 * D, "day", 2],
    [42 * D, "week", 1],
    [180 * D, "month", 1],
    [540 * D, "month", 3],
    [2190 * D, "year", 1],
  ];

  for (const [span, unit, every] of RUNGS) {
    test(`selects ${every}${unit} at a span of ${span} ms`, () => {
      assert.deepEqual(calendarRung(MON, MON + span, 6, UTC), {
        unit,
        every,
      });
    });
  }

  test("all eighteen rungs are distinct and reachable", () => {
    const hit = new Set(
      RUNGS.map(([span]) => {
        const r = calendarRung(MON, MON + span, 6, UTC);
        return `${r?.every}${r?.unit}`;
      }),
    );
    assert.strictEqual(hit.size, 18);
  });

  test("coarsest match first, not nearest count", () => {
    // One day in UTC. The three candidate rungs give 12h → 3
    // ticks, 6h → 5, 3h → 9. At a target of 4 the two readings
    // disagree and this pins which one we take: "nearest" would
    // choose 12h (|3-4| = 1 = |5-4|, and coarser breaks the tie),
    // "coarsest whose count is AT LEAST the target" rejects 12h
    // outright because 3 < 4 and takes 6h. §4.8's own first line
    // — count is a target, round values win — is why: overshoot
    // is a target missed, undershoot is an axis with too few
    // ticks to read.
    assert.strictEqual(ticksCalendar(MON, MON + D, 4, UTC).length, 5);
    assert.deepEqual(calendarRung(MON, MON + D, 4, UTC), {
      unit: "hour",
      every: 6,
    });
    // At a target of exactly 5 the same rung matches exactly, and
    // at 3 the coarser one does — so the boundary is pinned from
    // both sides rather than incidentally.
    assert.deepEqual(calendarRung(MON, MON + D, 5, UTC), {
      unit: "hour",
      every: 6,
    });
    assert.deepEqual(calendarRung(MON, MON + D, 3, UTC), {
      unit: "hour",
      every: 12,
    });
    assert.deepEqual(calendarRung(MON, MON + D, 6, UTC), {
      unit: "hour",
      every: 3,
    });
  });

  test("falls back to the finest rung below it", () => {
    // A two-second domain cannot supply ten ticks at any rung.
    assert.deepEqual(calendarRung(MON, MON + 2000, 10, UTC), {
      unit: "second",
      every: 1,
    });
    assert.deepEqual(
      ticksCalendar(MON, MON + 2000, 10, UTC),
      [1592179200000, 1592179201000, 1592179202000],
    );
  });
});

/* -------------------------------------------------------------- */
/* Boundaries — exact integers, aligned, in the zone               */
/* -------------------------------------------------------------- */

suite("hdvl/kernel/ticks-calendar — boundaries", () => {
  test("a multiple rung aligns to its parent cycle", () => {
    // §4.8 gives the multiples without saying what they are
    // multiples OF. Stepping from the domain's own start would
    // read 07:13, 10:13, 13:13; snapping the unit's absolute
    // index down to a multiple of `every` reads 09:00, 12:00 …
    assert.deepEqual(ticksCalendar(ODD, ODD + 18 * H, 6, UTC), [
      1592211600000, // 09:00
      1592222400000, // 12:00
      1592233200000, // 15:00
      1592244000000, // 18:00
      1592254800000, // 21:00
      1592265600000, // 00:00 next day
    ]);
  });

  test("a 15m rung lands on the quarter hours", () => {
    assert.deepEqual(ticksCalendar(ODD, ODD + 5400000, 6, UTC), [
      1592205300000, // 07:15
      1592206200000, // 07:30
      1592207100000, // 07:45
      1592208000000, // 08:00
      1592208900000, // 08:15
      1592209800000, // 08:30
    ]);
  });

  test("a 5s rung lands on the five-second marks", () => {
    assert.deepEqual(
      ticksCalendar(ODD, ODD + 30000, 6, UTC),
      [
        1592205195000, 1592205200000, 1592205205000, 1592205210000,
        1592205215000, 1592205220000,
      ],
    );
  });

  test("a 3mo rung lands on the calendar quarters", () => {
    assert.deepEqual(ticksCalendar(ODD, ODD + 540 * D, 6, UTC), [
      1593561600000, // 2020-07-01
      1601510400000, // 2020-10-01
      1609459200000, // 2021-01-01
      1617235200000, // 2021-04-01
      1625097600000, // 2021-07-01
      1633046400000, // 2021-10-01
    ]);
  });

  test("a week rung floors to ISO Monday", () => {
    // The domain starts on a THURSDAY (2026-03-05), so a rung
    // stepping from the domain's first instant would emit
    // Thursdays and a Sunday-based week would emit Sundays.
    const thu = 1772668800000;
    const ticks = ticksCalendar(thu, thu + 42 * D, 6, UTC);
    assert.deepEqual(ticks, [
      1773014400000, // Mon 2026-03-09
      1773619200000,
      1774224000000,
      1774828800000,
      1775433600000,
      1776038400000,
    ]);
    for (const t of ticks) {
      assert.strictEqual(new Date(t).getUTCDay(), 1);
    }
  });

  test("every boundary is an exact integer", () => {
    for (const span of [30000, 6 * H, 6 * D, 540 * D, 2190 * D]) {
      for (const zone of [UTC, NY]) {
        for (const t of ticksCalendar(MON, MON + span, 7, zone)) {
          assert.isTrue(Number.isInteger(t));
        }
      }
    }
  });

  test("boundaries are the scale's zone, never UTC", () => {
    // THE LOAD-BEARING ONE. An implementation that floors in UTC
    // and formats in the zone passes every other test in this
    // file.
    const a = 1748736000000; // 2025-06-01T00:00Z
    const b = a + 4 * D;
    const utc = ticksCalendar(a, b, 4, UTC);
    const ny = ticksCalendar(a, b, 4, NY);
    assert.deepEqual(
      utc,
      [
        1748736000000, 1748822400000, 1748908800000, 1748995200000,
        1749081600000,
      ],
    );
    assert.deepEqual(
      ny,
      [1748750400000, 1748836800000, 1748923200000, 1749009600000],
    );
    assert.notDeepEqual(utc, ny);
    assert.strictEqual((ny[0] - utc[0]) / H, 4);
  });
});

/* -------------------------------------------------------------- */
/* Beyond a year — the numeric ladder, in the zone                 */
/* -------------------------------------------------------------- */

suite("hdvl/kernel/ticks-calendar — beyond a year", () => {
  test("uses the numeric ladder over year numbers", () => {
    const a = 315532800000; // 1980-01-01T00:00Z
    const b = 1767225600000; // 2026-01-01T00:00Z
    assert.deepEqual(calendarRung(a, b, 5, UTC), {
      unit: "year",
      every: 10,
    });
    assert.deepEqual(ticksCalendar(a, b, 5, UTC), [
      315532800000, // 1980
      631152000000, // 1990
      946684800000, // 2000
      1262304000000, // 2010
      1577836800000, // 2020
    ]);
  });

  test("takes a {1, 2, 5} × 10ⁿ multiple, as numeric does", () => {
    // 120 years at a target of 6 wants a 20-year step, which is
    // the numeric ladder's `2 × 10¹` rung. A calendar ladder that
    // re-derived its own multiples would have to justify 20
    // separately; this one inherits it (R12).
    const a = -2208988800000; // 1900-01-01T00:00Z
    const b = 1577836800000; // 2020-01-01T00:00Z
    assert.deepEqual(calendarRung(a, b, 6, UTC), {
      unit: "year",
      every: 20,
    });
  });

  test("emits year boundaries in the zone, not 365.25 days", () => {
    // 1980-01-01T00:00 NEW YORK, not UTC. Every emitted value is
    // local midnight on 1 January at offset −300, five hours
    // after the UTC boundary above — which a
    // `year × 365.25 × 86400000` implementation cannot produce
    // and a UTC-flooring one gets wrong by exactly those hours.
    const a = 315550800000; // 1980-01-01T00:00 EST
    const b = 1767243600000; // 2026-01-01T00:00 EST
    assert.deepEqual(ticksCalendar(a, b, 5, NY), [
      315550800000, // 1980
      631170000000, // 1990
      946702800000, // 2000
      1262322000000, // 2010
      1577854800000, // 2020
    ]);
    for (const t of ticksCalendar(a, b, 5, NY)) {
      assert.strictEqual((t - 315550800000) % 1000, 0);
    }
  });

  test("a six-year domain still steps by one year", () => {
    const a = 1577836800000; // 2020-01-01T00:00Z
    const b = 1767225600000; // 2026-01-01T00:00Z
    assert.deepEqual(calendarRung(a, b, 6, UTC), {
      unit: "year",
      every: 1,
    });
    assert.strictEqual(ticksCalendar(a, b, 6, UTC).length, 7);
  });
});

/* -------------------------------------------------------------- */
/* DST — both 2026 transitions in America/New_York                */
/* -------------------------------------------------------------- */

suite("hdvl/kernel/ticks-calendar — DST", () => {
  test("spring forward emits each instant once", () => {
    // APPROVED UNDER D1, 2026-08-21: de-duplicate by resulting
    // instant, keeping the first. §4.8 was silent; step 14's own
    // §4.8 CLARIFIED banner had already given symlog's join value
    // the same answer one rung up. The wall clocks emitted are
    // 00 01 03 04 05 06 07 — a two-hour gap on the labels where
    // the clock jumped, which is TRUE, rather than two ticks at
    // one x-position.
    const ticks = ticksCalendar(SPRING, SPRING + 6 * H, 6, NY);
    assert.deepEqual(calendarRung(SPRING, SPRING + 6 * H, 6, NY), {
      unit: "hour",
      every: 1,
    });
    assert.deepEqual(ticks, [
      1772946000000, // 00:00 EST
      1772949600000, // 01:00 EST
      1772953200000, // 03:00 EDT — wall 02:00 collapsed onto it
      1772956800000, // 04:00 EDT
      1772960400000, // 05:00 EDT
      1772964000000, // 06:00 EDT
      1772967600000, // 07:00 EDT
    ]);
    assert.strictEqual(new Set(ticks).size, ticks.length);
  });

  test("fall back needs no de-duplication", () => {
    // `compatible` takes the FIRST (EDT) instant of the repeated
    // 01:00, so the second one is never produced. The ladder
    // carries a two-hour real-time gap there instead of a
    // duplicate.
    const ticks = ticksCalendar(FALL, FALL + 6 * H, 6, NY);
    assert.deepEqual(ticks, [
      1793505600000, // 00:00 EDT
      1793509200000, // 01:00 EDT — the earlier instant
      1793516400000, // 02:00 EST
      1793520000000, // 03:00 EST
      1793523600000, // 04:00 EST
      1793527200000, // 05:00 EST
    ]);
    assert.strictEqual(new Set(ticks).size, ticks.length);
    assert.notInclude(ticks, 1793512800000);
    assert.strictEqual((ticks[2] - ticks[1]) / H, 2);
  });

  test("neither transition emits a duplicate instant", () => {
    for (const start of [SPRING, FALL]) {
      for (const count of [3, 6, 12, 24]) {
        const t = ticksCalendar(start, start + 24 * H, count, NY);
        // `assert.lengthOf` reads `.size` on a Set and so passes
        // for the wrong reason (step 14's T4). Compare the number.
        assert.strictEqual(new Set(t).size, t.length);
      }
    }
  });

  test("a day boundary across a transition is still midnight", () => {
    // The 1d rung on the week containing 2026-03-08. Every tick
    // is local midnight, and the gap ACROSS the transition is 23
    // hours — the clearest single proof that this is calendar
    // arithmetic and not `+ 86400000`.
    const a = 1772773200000; // 2026-03-06T00:00 EST
    const b = 1773288000000; // 2026-03-12T00:00 EDT
    const ticks = ticksCalendar(a, b, 6, NY);
    assert.deepEqual(ticks, [
      1772773200000, // 03-06
      1772859600000, // 03-07
      1772946000000, // 03-08  ← 23 hours long
      1773028800000, // 03-09
      1773115200000, // 03-10
      1773201600000, // 03-11
      1773288000000, // 03-12
    ]);
    const gaps = ticks.slice(1).map((t, i) => (t - ticks[i]) / H);
    assert.deepEqual(gaps, [24, 24, 23, 24, 24, 24]);
  });
});

/* -------------------------------------------------------------- */
/* nice                                                            */
/* -------------------------------------------------------------- */

suite("hdvl/kernel/ticks-calendar — niceCalendar", () => {
  test("rounds outward to the chosen rung's boundary", () => {
    const a = 1741936920000; // 2025-03-14T07:22Z
    const b = 1754163660000; // 2025-08-02T19:41Z
    assert.deepEqual(calendarRung(a, b, 5, UTC), {
      unit: "month",
      every: 1,
    });
    assert.deepEqual(niceCalendar(a, b, 5, UTC), [
      1740787200000, // 2025-03-01
      1756684800000, // 2025-09-01
    ]);
  });

  test("only ever widens", () => {
    for (const zone of [UTC, NY]) {
      for (const span of [7000, 300000, 5 * H, 3 * D, 400 * D]) {
        for (const off of [0, 1234567, 98765432]) {
          const a = MON + off;
          const b = a + span;
          const [lo, hi] = niceCalendar(a, b, 5, zone);
          assert.isAtMost(lo, a);
          assert.isAtLeast(hi, b);
        }
      }
    }
  });

  test("rounds in the zone, across a transition", () => {
    const a = 1772951400000; // 2026-03-08T01:30 EST
    const b = 1772961000000; // 2026-03-08T05:30 EDT
    assert.deepEqual(niceCalendar(a, b, 4, NY), [
      1772949600000, // 01:00 EST
      1772964000000, // 06:00 EDT
    ]);
  });

  test("preserves the orientation it was given", () => {
    const a = 1741936920000;
    const b = 1754163660000;
    const up = niceCalendar(a, b, 5, UTC);
    const down = niceCalendar(b, a, 5, UTC);
    assert.deepEqual(down, [up[1], up[0]]);
  });

  test("is idempotent where the rung does not change", () => {
    const cases: [number, number, number, string][] = [
      [1741936920000, 1754163660000, 5, UTC],
      [1772951400000, 1772961000000, 4, NY],
      [1582977600000, 1583064000000, 3, UTC],
      [MON + 1234567, MON + 1234567 + 3 * D, 5, UTC],
    ];
    for (const [a, b, c, z] of cases) {
      const once = niceCalendar(a, b, c, z);
      assert.deepEqual(niceCalendar(once[0], once[1], c, z), once);
    }
  });

  test("a single pass is not a fixed point when it promotes", () => {
    // A STANDING CHECK ON A PROPERTY THE PROMPT ASSUMED. Widening
    // makes the domain longer, which can promote the rung, which
    // widens further — so `nice(nice(d))` is NOT universally
    // `nice(d)`. Measured over 1 950 configurations: 242 (12.4 %)
    // move on a second pass, all of them outward, all reaching a
    // fixed point within two further passes.
    //
    // **`niceNumeric` has exactly the same property** — measured
    // 37 of 280 (13.2 %) — so this is not a calendar defect but
    // the shape of `nice` itself, and step 14 asserted it on
    // fixtures where the step is stable. §4.2 step 5 computes the
    // step ONCE from the domain, so a single pass is the
    // RFC-faithful reading and iterating to a fixed point would
    // be changing the rule rather than implementing it (R23).
    // Domain resolution applies it once (step 18), so nothing
    // downstream depends on the fixed point.
    const a = 1546399565432;
    const b = 1546399572432;
    const once = niceCalendar(a, b, 2, UTC);
    assert.deepEqual(once, [1546399565000, 1546399573000]);
    assert.deepEqual(calendarRung(a, b, 2, UTC), {
      unit: "second",
      every: 1,
    });
    const twice = niceCalendar(once[0], once[1], 2, UTC);
    assert.notDeepEqual(twice, once);
    assert.deepEqual(twice, [1546399565000, 1546399575000]);
    // It converges, and it only ever widens.
    assert.deepEqual(niceCalendar(twice[0], twice[1], 2, UTC), twice);
    assert.isAtMost(twice[0], once[0]);
    assert.isAtLeast(twice[1], once[1]);
  });
});

/* -------------------------------------------------------------- */
/* Totality                                                        */
/* -------------------------------------------------------------- */

suite("hdvl/kernel/ticks-calendar — totality", () => {
  test("a degenerate domain yields no ticks", () => {
    // `ticks-numeric.ts`'s `usable()` precedent: no ticks, never
    // a throw.
    assert.isNull(calendarRung(MON, MON, 5, UTC));
    assert.deepEqual(ticksCalendar(MON, MON, 5, UTC), []);
    assert.deepEqual(niceCalendar(MON, MON, 5, UTC), [MON, MON]);
  });

  test("a reversed domain gives ascending ticks", () => {
    assert.deepEqual(
      ticksCalendar(MON + D, MON, 4, UTC),
      ticksCalendar(MON, MON + D, 4, UTC),
    );
  });

  test("a non-finite endpoint yields no ticks", () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      assert.isNull(calendarRung(bad, MON, 5, UTC));
      assert.deepEqual(ticksCalendar(bad, MON, 5, UTC), []);
      assert.deepEqual(ticksCalendar(MON, bad, 5, UTC), []);
      // Returned unchanged, so `nice` never invents a finite
      // endpoint for a domain that had none.
      const nice = niceCalendar(MON, bad, 5, UTC);
      assert.strictEqual(nice[0], MON);
      assert.isTrue(Object.is(nice[1], bad));
    }
  });

  test("a zero, negative or NaN count reads as one", () => {
    // `Math.max(1, NaN)` is `NaN`, not 1 (step 15's T4), so the
    // guard is an explicit `Number.isFinite` test rather than a
    // clamp. All three targets must behave identically.
    const one = calendarRung(MON, MON + D, 1, UTC);
    for (const bad of [0, -7, NaN]) {
      assert.deepEqual(calendarRung(MON, MON + D, bad, UTC), one);
      assert.strictEqual(
        ticksCalendar(MON, MON + D, bad, UTC).length,
        ticksCalendar(MON, MON + D, 1, UTC).length,
      );
    }
    assert.isAbove(ticksCalendar(MON, MON + D, 0, UTC).length, 0);
  });

  test("no reachable input produces a negative zero", () => {
    // MEASURED, not assumed (step 15's §7 precedent). Epoch
    // milliseconds are integers and nothing on any path here
    // multiplies by zero, so — unlike every other kernel module —
    // this one carries no private `num()`. The sweep below is
    // what licenses that, and it is why the guarantee is checked
    // rather than argued.
    let seen = 0;
    for (const zone of [UTC, NY, "Asia/Kolkata"]) {
      for (const count of [1, 5, 10]) {
        for (const span of [45000, 5 * H, 3 * D, 400 * D]) {
          // A domain straddling the epoch is the only plausible
          // source of one.
          for (const a of [-span / 2, 0, MON]) {
            for (const v of ticksCalendar(a, a + span, count, zone)) {
              if (Object.is(v, -0)) {
                seen++;
              }
            }
            for (const v of niceCalendar(a, a + span, count, zone)) {
              if (Object.is(v, -0)) {
                seen++;
              }
            }
          }
        }
      }
    }
    assert.strictEqual(seen, 0);
  });
});
