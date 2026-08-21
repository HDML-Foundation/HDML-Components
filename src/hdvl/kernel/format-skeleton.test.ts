/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import {
  SkeletonKind,
  dateOptions,
  formatCompactSet,
  formatValue,
  formatterFor,
  numberOptions,
  skeletonKind,
} from "./format-skeleton";

/**
 * RFC §4.9 / SPEC §7 — the CLDR skeleton formatter.
 *
 * A pure fixture table: no DOM, no computed style, no element, no
 * `fixture` import, and — unlike `zone.test.ts` — **no `async`
 * test at all**, because nothing here has to read its own source.
 *
 * **★ Which cross-engine rule applies where** (plan rules 1, 4, 7,
 * 9). This is the one file in the project where rule 4 binds, and
 * it licenses far less than it looks like.
 *
 * - **Rule 1 — exact, all three engines — covers every option
 *   bag.** `deepEqual` on what {@link numberOptions} and
 *   {@link dateOptions} return is the cross-engine contract: it is
 *   this repo's own mapping, computed by this repo's own code, and
 *   no ICU data enters it.
 * - **Rule 1 also covers every *structural* claim about the
 *   shared compact prefix** — that every label in a set carries
 *   the same part, that the part is the one `formatToParts` gives
 *   for the largest-magnitude endpoint, that the numeric halves
 *   are `value / divisor`. Each compares labels **to each other**
 *   or to a value read from the **same** `Intl` API, never to a
 *   literal, so each holds wherever `Intl` is self-consistent.
 * - **Rule 4 — chromium only — covers rendered strings and
 *   nothing else.** `"1.2M"`, `"$1.50M"` and NBSP-vs-space are
 *   ICU version and OS data. Those assertions live in exactly one
 *   suite, guarded explicitly, and that suite says so.
 * - **Rule 7's one declared exception in this file is that
 *   suite.** The guard itself is asserted on all three engines, so
 *   a future engine-detection change cannot silently skip it.
 * - **Rule 2 (`closeTo`) does not bind** — there is no
 *   transcendental on any path. The one tolerance in the file is
 *   the round-trip through a formatted string, and it is derived
 *   from the skeleton's own `maximumFractionDigits` rather than
 *   from a magic constant.
 * - **Rule 9 binds**: measured here, a signed zero prints with a
 *   minus sign, so the module normalises and this file sweeps for
 *   it.
 */

/* -------------------------------------------------------------- */
/* Engine classification — rule 7's guard, asserted               */
/* -------------------------------------------------------------- */

type Engine = "chromium" | "firefox" | "webkit" | "unclassified";

/**
 * Which of the three engines this run is on.
 *
 * Firefox is tested first because its UA names neither of the
 * other two, and chromium before webkit because a chromium UA
 * also carries `AppleWebKit`.
 */
function engineOf(ua: string): Engine {
  if (/Firefox/.test(ua)) return "firefox";
  if (/Chrome|Chromium|Edg\//.test(ua)) return "chromium";
  if (/AppleWebKit/.test(ua)) return "webkit";
  return "unclassified";
}

/** The engine this run is on. */
const ENGINE = engineOf(navigator.userAgent);

/* -------------------------------------------------------------- */
/* Fixtures                                                        */
/* -------------------------------------------------------------- */

/** SPEC §7's own example set — `0.9M, 1.2M, 1.5M`. */
const SPEC_SET = [900_000, 1_200_000, 1_500_000];

/** 2026-03-08T13:47:33.412Z — `zone.test.ts`'s instant. */
const T = 1772977653412;

/** The part types that carry the number itself. */
const NUMERIC = new Set(["integer", "group", "decimal", "fraction"]);

/**
 * Everything `Intl` prints after the number, read back off the
 * same API the module reads it off.
 *
 * Re-derived here rather than imported: a test that imported the
 * module's own splitter would assert that the code equals itself.
 */
function tailOf(parts: readonly Intl.NumberFormatPart[]): string {
  let last = -1;
  for (let i = 0; i < parts.length; i++) {
    if (NUMERIC.has(parts[i].type)) last = i;
  }
  if (last < 0) return "";
  let out = "";
  for (let i = last + 1; i < parts.length; i++) {
    out += parts[i].value;
  }
  return out;
}

/** The compact part `Intl` gives one value, on its own. */
function suffixOf(
  value: number,
  locale: string,
  display: "short" | "long" = "short",
): string {
  const fmt = new Intl.NumberFormat(locale, {
    notation: "compact",
    compactDisplay: display,
  });
  return tailOf(fmt.formatToParts(value));
}

/** The number `Intl` printed, in Latin digits. */
function numericOf(value: number, locale: string): number {
  const latin = new Intl.Locale(locale, {
    numberingSystem: "latn",
  }).toString();
  const fmt = new Intl.NumberFormat(latin, { notation: "compact" });
  const parts = fmt.formatToParts(value);
  let digits = "";
  for (const part of parts) {
    if (part.type === "integer" || part.type === "fraction") {
      digits += part.value;
    } else if (part.type === "decimal") {
      digits += ".";
    }
  }
  return Number(digits);
}

/** The decimal half of a skeleton — its bag without the compact. */
function decimalBag(skeleton: string): Intl.NumberFormatOptions {
  const bag = { ...(numberOptions(skeleton) ?? {}) };
  delete bag.notation;
  delete bag.compactDisplay;
  return bag;
}

/**
 * Half a unit in the last place the skeleton asks for.
 *
 * A label is a **rounded** rendering of `value / divisor`, so the
 * round-trip in the `value / divisor` assertion is not exact. The
 * tolerance is read off the same option bag the module formats
 * with rather than being a magic `1e-9` — plan rule 2 does not
 * bind here and borrowing its constant would assert the wrong
 * thing.
 */
function tolerance(skeleton: string, locale: string): number {
  const fmt = new Intl.NumberFormat(locale, decimalBag(skeleton));
  const digits = fmt.resolvedOptions().maximumFractionDigits ?? 3;
  return 0.5 * 10 ** -digits;
}

/** A label's numeric half, parsed back out of `en` output. */
function parseEn(label: string, suffix: string): number {
  const bare = label.split(suffix).join("");
  return Number(bare.replace(/[^0-9.-]/g, ""));
}

/* -------------------------------------------------------------- */
/* Rule 7 — the guard is asserted before anything relies on it     */
/* -------------------------------------------------------------- */

suite("hdvl/kernel/format-skeleton — the engine guard", () => {
  test("every engine the suite runs on classifies", () => {
    // WHY THIS TEST EXISTS. One suite below is chromium-scoped
    // under rule 4. If `engineOf` ever stopped recognising an
    // engine it would return "unclassified", that suite would
    // quietly assert nothing on every engine, and the build would
    // stay green. This is the assertion that makes the scoping
    // visible rather than silent.
    assert.oneOf(ENGINE, ["chromium", "firefox", "webkit"]);
  });

  test("the classifier is exclusive", () => {
    assert.strictEqual(
      engineOf("Mozilla/5.0 Firefox/128.0"),
      "firefox",
    );
    assert.strictEqual(
      engineOf("Mozilla/5.0 AppleWebKit/537 Chrome/145 Safari/537"),
      "chromium",
    );
    assert.strictEqual(
      engineOf("Mozilla/5.0 AppleWebKit/605 Version/17 Safari/605"),
      "webkit",
    );
  });
});

/* -------------------------------------------------------------- */
/* §4.9's number table — exact, all three engines                  */
/* -------------------------------------------------------------- */

suite("hdvl/kernel/format-skeleton — §4.9's number stems", () => {
  test("compact-short", () => {
    assert.deepEqual(numberOptions("compact-short"), {
      notation: "compact",
      compactDisplay: "short",
    });
  });

  test("compact-long", () => {
    assert.deepEqual(numberOptions("compact-long"), {
      notation: "compact",
      compactDisplay: "long",
    });
  });

  test("percent", () => {
    assert.deepEqual(numberOptions("percent"), { style: "percent" });
  });

  test("currency/XXX takes any ISO 4217 code", () => {
    assert.deepEqual(numberOptions("currency/USD"), {
      style: "currency",
      currency: "USD",
    });
    assert.deepEqual(numberOptions("currency/EUR"), {
      style: "currency",
      currency: "EUR",
    });
    // Three ASCII capitals or nothing — a lowercase or four-letter
    // code is not a code.
    assert.isNull(numberOptions("currency/usd"));
    assert.isNull(numberOptions("currency/USDX"));
    assert.isNull(numberOptions("currency/"));
  });

  test("precision-integer", () => {
    assert.deepEqual(numberOptions("precision-integer"), {
      maximumFractionDigits: 0,
    });
  });

  test("fraction digits — zeros are the minimum", () => {
    // §4.9's row is the one with a real parse in it: the count of
    // `0`s is the MINIMUM and the total count is the MAXIMUM.
    assert.deepEqual(numberOptions(".#"), {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    });
    assert.deepEqual(numberOptions(".##"), {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
    assert.deepEqual(numberOptions(".0#"), {
      minimumFractionDigits: 1,
      maximumFractionDigits: 2,
    });
    assert.deepEqual(numberOptions(".0"), {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    assert.deepEqual(numberOptions(".00##"), {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
  });

  test("a bare `.` is exactly no fraction digits", () => {
    assert.deepEqual(numberOptions("."), {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  });

  test("a `#` before a `0` is rejected, not normalised", () => {
    // UTS #35 has no such form. Accepting it silently would make
    // two different skeletons format identically with nothing
    // saying so.
    assert.isNull(numberOptions(".#0"));
    assert.isNull(numberOptions(".#0#"));
    // And a fraction stem needs its leading `.`.
    assert.isNull(numberOptions("#"));
    assert.isNull(numberOptions("0"));
  });
});

/* -------------------------------------------------------------- */
/* §4.9's date table — exact, all three engines                    */
/* -------------------------------------------------------------- */

suite("hdvl/kernel/format-skeleton — §4.9's date fields", () => {
  test("y yy", () => {
    assert.deepEqual(dateOptions("y"), { year: "numeric" });
    assert.deepEqual(dateOptions("yy"), { year: "2-digit" });
  });

  test("M MM MMM MMMM", () => {
    assert.deepEqual(dateOptions("M"), { month: "numeric" });
    assert.deepEqual(dateOptions("MM"), { month: "2-digit" });
    assert.deepEqual(dateOptions("MMM"), { month: "short" });
    assert.deepEqual(dateOptions("MMMM"), { month: "long" });
  });

  test("d dd", () => {
    assert.deepEqual(dateOptions("d"), { day: "numeric" });
    assert.deepEqual(dateOptions("dd"), { day: "2-digit" });
  });

  test("E EEEE, and CLDR's abbreviated widths between", () => {
    assert.deepEqual(dateOptions("E"), { weekday: "short" });
    assert.deepEqual(dateOptions("EEEE"), { weekday: "long" });
    // CLDR makes E, EE and EEE one width and `Intl` has no option
    // that could tell them apart.
    assert.deepEqual(dateOptions("EE"), { weekday: "short" });
    assert.deepEqual(dateOptions("EEE"), { weekday: "short" });
  });

  test("H HH carry hour12: false", () => {
    // Not decoration: this is the difference between a 24-hour
    // axis and a 12-hour one, so it is a mapping row and is
    // asserted exactly on every engine even though what it
    // renders is not.
    assert.deepEqual(dateOptions("H"), {
      hour: "numeric",
      hour12: false,
    });
    assert.deepEqual(dateOptions("HH"), {
      hour: "2-digit",
      hour12: false,
    });
  });

  test("m mm", () => {
    assert.deepEqual(dateOptions("m"), { minute: "numeric" });
    assert.deepEqual(dateOptions("mm"), { minute: "2-digit" });
  });

  test("a width outside the conformance subset is null", () => {
    assert.isNull(dateOptions("yyy"));
    assert.isNull(dateOptions("MMMMM"));
    assert.isNull(dateOptions("ddd"));
    assert.isNull(dateOptions("HHH"));
    assert.isNull(dateOptions("mmm"));
    assert.isNull(dateOptions("EEEEE"));
  });

  test("the same field twice is null", () => {
    assert.isNull(dateOptions("yMy"));
    assert.isNull(dateOptions("yy y"));
  });
});

/* -------------------------------------------------------------- */
/* Composition, order-freedom, and the disjoint token spaces       */
/* -------------------------------------------------------------- */

suite("hdvl/kernel/format-skeleton — composition", () => {
  test("two stems merge into one bag", () => {
    assert.deepEqual(numberOptions("percent precision-integer"), {
      style: "percent",
      maximumFractionDigits: 0,
    });
    assert.deepEqual(numberOptions("currency/USD compact-short"), {
      style: "currency",
      currency: "USD",
      notation: "compact",
      compactDisplay: "short",
    });
  });

  test("a stem order is not a bag order", () => {
    assert.deepEqual(
      numberOptions("precision-integer percent"),
      numberOptions("percent precision-integer"),
    );
  });

  test("two stems that contradict are null", () => {
    assert.isNull(numberOptions("percent currency/USD"));
    assert.isNull(numberOptions("compact-short compact-long"));
    assert.isNull(numberOptions("precision-integer .##"));
  });

  test("yMMMd is a three-field set with no order implied", () => {
    assert.deepEqual(dateOptions("yMMMd"), {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    // The set, not the sequence: every permutation of the runs is
    // the same bag, because CLDR orders the fields per locale.
    assert.deepEqual(dateOptions("dMMMy"), dateOptions("yMMMd"));
    assert.deepEqual(dateOptions("MMMdy"), dateOptions("yMMMd"));
    // And whitespace between runs means nothing.
    assert.deepEqual(dateOptions("y MMM d"), dateOptions("yMMMd"));
  });

  test("Hm is the two-field time set", () => {
    assert.deepEqual(dateOptions("Hm"), {
      hour: "numeric",
      hour12: false,
      minute: "numeric",
    });
  });
});

suite("hdvl/kernel/format-skeleton — the token spaces", () => {
  test("every conformance-subset stem classifies as number", () => {
    const stems = [
      "compact-short",
      "compact-long",
      "percent",
      "currency/USD",
      "precision-integer",
      ".#",
      ".0#",
      "percent precision-integer",
      "currency/USD compact-short",
    ];
    assert.deepEqual(
      stems.map(skeletonKind),
      stems.map((): SkeletonKind => "number"),
    );
  });

  test("every date field run classifies as date", () => {
    const runs = ["y", "MMM", "d", "EEEE", "H", "mm", "yMMMd", "Hm"];
    assert.deepEqual(
      runs.map(skeletonKind),
      runs.map((): SkeletonKind => "date"),
    );
  });

  test("classification needs no scale chain and no bag", () => {
    // The whole point of §4.9's disjointness. `MMMMM` is in the
    // date space — its letters are date letters — while its bag
    // is null, because CLDR's narrow width is outside SPEC §7's
    // conformance subset. That PAIR is how a caller tells "wrong
    // token space" from "right space, unsupported", and a single
    // `null` could not express it.
    assert.strictEqual(skeletonKind("MMMMM"), "date");
    assert.isNull(dateOptions("MMMMM"));
    assert.strictEqual(
      skeletonKind("percent currency/USD"),
      "number",
    );
    assert.isNull(numberOptions("percent currency/USD"));
  });

  test("both spaces at once is `mixed`, not `unknown`", () => {
    // V14's "never both" is about exactly this string, and step 24
    // needs to tell it apart from a string that is no skeleton at
    // all without re-tokenising.
    assert.strictEqual(skeletonKind("compact-short yMMMd"), "mixed");
    assert.strictEqual(skeletonKind("yMMMd percent"), "mixed");
  });

  test("neither space is `unknown`", () => {
    assert.strictEqual(skeletonKind("nonsense"), "unknown");
    assert.strictEqual(skeletonKind("compact-medium"), "unknown");
    assert.strictEqual(skeletonKind(""), "unknown");
    assert.strictEqual(skeletonKind("   "), "unknown");
    // One unrecognised token makes the whole string
    // unclassifiable, even beside a recognised one.
    assert.strictEqual(
      skeletonKind("compact-short nonsense"),
      "unknown",
    );
  });

  test("the spaces really are disjoint", () => {
    // Not a tautology: it is the property §4.9 asserts and V14
    // rests on. No conformance-subset stem is also a date run, and
    // no date run is also a stem.
    const stems = [
      "compact-short",
      "compact-long",
      "percent",
      "currency/USD",
      "precision-integer",
      ".#",
    ];
    const runs = ["y", "MMM", "dd", "EEEE", "HH", "m", "yMMMd"];
    for (const stem of stems) {
      assert.isNull(dateOptions(stem), stem);
    }
    for (const run of runs) {
      assert.isNull(numberOptions(run), run);
    }
  });
});

/* -------------------------------------------------------------- */
/* ★ The shared compact prefix — structural, all three engines     */
/* -------------------------------------------------------------- */

suite("hdvl/kernel/format-skeleton — the shared prefix", () => {
  test("§4.9's compact part is present on this engine", () => {
    // §4.9 claims the part is "present on all three engines,
    // measured". This test IS that measurement, and it runs on
    // all three — so if an engine ever stops emitting it, the
    // algorithm's step 1 fails here rather than silently
    // producing an axis with no prefix.
    const parts = new Intl.NumberFormat("en", {
      notation: "compact",
    }).formatToParts(1_500_000);
    assert.isTrue(parts.some((p) => p.type === "compact"));
  });

  test("every label in a set carries one part", () => {
    for (const locale of ["en", "de", "ja"]) {
      const labels = formatCompactSet(
        SPEC_SET,
        "compact-short",
        locale,
      );
      const suffix = suffixOf(1_500_000, locale);
      assert.isTrue(suffix.length > 0, locale);
      const tails = new Set(labels.map((l) => l.endsWith(suffix)));
      assert.strictEqual(tails.size, 1, locale);
      assert.isTrue(
        labels.every((l) => l.endsWith(suffix)),
        locale,
      );
    }
  });

  test("the part is the largest-magnitude endpoint's", () => {
    // Read off the SAME API rather than hardcoded, so this is a
    // claim about `Intl`'s self-consistency and holds on every
    // engine.
    const labels = formatCompactSet(SPEC_SET, "compact-short", "en");
    assert.isTrue(
      labels.every((l) => l.endsWith(suffixOf(1_500_000, "en"))),
    );
    // And it is NOT the smallest endpoint's, which is the whole
    // point — 900 000 alone would say `K`.
    assert.notStrictEqual(
      suffixOf(900_000, "en"),
      suffixOf(1_500_000, "en"),
    );
  });

  test("the naive form really does differ", () => {
    // Without this the suite cannot fail for the reason it
    // exists. SPEC §7's own example: per value, `900K, 1.2M,
    // 1.5M`; as a set, one part throughout.
    const naive = new Set(SPEC_SET.map((v) => suffixOf(v, "en")));
    assert.strictEqual(naive.size, 2);
    const shared = formatCompactSet(SPEC_SET, "compact-short", "en");
    const suffix = suffixOf(1_500_000, "en");
    assert.strictEqual(
      new Set(shared.map((l) => l.slice(-suffix.length))).size,
      1,
    );
  });

  test("the numeric halves are value / divisor", () => {
    // The fixtures are chosen so `peak / numeric` is exact — the
    // reduced-fixture tactic rule 1's amendment prescribes — so
    // the only inexactness left is the rounding inside the label,
    // which `tolerance` bounds.
    const peak = 1_500_000;
    const divisor = peak / numericOf(peak, "en");
    const suffix = suffixOf(peak, "en");
    const labels = formatCompactSet(SPEC_SET, "compact-short", "en");
    const tol = tolerance("compact-short", "en");
    for (let i = 0; i < SPEC_SET.length; i++) {
      assert.closeTo(
        parseEn(labels[i], suffix),
        SPEC_SET[i] / divisor,
        tol,
        labels[i],
      );
    }
  });

  test("below 1000 there is no part at all", () => {
    // The case a divisor lookup table silently breaks, and the
    // common one.
    assert.strictEqual(suffixOf(999, "en"), "");
    const labels = formatCompactSet(
      [1, 50, 999],
      "compact-short",
      "en",
    );
    assert.strictEqual(labels.length, 3);
    for (const label of labels) {
      assert.isTrue(/[0-9]/.test(label), label);
    }
  });

  test("largest magnitude is max(|v|), not max(v)", () => {
    // A domain spanning [-2e6, 5e5] takes its part from the
    // NEGATIVE endpoint.
    const labels = formatCompactSet(
      [-2e6, 0, 5e5],
      "compact-short",
      "en",
    );
    const suffix = suffixOf(2e6, "en");
    assert.isTrue(suffix.length > 0);
    assert.isTrue(
      labels.every((l) => l.endsWith(suffix)),
      labels.join(),
    );
    // 500 000 on its own would carry a different part.
    assert.notStrictEqual(suffixOf(5e5, "en"), suffix);
  });

  test("a rounded-up endpoint still snaps to its own decade", () => {
    // 999 999 prints compactly as one million, so the recovered
    // ratio is 999 999 rather than 1e6 — the snap to the nearest
    // power of ten is what keeps the divisor right.
    const labels = formatCompactSet(
      [999_999, 500_000],
      "compact-short",
      "en",
    );
    const suffix = suffixOf(999_999, "en");
    assert.isTrue(
      labels.every((l) => l.endsWith(suffix)),
      labels.join(),
    );
  });

  test("compact-long shares the part the same way", () => {
    // The part is a word rather than a letter, and its locale
    // separator rides with it — which is why the module captures
    // everything after the number and not the `compact` part
    // alone.
    const labels = formatCompactSet(SPEC_SET, "compact-long", "en");
    const suffix = suffixOf(1_500_000, "en", "long");
    assert.isTrue(suffix.length > 1, JSON.stringify(suffix));
    assert.isTrue(
      labels.every((l) => l.endsWith(suffix)),
      labels.join(),
    );
  });

  test("the part sits inside a sign-suffixed rendering", () => {
    // §4.9 step 3 says "append"; that is only right where the
    // currency or percent sign is a PREFIX. Structurally: every
    // label contains the one part, and in the percent case it is
    // not at the end.
    const pct = formatCompactSet(
      SPEC_SET,
      "percent compact-short",
      "en",
    );
    const suffix = suffixOf(1_500_000, "en");
    assert.isTrue(
      pct.every((l) => l.includes(suffix)),
      pct.join(),
    );
    assert.isFalse(pct[2].endsWith(suffix), pct[2]);
    const fr = formatCompactSet(
      SPEC_SET,
      "currency/USD compact-short",
      "fr",
    );
    assert.isTrue(
      fr.every((l) => l.includes(suffix)),
      fr.join(),
    );
    // `fr` puts the currency AFTER the number, so the part sits
    // between the two and appending would have put it last.
    assert.isFalse(fr[2].endsWith(suffix), fr[2]);
  });

  test("a non-power-of-1000 divisor is recovered", () => {
    // `ja` groups by 10 000 at 万, so a table of thousands would
    // be wrong. The set is still coherent.
    const labels = formatCompactSet(SPEC_SET, "compact-short", "ja");
    const suffix = suffixOf(1_500_000, "ja");
    assert.isTrue(
      labels.every((l) => l.endsWith(suffix)),
      labels.join(),
    );
    assert.strictEqual(
      1_500_000 / numericOf(1_500_000, "ja"),
      10_000,
    );
  });

  test("a non-Latin numbering system is recovered too", () => {
    // The divisor probe forces `latn` so the digits are readable;
    // the LABELS keep the locale's own digits. The numbering
    // system is named EXPLICITLY: measured at step 17, `ar` alone
    // resolves to `latn` on chromium and firefox and to `arab` on
    // webkit, so a bare `"ar"` would make this an engine-scoped
    // claim rather than a structural one.
    const locale = "ar-u-nu-arab";
    const labels = formatCompactSet(
      SPEC_SET,
      "compact-short",
      locale,
    );
    const suffix = suffixOf(1_500_000, locale);
    assert.isTrue(suffix.length > 0);
    assert.isTrue(
      labels.every((l) => l.includes(suffix)),
      labels.join(),
    );
    assert.isFalse(/[0-9]/.test(labels[2]), labels[2]);
  });

  test("a skeleton with no compact stem passes through", () => {
    assert.deepEqual(
      formatCompactSet(SPEC_SET, "precision-integer", "en"),
      SPEC_SET.map((v) =>
        formatValue(v, "precision-integer", "en", null),
      ),
    );
  });

  test("an unmappable skeleton falls back, one label each", () => {
    // Totality is what makes this H6's single entry point: a
    // guide never has a reason to reach past it.
    assert.strictEqual(
      formatCompactSet(SPEC_SET, "", "en").length,
      3,
    );
    assert.strictEqual(
      formatCompactSet(SPEC_SET, "nonsense", "en").length,
      3,
    );
  });
});

/* -------------------------------------------------------------- */
/* Memoisation — §4.9's two caches                                 */
/* -------------------------------------------------------------- */

suite("hdvl/kernel/format-skeleton — memoisation", () => {
  test("the same key returns the same instance", () => {
    // Identity, not output equality: the requirement is that the
    // constructor is not re-run, and only identity witnesses it.
    const a = formatterFor("compact-short", "en", null);
    const b = formatterFor("compact-short", "en", null);
    assert.isNotNull(a);
    assert.strictEqual(a, b);
  });

  test("any of the three changing changes the instance", () => {
    const base = formatterFor("compact-short", "en", null);
    assert.notStrictEqual(base, formatterFor("percent", "en", null));
    assert.notStrictEqual(
      base,
      formatterFor("compact-short", "de", null),
    );
    const utc = formatterFor("Hm", "en", "UTC");
    const tokyo = formatterFor("Hm", "en", "Asia/Tokyo");
    assert.isNotNull(utc);
    assert.notStrictEqual(utc, tokyo);
  });

  test("a date skeleton makes a DateTimeFormat", () => {
    assert.instanceOf(
      formatterFor("yMMMd", "en", "UTC"),
      Intl.DateTimeFormat,
    );
    assert.instanceOf(
      formatterFor("compact-short", "en", null),
      Intl.NumberFormat,
    );
  });

  test("an unmappable skeleton has no formatter", () => {
    assert.isNull(formatterFor("nonsense", "en", null));
    assert.isNull(formatterFor("MMMMM", "en", "UTC"));
    assert.isNull(formatterFor("", "en", null));
  });

  test("two zones, one skeleton, one instant", () => {
    // §4.9's "every `Intl.DateTimeFormat` carries the scale's
    // `timeZone`", in its behavioural form. The two-instances
    // half and the strings-differ half are both structural and
    // run on all three engines; the strings themselves are in the
    // chromium suite.
    const utc = formatValue(T, "Hm", "en", "UTC");
    const tokyo = formatValue(T, "Hm", "en", "Asia/Tokyo");
    assert.notStrictEqual(utc, tokyo);
    assert.notStrictEqual(
      formatterFor("Hm", "en", "UTC"),
      formatterFor("Hm", "en", "Asia/Tokyo"),
    );
  });

  test("the output cache does not change the answer", () => {
    // Cache B is read-through, so the second call must be the
    // first one's string and not merely an equal one.
    const first = formatValue(1_234.5, ".##", "en", null);
    const second = formatValue(1_234.5, ".##", "en", null);
    assert.strictEqual(first, second);
    // And it is keyed per value, not per formatter.
    assert.notStrictEqual(
      formatValue(1_234.5, ".##", "en", null),
      formatValue(2_345.5, ".##", "en", null),
    );
  });
});

/* -------------------------------------------------------------- */
/* Totality — nothing throws                                       */
/* -------------------------------------------------------------- */

suite("hdvl/kernel/format-skeleton — totality", () => {
  test("an unsupported stem formats plainly", () => {
    const out = formatValue(1500, "compact-medium", "en", null);
    assert.isString(out);
    assert.isTrue(/1/.test(out));
  });

  test("an empty skeleton formats plainly", () => {
    assert.isString(formatValue(1500, "", "en", null));
    assert.isString(formatValue(1500, "   ", "en", null));
  });

  test("a `.`-only skeleton is zero fraction digits", () => {
    assert.strictEqual(formatValue(1.6, ".", "en", null), "2");
  });

  test("an unknown date letter formats plainly", () => {
    assert.isString(formatValue(T, "Q", "en", "UTC"));
    assert.isString(formatValue(T, "MMMMM", "en", "UTC"));
  });

  test("a zone routes an unmappable skeleton to a date", () => {
    // The zone is the caller's statement that the value is an
    // instant; without it the kernel would print an epoch number
    // on a datetime axis whose skeleton V14 has yet to reject.
    assert.instanceOf(
      formatterFor("yMMMd", "en", "UTC"),
      Intl.DateTimeFormat,
    );
    const out = formatValue(T, "MMMMM", "en", "UTC");
    assert.isFalse(out.includes("1772977653412"), out);
  });

  test("an empty value set is an empty label set", () => {
    assert.deepEqual(formatCompactSet([], "compact-short", "en"), []);
    assert.deepEqual(formatCompactSet([], "", "en"), []);
  });

  test("an all-zero set has no magnitude and formats plainly", () => {
    const labels = formatCompactSet([0, 0], "compact-short", "en");
    assert.strictEqual(labels.length, 2);
    assert.strictEqual(labels[0], labels[1]);
    assert.strictEqual(suffixOf(0, "en"), "");
  });

  test("a non-finite value carries no part", () => {
    const labels = formatCompactSet(
      [NaN, 1_500_000, Infinity, -Infinity],
      "compact-short",
      "en",
    );
    assert.strictEqual(labels.length, 4);
    const suffix = suffixOf(1_500_000, "en");
    assert.isTrue(labels[1].endsWith(suffix));
    assert.isFalse(labels[0].endsWith(suffix), labels[0]);
    assert.isFalse(labels[2].endsWith(suffix), labels[2]);
  });

  test("a malformed locale falls back to the runtime default", () => {
    // §4.9 resolves the locale from the nearest `lang`, which is
    // author-controlled; `Intl` throws `RangeError` on a
    // malformed tag and a chart with default-locale labels beats
    // a chart with none.
    assert.isString(
      formatValue(1500, "compact-short", "not a tag!!", null),
    );
    assert.strictEqual(
      formatCompactSet(SPEC_SET, "compact-short", "").length,
      3,
    );
  });

  test("an unknown zone throws, as kernel/zone.ts does", () => {
    // The one deliberate non-total case, and it is deliberate:
    // silently falling back to UTC would shift every date label
    // in the chart with nothing anywhere reporting it. Diagnosing
    // an authored zone belongs to the validator.
    assert.throws(() => formatValue(T, "Hm", "en", "Mars/Olympus"));
  });
});

/* -------------------------------------------------------------- */
/* Rule 9 — the signed zero sweep                                  */
/* -------------------------------------------------------------- */

suite("hdvl/kernel/format-skeleton — signed zero", () => {
  test("the platform fact underneath the guard", () => {
    // Structural, not an output-string claim: the assertion is
    // that a sign appears at all, which is what makes the
    // normalisation necessary. The exact rendering is in the
    // chromium suite.
    const raw = new Intl.NumberFormat("en").format(-0);
    assert.notStrictEqual(raw, new Intl.NumberFormat("en").format(0));
    assert.isTrue(Object.is(-0 / 1e6, -0));
  });

  test("no skeleton and no path emits one", () => {
    const skeletons = [
      "compact-short",
      "compact-long",
      "percent",
      "currency/USD",
      "precision-integer",
      ".#",
      ".0#",
      "",
    ];
    const plus = new Intl.NumberFormat("en").format(0);
    for (const skeleton of skeletons) {
      assert.strictEqual(
        formatValue(-0, skeleton, "en", null),
        formatValue(0, skeleton, "en", null),
        skeleton,
      );
      const set = formatCompactSet(
        [-0, 0, 1_500_000],
        skeleton,
        "en",
      );
      assert.strictEqual(set[0], set[1], skeleton);
      assert.isTrue(set[0].includes(plus), `${skeleton} ${set[0]}`);
    }
  });
});

/* -------------------------------------------------------------- */
/* ★ Rule 4's ONE declared exception — chromium only               */
/* -------------------------------------------------------------- */

suite("hdvl/kernel/format-skeleton — rendered strings", () => {
  /**
   * WHY THIS SUITE IS SCOPED AND NOTHING ELSE IS.
   *
   * Everything above compares a bag this repo computed, or a
   * label against another label, or a label against a value read
   * from the same `Intl` call. None of that depends on which ICU
   * an engine shipped. These assertions do: the exact rendering
   * of a compact part, the number of fraction digits a currency
   * style defaults to, and whether the separator before a
   * long-form part is U+0020 or U+00A0 are ICU version and OS
   * data, and they differ between chromium, firefox and webkit on
   * the same machine. Plan rule 4 scopes exactly this and nothing
   * else; rule 7 makes the scoping have to be declared, and this
   * is the declaration.
   */
  const only = ENGINE === "chromium";

  test("SPEC §7's axis reads 0.9M, 1.2M, 1.5M", () => {
    if (!only) return;
    assert.deepEqual(
      formatCompactSet(SPEC_SET, "compact-short", "en"),
      ["0.9M", "1.2M", "1.5M"],
    );
  });

  test("per value it would read 900K, 1.2M, 1.5M", () => {
    if (!only) return;
    assert.deepEqual(
      SPEC_SET.map((v) =>
        formatValue(v, "compact-short", "en", null),
      ),
      ["900K", "1.2M", "1.5M"],
    );
  });

  test("compact-long spells the part", () => {
    if (!only) return;
    assert.deepEqual(
      formatCompactSet(SPEC_SET, "compact-long", "en"),
      ["0.9 million", "1.2 million", "1.5 million"],
    );
  });

  test("a currency style keeps its own fraction digits", () => {
    if (!only) return;
    // A real consequence of §4.9 step 2's "the skeleton's other
    // options": the plain decimal formatter inherits the currency
    // style's two fraction digits, where per-value compact would
    // have rounded to one. An author who wants `$0.9M` composes
    // `currency/USD compact-short .#`.
    assert.deepEqual(
      formatCompactSet(SPEC_SET, "currency/USD compact-short", "en"),
      ["$0.90M", "$1.20M", "$1.50M"],
    );
    assert.deepEqual(
      formatCompactSet(
        SPEC_SET,
        "currency/USD compact-short .#",
        "en",
      ),
      ["$0.9M", "$1.2M", "$1.5M"],
    );
  });

  test("the part goes before a suffixed sign", () => {
    if (!only) return;
    assert.deepEqual(
      formatCompactSet(SPEC_SET, "percent compact-short", "en"),
      ["90M%", "120M%", "150M%"],
    );
    // WHITESPACE IS NORMALISED HERE, and that is rule 4's own
    // example. `fr` separates the number from a suffixed currency
    // with a narrow no-break space, not U+0020, and which of the
    // two an engine ships is ICU data — the claim being made is
    // about the ORDER of the pieces, so the space class is
    // collapsed rather than pinned.
    const fr = formatCompactSet(
      SPEC_SET,
      "currency/USD compact-short",
      "fr",
    ).map((l) => l.replace(/\s/g, " "));
    assert.deepEqual(fr, ["0,90 M $US", "1,20 M $US", "1,50 M $US"]);
  });

  test("ja groups by ten thousand", () => {
    if (!only) return;
    assert.deepEqual(
      formatCompactSet(SPEC_SET, "compact-short", "ja"),
      ["90万", "120万", "150万"],
    );
  });

  test("the date table renders what it maps to", () => {
    if (!only) return;
    assert.strictEqual(
      formatValue(T, "yMMMd", "en", "UTC"),
      "Mar 8, 2026",
    );
    assert.strictEqual(formatValue(T, "Hm", "en", "UTC"), "13:47");
    assert.strictEqual(
      formatValue(T, "Hm", "en", "Asia/Tokyo"),
      "22:47",
    );
    assert.strictEqual(formatValue(T, "EEEE", "en", "UTC"), "Sunday");
    assert.strictEqual(formatValue(T, "MMMM", "en", "UTC"), "March");
  });

  test("a signed zero would have printed a sign", () => {
    if (!only) return;
    assert.strictEqual(new Intl.NumberFormat("en").format(-0), "-0");
    assert.strictEqual(
      formatValue(-0, "compact-short", "en", null),
      "0",
    );
  });
});
