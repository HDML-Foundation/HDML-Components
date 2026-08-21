/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * §4.9's CLDR skeleton → `Intl` option-bag mapping (RFC 016/001,
 * SPEC §7).
 *
 * **No formatting dependency ships** (§4.9, R3). `Intl` is the
 * platform, not a library, and this module is the only place in
 * `src/hdvl/` that touches it. It does **not** import
 * `temporal-polyfill`: a date skeleton is turned into an
 * `Intl.DateTimeFormat` carrying the scale's `timeZone`, so the
 * calendar work happens inside `Intl` and never crosses
 * {@link module:hdvl/kernel/zone}'s four-operation seam. Plan rule
 * 5 stays discharged because there is no second calendar
 * implementation here to discharge.
 *
 * **What is a cross-engine contract and what is not** (plan rule
 * 4, the project's only engine-scoped rule). The **mapping** —
 * skeleton in, option bag out — is exact on every engine, which is
 * why {@link numberOptions} and {@link dateOptions} return the
 * **bag** rather than a formatter. The **rendered string** is not:
 * ICU version and data differ by engine and OS, so `"1.2M"`,
 * `"$1.5M"` and NBSP-vs-space are asserted on chromium alone. That
 * split is the reason this module has the shape it does.
 *
 * **★ H6 — one implementation of the shared prefix.**
 * {@link formatCompactSet} takes a value **set** and returns one,
 * because SPEC §7 makes axis coherence *"a property of the label
 * set, not of the format string"*: an axis must read
 * `0.9M, 1.2M, 1.5M` and never `900K, 1.2M, 1.5M`. It is **total**
 * — a skeleton it cannot map, including the empty string a label
 * with no `format` carries, falls through to the locale's default
 * number formatting — so a guide has no reason to reach past it to
 * {@link formatValue} for a label set, and there is no per-value
 * entry point that could emit an incoherent axis.
 * **`hdml-label` on a continuous channel (step 23/24) and a
 * continuous `hdml-legend`'s ramp values (step 31) both call
 * `formatCompactSet`, and that call is the whole of the shared
 * implementation H6 requires.** {@link formatValue} exists for the
 * single value — a date label, a datum readout — and says so.
 *
 * **The two caches §4.9 requires rather than suggests.** Cache A
 * is the formatter, keyed `(locale, skeleton, zone)` — §4.9's own
 * key — and its entries carry every formatter derived from that
 * key, so one lookup answers the mapped formatter, the compact
 * probe and the divided-value formatter alike. Cache B is the
 * formatted output, keyed by value **inside** an A entry, so its
 * composite key is `(locale, skeleton, zone, value)`. §4.9 writes
 * B's key as `(scale, domain identity, skeleton, value)` and says
 * both are *"invalidated when the scale's resolved domain
 * changes"*; a **pure** module has no scale to observe and needs
 * none, because a formatted value is a function of its key alone
 * and can never go stale. What the domain really contributes is
 * the compact **divisor**, and that is exactly what the set path
 * folds into B's key. Cache A is unbounded — its key space is the
 * page's authored skeletons, which is small and static, the same
 * call `measure-text.ts` makes for `(text, font)`. Cache B is
 * **bounded**, because its value component is not: an animated
 * domain would grow it without limit.
 *
 * **This module is pure.** No DOM, no `getComputedStyle`, no
 * `closest`, no import side effect. In particular the **locale
 * arrives as a parameter**: §4.9 resolves it from the nearest
 * `lang`, which is a DOM read and belongs to the guide element at
 * step 23/24.
 *
 * **`-0` is normalised at the boundary** (plan rule 9). Measured
 * at step 17: `Intl.NumberFormat("en").format(-0)` is `"-0"` on
 * all three engines, and `-0 / 1e6` is `-0`, so a signed zero
 * reaching {@link formatCompactSet} would print a minus sign on an
 * axis. Unlike step 16's two modules there **is** a reachable
 * producer — the caller's own domain, which `niceNumeric` can end
 * at `-0` — so this module carries a private `num()`, as five of
 * the other seven kernel modules do.
 *
 * **An unknown zone throws `RangeError` and this module lets it
 * propagate**, exactly as {@link module:hdvl/kernel/zone} does and
 * for the same reason: diagnosing an authored zone belongs to the
 * validator, and a silent fall back to UTC would shift every date
 * label in the chart with nothing anywhere reporting it.
 *
 * @module hdvl/kernel/format-skeleton
 */

/**
 * Which token space a skeleton is written in (§4.9).
 *
 * §4.9's *"stems and date letters are disjoint token spaces"* is
 * what lets V14 classify a `format` string **without resolving the
 * scale chain**, and this type is that classification. It is
 * deliberately **four** members and not three.
 *
 * - `"number"` / `"date"` — every token belongs to that space.
 * - `"mixed"` — tokens from **both** spaces. This is the case
 *   V14's *"number stems **or** date pattern letters, never
 *   both"* exists for, and collapsing it into `"unknown"` would
 *   force step 24 to re-tokenise the string to write its own
 *   message — a second parser, which R12 forbids.
 * - `"unknown"` — at least one token belongs to neither.
 *
 * A kind is **not** a diagnostic: it says which space the string
 * is written in, never what to tell the author. Whether an
 * unsupported *width* is legal is a separate question and a
 * separate answer — `"MMMMM"` is `"date"` (the letters are date
 * letters) while {@link dateOptions} returns `null` (CLDR's narrow
 * width is outside SPEC §7's conformance subset). That pair is how
 * a caller tells *"wrong token space"* from *"a skeleton of the
 * right kind that this implementation does not support"*, which
 * V14 needs and a single `null` could not express.
 */
export type SkeletonKind = "number" | "date" | "mixed" | "unknown";

/**
 * The date letters SPEC §7's conformance subset names — `y M d E
 * H m`, and nothing else.
 */
const DATE_LETTERS = "yMdEHm";

/** `currency/{ISO 4217}` — three ASCII capitals, per §4.9. */
const CURRENCY = /^currency\/([A-Z]{3})$/;

/**
 * `.#`, `.##`, `.0#`, `.0` … — zeros then hashes, never the
 * reverse.
 *
 * UTS #35 has no form in which a `#` precedes a `0`, so `.#0` does
 * **not** match and is rejected rather than normalised. Silently
 * accepting it is the third option nobody wants: it would make two
 * different skeletons format identically with nothing saying so.
 */
const FRACTION = /^\.(0*)(#*)$/;

/** The part types that carry the number itself. */
const NUMERIC_PARTS = new Set([
  "integer",
  "group",
  "decimal",
  "fraction",
]);

/**
 * 10^0.5 — the geometric midpoint between two powers of ten, and
 * the threshold {@link nearestPowerOfTen} rounds at.
 */
const ROOT_TEN = 3.1622776601683795;

/** The largest divisor the snap will consider. */
const MAX_DIVISOR = 1e21;

/** How many formatted strings one cache-A entry retains. */
const MAX_CACHED_OUTPUT = 512;

/**
 * Plan rule 9 — a signed zero prints as `"-0"` on all three
 * engines, so it is normalised before it can reach `Intl`.
 */
function num(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

/**
 * §4.9's number stems, one token at a time.
 *
 * @param token - One whitespace-separated stem.
 * @returns The stem's options, or `null` if it is not one of SPEC
 *   §7's conformance-subset stems.
 */
function stemOptions(token: string): Intl.NumberFormatOptions | null {
  switch (token) {
    case "compact-short":
      return { notation: "compact", compactDisplay: "short" };
    case "compact-long":
      return { notation: "compact", compactDisplay: "long" };
    case "percent":
      return { style: "percent" };
    case "precision-integer":
      return { maximumFractionDigits: 0 };
    default:
      break;
  }
  const currency = CURRENCY.exec(token);
  if (currency) {
    return { style: "currency", currency: currency[1] };
  }
  const fraction = FRACTION.exec(token);
  if (fraction) {
    // `.0#` is one `0` and two total. A bare `.` is zero of each,
    // which UTS #35 reads as exactly no fraction digits.
    const zeros = fraction[1].length;
    return {
      minimumFractionDigits: zeros,
      maximumFractionDigits: zeros + fraction[2].length,
    };
  }
  return null;
}

/** One run of one repeated date letter. */
interface DateRun {
  letter: string;
  count: number;
}

/**
 * A date token split into runs of one repeated letter.
 *
 * `yMMMd` is `y` + `MMM` + `d`. A token containing any character
 * outside {@link DATE_LETTERS} is not in the date token space at
 * all and returns `null`, which is what makes the two spaces
 * disjoint in practice as well as on paper.
 *
 * @param token - One whitespace-separated token.
 * @returns Its runs, or `null` if it is not a date token.
 */
function dateRuns(token: string): DateRun[] | null {
  if (!token.length) {
    return null;
  }
  const runs: DateRun[] = [];
  let i = 0;
  while (i < token.length) {
    const letter = token[i];
    if (!DATE_LETTERS.includes(letter)) {
      return null;
    }
    let j = i;
    while (j < token.length && token[j] === letter) {
      j++;
    }
    runs.push({ letter, count: j - i });
    i = j;
  }
  return runs;
}

/**
 * §4.9's date-field table — width by letter count.
 *
 * `H` carries `hour12: false`, which is not decoration: it is the
 * difference between a 24-hour axis and a 12-hour one.
 *
 * `EE` and `EEE` map to `"short"` alongside `E`, because CLDR
 * makes all three the abbreviated width and `Intl` has no option
 * that could tell them apart. That is the only place this module
 * reaches past §4.9's literal table, and it reaches nowhere new —
 * the option bag is one §4.9 already lists.
 *
 * @param run - One run of a repeated date letter.
 * @returns The field's options, or `null` at a width outside SPEC
 *   §7's conformance subset (CLDR's narrow `MMMMM`, a three-digit
 *   `yyy`, and so on).
 */
function fieldOptions(
  run: DateRun,
): Intl.DateTimeFormatOptions | null {
  const { letter, count } = run;
  switch (letter) {
    case "y":
      if (count === 1) return { year: "numeric" };
      if (count === 2) return { year: "2-digit" };
      return null;
    case "M":
      if (count === 1) return { month: "numeric" };
      if (count === 2) return { month: "2-digit" };
      if (count === 3) return { month: "short" };
      if (count === 4) return { month: "long" };
      return null;
    case "d":
      if (count === 1) return { day: "numeric" };
      if (count === 2) return { day: "2-digit" };
      return null;
    case "E":
      if (count >= 1 && count <= 3) return { weekday: "short" };
      if (count === 4) return { weekday: "long" };
      return null;
    case "H":
      if (count === 1) return { hour: "numeric", hour12: false };
      if (count === 2) return { hour: "2-digit", hour12: false };
      return null;
    default:
      // `m`. `noImplicitReturns` wants a default rather than a
      // seventh named case.
      if (count === 1) return { minute: "numeric" };
      if (count === 2) return { minute: "2-digit" };
      return null;
  }
}

/** A skeleton's whitespace-separated tokens. */
function tokensOf(skeleton: string): string[] {
  const trimmed = skeleton.trim();
  return trimmed.length ? trimmed.split(/\s+/) : [];
}

/**
 * §4.9's disjointness test — no scale chain needed.
 *
 * @param skeleton - A `format` attribute's value.
 * @returns Which token space it is written in. See
 *   {@link SkeletonKind} for what each member means and why there
 *   are four.
 */
export function skeletonKind(skeleton: string): SkeletonKind {
  const tokens = tokensOf(skeleton);
  if (!tokens.length) {
    return "unknown";
  }
  let numbers = 0;
  let dates = 0;
  for (const token of tokens) {
    if (stemOptions(token)) {
      numbers++;
    } else if (dateRuns(token)) {
      dates++;
    } else {
      // One unrecognised token makes the whole string
      // unclassifiable — it is not a skeleton at all, which is a
      // different thing to say than "both spaces at once".
      return "unknown";
    }
  }
  if (numbers && dates) {
    return "mixed";
  }
  return numbers ? "number" : "date";
}

/**
 * §4.9's number skeleton → `Intl.NumberFormat` option bag.
 *
 * A skeleton is **space-separated and order-free**, so two stems
 * compose into one bag: `percent precision-integer` and
 * `currency/USD compact-short` are both SPEC §7 examples. Two
 * stems that would set the **same** option — `percent
 * currency/USD`, `compact-short compact-long` — contradict each
 * other and are rejected rather than resolved by position.
 *
 * @param skeleton - A `format` attribute's value.
 * @returns The option bag, or `null` when the skeleton is not in
 *   the number token space **or** is a number skeleton outside
 *   SPEC §7's conformance subset. {@link skeletonKind} is what
 *   tells those two apart: `"date"` or `"mixed"` means the wrong
 *   space, `"number"` with a `null` bag means unsupported.
 */
export function numberOptions(
  skeleton: string,
): Intl.NumberFormatOptions | null {
  const tokens = tokensOf(skeleton);
  if (!tokens.length) {
    return null;
  }
  const bag: Intl.NumberFormatOptions = {};
  const seen = new Set<string>();
  for (const token of tokens) {
    const part = stemOptions(token);
    if (!part) {
      return null;
    }
    for (const key of Object.keys(part)) {
      if (seen.has(key)) {
        return null;
      }
      seen.add(key);
    }
    Object.assign(bag, part);
  }
  return bag;
}

/**
 * §4.9's date skeleton → `Intl.DateTimeFormat` option bag.
 *
 * A date skeleton is **one run of letters** — `yMMMd` is `y` +
 * `MMM` + `d` — and it names a **field set**: §4.9 and SPEC §7
 * both say CLDR orders the fields per locale, so the parse does
 * not preserve order and the bag does not imply one. Whitespace
 * between runs is accepted and means nothing, which falls out of
 * the same loop rather than being a second grammar.
 *
 * The bag deliberately carries **no `timeZone`**: the same
 * skeleton is used on scales in different zones, and a bag
 * carrying one would defeat the `(locale, skeleton, zone)` cache
 * key. The zone arrives per call, at {@link formatterFor}.
 *
 * @param skeleton - A `format` attribute's value.
 * @returns The option bag, or `null` when the skeleton is not in
 *   the date token space, names a width outside SPEC §7's
 *   conformance subset, or names the same field twice.
 */
export function dateOptions(
  skeleton: string,
): Intl.DateTimeFormatOptions | null {
  const tokens = tokensOf(skeleton);
  if (!tokens.length) {
    return null;
  }
  const bag: Intl.DateTimeFormatOptions = {};
  const seen = new Set<string>();
  for (const token of tokens) {
    const runs = dateRuns(token);
    if (!runs) {
      return null;
    }
    for (const run of runs) {
      const part = fieldOptions(run);
      if (!part || seen.has(run.letter)) {
        return null;
      }
      seen.add(run.letter);
      Object.assign(bag, part);
    }
  }
  return bag;
}

/**
 * One cache-A entry — everything derived from one
 * `(locale, skeleton, zone)`.
 */
interface Entry {
  /** The locale handed to `Intl`, or `undefined` for default. */
  locale: string | undefined;
  /** The mapped formatter, or a default one — never `null`. */
  formatter: Intl.NumberFormat | Intl.DateTimeFormat;
  /** Whether the skeleton mapped to a bag at all. */
  mapped: boolean;
  /** §4.9's second cache, bounded. */
  out: Map<string, string>;
  /** The compact probe of §4.9 step 1, built on demand. */
  probe: Intl.NumberFormat | null;
  /** The divided-value formatter of step 2, built on demand. */
  plain: Intl.NumberFormat | null;
}

/** Cache A — §4.9's `(locale, skeleton, zone)`. */
const ENTRIES = new Map<string, Entry>();

/**
 * A locale `Intl` will accept, or `undefined` for the runtime
 * default.
 *
 * §4.9 resolves the locale from the nearest `lang`, which is
 * author-controlled and can be anything at all. `Intl` throws
 * `RangeError` on a malformed tag; falling back to the runtime
 * default keeps the chart rendering, and it is the same fallback
 * §4.9 already names for a document with no `lang`.
 */
function acceptedLocale(locale: string): string | undefined {
  try {
    Intl.getCanonicalLocales(locale);
    return locale;
  } catch {
    return undefined;
  }
}

/**
 * The same locale with the Latin numbering system.
 *
 * §4.9 step 1 asks for *"the implied divisor from the same call"*,
 * and recovering it means reading the number `Intl` actually
 * printed. In a locale whose default numbering system is not
 * `latn` those digits are not ASCII — `ar` prints `١٫٥` — so the
 * probe forces `latn`. Measured at step 17: forcing it changes the
 * digits and **nothing else**, so the compact part and its
 * separator still come out of the target locale's own CLDR data
 * (`ja` still gives `万`, `ar` still gives `مليون`), and one probe
 * formatter can serve both halves of step 1.
 */
function latinLocale(locale: string | undefined): string | undefined {
  try {
    return new Intl.Locale(locale ?? "en", {
      numberingSystem: "latn",
    }).toString();
  } catch {
    return undefined;
  }
}

/** Build one cache-A entry. */
function makeEntry(
  skeleton: string,
  locale: string,
  zone: string | null,
): Entry {
  const accepted = acceptedLocale(locale);
  const kind = skeletonKind(skeleton);
  // A non-null `zone` is the caller's statement that the value is
  // an instant (§5 of this module's contract, and §4.9's "every
  // `Intl.DateTimeFormat` carries the scale's `timeZone`"), so it
  // decides the branch when the skeleton itself cannot.
  const temporal =
    kind === "date" || (zone !== null && kind !== "number");
  const base = {
    locale: accepted,
    out: new Map<string, string>(),
    probe: null,
    plain: null,
  };
  if (temporal) {
    const bag = kind === "date" ? dateOptions(skeleton) : null;
    return {
      ...base,
      mapped: bag !== null,
      formatter: new Intl.DateTimeFormat(accepted, {
        ...(bag ?? {}),
        timeZone: zone ?? "UTC",
      }),
    };
  }
  const bag = numberOptions(skeleton);
  return {
    ...base,
    mapped: bag !== null,
    formatter: new Intl.NumberFormat(accepted, bag ?? {}),
  };
}

/** Cache A's lookup. */
function entryOf(
  skeleton: string,
  locale: string,
  zone: string | null,
): Entry {
  // Length-prefixed rather than delimited. A skeleton is an
  // author-controlled string, so **any** separator character can
  // appear inside one; prefixing each variable-length component
  // with its length makes the key injective without picking a
  // character no author may type.
  const key =
    `${locale.length}:${locale}` +
    `${skeleton.length}:${skeleton}${zone ?? ""}`;
  let entry = ENTRIES.get(key);
  if (!entry) {
    entry = makeEntry(skeleton, locale, zone);
    ENTRIES.set(key, entry);
  }
  return entry;
}

/** Cache B's read-through, bounded. */
function cached(
  entry: Entry,
  key: string,
  make: () => string,
): string {
  const hit = entry.out.get(key);
  if (hit !== undefined) {
    return hit;
  }
  const value = make();
  if (entry.out.size >= MAX_CACHED_OUTPUT) {
    // The key's value component is unbounded — an animated domain
    // would grow this without limit — and a chart re-formats the
    // same handful of ticks frame after frame, so dropping the
    // whole map is both cheap and self-healing.
    entry.out.clear();
  }
  entry.out.set(key, value);
  return value;
}

/**
 * §4.9's memoised formatter, per `(locale, skeleton, zone)`.
 *
 * Two calls with the same three arguments return the **same
 * instance**, which is the requirement: §4.9 calls the
 * memoisation *"an implementation requirement, not an
 * optimisation to consider later"*, because without it a resize
 * drag reconstructs one `Intl.DateTimeFormat` per label per
 * frame.
 *
 * @param skeleton - A `format` attribute's value.
 * @param locale - A BCP 47 tag. §4.9 resolves it from the nearest
 *   `lang`; that walk is a DOM read and belongs to the guide.
 * @param zone - An IANA zone name for a date skeleton, `null` for
 *   a number one. An unknown zone throws `RangeError`, as it does
 *   in `kernel/zone.ts`.
 * @returns The formatter, or `null` when the skeleton maps to no
 *   option bag — see {@link numberOptions} and
 *   {@link dateOptions} for which failures that covers.
 */
export function formatterFor(
  skeleton: string,
  locale: string,
  zone: string | null,
): Intl.NumberFormat | Intl.DateTimeFormat | null {
  const entry = entryOf(skeleton, locale, zone);
  return entry.mapped ? entry.formatter : null;
}

/**
 * One value, formatted.
 *
 * **A label *set* does not belong here** — SPEC §7's shared
 * compact prefix is a property of the set, so a guide formatting
 * an axis calls {@link formatCompactSet} and this function
 * formats the single value: a datum readout, a tooltip, one date
 * label.
 *
 * A skeleton that maps to no bag falls back to the locale's
 * default formatting rather than throwing or returning the raw
 * number: a chart with plainly-formatted labels is better than a
 * chart with none, and telling the author about the skeleton is
 * V14's job (step 24), not the kernel's.
 *
 * @param value - The number, or an epoch-millisecond instant for
 *   a date skeleton.
 * @param skeleton - A `format` attribute's value.
 * @param locale - A BCP 47 tag.
 * @param zone - An IANA zone name for a date skeleton, `null` for
 *   a number one.
 * @returns The formatted string. Never throws for any skeleton,
 *   locale or value.
 */
export function formatValue(
  value: number,
  skeleton: string,
  locale: string,
  zone: string | null,
): string {
  const entry = entryOf(skeleton, locale, zone);
  const clean = num(value);
  return cached(entry, `v ${clean}`, () =>
    entry.formatter.format(clean),
  );
}

/** What §4.9 step 1 reads off the probe. */
interface Prefix {
  /** Everything printed after the number — `"M"`, `" million"`. */
  suffix: string;
  /** The number as printed, in Latin digits. */
  numeric: number;
}

/** Index of the last part that carries the number itself. */
function lastNumericPart(
  parts: readonly Intl.NumberFormatPart[],
): number {
  let last = -1;
  for (let i = 0; i < parts.length; i++) {
    if (NUMERIC_PARTS.has(parts[i].type)) {
      last = i;
    }
  }
  return last;
}

/** §4.9 step 1, over one `formatToParts` call. */
function prefixOf(parts: readonly Intl.NumberFormatPart[]): Prefix {
  const last = lastNumericPart(parts);
  if (last < 0) {
    // `NaN` and `±Infinity` print as a single non-numeric part and
    // carry no magnitude to take a prefix from.
    return { suffix: "", numeric: 0 };
  }
  let digits = "";
  for (let i = 0; i <= last; i++) {
    const part = parts[i];
    if (part.type === "integer" || part.type === "fraction") {
      digits += part.value;
    } else if (part.type === "decimal") {
      digits += ".";
    }
  }
  let suffix = "";
  for (let i = last + 1; i < parts.length; i++) {
    suffix += parts[i].value;
  }
  const numeric = Number(digits);
  return {
    suffix,
    numeric: Number.isFinite(numeric) ? numeric : 0,
  };
}

/**
 * The power of ten nearest `raw` in log space.
 *
 * CLDR keys its compact patterns by a **power of ten**, not by a
 * power of a thousand: `ja` divides by 10⁴ at 万 and `en` by 10³
 * at K. Snapping is what makes the recovered divisor exact even
 * though the number it was recovered from is rounded — `999999`
 * prints as `1M`, giving a raw ratio of 999 999, which is 10⁶.
 *
 * Written as a loop rather than `Math.log10`: the answer is an
 * integer exponent, and `10 ** e` built by repeated multiplication
 * is exact through 10²², where a transcendental round-trip is a
 * cross-engine hazard for no benefit.
 */
function nearestPowerOfTen(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) {
    return 1;
  }
  let divisor = 1;
  while (divisor < MAX_DIVISOR && divisor * 10 <= raw * ROOT_TEN) {
    divisor *= 10;
  }
  return divisor;
}

/**
 * §4.9 step 3 — the one compact part, applied to one value.
 *
 * **The part is inserted after the number, not appended to the
 * string** — see the RFC's amendment banner. `Intl` puts a
 * currency or percent sign on whichever side the locale wants,
 * and the compact part always sits between the number and that
 * sign: `fr` renders `1,5 M $US` and `en` renders `150M%`.
 * Appending would give `1,5 $US M` and `150%M`. Where the sign is
 * a prefix — `en` currency — the two readings coincide, which is
 * why the literal one survives an English-only test.
 */
function withSuffix(
  parts: readonly Intl.NumberFormatPart[],
  suffix: string,
): string {
  const last = suffix ? lastNumericPart(parts) : -1;
  let out = "";
  for (let i = 0; i < parts.length; i++) {
    out += parts[i].value;
    if (i === last) {
      out += suffix;
    }
  }
  return out;
}

/**
 * §4.9's shared compact prefix, over a value **set** (SPEC §7).
 *
 * `Intl`'s compact notation picks a prefix per value, so an axis
 * formatted value-by-value reads `900K, 1.2M, 1.5M`. §4.9's
 * algorithm, applied here verbatim: read one compact part and its
 * implied divisor off the **largest-magnitude** value, format
 * every value as `value / divisor` with a plain decimal formatter
 * carrying the skeleton's other options, and give every value that
 * one part.
 *
 * *Largest magnitude* is `max(|v|)`, so a domain spanning
 * `[-2e6, 5e5]` takes its prefix from the negative endpoint.
 * Non-finite values are skipped when choosing it — `Math.max` with
 * a `NaN` in it is `NaN` — and are formatted without a prefix,
 * having no magnitude to share. An empty set returns an empty
 * array; an all-zero set has no magnitude either, so it formats
 * plainly.
 *
 * **This function is total, and that is what makes it H6's one
 * implementation.** A skeleton with no compact stem formats
 * value-by-value, and one that maps to no bag at all — including
 * the empty string a label with no `format` carries — falls back
 * to the locale's default number formatting. A guide therefore
 * calls it for **every** continuous label set and never has a
 * reason to reach past it.
 *
 * @param values - The label set, in the order it will be shown.
 * @param skeleton - A `format` attribute's value.
 * @param locale - A BCP 47 tag.
 * @returns One string per input value, in the same order, all
 *   carrying the same compact part.
 */
export function formatCompactSet(
  values: readonly number[],
  skeleton: string,
  locale: string,
): string[] {
  const bag = numberOptions(skeleton);
  if (!bag || bag.notation !== "compact") {
    return values.map((v) => formatValue(v, skeleton, locale, null));
  }
  const entry = entryOf(skeleton, locale, null);

  let peak = 0;
  for (const value of values) {
    if (Number.isFinite(value) && Math.abs(value) > peak) {
      peak = Math.abs(value);
    }
  }

  // Step 1. The probe carries the skeleton's own `compactDisplay`
  // — §4.9 writes `{notation:"compact"}`, whose default is
  // `"short"`, which would give a `compact-long` axis an `M` where
  // it asked for `million`.
  let probe = entry.probe;
  if (!probe) {
    // The **resolved** locale, not the requested one: a request
    // `Intl` fell back on still has to be probed in the locale it
    // actually landed in, or the divisor comes from the wrong
    // CLDR data.
    const resolved = entry.formatter.resolvedOptions().locale;
    probe = new Intl.NumberFormat(latinLocale(resolved), {
      notation: "compact",
      compactDisplay: bag.compactDisplay ?? "short",
    });
    entry.probe = probe;
  }
  const { suffix, numeric } = prefixOf(probe.formatToParts(peak));
  const divisor = numeric > 0 ? nearestPowerOfTen(peak / numeric) : 1;

  // Step 2. A plain decimal formatter carrying the skeleton's
  // other options — `currency/USD compact-short` still prints its
  // currency, it just no longer picks its own compact part.
  let plain = entry.plain;
  if (!plain) {
    const plainBag: Intl.NumberFormatOptions = { ...bag };
    delete plainBag.notation;
    delete plainBag.compactDisplay;
    plain = new Intl.NumberFormat(entry.locale, plainBag);
    entry.plain = plain;
  }
  const decimal = plain;

  // Step 3, memoised through cache B. The divisor is what §4.9's
  // "domain identity" contributes to the key, so it is in it.
  return values.map((value) => {
    const clean = num(value) / divisor;
    return cached(entry, `c ${divisor} ${clean}`, () =>
      withSuffix(decimal.formatToParts(clean), suffix),
    );
  });
}
