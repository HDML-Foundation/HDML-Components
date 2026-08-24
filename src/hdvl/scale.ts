/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * Contract 2 — `Scale` (RFC 016/001 §2.4, §4.2, §4.3, §4.7, §5.5,
 * §5.11, H1, R6, R12, R18, R30).
 *
 * **One implementation, shared by all three scale elements.** The
 * tags differ in exactly three things — the kind, which attributes
 * they publish, and which modifiers V18 lets them carry — and every
 * other line of domain resolution, range derivation, projection,
 * ticking, formatting and painting is the same. Splitting it three
 * ways would be three chances to disagree about §4.2's step order.
 *
 * **`Scale` lands whole** (H1). `paint()` in particular is not
 * deferrable to the legend: §6.1's paint resolution says a bound
 * `color` channel wins over `--hdml-fill-color`, and the corpus
 * binds `color` on **marks**, so a `paint()` that arrived with
 * Slice H would silently correct four slices of wrong charts.
 *
 * **Every number here comes from `kernel/`.** This module composes
 * the eight pure modules and contains no ladder, no band formula,
 * no transform and no formatter of its own (R12/R18) — a guide
 * calls `scale.ticks()` / `scale.format()` / `scale.paint()` and
 * never reimplements one.
 *
 * **Domain resolution never reads a pixel.** §4.2 is explicit that
 * `nice` is layout-independent: its step comes from the domain and
 * its own count. A `resolveDomain` that consulted the box would
 * make the domain depend on the range, and a resize would silently
 * move the data.
 *
 * @module hdvl/scale
 */

import type { HdvlElement } from "./base";
import type { Channel } from "./resolve";
import type { FrameContext, Measured } from "./measure";
import type { EventQueue } from "./events";
import type { Binding } from "./subscribe";
import type { ContinuousSpec } from "./kernel/scale-continuous";
import type { Delivery } from "../hdio/delivery";
import { HDML_SCALE_CHANGE, outward } from "./events";
import { channelOf, resolutionOf } from "./resolve";
import { adoptedOf, sourceOf } from "./subscribe";
import {
  CONTINUOUS_SCALE_ATTRS_LIST,
  DATETIME_SCALE_ATTRS_LIST,
  HDVL_TAG_NAMES,
  ORDINAL_SCALE_ATTRS_LIST,
} from "./vocabulary";
import {
  continuousSpec,
  project as projectContinuous,
} from "./kernel/scale-continuous";
import {
  niceLog,
  niceNumeric,
  niceSymlog,
  ticksLog,
  ticksNumeric,
  ticksPow,
  ticksSymlog,
} from "./kernel/ticks-numeric";
import { bandOfValue, thinOrdinal } from "./kernel/scale-band";
import { radialCeiling } from "./kernel/project-polar";
import { niceCalendar, ticksCalendar } from "./kernel/ticks-calendar";
import { formatValue } from "./kernel/format-skeleton";
import {
  paletteColor,
  rampStops,
  splitColorList,
} from "./kernel/color";

// ---------------------------------------------------------------
// §2.4 — Contract 2, verbatim
// ---------------------------------------------------------------

/** The three scale kinds — the tag **is** the kind (SPEC §6). */
export type ScaleKind = "continuous" | "datetime" | "ordinal";

/** A resolved domain (§2.4). */
export interface ScaleDomain {
  /** "extent" for continuous/datetime, "ordinal" for
   *  string. Datetime extents are epoch-ms. */
  kind: "extent" | "ordinal";
  extent?: [number, number];
  values?: readonly string[];
}

/** What a guide asks a scale for (§2.4, §6.5). */
export interface TickSpec {
  /** A target, never a promise. */
  count?: number;
  /** An exact interval. */
  step?: number;
  /** Literal JSON. */
  values?: readonly (number | string)[];
}

/** One tick (§2.4). */
export interface Tick {
  value: number | string;
  /** In the channel's range unit (see {@link Scale.project}). */
  at: number;
}

/** The band a value occupies, in range units (§4.4). */
export interface ScaleBand {
  start: number;
  width: number;
  centre: number;
}

/**
 * Contract 2 — eleven members, and every one of them answers from
 * the frame the scale last resolved in.
 */
export interface Scale {
  readonly kind: ScaleKind;
  readonly channel: Channel;
  /** null until the domain resolves (§4.2). */
  domain(): ScaleDomain | null;
  /** The range, in the channel's unit; null for `color`.
   *  Derived from this element's own content box for
   *  x/y/radius, from --hdml-angle-start/-end for `angle`,
   *  from --hdml-size-min/-max for `size`. */
  range(): [number, number] | null;
  /** Domain value → range unit: CSS px (x, y, radius,
   *  size), degrees (angle). null = the value is outside
   *  an ordinal domain, so the row produces no mark. */
  project(v: number | string): number | null;
  /** Ordinal only. The band the value occupies, in range
   *  units. `centre` is what every non-band-filling lookup
   *  resolves to (§4.4). */
  bandOf(v: string): ScaleBand | null;
  /** `color` only: the resolved CSS <color> for a value. */
  paint(v: number | string): string | null;
  ticks(spec: TickSpec): readonly Tick[];
  /** CLDR skeleton → formatted text (§4.9). */
  format(v: number | string, skeleton?: string): string;
}

// ---------------------------------------------------------------
// Attributes — every key from a published enum (R8)
// ---------------------------------------------------------------

const A_CHANNEL = CONTINUOUS_SCALE_ATTRS_LIST.CHANNEL;
const A_MIN = CONTINUOUS_SCALE_ATTRS_LIST.MIN;
const A_MAX = CONTINUOUS_SCALE_ATTRS_LIST.MAX;
const A_TYPE = CONTINUOUS_SCALE_ATTRS_LIST.TYPE;
const A_BASE = CONTINUOUS_SCALE_ATTRS_LIST.BASE;
const A_EXPONENT = CONTINUOUS_SCALE_ATTRS_LIST.EXPONENT;
const A_CONSTANT = CONTINUOUS_SCALE_ATTRS_LIST.CONSTANT;
const A_NICE = CONTINUOUS_SCALE_ATTRS_LIST.NICE;
const A_ZERO = CONTINUOUS_SCALE_ATTRS_LIST.ZERO;
const A_CLAMP = CONTINUOUS_SCALE_ATTRS_LIST.CLAMP;
const A_REVERSE = CONTINUOUS_SCALE_ATTRS_LIST.REVERSE;
const A_ZONE = DATETIME_SCALE_ATTRS_LIST.ZONE;
const A_SORT = ORDINAL_SCALE_ATTRS_LIST.SORT;

/**
 * The domain slot, R21/R29's literal — and an attribute name, so
 * it comes from the enum rather than from a string in this file.
 */
export const VALUES_SLOT: string = CONTINUOUS_SCALE_ATTRS_LIST.VALUES;

/**
 * The five domain modifiers and the kinds each is meaningful on
 * (SPEC §6, V18). `reverse` is legal on every kind, and that
 * positive case is what proves the rule is scoped rather than
 * blanket.
 */
export const MODIFIERS: readonly {
  attr: string;
  kinds: readonly ScaleKind[];
}[] = [
  { attr: A_NICE, kinds: ["continuous", "datetime"] },
  { attr: A_ZERO, kinds: ["continuous"] },
  { attr: A_CLAMP, kinds: ["continuous", "datetime"] },
  { attr: A_SORT, kinds: ["ordinal"] },
  { attr: A_REVERSE, kinds: ["continuous", "datetime", "ordinal"] },
];

/**
 * Tag → kind, over the three scale tags only.
 *
 * The keys are `string`-typed rather than compared against the enum
 * directly: a direct `=== HDVL_TAG_NAMES.X` trips
 * `no-unsafe-enum-comparison`, exactly as `validate.ts`'s
 * `FALLBACK_TAG` does.
 */
const KINDS: Readonly<Record<string, ScaleKind>> = {
  [<string>HDVL_TAG_NAMES.CONTINUOUS_SCALE]: "continuous",
  [<string>HDVL_TAG_NAMES.DATETIME_SCALE]: "datetime",
  [<string>HDVL_TAG_NAMES.ORDINAL_SCALE]: "ordinal",
};

/**
 * The kind an element's tag declares — the tag **is** the kind
 * (SPEC §6), which is what makes V2 a single rule rather than a
 * lookup table.
 *
 * @param el - Any display element.
 * @returns Its scale kind, or `null` if it is not a scale.
 */
export function scaleKindOf(el: HdvlElement): ScaleKind | null {
  const tag: string = el.tag;
  return Object.prototype.hasOwnProperty.call(KINDS, tag)
    ? KINDS[tag]
    : null;
}

// ---------------------------------------------------------------
// §5's first-character grammar, as `values` uses it
// ---------------------------------------------------------------

/** What a `values` attribute resolved to (SPEC §5, §6). */
export type ValuesSpec =
  | { kind: "none" }
  | { kind: "column"; column: string }
  | { kind: "literal"; json: unknown }
  | { kind: "bad-json" }
  | { kind: "bad-identifier" }
  | { kind: "ref" };

/**
 * Classifies a `values` attribute by its first character.
 *
 * The same grammar V3 and V10 police, so the classification has one
 * implementation and the validator reads it rather than
 * re-tokenising (R12).
 *
 * @param raw - The attribute value, or `null`.
 * @returns The classification.
 */
export function valuesSpecOf(raw: null | string): ValuesSpec {
  if (raw === null) {
    return { kind: "none" };
  }
  const value = raw.trim();
  if (value === "") {
    return { kind: "none" };
  }
  if (looksLikeRef(value)) {
    return { kind: "ref" };
  }
  const head = value[0];
  if (head === "[" || head === "{" || head === '"') {
    try {
      return { kind: "literal", json: <unknown>JSON.parse(value) };
    } catch {
      return { kind: "bad-json" };
    }
  }
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    return { kind: "column", column: value };
  }
  return { kind: "bad-identifier" };
}

/**
 * Whether a channel-attribute value is a **full source specifier**
 * (V10) rather than merely ungrammatical (V3).
 *
 * The two rules both fire on `?` and `/`, and SPEC gives each its
 * own message, so they are separated here by shape: a value that
 * names a document or carries HDML's own query form is a ref, and
 * anything else containing those characters is a grammar error.
 * V10 is checked first, being the more specific of the two.
 *
 * @param value - A trimmed attribute value.
 * @returns Whether it is a source specifier.
 */
export function looksLikeRef(value: string): boolean {
  return (
    value.includes("?hdml-") ||
    /^(\/|\.{1,2}\/|[a-z][a-z0-9+.-]*:\/\/)/i.test(value)
  );
}

// ---------------------------------------------------------------
// §4.2 — domain resolution, in COMPUTE, never reading a pixel
// ---------------------------------------------------------------

/** One endpoint's provenance, so `zero` and `nice` obey V15. */
interface Resolved {
  domain: ScaleDomain | null;
  /** Whether `min` supplied the low endpoint. */
  lowAuthored: boolean;
  /** Whether `max` supplied the high endpoint. */
  highAuthored: boolean;
}

/** The unresolved-but-legal answer of §4.2 step 3. */
const UNRESOLVED: Resolved = {
  domain: null,
  lowAuthored: false,
  highAuthored: false,
};

/** A number, or `NaN` when the text is not one. */
function numberOf(raw: null | string): number {
  if (raw === null) {
    return NaN;
  }
  const text = raw.trim();
  if (text === "") {
    return NaN;
  }
  const n = Number(text);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * An ISO instant in epoch milliseconds, reading **zone-less input
 * as UTC** (§4.2).
 *
 * `Date.parse` is date-only-is-UTC but date-**time**-without-offset
 * is *local* per ES2015, so a bare `2025-01-01T06:00` would drift
 * by the runner's own offset. The `Z` is appended explicitly.
 */
function instantOf(raw: null | string): number {
  if (raw === null) {
    return NaN;
  }
  const text = raw.trim();
  if (text === "") {
    return NaN;
  }
  if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) {
    return Number(text);
  }
  const dated = /^\d{4}-\d{2}-\d{2}[T ]/.test(text);
  const zoned = /(z|[+-]\d{2}:?\d{2})$/i.test(text);
  const at = Date.parse(dated && !zoned ? `${text}Z` : text);
  return Number.isFinite(at) ? at : NaN;
}

/** Code-point order, which `Array.prototype.sort` is not. */
function byCodePoint(a: string, b: string): number {
  const ax = Array.from(a);
  const bx = Array.from(b);
  const n = Math.min(ax.length, bx.length);
  for (let i = 0; i < n; i++) {
    const d =
      (ax[i].codePointAt(0) ?? 0) - (bx[i].codePointAt(0) ?? 0);
    if (d !== 0) {
      return d;
    }
  }
  return ax.length - bx.length;
}

/** The delivery adopted on the `values` slot, or `null`. */
function deliveredDomain(el: HdvlElement): null | Delivery {
  return adoptedOf(el, VALUES_SLOT);
}

/**
 * A delivered column's D9 type, derived from the `data` arm rather
 * than imported.
 *
 * `ColumnType` itself lives in `../hdio/decode`, which the §2.1
 * edge does not permit `src/hdvl/` to import at all — not even
 * `type`-only, and `check-dist.mjs` check 6 enforces exactly that.
 * `Delivery` carries the same type, so an `Extract` reaches it
 * through the one module the edge does allow.
 */
type DeliveredType = Extract<Delivery, { kind: "data" }>["type"];

/**
 * A delivered column's kind, as a scale kind (SPEC §6) — V2's whole
 * lookup, and the reason V2 is one rule rather than a table.
 *
 * A `time` column maps to `continuous` because ms-since-midnight
 * *is* a number; that it is not an **instant** is the separate
 * clause V2 spells out for `hdml-datetime-scale`.
 *
 * @param type - The delivered column type.
 * @returns The scale kind that binding belongs on.
 */
export function kindOfColumn(type: DeliveredType): ScaleKind {
  if (type.kind === "string") {
    return "ordinal";
  }
  return type.kind === "date" || type.kind === "timestamp"
    ? "datetime"
    : "continuous";
}

/**
 * §4.2 steps 1–3: the derived endpoints, before `min`/`max`.
 *
 * Returns `undefined` when the source returned **nothing** — a
 * zero-row `values` delivery, whose extent is `[NaN, NaN]` and
 * whose ordinal list is empty. That is UNRESOLVED-BUT-LEGAL and
 * never V8 (§4.2 step 3).
 */
function derivedOf(
  el: HdvlElement,
  kind: ScaleKind,
  spec: ValuesSpec,
): undefined | ScaleDomain {
  if (spec.kind === "literal") {
    return literalDomain(kind, spec.json);
  }
  if (spec.kind !== "column") {
    return undefined;
  }
  const d = deliveredDomain(el);
  if (d === null || d.kind !== "data") {
    return undefined;
  }
  if (kind === "ordinal") {
    const values = d.domain.kind === "ordinal" ? d.domain.value : [];
    return values.length === 0
      ? undefined
      : { kind: "ordinal", values: values.map((v) => String(v)) };
  }
  if (d.domain.kind !== "extent") {
    return undefined;
  }
  const [lo, hi] = d.domain.value;
  return Number.isFinite(lo) && Number.isFinite(hi)
    ? { kind: "extent", extent: [lo, hi] }
    : undefined;
}

/** A literal `values` array, per kind. */
function literalDomain(
  kind: ScaleKind,
  json: unknown,
): undefined | ScaleDomain {
  if (!Array.isArray(json) || json.length === 0) {
    return undefined;
  }
  const items = <unknown[]>json;
  if (kind === "ordinal") {
    return { kind: "ordinal", values: items.map((v) => String(v)) };
  }
  const nums = items.map((v) =>
    kind === "datetime"
      ? instantOf(typeof v === "number" ? String(v) : String(v))
      : numberOf(String(v)),
  );
  const clean = nums.filter((n) => Number.isFinite(n));
  return clean.length === 0
    ? undefined
    : {
        kind: "extent",
        extent: [Math.min(...clean), Math.max(...clean)],
      };
}

/**
 * §4.2's seven steps, in the order SPEC §6 fixes them: domain →
 * `zero` → `nice`. `zero` may create the endpoint `nice` then
 * rounds, never the reverse.
 *
 * @param el - The scale element.
 * @param kind - Its kind.
 * @returns The resolved domain and which endpoints were authored.
 */
function resolveDomain(el: HdvlElement, kind: ScaleKind): Resolved {
  const spec = valuesSpecOf(el.getAttribute(VALUES_SLOT));
  const derived = derivedOf(el, kind, spec);
  const rawMin = el.getAttribute(A_MIN);
  const rawMax = el.getAttribute(A_MAX);

  if (kind === "ordinal") {
    return resolveOrdinal(el, derived, rawMin, rawMax);
  }

  // Step 2 — min / max override their endpoint, PER ENDPOINT.
  const authoredLo =
    kind === "datetime" ? instantOf(rawMin) : numberOf(rawMin);
  const authoredHi =
    kind === "datetime" ? instantOf(rawMax) : numberOf(rawMax);
  const lowAuthored = Number.isFinite(authoredLo);
  const highAuthored = Number.isFinite(authoredHi);
  const base = derived?.extent;
  let lo = lowAuthored ? authoredLo : base?.[0] ?? NaN;
  let hi = highAuthored ? authoredHi : base?.[1] ?? NaN;

  // Step 3 — a legal source that returned nothing.
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    return UNRESOLVED;
  }

  // Step 4 — `zero` extends a DERIVED endpoint only (V15's line).
  if (kind === "continuous" && has(el, A_ZERO)) {
    if (!lowAuthored && lo > 0) {
      lo = 0;
    }
    if (!highAuthored && hi < 0) {
      hi = 0;
    }
  }

  // Step 5 — `nice`, ONCE. Widening can promote the chosen step,
  // so `nice` is not idempotent and iterating to a fixed point
  // would be changing the rule rather than implementing it.
  if (has(el, A_NICE)) {
    const count = niceCount(el);
    const [nLo, nHi] = niceFor(el, kind, lo, hi, count);
    if (!lowAuthored && Number.isFinite(nLo)) {
      lo = nLo;
    }
    if (!highAuthored && Number.isFinite(nHi)) {
      hi = nHi;
    }
  }

  return {
    domain: { kind: "extent", extent: [lo, hi] },
    lowAuthored,
    highAuthored,
  };
}

/**
 * The ordinal half of §4.2 — steps 1, 2, 3 and 7.
 *
 * `min` and `max` pin the **first** and **last** domain values, so
 * SPEC §6's combination table reads the same on every kind: two
 * authored endpoints and no `values` is a legal two-category
 * domain, and one authored endpoint replaces that end of a derived
 * list.
 */
function resolveOrdinal(
  el: HdvlElement,
  derived: undefined | ScaleDomain,
  rawMin: null | string,
  rawMax: null | string,
): Resolved {
  const low = (rawMin ?? "").trim();
  const high = (rawMax ?? "").trim();
  const lowAuthored = low !== "";
  const highAuthored = high !== "";
  const derivedValues = derived?.values ?? [];
  let values: string[];
  if (derivedValues.length === 0) {
    // No list to pin an end of, so the authored endpoints ARE the
    // domain — a legal one- or two-category ordinal scale.
    values = [
      ...(lowAuthored ? [low] : []),
      ...(highAuthored ? [high] : []),
    ];
    if (values.length === 0) {
      return UNRESOLVED;
    }
  } else {
    values = [...derivedValues];
    if (lowAuthored) {
      values[0] = low;
    }
    if (highAuthored) {
      values[values.length - 1] = high;
    }
  }
  // Step 7 — `sort`. `domain` keeps first-occurrence row order.
  const sort = (el.getAttribute(A_SORT) ?? "").trim();
  if (sort === "ascending") {
    values.sort(byCodePoint);
  } else if (sort === "descending") {
    values.sort((a, b) => byCodePoint(b, a));
  }
  return {
    domain: { kind: "ordinal", values },
    lowAuthored,
    highAuthored,
  };
}

/** Whether a modifier attribute is present and not `"false"`. */
function has(el: HdvlElement, attr: string): boolean {
  const raw = el.getAttribute(attr);
  return raw !== null && raw.trim().toLowerCase() !== "false";
}

/**
 * §4.2 step 5's ladder choice — **the scale's own ladder**.
 *
 * ★ **Added 2026-08-24 at step 25, under D1, with the user.** SPEC
 * §6's `nice` paragraph names exactly one special case — *"on
 * `hdml-datetime-scale` the step comes from the calendar ladder"* —
 * and step 18 read the silence about `log` / `pow` / `symlog` as
 * *linear*. On a **log** scale that is not a rounding difference: a
 * delivered `[12.5, 1250]` becomes `[0, 1400]`, V2 errors on the
 * zero, and the figure paints nothing (corpus `05-scatter` B, the
 * first page that ever ran it). The approved reading generalises the
 * datetime clause instead of special-casing it: whichever ladder a
 * scale's **ticks** come from is the ladder its `nice` rounds to.
 *
 * This dispatch has the same four arms `ticksFor` has, deliberately
 * — the two are the same §4.8 choice asked at two moments, and a
 * ladder that appeared in one and not the other is exactly the bug
 * this fixes. `pow`/`sqrt` fall through to {@link niceNumeric}
 * because §4.8's pow ladder **is** the numeric one (`ticksPow`
 * returns `ticksNumeric`), so nothing about a `sqrt` scale changes.
 *
 * @param el - The scale element.
 * @param kind - Its kind.
 * @param lo - The low endpoint after `zero`.
 * @param hi - The high endpoint after `zero`.
 * @param count - `nice`'s own target count.
 * @returns The widened endpoints.
 */
function niceFor(
  el: HdvlElement,
  kind: ScaleKind,
  lo: number,
  hi: number,
  count: number,
): [number, number] {
  if (kind === "datetime") {
    return niceCalendar(lo, hi, count, zoneOf(el));
  }
  const spec = specOf(el);
  if (spec.type === "log") {
    return niceLog(lo, hi, spec.base);
  }
  if (spec.type === "symlog") {
    return niceSymlog(lo, hi, count, spec.constant, spec.base);
  }
  return niceNumeric(lo, hi, count);
}

/** `nice`'s own target count. Bare `nice` is 10 (SPEC §6). */
function niceCount(el: HdvlElement): number {
  const n = numberOf(el.getAttribute(A_NICE));
  return Number.isFinite(n) && n > 0 ? n : 10;
}

/**
 * The scale's IANA zone. `utc` by default, `local` for the
 * runtime's own.
 *
 * An **unknown** zone is guarded here rather than allowed to reach
 * `kernel/zone.ts`, which throws `RangeError` on one deliberately:
 * a throw inside COMPUTE would take the whole frame down and the
 * validator could never report anything at all.
 */
export function zoneOf(el: HdvlElement): string {
  const raw = (el.getAttribute(A_ZONE) ?? "").trim();
  if (raw === "" || raw.toLowerCase() === "utc") {
    return "UTC";
  }
  const wanted =
    raw.toLowerCase() === "local"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : raw;
  try {
    void new Intl.DateTimeFormat("en", { timeZone: wanted }).format(
      0,
    );
    return wanted;
  } catch {
    return "UTC";
  }
}

/** The continuous transform, with §4.5's defaults. */
function specOf(el: HdvlElement): ContinuousSpec {
  const type = (el.getAttribute(A_TYPE) ?? "").trim().toLowerCase();
  const known =
    type === "log" ||
    type === "pow" ||
    type === "sqrt" ||
    type === "symlog"
      ? type
      : "linear";
  const base = numberOf(el.getAttribute(A_BASE));
  const exponent = numberOf(el.getAttribute(A_EXPONENT));
  const constant = numberOf(el.getAttribute(A_CONSTANT));
  return continuousSpec(known, {
    base: Number.isFinite(base) ? base : undefined,
    exponent: Number.isFinite(exponent) ? exponent : undefined,
    constant: Number.isFinite(constant) ? constant : undefined,
  });
}

// ---------------------------------------------------------------
// §4.3 — ranges from boxes
// ---------------------------------------------------------------

/** A `<length>` / `<number>` computed value as a number. */
function cssNumber(
  raw: undefined | string,
  fallback: number,
): number {
  const n = Number.parseFloat((raw ?? "").trim());
  return Number.isFinite(n) ? n : fallback;
}

/** A registered `<angle>`, in degrees, whatever unit it kept. */
function cssAngle(raw: undefined | string, fallback: number): number {
  const text = (raw ?? "").trim();
  const n = Number.parseFloat(text);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  if (/rad\s*$/i.test(text)) {
    return (n * 180) / Math.PI;
  }
  if (/grad\s*$/i.test(text)) {
    return n * 0.9;
  }
  if (/turn\s*$/i.test(text)) {
    return n * 360;
  }
  return n;
}

/**
 * §4.3's table. The box is the MEASURE snapshot's **content** box
 * (R5) — never a `getBoundingClientRect()` inside COMPUTE — and
 * `--hdml-angle-*` / `--hdml-size-*` come from the same computed
 * style everything else reads.
 *
 * @param channel - The channel this scale serves.
 * @param m - The scale's own measured snapshot.
 * @returns The range, or `null` for `color`.
 */
function rangeOf(
  channel: Channel,
  m: Measured,
): null | [number, number] {
  const box = m.content;
  switch (channel) {
    case "x":
      return [box.x, box.x + box.w];
    case "y":
      // bottom → top: a larger value is higher, which is
      // DESCENDING in §2.7's y-down view coordinates.
      return [box.y + box.h, box.y];
    case "radius":
      return [0, radialCeiling(box.w, box.h)];
    case "angle":
      return [
        cssAngle(m.props.get("--hdml-angle-start"), 0),
        cssAngle(m.props.get("--hdml-angle-end"), 360),
      ];
    case "size":
      return [
        cssNumber(m.props.get("--hdml-size-min"), 2),
        cssNumber(m.props.get("--hdml-size-max"), 12),
      ];
    default:
      // `color` has no range — `paint()` instead (§2.4). This is a
      // contract, not an omission.
      return null;
  }
}

// ---------------------------------------------------------------
// The Scale object
// ---------------------------------------------------------------

/** Everything one frame resolved about one scale. */
interface Frame {
  ctx: FrameContext | null;
  scale: Scale | null;
  /** `(domain, range)` identity — §5.11's edge. */
  signature: string;
  /** Whether that pair changed since the last drain. */
  changed: boolean;
}

const frames = new WeakMap<HdvlElement, Frame>();

function frameOf(el: HdvlElement): Frame {
  let f = frames.get(el);
  if (f === undefined) {
    f = { ctx: null, scale: null, signature: "", changed: false };
    frames.set(el, f);
  }
  return f;
}

/**
 * SPEC §7's *"locale resolves from the nearest `lang`"*, resolved at
 * the **view**.
 *
 * **★ Step 24 exported this rather than writing the guide's own.**
 * The plan reserved §4.9's full ancestor walk for the guide, on the
 * grounds that a label formats a *set* through `formatCompactSet`
 * and so needs a locale of its own. It does — but a second
 * resolution is the one construction under which a single axis can
 * format in two locales: `hdml-label` reaches `formatCompactSet`
 * directly on a continuous channel and reaches {@link Scale.format}
 * on a datetime one (only the scale knows its `timeZone`), so the
 * two paths **must** agree or one axis renders half its ticks in
 * `en` and half in `de`. Resolving at the view makes them agree by
 * construction, because a label and the scale it labels share one.
 *
 * The narrowing that buys it: a `lang` on an element *between* the
 * view and a guide does not take effect. Nothing in the corpus
 * writes one, and widening this to a `parentElement` walk is a
 * behaviour change to `Scale.format` as much as to the label — so it
 * is a decision to take deliberately, not a side effect of step 24.
 * See `docs/decisions.md`.
 *
 * Read per frame, so a `lang` change is picked up rather than frozen
 * at construction.
 *
 * @param el - Any display element in the view.
 * @returns A BCP 47 tag.
 */
export function localeOf(el: HdvlElement): string {
  const view = resolutionOf(el)?.view ?? null;
  const own = (view?.getAttribute("lang") ?? "").trim();
  if (own !== "") {
    return own;
  }
  const root = document.documentElement.lang.trim();
  return root !== "" ? root : navigator.language;
}

/** Builds the eleven-member object for one frame. */
function buildScale(
  el: HdvlElement,
  kind: ScaleKind,
  channel: Channel,
  ctx: FrameContext,
): Scale {
  const m = ctx.measured(el);
  const resolved = resolveDomain(el, kind);
  const domain = resolved.domain;
  const base = rangeOf(channel, m);
  // §4.2 step 6 — `reverse` reverses the RANGE mapping and leaves
  // the domain untouched. It is applied ONCE, here, so `range()`
  // and `project()` can never disagree about which way it runs.
  const range: null | [number, number] =
    base !== null && has(el, A_REVERSE) ? [base[1], base[0]] : base;
  const clamp = has(el, A_CLAMP) && kind !== "ordinal";
  const bandwidth = Math.min(
    1,
    Math.max(0, cssNumber(m.props.get("--hdml-bandwidth"), 0.8)),
  );
  const spec =
    kind === "continuous" ? specOf(el) : continuousSpec("linear");
  const zone = kind === "datetime" ? zoneOf(el) : null;
  const values = domain?.values ?? [];
  const extent = domain?.extent ?? null;

  const bandAt = (v: string): ScaleBand | null =>
    kind !== "ordinal" || range === null
      ? null
      : bandOfValue(v, values, range, bandwidth);

  const at = (v: number | string): number | null => {
    if (range === null) {
      return null;
    }
    if (kind === "ordinal") {
      return bandAt(String(v))?.centre ?? null;
    }
    if (extent === null) {
      return null;
    }
    const n = typeof v === "number" ? v : rawToNumber(kind, v);
    if (!Number.isFinite(n)) {
      return null;
    }
    return projectContinuous(spec, extent, range, n, { clamp });
  };

  const fraction = (v: number | string): number | null => {
    if (extent === null) {
      return null;
    }
    const n = typeof v === "number" ? v : rawToNumber(kind, v);
    if (!Number.isFinite(n)) {
      return null;
    }
    return projectContinuous(spec, extent, [0, 1], n, {
      clamp: true,
    });
  };

  return {
    kind,
    channel,
    domain: (): ScaleDomain | null => domain,
    range: (): [number, number] | null => range,
    project: at,
    bandOf: bandAt,
    paint: (v: number | string): string | null => {
      if (channel !== "color" || domain === null) {
        return null;
      }
      if (kind === "ordinal") {
        const palette = splitColorList(
          m.props.get("--hdml-palette") ?? "",
        );
        return paletteColor(palette, values.indexOf(String(v)));
      }
      const t = fraction(v);
      if (t === null) {
        return null;
      }
      const stops = splitColorList(
        m.props.get("--hdml-color-interpolate") ?? "",
      );
      const space = (
        m.props.get("--hdml-color-interpolate-space") ?? "oklch"
      ).trim();
      return stops.length === 0 ? null : rampStops(stops, space, t);
    },
    ticks: (want: TickSpec): readonly Tick[] =>
      ticksFor(kind, spec, domain, zone, want, at),
    format: (v: number | string, skeleton?: string): string => {
      if (kind === "ordinal") {
        // SPEC §7: an ordinal channel renders its domain strings
        // verbatim. There is nothing to format.
        return String(v);
      }
      const n = typeof v === "number" ? v : rawToNumber(kind, v);
      if (!Number.isFinite(n)) {
        return String(v);
      }
      return formatValue(n, skeleton ?? "", localeOf(el), zone);
    },
  };
}

/** A string domain value read back as a number, per kind. */
function rawToNumber(kind: ScaleKind, v: string): number {
  return kind === "datetime" ? instantOf(v) : numberOf(v);
}

/**
 * SPEC §7's explicit `step=` — *"states the interval exactly and
 * invokes no tick algorithm"*, so every multiple of the author's
 * interval that lies inside the domain, and nothing else.
 *
 * ★ **Corrected 2026-08-24 at step 25.** The obvious spelling of
 * that predicate is `ceil(lo / step) … floor(hi / step)`, and it is
 * wrong at the one place it matters most: `0.35 / 0.05` is
 * `6.999999999999999`, so a domain whose high endpoint **is** a
 * multiple of the step silently loses its last tick — the top
 * gridline and the top label, with no diagnostic. Measured on
 * corpus page `05-scatter` A, whose `nice`d margin domain ends
 * exactly at `0.35` and whose `step="0.05"` grid and label both
 * stopped at `0.30`. §4.8's own ladder never had this bug because
 * it generates `i / divisor` over an integer index range; an
 * author's step is an arbitrary number with no divisor to reuse, so
 * the bound is taken with a **relative** tolerance and the products
 * are snapped back onto the endpoints they name. Landed at step 18,
 * found at step 25 — the first step that ran a `step=` guide over a
 * domain it did not choose.
 *
 * The tolerance is relative to the domain's own magnitude, because
 * an absolute one is meaningless across a corpus carrying both
 * `0.05` margins and `500 000` revenues.
 *
 * A sub-unit step whose reciprocal is an integer — `0.05`, `0.2`,
 * `0.001`, which is nearly every one an author writes — gets the
 * kernel's own treatment and is generated as `i / divisor`, so the
 * **interior** ticks are exact too: `3 * 0.05` is
 * `0.15000000000000002` where `3 / 20` is `0.15`. The endpoint
 * tolerance stays as the backstop for the steps that have no
 * divisor.
 *
 * @param lo - The domain's low endpoint.
 * @param hi - The domain's high endpoint.
 * @param step - The author's interval, already known positive.
 * @returns The ticks, ascending.
 */
function stepTicks(lo: number, hi: number, step: number): number[] {
  const guess = Math.round(1 / step);
  const exact =
    step < 1 && guess > 0 && Math.abs(guess * step - 1) < 1e-12;
  const index = (v: number): number => (exact ? v * guess : v / step);
  const value = (i: number): number => (exact ? i / guess : i * step);
  const first = Math.ceil(index(lo) - 1e-9);
  const last = Math.floor(index(hi) + 1e-9);
  if (!Number.isFinite(first) || !Number.isFinite(last)) {
    return [];
  }
  const tol = Math.max(Math.abs(lo), Math.abs(hi), step) * 1e-9;
  const out: number[] = [];
  for (let i = first; i <= last; i++) {
    const v = value(i);
    const snapped =
      Math.abs(v - lo) <= tol ? lo : Math.abs(v - hi) <= tol ? hi : v;
    out.push(snapped === 0 ? 0 : snapped);
  }
  return out;
}

/**
 * §4.8's ladders, chosen by kind and by which member of the spec
 * the guide supplied. Every one of them is `kernel/`'s (R12).
 */
function ticksFor(
  kind: ScaleKind,
  spec: ContinuousSpec,
  domain: ScaleDomain | null,
  zone: null | string,
  want: TickSpec,
  at: (v: number | string) => number | null,
): readonly Tick[] {
  if (domain === null) {
    return [];
  }
  const values = tickValues(kind, spec, domain, zone, want);
  const out: Tick[] = [];
  for (const value of values) {
    const where = at(value);
    if (where !== null) {
      out.push({ value, at: where });
    }
  }
  return out;
}

/** The tick VALUES, before projection. */
function tickValues(
  kind: ScaleKind,
  spec: ContinuousSpec,
  domain: ScaleDomain,
  zone: null | string,
  want: TickSpec,
): (number | string)[] {
  if (kind === "ordinal") {
    const list = [...(domain.values ?? [])];
    return thinOrdinal(list, {
      count: want.count,
      step: want.step,
      values: want.values?.map((v) => String(v)),
    });
  }
  const extent = domain.extent;
  if (extent === undefined) {
    return [];
  }
  if (want.values !== undefined) {
    return want.values.map((v) =>
      typeof v === "number" ? v : rawToNumber(kind, v),
    );
  }
  const [lo, hi] = [
    Math.min(extent[0], extent[1]),
    Math.max(extent[0], extent[1]),
  ];
  if (want.step !== undefined && want.step > 0) {
    return stepTicks(lo, hi, want.step);
  }
  const count =
    want.count !== undefined && want.count > 0 ? want.count : 10;
  if (kind === "datetime") {
    return ticksCalendar(lo, hi, count, zone ?? "UTC");
  }
  if (spec.type === "log") {
    return ticksLog(lo, hi, count, spec.base);
  }
  if (spec.type === "pow") {
    return ticksPow(lo, hi, count);
  }
  if (spec.type === "symlog") {
    return ticksSymlog(lo, hi, count, spec.constant, spec.base);
  }
  return ticksNumeric(lo, hi, count);
}

// ---------------------------------------------------------------
// The per-frame seam every element and widget goes through
// ---------------------------------------------------------------

/**
 * Resolves this scale for the frame in flight — called from the
 * scale element's own `scene()`, which is why a scale with no
 * widgets under it still resolves, still reports `hdml-data`'s
 * resolved domain, and still fires `hdml-scale-change`.
 *
 * Idempotent within one frame: the `FrameContext` is the frame's
 * identity, so a widget asking later gets the object the scale
 * already built rather than a second resolution.
 *
 * @param el - The scale element.
 * @param ctx - The frame's snapshot.
 * @returns Its `Scale`, or `null` when the element declares no
 *   legal channel.
 */
export function resolveScaleFrame(
  el: HdvlElement,
  ctx: FrameContext,
): Scale | null {
  const state = frameOf(el);
  if (state.ctx === ctx) {
    return state.scale;
  }
  const kind = scaleKindOf(el);
  const channel = channelOf(el.getAttribute(A_CHANNEL));
  const scale =
    kind === null || channel === null
      ? null
      : buildScale(el, kind, channel, ctx);
  const signature = signatureOf(scale);
  state.ctx = ctx;
  state.scale = scale;
  if (signature !== state.signature) {
    state.signature = signature;
    state.changed = true;
  }
  return scale;
}

/** §5.11's edge — the resolved `(domain, range)` pair. */
function signatureOf(scale: Scale | null): string {
  if (scale === null) {
    return "";
  }
  return JSON.stringify([scale.domain(), scale.range()]);
}

/**
 * The `Scale` this element resolved in the last frame.
 *
 * @param el - A scale element.
 * @returns Its `Scale`, or `null` before its first frame.
 */
export function scaleOf(el: HdvlElement): Scale | null {
  return frames.get(el)?.scale ?? null;
}

/**
 * The scale a widget's channel resolves to — a read of the
 * resolution index and nothing else (R35).
 *
 * @param ctx - The frame's snapshot.
 * @param el - The widget.
 * @param channel - The channel it binds.
 * @returns The resolved `Scale`, or `null`.
 */
export function chainScaleOf(
  ctx: FrameContext,
  el: HdvlElement,
  channel: Channel,
): Scale | null {
  const scale = ctx.resolution(el)?.chain[channel];
  if (scale === undefined) {
    return null;
  }
  // Scales precede their widgets in document order, so this is
  // normally a cache read; resolving here covers the one case it
  // is not — a widget asked out of order by a test.
  return resolveScaleFrame(scale, ctx);
}

/**
 * §5.11's `hdml-scale-change`, queued for the after-PAINT drain.
 *
 * **Edge-triggered on the `(domain, range)` pair**, or a resize
 * drag would fire it sixty times a second. Note the edge differs
 * from `hdml-data`'s on purpose: a resize changes the range and so
 * **does** re-fire this event, while §5.11 says a resize does not
 * re-fire `hdml-data`.
 *
 * @param elements - The view's display elements, document order.
 * @param queue - The frame's outward-event queue.
 */
export function drainScaleEvents(
  elements: readonly HdvlElement[],
  queue: EventQueue,
): void {
  for (const el of elements) {
    const state = frames.get(el);
    if (state === undefined || !state.changed) {
      continue;
    }
    state.changed = false;
    const scale = state.scale;
    if (scale === null) {
      continue;
    }
    queue.push(
      el,
      outward(HDML_SCALE_CHANGE, {
        channel: scale.channel,
        domain: scale.domain(),
        range: scale.range(),
      }),
    );
  }
}

/**
 * §7.2's request path for a scale — R6's *"a scale's `values` is an
 * ordinary D8 subscription"*, and the whole of it.
 *
 * `raw: false` is SPEC §4's domain request shape: the worker
 * already computes both shapes, and a scale and a mark binding the
 * same column coalesce into one union entry whose `raw` is
 * OR-merged, so the domain costs no extra query.
 *
 * **A literal `values="[…]"` opens no subscription at all**, which
 * is what keeps a literal-only page out of `:state(loading)`
 * forever (R22/R34).
 *
 * @param el - The scale element.
 * @returns Its bindings — at most one, on the `values` slot.
 */
export function scaleBindings(el: HdvlElement): readonly Binding[] {
  const spec = valuesSpecOf(el.getAttribute(VALUES_SLOT));
  if (spec.kind !== "column") {
    return [];
  }
  const ref = sourceOf(el);
  if (ref === null) {
    return [];
  }
  return [
    { slot: VALUES_SLOT, ref, column: spec.column, raw: false },
  ];
}
