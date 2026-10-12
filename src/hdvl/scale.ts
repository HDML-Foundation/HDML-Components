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
import { bandSlotOf, bandSlotOwnerOf, subdivide } from "./container";
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
  /**
   * A target, never a promise — or **`"auto"`**, which is
   * `--hdml-tick-count`'s initial and hands the decision to the
   * runtime (§6.6, 019 item 8).
   *
   * ★ **`"auto"` is forwarded, not resolved, by `tickSpecOf`.**
   * Resolving it needs the scale's pixel `range`, which only
   * {@link buildScale} holds — see {@link autoCap}. A guide with
   * no MEASURE snapshot has no declaration to read and so leaves
   * this **absent**, which is a third state and not a synonym for
   * `"auto"`: absent means *"this guide takes no spec at all"*
   * (§6.5's `hdml-axis`) and keeps the ladder's own default.
   */
  count?: number | "auto";
  /** An exact interval. */
  step?: number;
  /** Literal JSON. */
  values?: readonly (number | string)[];
}

/**
 * A {@link TickSpec} with `auto` already **resolved** — what the
 * two-function ladder thread (`ticksFor` → `tickValues`) consumes.
 *
 * `count` has narrowed back to a number, and `auto`'s answer
 * arrives as {@link WantedTicks.cap} instead, because the two mean
 * different things to the ladder: a `count` is a target handed
 * *to* it, and a `cap` is a ceiling applied *after* it.
 */
interface WantedTicks {
  count?: number;
  step?: number;
  values?: readonly (number | string)[];
  /**
   * `auto`'s pixel-derived ceiling — stride-thin the ladder's
   * output down to at most this many (§6.6). Absent whenever
   * `auto` could not be resolved, which is the whole of today's
   * behaviour.
   */
  cap?: number;
}

/** One tick (§2.4). */
export interface Tick {
  value: number | string;
  /**
   * In the channel's range unit (see {@link Scale.project}) — CSS
   * px, degrees, or, on a continuous `color` channel, the ramp
   * fraction in `[0, 1]`.
   */
  at: number;
}

/** The band a value occupies, in range units (§4.4). */
export interface ScaleBand {
  start: number;
  width: number;
  centre: number;
}

/**
 * Contract 2 — ten members, and every one of them answers from
 * the frame the scale last resolved in.
 *
 * ⚠ This said **eleven** until 019 R1 added `paintState`, and
 * eleven was never right: `scale.test.ts`'s `MEMBERS` has counted
 * **nine** since step 18 and records that the step-18 prompt said
 * eleven *"in five places"*. Nine + `paintState` = **ten**.
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
   *  size), degrees (angle), and on a CONTINUOUS `color`
   *  channel the ramp fraction in [0, 1] — the number
   *  `paint()` maps through, since a colour has no
   *  `range()` but does have a position along its ramp
   *  (step 31, the legend's bar). null = the value is
   *  outside an ordinal domain, so the row produces no
   *  mark. */
  project(v: number | string): number | null;
  /** Ordinal only. The band the value occupies, in range
   *  units. `centre` is what every non-band-filling lookup
   *  resolves to (§4.4). On an `angle` channel whose sweep is
   *  a whole turn the bands divide by `n` rather than
   *  `n − 1 + b`, because `r1` is `r0` — see
   *  {@link isCyclic} (017 R8). */
  bandOf(v: string): ScaleBand | null;
  /** `color` only: the resolved CSS <color> for a value. */
  paint(v: number | string): string | null;
  /** ★ 019 R1. `color` only: the value's colour in an
   *  INTERACTION state, from `--hdml-palette--{state}` or
   *  `--hdml-color-interpolate--{state}`.
   *
   *  **`null` means "no state rule applies"** and never
   *  "re-state the base" — see {@link CHANNEL_STATE_PROPERTIES}.
   *  That is why this is a sibling of {@link Scale.paint} rather
   *  than a second parameter on it: `paint()`'s `null` means
   *  *exhausted / not a colour channel*, and one return channel
   *  may not carry two meanings a caller must tell apart. */
  paintState(v: number | string, state: string): string | null;
  ticks(spec: TickSpec): readonly Tick[];
  /** CLDR skeleton → formatted text (§4.9). */
  format(v: number | string, skeleton?: string): string;
}

/**
 * ★ 019 R1 — the **channel class** of SPEC §9's state variants:
 * the base properties whose `--hover` / `--active` variants are
 * read **per datum** by {@link Scale.paintState} rather than
 * emitted into a generated CSS rule by `states.ts`.
 *
 * **Exported for exactly one reason**, and it is the same reason
 * `STATE_PROPERTIES` is: it is the only thing that makes the
 * registry↔reader boundary **enforced** rather than remembered.
 * `states.test.ts` asserts both lists against `HDVL_PROPERTIES` in
 * both directions and asserts they are **disjoint**, so a
 * registered variant with no reader fails, a listed base with no
 * registration fails, and a base claimed by both classes fails.
 *
 * ── Why this is a SECOND list and not two more members of
 * `STATE_PROPERTIES` ──
 *
 * `STATE_PROPERTIES` is *"the base properties `states.ts` can
 * state-vary"*, and `states.ts` cannot state-vary either of these.
 * A palette is a `<color>+` list feeding `n` colours through one
 * declaration: `fill: #1c8cf4 #f59e0b …` is not a paint value, so
 * there is no literal for the generator to emit and no single rule
 * that could carry it. Adding them there would have widened a list
 * whose docblock promises its members are generated — which is
 * precisely R7's silent-failure shape, reintroduced by the step
 * that was closing it. Two lists, each exhaustive against its own
 * reader, keep the boundary sharp in both directions.
 *
 * ── ★ `--hdml-color-interpolate-space` is absent (D3) ──
 *
 * It is the ramp's interpolation space, not a colour. A per-state
 * space would change *how* the ramp is computed — a different
 * picture on hover rather than a different colour — so a state ramp
 * interpolates in the base space. That is what holds the registry
 * at 57 rather than 59.
 */
export const CHANNEL_STATE_PROPERTIES: readonly string[] = [
  "--hdml-palette",
  "--hdml-color-interpolate",
];

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

/**
 * A registered `<angle>`, in degrees, whatever unit it kept.
 *
 * ★ **Exported at 017 R2's step 10-4, for its second caller.** It is
 * registry-generic and never was scale arithmetic — it converts
 * `rad`/`grad`/`turn` because a registered `<angle>`'s computed value
 * is not guaranteed to be canonicalised to `deg` on every engine —
 * and it lived here only because `--hdml-angle-start`/`-end` were the
 * registry's only `<angle>`s. `--hdml-text-rotate` is the second, and
 * `guide-label.ts` reads it through **this** function rather than a
 * sixth private copy: three unit conversions are an implementation,
 * not the one-liner `cssNumber` is, and R12/R18 gives an
 * implementation one home. {@link localeOf} is the precedent for a
 * reader hosted here that a guide also needs.
 */
export function cssAngle(
  raw: undefined | string,
  fallback: number,
): number {
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
 * A registered `<number>` resolved to §4.4's `b` — parsed, and
 * **clamped to `[0, 1]`**.
 *
 * ★ **Exported at 019 item 10 / R2's step 34, for its second
 * caller.** `--hdml-bandwidth` was the registry's only bandwidth
 * until `--hdml-cluster-bandwidth`, so the clamp lived inline at
 * the one read site. Two readers make it an implementation, and
 * R12/R18 gives an implementation one home — the same argument
 * {@link cssAngle} is here under, with {@link localeOf} as the
 * older precedent.
 *
 * ★ **It is not a second {@link cssNumber}.** `cssNumber` is a bare
 * parse-with-fallback, and the five private copies of it across
 * this package are deliberately private because there is nothing
 * to share. What this function carries is the **band contract**:
 * {@link import("./kernel/scale-band").bandOf} documents its
 * `bandwidth` parameter as *"already resolved to a number in
 * `[0, 1]`"*, the kernel never reads a CSS value, and so the
 * resolution that discharges that precondition is exactly the
 * thing R12 says must not exist twice. A second clamp that drifted
 * — `Math.max` without the `Math.min`, say — would hand the kernel
 * a `b > 1`, and §4.4 answers that with **overlapping** bands
 * rather than an error.
 *
 * ★ **Above 1 clamps rather than diagnosing**, which is a choice
 * and not an oversight: `<number>` has no closed set for CSS to
 * reject against, so the alternatives were a clamp or a new
 * V-rule, and a V-rule on a value the cascade may deliver from
 * anywhere would fire on documents whose author never wrote the
 * property. The outer read has answered it this way since Slice C;
 * both now answer it in one place. `0` is **legal** at both ends —
 * the outer band's `0` is §9's point placement, and the inner
 * band's is its exact analogue: `n` zero-width slots spread
 * edge-to-edge across the group.
 *
 * @param raw - The computed value, or `undefined`.
 * @param fallback - The value to use when it does not parse.
 * @returns `b`, in `[0, 1]`.
 */
export function cssBandwidth(
  raw: undefined | string,
  fallback: number,
): number {
  return Math.min(1, Math.max(0, cssNumber(raw, fallback)));
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

/**
 * ★ **017 R8 — cyclicity is DERIVED, never authored.** An `angle`
 * channel whose sweep is a non-zero multiple of a whole turn has
 * `r1` denoting the **same place** as `r0`, so §4.4's inclusive
 * denominator places the last category on the first: `10-radar`'s
 * six metrics over `[0deg, 360deg]` at `--hdml-bandwidth: 0` stepped
 * by `360 / 5` and drew a pentagon. `kernel/scale-band.ts` takes
 * `cyclic` as a parameter and this is the one place that decides it.
 *
 * *(Decided 2026-09-26, with the user, at 017 step 07.)* The
 * alternatives were an authored `cyclic` attribute — which leaves
 * every new radar wrong by default — and derivation plus an
 * `inclusive` opt-out, whose only purpose would be to reinstate the
 * defect. **The accepted cost is that a page's geometry changes when
 * its `--hdml-angle-end` crosses a whole turn with nothing in the
 * document saying so**: a 359° fan and a 360° one place their
 * categories by different arithmetic. That is R1's trade taken
 * again — the runtime owns the geometry the author cannot see.
 *
 * **Only `angle` can be cyclic**, and only an ordinal scale has
 * bands to collide: `x`, `y` and `radius` are lengths in a box and
 * `size` is a diameter range, none of which wrap. The test is on
 * `|r1 − r0|` and so is immune to `reverse`, which swaps the pair.
 *
 * **A multi-turn sweep stays degenerate**, deliberately: 720° over
 * six categories collides under `n` (0/120/240/0/120/240) exactly as
 * it does under `n − 1 + b`, because the range really does pass the
 * same angle twice. Naming it non-cyclic would not rescue it, so the
 * survivor is reported rather than arithmetically hidden — see
 * {@link angleCollisionOf} and V2's `colliding-angle-bands`.
 *
 * @param channel - The channel this scale serves.
 * @param kind - Its tag's kind.
 * @param range - The resolved range, already reversed if `reverse`.
 * @returns Whether the band formula should divide by `n`.
 */
function isCyclic(
  channel: Channel,
  kind: ScaleKind,
  range: null | readonly [number, number],
): boolean {
  if (channel !== "angle" || kind !== "ordinal" || range === null) {
    return false;
  }
  const turns = Math.abs(range[1] - range[0]) / 360;
  // A tolerance rather than `% 360 === 0`, because a sweep authored
  // in `rad` or `grad` reaches here through a unit conversion:
  // `2 * Math.PI` rad is 359.999999999999994°, which is one turn and
  // must not be read as a partial one. Below a millionth of a
  // degree there is no authorable intent to preserve — the scene's
  // own quantization is six decimals.
  return turns >= 1 && Math.abs(turns - Math.round(turns)) < 3e-9;
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

/** Builds the ten-member object for one frame. */
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
  // The OUTER band — the gap between *categories*. Its inner
  // sibling `--hdml-cluster-bandwidth` is read in `chainScaleOf`,
  // off the cluster, through this same function (019 item 10).
  const bandwidth = cssBandwidth(
    m.props.get("--hdml-bandwidth"),
    0.8,
  );
  const cyclic = isCyclic(channel, kind, range);
  const spec =
    kind === "continuous" ? specOf(el) : continuousSpec("linear");
  const zone = kind === "datetime" ? zoneOf(el) : null;
  const values = domain?.values ?? [];
  const extent = domain?.extent ?? null;

  const bandAt = (v: string): ScaleBand | null =>
    kind !== "ordinal" || range === null
      ? null
      : bandOfValue(v, values, range, bandwidth, cyclic);

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

  const at = (v: number | string): number | null => {
    if (range === null) {
      // ★ A colour channel has no `range()` and never gains one
      // (§2.4) — but a CONTINUOUS one does have a position unit,
      // and it is the **ramp fraction** `paint()` already maps
      // through. Returning `null` here made `ticksFor` drop every
      // tick it generated (its §4.7 filter is `at(value) !==
      // null`), so `ticks()` on a colour scale answered `[]` and a
      // continuous legend would have had no graduations at all —
      // silently, since an empty tick list is a legal answer.
      // Landed at step 31, with the first caller. The ORDINAL
      // colour case stays `null`: a palette slot is not a position
      // and a key renders the domain, never a tick list.
      return channel === "color" && kind !== "ordinal"
        ? fraction(v)
        : null;
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
    paintState: (
      v: number | string,
      state: string,
    ): string | null => {
      if (channel !== "color" || domain === null) {
        return null;
      }
      // ★ R1's `null` contract, and the ONE place it is decided.
      // An unauthored state source is the empty sentinel (these
      // four OMIT `initialValue`), so `""` here means "the author
      // wrote no state rule" and the node keeps the base paint
      // `paint()` already gave it. Returning the BASE instead
      // would make every channel-coloured mark carry a state rule
      // that changes nothing — which is a cost per node for no
      // author-visible effect, and it would also make "has a
      // state colour" untestable from the outside.
      //
      // `state` is not validated against `HDVL_STATES`: importing
      // it would close the cycle `scale → states → mark → scale`.
      // It needs no validation — an unknown state spells a
      // property nobody registered, whose computed value is
      // `undefined`, which falls out here as `null`.
      if (kind === "ordinal") {
        const raw = m.props.get(`--hdml-palette--${state}`) ?? "";
        if (raw.trim() === "") {
          return null;
        }
        return paletteColor(
          splitColorList(raw),
          values.indexOf(String(v)),
        );
      }
      const raw =
        m.props.get(`--hdml-color-interpolate--${state}`) ?? "";
      if (raw.trim() === "") {
        return null;
      }
      const t = fraction(v);
      if (t === null) {
        return null;
      }
      const stops = splitColorList(raw);
      // ★ D3 — the interpolation SPACE has no variant and is read
      // off the base. It is the ramp's geometry, not a colour: a
      // per-state space would redraw the ramp on hover instead of
      // recolouring it.
      const space = (
        m.props.get("--hdml-color-interpolate-space") ?? "oklch"
      ).trim();
      return stops.length === 0 ? null : rampStops(stops, space, t);
    },
    ticks: (want: TickSpec): readonly Tick[] =>
      ticksFor(
        kind,
        spec,
        domain,
        zone,
        wantedTicks(want, kind, channel, range, m),
        at,
      ),
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
 * ★ **The channels whose `range` is measured in CSS px.**
 *
 * `rangeOf`'s table hands back a range *in the channel's own unit*:
 * px for these three, **degrees** for `angle`, a **diameter** pair
 * for `size`, and `null` for `color`. A minimum *pitch* in px is
 * therefore only meaningful here, and item 8's whole derivation is
 * a pitch. An `angle` range would need the radius it is swept at to
 * become an arc length, and the angle scale does not know it.
 *
 * ⚠ So `auto` on an `angle`, `size` or `color` channel resolves to
 * **absent** — the ladder's own default, which is exactly today's
 * behaviour. This is a gap, not a silent wrong answer, and it is
 * what keeps `guide-grid.ts`'s radial spokes and every colour
 * legend's graduations where they are.
 */
const PX_CHANNELS: readonly Channel[] = ["x", "y", "radius"];

/**
 * ★★ **A13 — the minimum pitch one tick needs, in CSS px.**
 *
 * `2 × --hdml-font-size + 2px`, which is **24 px** at the
 * registered `11px` initial. The form matters more than the
 * number: a pitch expressed in font sizes moves with the type
 * rather than being a magic constant, which is the reason A13
 * chose 24 over the 20 and 30 that also satisfy the window.
 *
 * **The window is measured, not guessed** (Note 005 §4.2): the
 * upper bound `≤ 30.78 px` is `02-area`'s own wide-layout pitch,
 * so a larger pitch would thin an axis that fits and move a
 * golden; the lower bound `> 16.47 px` is `04-grouped-stacked` E's
 * narrow pitch, so a smaller one would fail to thin a collision
 * the gate has recorded. **Admissible: `16.47 < p ≤ 30.78`.**
 *
 * ★ `m.font.size` is the SAME `--hdml-font-size` read `measure.ts`
 * already resolves to a number for the text metrics (`:269`), off
 * the same `getComputedStyle` call `m.props` comes from. Nothing
 * is plumbed and no second read is introduced — R16 keeps computed
 * styles in `measure.ts` and this honours it.
 *
 * ⚠ **It is the SCALE's font size, not the guide's.** The scale is
 * the only element `buildScale` has a snapshot of, and a guide's
 * ticks are the scale's to decide (R12). `--hdml-font-size`
 * inherits, so the two agree unless a rule targets the guide
 * alone — in which case `auto` is an estimate made at the wrong
 * size. That is admissible because `auto` is an estimate either
 * way (§3.4): it has no access to ink.
 *
 * @param m - The scale's own measured snapshot.
 * @returns The pitch in px, always finite and `> 0`.
 */
function minPitch(m: Measured): number {
  const size =
    Number.isFinite(m.font.size) && m.font.size > 0
      ? m.font.size
      : 11;
  return 2 * size + 2;
}

/**
 * ★★★ **Item 8 — what `--hdml-tick-count: auto` resolves to.**
 *
 * `floor(span / minPitch)`, clamped to **at least 2**: an axis
 * always gets its two ends, however little room there is, because
 * a one-tick axis reads as a rendering failure rather than as a
 * crowded one.
 *
 * **It is a CEILING, never a target, and it NEVER ADDS a tick.**
 * The ladder is still asked for its own default, and the cap only
 * removes what there is no room for — which is item 8's defect
 * stated exactly (*"a ladder does not thin when the room runs
 * out"*). Two things follow, both deliberate:
 *
 * - **A wide axis is unchanged by construction.** `02-area`'s x
 *   axis has 664 px of range at the golden width, so the cap is
 *   `floor(664 / 24) = 27` against the 21 runs the calendar ladder
 *   emits — a stride of 1, and the golden cannot move. That is why
 *   the 29 goldens are a regression guard **on** the fix rather
 *   than a cost of it (Note 005 §4.3).
 * - **A very wide axis does not sprout ticks.** `auto` is not
 *   *"fill the room"*; it is *"use the room you have"*.
 *
 * ⚠ **The ORDINAL path is excluded.** `thinOrdinal` with an empty
 * spec returns the whole domain, and a categorical axis that drops
 * every other month leaves bars unlabelled — a different failure
 * from a crowded ladder, and not the one item 8 is about. §4.8's
 * ladders are what *"when the room runs out"* names, and an
 * ordinal domain has none. `04-grouped-stacked`'s 54 accepted
 * narrow collisions are therefore still accepted, by decision.
 *
 * ⚠ **A `step` or a `values` set is never capped** — see
 * {@link ticksFor}. Both are the author deciding exactly which
 * ticks exist; `auto` is the author declining to decide.
 *
 * @param kind - The scale's kind.
 * @param channel - The channel it serves.
 * @param range - Its resolved range, in the channel's unit.
 * @param m - The scale's own measured snapshot.
 * @returns The ceiling, or `undefined` when `auto` cannot be
 *   resolved — on an ordinal scale, a non-px channel, a `color`
 *   channel, or a range of no extent.
 */
function autoCap(
  kind: ScaleKind,
  channel: Channel,
  range: null | readonly [number, number],
  m: Measured,
): number | undefined {
  if (
    kind === "ordinal" ||
    range === null ||
    !PX_CHANNELS.includes(channel)
  ) {
    return undefined;
  }
  const span = Math.abs(range[1] - range[0]);
  if (!Number.isFinite(span) || span <= 0) {
    return undefined;
  }
  return Math.max(2, Math.floor(span / minPitch(m)));
}

/**
 * {@link TickSpec} → {@link WantedTicks}: `auto` becomes a
 * {@link WantedTicks.cap}, or becomes nothing at all.
 *
 * ★ **This is the one place `auto` is resolved, and it is NOT
 * `tickSpecOf`.** That function reads declarations and resolves
 * nothing, deliberately: *"a second resolution there would be a
 * second ladder entry point in all but name (R12), and the two
 * could disagree"*. So `tickSpecOf` forwards the keyword and
 * `buildScale` — the only holder of the pixel `range` — answers
 * it.
 */
function wantedTicks(
  want: TickSpec,
  kind: ScaleKind,
  channel: Channel,
  range: null | readonly [number, number],
  m: Measured,
): WantedTicks {
  const out: WantedTicks = {};
  if (want.step !== undefined) {
    out.step = want.step;
  }
  if (want.values !== undefined) {
    out.values = want.values;
  }
  if (want.count === "auto") {
    const cap = autoCap(kind, channel, range, m);
    if (cap !== undefined) {
      out.cap = cap;
    }
  } else if (want.count !== undefined) {
    out.count = want.count;
  }
  return out;
}

/**
 * ★ **Stride-thinning — `thinOrdinal`'s rule, on the continuous
 * side.**
 *
 * The mechanism is chosen, not incidental (Note 005 §3.3). The
 * alternative was re-asking the ladder for a **coarser rung**,
 * which was rejected because it changes the surviving labels'
 * *text*: months would become quarters, and an author who wrote
 * `format: MMM` would get something they never asked for. A
 * stride keeps every surviving label's text **and its position**,
 * so thinning is visibly the same axis with fewer labels on it.
 *
 * The arithmetic is `kernel/scale-band.ts`'s `thinOrdinal`
 * verbatim — `every ⌈N / cap⌉-th, starting at index 0` — so
 * **continuous axes come to behave as ordinal ones already do**.
 * Consistency, not a new idea. `N = 21, cap = 12` gives a stride
 * of `⌈21 / 12⌉ = 2` and therefore **eleven** values, not twelve:
 * a round stride wins over an exact count, which is §4.8's
 * opening rule and the reason `cap` is a ceiling.
 *
 * ⚠ **It is NOT shared with `thinOrdinal`.** That function is
 * typed to `readonly string[]` and owns the ordinal path, which
 * {@link autoCap} excludes; generalising it would put the ordinal
 * path at risk for no behavioural gain, and R12 keeps
 * `kernel/`'s signatures fixed for exactly this reason. The rule
 * is cited here instead of copied blind.
 *
 * **Index 0 is always kept**, which anchors the axis's first tick
 * rather than letting it drift with `N`.
 *
 * @param values - The ladder's output, in order.
 * @param cap - At most this many survive.
 * @returns The kept values, in order.
 */
function strideThin(
  values: readonly (number | string)[],
  cap: number,
): (number | string)[] {
  const raw = Math.ceil(values.length / Math.max(1, cap));
  // `strideOf`'s guard, for the same reason it gives: a stride
  // below 1 would loop forever and a non-finite one would blank
  // the axis, and both are legal arithmetic on a degenerate cap.
  const stride =
    Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
  if (stride <= 1) {
    return [...values];
  }
  const kept: (number | string)[] = [];
  for (let i = 0; i < values.length; i += stride) {
    kept.push(values[i]);
  }
  return kept;
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
  want: WantedTicks,
  at: (v: number | string) => number | null,
): readonly Tick[] {
  if (domain === null) {
    return [];
  }
  const ladder = tickValues(kind, spec, domain, zone, want);
  // ⚠ `auto`'s cap applies to a LADDER only. A `step` or a
  // `values` set is the author naming exactly which ticks exist,
  // and thinning it would silently overrule them — so the guard
  // mirrors `tickValues`'s own precedence (`values`, then `step`,
  // then `count`) rather than trusting V16 to have kept them
  // apart: V16 diagnoses, and the runtime must still be
  // deterministic when a document ignores the diagnostic.
  const values =
    want.cap !== undefined &&
    want.step === undefined &&
    want.values === undefined
      ? strideThin(ladder, want.cap)
      : ladder;
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
  want: WantedTicks,
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

/** A resolved ordinal colour domain that outruns its palette. */
export interface PaletteGap {
  /** How many domain values there are. */
  domain: number;
  /** How many colours `--hdml-palette` supplies. */
  palette: number;
}

/**
 * ★ SPEC §9's palette assignment, as a **question**: did this
 * scale's resolved domain outrun `--hdml-palette`?
 *
 * *"A domain larger than the palette is an **error**"* — and the two
 * facts it needs live on opposite sides of a module boundary. The
 * resolved domain and the computed palette are both **here**, on the
 * frame this scale last resolved in; the diagnostic, the edge
 * triggering and `:state(error)` are all `validate.ts`'s. So this
 * module answers and that one reports, rather than this one
 * importing the validator — which would close a cycle, since
 * `validate.ts` already imports {@link scaleKindOf} from here.
 *
 * **Ordinal only, and that is the rule and not a shortcut.** §5.5
 * assigns a palette *by domain index*; a continuous colour channel
 * interpolates a ramp and has no index to run out of.
 *
 * The split is the same one {@link paletteColor} takes: it returns
 * `null` on an exhausted slot rather than wrapping, so the mark
 * falls back to `--hdml-fill-color` **visibly**, and the count of
 * how far past the end the domain went is answered once, here.
 *
 * @param el - A scale element.
 * @returns Both counts when the domain outruns the palette, else
 *   `null` — including before the scale's first frame, when there
 *   is no resolved domain to compare.
 */
export function paletteGapOf(el: HdvlElement): PaletteGap | null {
  const state = frames.get(el);
  const ctx = state?.ctx ?? null;
  const scale = state?.scale ?? null;
  if (ctx === null || scale === null) {
    return null;
  }
  if (scale.channel !== "color" || scale.kind !== "ordinal") {
    return null;
  }
  const values = scale.domain()?.values ?? [];
  if (values.length === 0) {
    return null;
  }
  const palette = splitColorList(
    ctx.measured(el).props.get("--hdml-palette") ?? "",
  );
  return values.length > palette.length
    ? { domain: values.length, palette: palette.length }
    : null;
}

/** {@link angleCollisionOf}'s answer — both counts, as V2 needs. */
export interface AngleCollision {
  /** How many categories the resolved domain holds. */
  domain: number;
  /** How many distinct angles they occupy, modulo a turn. */
  distinct: number;
}

/**
 * A whole degree, keyed modulo one turn so that `360` and `0` are
 * the same slot.
 *
 * **Rounded before the modulo, not after.** `359.9999996°` and `0°`
 * are the same place; taking `% 360` first leaves them 359.9999996
 * apart and the collision goes unseen, which is the failure mode
 * this whole check exists to end. Six decimals is the scene's own
 * quantization, so two positions that survive it as distinct are
 * distinct in every golden and every pixel.
 */
function angleKey(deg: number): number {
  const q = Math.round(deg * 1e6) % 360_000_000;
  return q < 0 ? q + 360_000_000 : q;
}

/**
 * ★ **017 R8's survivor, as a question**: do two categories of this
 * ordinal angle scale resolve to the *same angle*?
 *
 * R8's fix makes this impossible on a **one-turn** sweep — that is
 * what `cyclic` is for ({@link isCyclic}) — and leaves it perfectly
 * possible on the two sweeps the fix cannot help:
 *
 * - **a multi-turn sweep.** 720° over six categories is
 *   `0/120/240/0/120/240` cyclically and `0/144/288/72/216/0`
 *   inclusively. The range passes the same angle twice, so no
 *   denominator rescues it. Nothing clamps `--hdml-angle-end`.
 * - **a zero-length sweep.** `--hdml-angle-start` equal to
 *   `--hdml-angle-end` puts every category on one angle.
 *
 * Both draw a chart with **fewer positions than it has categories**
 * and say nothing — §1.5's silent wrong chart, and exactly the class
 * R8 was found in by a human looking at a rendered page rather than
 * by 1305 passing tests. *(Decided 2026-09-26, with the user, at 017
 * step 07.)*
 *
 * **It is filed under V2 with its own `DiagnosticCode`**, on
 * {@link paletteGapOf}'s precedent and for the identical reason:
 * §8.3's V2 row is the binding pass's *"does the delivered data fit
 * this scale"* question, and `n` categories that fit in fewer than
 * `n` angles is an answer of no. SPEC §11's checklist is unchanged —
 * no new W-number, no new V-number — and the alternative considered
 * and declined was a new `W7`, which would have amended §11 and
 * joined two `WarningCode`s 016 shipped uncalled.
 *
 * **The domain, not the rows.** A repeated *row* is the author's
 * data and legal; this asks only whether the resolved **domain**'s
 * distinct values reach distinct angles.
 *
 * @param el - A scale element.
 * @returns Both counts when two categories collide, else `null` —
 *   including before the scale's first frame, and at `n < 2`, where
 *   there is nothing to collide with.
 */
export function angleCollisionOf(
  el: HdvlElement,
): AngleCollision | null {
  const scale = frames.get(el)?.scale ?? null;
  if (scale === null) {
    return null;
  }
  if (scale.channel !== "angle" || scale.kind !== "ordinal") {
    return null;
  }
  const values = scale.domain()?.values ?? [];
  if (values.length < 2) {
    return null;
  }
  const seen = new Set<number>();
  for (const v of values) {
    const at = scale.project(v);
    if (at === null) {
      // §4.7's own answer, not a collision: an unresolvable value
      // produces no mark, and counting it as a slot would report a
      // collision that nothing draws.
      return null;
    }
    seen.add(angleKey(at));
  }
  return seen.size < values.length
    ? { domain: values.length, distinct: seen.size }
    : null;
}

/**
 * The scale a widget's channel resolves to — a read of the
 * resolution index, and of the one thing a container may change
 * about it (R35, R19).
 *
 * **★ A clustered widget resolves the INNER band scale.** SPEC §7
 * makes `hdml-cluster`'s subdivision *"an anonymous inner band
 * scale whose domain is the children in DOM order"*, so it is the
 * *scale* a clustered widget sees that differs and not the widget's
 * arithmetic — which is why `hdml-bar` reads `bandOf().width`
 * without knowing whether it is in a cluster. The subdivision
 * itself is `kernel/scale-band.ts` and lives in `container.ts`;
 * nothing about the outer scale, its domain, its range or its ticks
 * changes, so every guide over the same scale keeps addressing the
 * category and not the slot.
 *
 * ★ **This is where `--hdml-cluster-bandwidth` is read** (019 item
 * 10 / R2), and it is read off the **cluster** rather than off the
 * widget. The property inherits, so the widget's own computed value
 * is normally the same number — but a child carrying its own
 * declaration would compute a different one, and `n` slots derived
 * from `n` different bandwidths do not tile the band they
 * subdivide. {@link import("./container").bandSlotOwnerOf} is the
 * element that owns the subdivision, and it is the only one asked.
 *
 * ⚠ The outer `--hdml-bandwidth` is a different band and is read in
 * {@link buildScale}. The two names differ by one word and nothing
 * diagnoses a page that sets the wrong one; see `docs/decisions.md`.
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
  const resolved = resolveScaleFrame(scale, ctx);
  const slot = bandSlotOf(el);
  const cluster = bandSlotOwnerOf(el);
  return resolved === null ||
    slot === null ||
    cluster === null ||
    slot.channel !== channel
    ? resolved
    : subdivide(
        resolved,
        slot,
        cssBandwidth(
          ctx.measured(cluster).props.get("--hdml-cluster-bandwidth"),
          1,
        ),
      );
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
