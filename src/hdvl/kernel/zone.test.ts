/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import {
  CalendarUnit,
  addUnits,
  ceilTo,
  fieldsOf,
  floorTo,
} from "./zone";

/**
 * RFC §4.8 / §9.4 — the calendar-arithmetic seam.
 *
 * A pure fixture table: no DOM, no computed style, no element, no
 * `fixture` import. **One test is `async`, and it is the reason
 * this file exists in the shape it does** — plan rule 5's
 * assertion reads this module's own compiled source over `fetch`,
 * which no synchronous form can do. That is the file's single
 * exception to the kernel suite convention, and nothing else in it
 * awaits.
 *
 * **Which cross-engine rule applies where** (plan rules 1, 5, 7):
 *
 * - Every boundary is an **exact integer epoch-ms**, asserted with
 *   `deepEqual` against hand-stated integers on all three engines
 *   (rule 1). Unlike step 15's band geometry, which had to be
 *   fixture-scoped because `f(k) + d === f(k+1)` compares two
 *   roundings against one, these are integers and the exactness is
 *   **universal**.
 * - Rule 2 (`closeTo`) does **not** bind: there is no
 *   transcendental on any path in the module.
 * - Rule 4 does **not** bind: a boundary is a number, not a
 *   formatted string. Formatting is step 17's.
 * - Rule 5 binds, and it binds through the **source**, not
 *   behaviour — see the first suite.
 * - Rule 7 has exactly one declared exception in this file, also
 *   in the first suite, and it says so where it happens.
 */

/** The zone every DST fixture is measured in. */
const NY = "America/New_York";

/** §4.2's default for a zone-less domain. */
const UTC = "UTC";

/**
 * 2026-03-08T13:47:33.412Z — 09:47:33.412 in New York.
 *
 * Deliberately on the spring-forward day, so one instant serves
 * both the ordinary field tests and the DST ones and a reader can
 * check them against each other.
 */
const T = 1772977653412;

/** Local midnight on the 23-hour day, 2026-03-08 in New York. */
const SPRING = 1772946000000;

/** Local midnight on the 25-hour day, 2026-11-01 in New York. */
const FALL = 1793505600000;

/** Every unit, coarsest last — the order every table below uses. */
const UNITS: CalendarUnit[] = [
  "second",
  "minute",
  "hour",
  "day",
  "week",
  "month",
  "year",
];

/* -------------------------------------------------------------- */
/* Rule 5 — asserted against the SOURCE, not the behaviour         */
/* -------------------------------------------------------------- */

suite("hdvl/kernel/zone — one implementation, every engine", () => {
  test("zone.ts never reads a global implementation", async () => {
    // WHY THE SOURCE AND NOT THE BEHAVIOUR. The standard binding
    // is present on chromium and firefox and absent on webkit
    // (R4, measured). A behavioural test cannot tell a polyfilled
    // implementation from a native one — both compute the same
    // boundary — so a green behavioural suite is exactly what a
    // feature-detecting implementation would produce while
    // running DIFFERENT CODE on each engine. That is what plan
    // rule 5 exists to forbid, and only the source text can
    // witness it.
    const res = await fetch(new URL("./zone.js", import.meta.url));
    const src = await res.text();
    assert.isTrue(res.ok);

    assert.notInclude(src, "globalThis.Temporal");
    assert.notInclude(src, "typeof Temporal");
    assert.notInclude(src, "temporal-polyfill/global");
    // The other two global spellings, as a pattern rather than as
    // literals: writing either one out would put the token this
    // directory's own purity grep searches for into the kernel,
    // and an assertion string is still source text.
    assert.notMatch(src, /\b(window|self|globalThis)\s*\.\s*Tempo/);

    // The positive half: it really does import the ponyfill. The
    // dev server rewrites the bare specifier to a path, so match
    // the package name rather than the import statement.
    assert.match(src, /temporal-polyfill/);
  });

  test("the same boundary is computed on every engine", () => {
    // The cross-engine claim in its behavioural form. It is not a
    // substitute for the source assertion above — it is what that
    // assertion makes MEAN something, because these integers are
    // now known to come from one implementation.
    assert.deepEqual(
      UNITS.map((u) => floorTo(T, u, NY)),
      [
        1772977653000, // 09:47:33 EDT
        1772977620000, // 09:47
        1772974800000, // 09:00
        1772946000000, // 2026-03-08
        1772427600000, // Mon 2026-03-02
        1772341200000, // 2026-03-01
        1767243600000, // 2026-01-01
      ],
    );
  });

  test("no global was patched", () => {
    // THE ONE ENGINE-SCOPED CLAIM IN THIS STEP, and rule 7's one
    // declared exception. On chromium and firefox a native
    // `Temporal` may legitimately be on the global object and its
    // presence says nothing about us; only on webkit — where
    // there is none to begin with — does its absence prove the
    // ponyfill did not leak.
    const ua = navigator.userAgent;
    const webkit =
      /AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg\//.test(ua);
    if (webkit) {
      assert.isFalse("Temporal" in globalThis);
    } else {
      assert.isTrue(true, "not webkit — see the comment above");
    }
  });
});

/* -------------------------------------------------------------- */
/* floorTo / ceilTo                                               */
/* -------------------------------------------------------------- */

suite("hdvl/kernel/zone — floorTo", () => {
  test("floors to every unit, in the zone", () => {
    assert.deepEqual(
      UNITS.map((u) => floorTo(T, u, NY)),
      [
        1772977653000, 1772977620000, 1772974800000, 1772946000000,
        1772427600000, 1772341200000, 1767243600000,
      ],
    );
  });

  test("a week floors to ISO Monday, not to Sunday", () => {
    // 2026-03-08 is a SUNDAY, so a Sunday-based week would floor
    // to the day itself and a domain-start-based one to 03-08.
    // ISO floors back six days, to Monday 2026-03-02.
    const monday = floorTo(T, "week", NY);
    assert.strictEqual(monday, 1772427600000);
    const f = fieldsOf(monday, NY);
    assert.deepEqual([f.year, f.month, f.day], [2026, 3, 2]);
    assert.deepEqual([f.hour, f.minute, f.second], [0, 0, 0]);
  });

  test("every boundary is an exact integer", () => {
    for (const u of UNITS) {
      assert.isTrue(Number.isInteger(floorTo(T, u, NY)));
      assert.isTrue(Number.isInteger(ceilTo(T, u, NY)));
    }
  });

  test("boundaries are the zone's, never UTC's", () => {
    // The load-bearing one. An implementation that floors in UTC
    // and only formats in the zone passes every other test here.
    assert.strictEqual(floorTo(T, "day", UTC), 1772928000000);
    assert.strictEqual(floorTo(T, "day", NY), 1772946000000);
    assert.strictEqual(
      (floorTo(T, "day", NY) - floorTo(T, "day", UTC)) / 3600000,
      5,
    );
  });
});

suite("hdvl/kernel/zone — ceilTo", () => {
  test("ceils to every unit, in the zone", () => {
    assert.deepEqual(
      UNITS.map((u) => ceilTo(T, u, NY)),
      [
        1772977654000, // 09:47:34
        1772977680000, // 09:48
        1772978400000, // 10:00
        1773028800000, // 2026-03-09
        1773028800000, // Mon 2026-03-09
        1775016000000, // 2026-04-01
        1798779600000, // 2027-01-01
      ],
    );
  });

  test("the ceiling of a boundary is that boundary", () => {
    for (const u of UNITS) {
      const b = floorTo(T, u, NY);
      assert.strictEqual(ceilTo(b, u, NY), b);
    }
  });
});

/* -------------------------------------------------------------- */
/* addUnits — wall clock, not elapsed milliseconds                */
/* -------------------------------------------------------------- */

suite("hdvl/kernel/zone — addUnits", () => {
  test("adds wall-clock hours across spring forward", () => {
    // 02:00 does not exist on 2026-03-08 in New York, so under
    // `compatible` the 02:00 and 03:00 rungs are ONE instant.
    // This is the platform fact the calendar ladder's
    // de-duplication rests on, asserted here rather than inferred
    // there.
    assert.deepEqual(
      [0, 1, 2, 3, 4, 5, 6].map((k) =>
        addUnits(SPRING, k, "hour", NY),
      ),
      [
        1772946000000, // 00:00 EST
        1772949600000, // 01:00 EST
        1772953200000, // 03:00 EDT  ← wall 02:00 moved forward
        1772953200000, // 03:00 EDT  ← the same instant
        1772956800000, // 04:00 EDT
        1772960400000, // 05:00 EDT
        1772964000000, // 06:00 EDT
      ],
    );
    assert.strictEqual(
      addUnits(SPRING, 2, "hour", NY),
      addUnits(SPRING, 3, "hour", NY),
    );
  });

  test("adds wall-clock hours across fall back", () => {
    // The repeated 01:00 takes the FIRST (EDT) instant, so the
    // second one — 1793512800000 — is never produced and there is
    // no duplicate to remove on this side.
    assert.deepEqual(
      [0, 1, 2, 3, 4].map((k) => addUnits(FALL, k, "hour", NY)),
      [
        1793505600000, // 00:00 EDT
        1793509200000, // 01:00 EDT — the earlier of the two
        1793516400000, // 02:00 EST
        1793520000000, // 03:00 EST
        1793523600000, // 04:00 EST
      ],
    );
    assert.notInclude(
      [0, 1, 2, 3, 4].map((k) => addUnits(FALL, k, "hour", NY)),
      1793512800000,
      "the repeated 01:00 EST instant is never a boundary",
    );
  });

  test("a day is 23 hours long across spring forward", () => {
    // The clearest single proof that this is calendar arithmetic
    // and not `+ 86400000`. Local midnight either side, 23 hours
    // of real time between them.
    const next = addUnits(SPRING, 1, "day", NY);
    assert.strictEqual(next, 1773028800000);
    assert.strictEqual((next - SPRING) / 3600000, 23);
    assert.strictEqual(fieldsOf(next, NY).hour, 0);
  });

  test("a day is 25 hours long across fall back", () => {
    const next = addUnits(FALL, 1, "day", NY);
    assert.strictEqual(next, 1793595600000);
    assert.strictEqual((next - FALL) / 3600000, 25);
    assert.strictEqual(fieldsOf(next, NY).hour, 0);
  });

  test("adds calendar months and years, not fixed spans", () => {
    const jan = floorTo(T, "year", NY);
    assert.strictEqual(addUnits(jan, 1, "month", NY), 1769922000000);
    assert.strictEqual(addUnits(jan, 12, "month", NY), 1798779600000);
    assert.strictEqual(addUnits(jan, 1, "year", NY), 1798779600000);
  });

  test("a week is seven days", () => {
    const monday = floorTo(T, "week", NY);
    assert.strictEqual(
      addUnits(monday, 1, "week", NY),
      addUnits(monday, 7, "day", NY),
    );
  });

  test("accepts a negative amount", () => {
    // How the ladder snaps a unit boundary back onto its multiple.
    const nine = floorTo(T, "hour", NY);
    assert.strictEqual(addUnits(nine, -3, "hour", NY), 1772964000000);
    assert.strictEqual(addUnits(nine, 0, "hour", NY), nine);
  });
});

/* -------------------------------------------------------------- */
/* fieldsOf                                                       */
/* -------------------------------------------------------------- */

suite("hdvl/kernel/zone — fieldsOf", () => {
  test("reads the wall clock in the zone", () => {
    assert.deepEqual(fieldsOf(T, NY), {
      year: 2026,
      month: 3,
      day: 8,
      hour: 9,
      minute: 47,
      second: 33,
      millisecond: 412,
      offset: -240,
    });
  });

  test("reads the same instant differently in UTC", () => {
    assert.deepEqual(fieldsOf(T, UTC), {
      year: 2026,
      month: 3,
      day: 8,
      hour: 13,
      minute: 47,
      second: 33,
      millisecond: 412,
      offset: 0,
    });
  });

  test("the offset moves across a transition", () => {
    assert.strictEqual(fieldsOf(SPRING, NY).offset, -300);
    assert.strictEqual(
      fieldsOf(addUnits(SPRING, 4, "hour", NY), NY).offset,
      -240,
    );
    assert.strictEqual(fieldsOf(FALL, NY).offset, -240);
    assert.strictEqual(
      fieldsOf(addUnits(FALL, 4, "hour", NY), NY).offset,
      -300,
    );
  });

  test("months are 1-12, not 0-11", () => {
    assert.strictEqual(fieldsOf(floorTo(T, "year", NY), NY).month, 1);
  });
});

/* -------------------------------------------------------------- */
/* The input contract                                             */
/* -------------------------------------------------------------- */

suite("hdvl/kernel/zone — the input contract", () => {
  test("a zone-less ISO literal is UTC (§4.2)", () => {
    // The platform's own rule for the date-only form, which is
    // what makes `"UTC"` the value §4.2 tells a zone-less caller
    // to pass rather than something the kernel invents.
    const iso = Date.parse("2025-01-01");
    assert.strictEqual(iso, 1735689600000);
    // Read as UTC it IS a day boundary; read in New York it is
    // 19:00 the previous evening, so the boundary is five hours
    // earlier. That difference is what makes the default a
    // decision rather than an accident.
    assert.strictEqual(floorTo(iso, "day", UTC), 1735689600000);
    assert.strictEqual(floorTo(iso, "day", NY), 1735621200000);
  });

  test("an unknown zone throws RangeError", () => {
    // DECIDED, not defaulted: it propagates. A silent fall back
    // to UTC would shift every boundary in the chart by the
    // intended zone's offset with nothing anywhere reporting it.
    // Diagnosing a bad authored zone is the validator's job, at
    // step 18.
    assert.throws(
      () => floorTo(T, "day", "Nope/Nowhere"),
      RangeError,
    );
    assert.throws(() => ceilTo(T, "day", "Nope/Nowhere"), RangeError);
    assert.throws(
      () => addUnits(T, 1, "day", "Nope/Nowhere"),
      RangeError,
    );
    assert.throws(() => fieldsOf(T, "Nope/Nowhere"), RangeError);
  });

  test("UTC has no transitions to disambiguate", () => {
    assert.strictEqual(fieldsOf(0, UTC).offset, 0);
    assert.strictEqual(floorTo(0, "day", UTC), 0);
    assert.isFalse(Object.is(floorTo(0, "day", UTC), -0));
  });
});
