/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The validator and the diagnostics surface (RFC 016/001 §8, R7,
 * R23, R25).
 *
 * **This is the only module under `src/hdvl/` that writes to the
 * console**, and that is not a style rule — it is what makes R25
 * mechanical. Diagnostics are **edge-triggered**: validation runs on
 * every structural change and every COMPUTE pass, so an unchanged
 * violation re-derived sixty times during a resize drag must report
 * once. A bare `console.warn` anywhere else bypasses the identity
 * bookkeeping below and re-fires every frame, which is exactly the
 * failure the rule exists to prevent.
 *
 * Two passes (§8.2), **always on in both builds** (§1.5's strict
 * semantics are the product):
 *
 * - **structural** — inside `view.reindex()`, once per structural
 *   change, over the whole view, off the resolution index the same
 *   walk just built. It re-derives nothing: `chain`, `tip`,
 *   `container` and `unit` are all read. V1, V3, V4 (local refs),
 *   V8, V9, V10, V13, V18, V19, W2.
 * - **binding** — per widget in COMPUTE, on adopted data. V2, V4
 *   (the runtime `absent`), V5.
 *
 * **The two passes share one edge-triggering memo and one apply.**
 * Each recomputes only its own half and then re-applies the union,
 * so a binding finding cannot clear a structural one and vice
 * versa — which is what would happen if each pass owned
 * `memo.errors` outright.
 *
 * @module hdvl/validate
 */

import type { HdmlViewElement } from "./view";
import type { Measured } from "./measure";
import type { Channel } from "./resolve";
import type { EventQueue } from "./events";
import type { ScaleKind } from "./scale";
import { HdvlElement, writeState } from "./base";
import { channelOf, resolutionOf } from "./resolve";
import { HDML_ERROR, outward } from "./events";
import { adoptedOf } from "./subscribe";
import {
  MODIFIERS,
  VALUES_SLOT,
  kindOfColumn,
  looksLikeRef,
  scaleKindOf,
  scaleOf,
  valuesSpecOf,
} from "./scale";
import {
  ARC_ATTRS_LIST,
  AREA_ATTRS_LIST,
  AXIS_ATTRS_LIST,
  CONTINUOUS_SCALE_ATTRS_LIST,
  HDVL_TAG_NAMES,
  POINT_ATTRS_LIST,
} from "./vocabulary";

/**
 * Stable, machine-readable slugs — the composition half of the D8
 * `DeliveryCode` enum (§2.6). One per rule, so a host app branches
 * on the code and never on the prose. The two enums are disjoint and
 * both ride `hdml-error`.
 *
 * **All twenty-one land here, though this step emits two.** A code
 * added "when its rule arrives" makes the union's completeness
 * untestable meanwhile, and every later slice would then edit this
 * type instead of adding a rule (H5's reasoning, re-applied).
 *
 * **`varying-path-color` is the twenty-second, added at step 21**
 * and the one exception to that sentence — a §8 amendment rather
 * than a rule finding its code, because the gap it names was found
 * during implementation and not during sequencing. See
 * {@link checkPathColor}.
 */
export type DiagnosticCode =
  | "no-scale-in-scope"
  | "duplicate-scale"
  | "kind-mismatch"
  | "bad-binding-grammar"
  | "unknown-field"
  | "length-mismatch"
  | "container-binding"
  | "container-source"
  | "unresolved-domain"
  | "wrong-plane-channel"
  | "ref-in-channel"
  | "heterogeneous-children"
  | "bad-format-skeleton"
  | "exclusive-guide-attrs"
  | "container-composition"
  | "modifier-kind"
  | "missing-binding"
  | "channel-guide-fit"
  | "palette-exhausted"
  | "all-rows-dropped"
  | "negative-pie-value"
  | "varying-path-color";

/**
 * Warnings are machine-readable too — W5 and W6 in particular are
 * things a host app may want to detect, not just read in a console.
 */
export type WarningCode =
  | "unknown-construct"
  | "missing-accessible-name"
  | "colorless-series"
  | "node-budget"
  | "detection-disabled"
  | "unsupported-url-reference";

/** A V-number or a W-number (SPEC §11's checklist). */
export type RuleId =
  | "V1"
  | "V2"
  | "V3"
  | "V4"
  | "V5"
  | "V6"
  | "V7"
  | "V8"
  | "V9"
  | "V10"
  | "V11"
  | "V12"
  | "V13"
  | "V14"
  | "V15"
  | "V16"
  | "V17"
  | "V18"
  | "V19"
  | "V20"
  | "W1"
  | "W2"
  | "W3"
  | "W4"
  | "W5"
  | "W6";

/** One report (§8.1). */
export interface Diagnostic {
  rule: RuleId;
  severity: "error" | "warning";
  /** The element that violates the rule. */
  element: HTMLElement;
  /** The element that blanks and dispatches (§3.5). */
  unit: HTMLElement;
  channel?: Channel;
  source?: string;
  /**
   * Always present — errors carry a {@link DiagnosticCode},
   * warnings a {@link WarningCode}. The two spaces are disjoint, so
   * `severity` and `code` never disagree.
   */
  code: DiagnosticCode | WarningCode;
  /** SPEC's verbatim teaching message (§8.4). */
  message: string;
}

/** The internal form: every element the walk names is display. */
interface Finding {
  rule: RuleId;
  severity: "error" | "warning";
  element: HdvlElement;
  unit: HdvlElement;
  channel?: Channel;
  code: DiagnosticCode | WarningCode;
  message: string;
}

/** Everything one view remembers between passes. */
interface Memo {
  /** unit → the identity of the error it currently carries. */
  errors: Map<HdvlElement, string>;
  /** `${uid}|${rule}` → the identity last printed. */
  warned: Map<string, string>;
  /** The last structural pass's findings. */
  structural: Finding[];
  /** The last binding pass's findings. */
  binding: Finding[];
  /**
   * What COMPUTE reported this frame — §4.7's all-drop clause is
   * decided by a **widget**, from data only the frame has, and is
   * folded into the binding pass that runs immediately after it.
   */
  computed: Finding[];
}

const memos = new Map<HdmlViewElement, Memo>();

function memoOf(view: HdmlViewElement): Memo {
  let memo = memos.get(view);
  if (memo === undefined) {
    memo = {
      errors: new Map(),
      warned: new Map(),
      structural: [],
      binding: [],
      computed: [],
    };
    memos.set(view, memo);
  }
  return memo;
}

/**
 * `localName` compared as a string. A direct `=== HDVL_TAG_NAMES.X`
 * trips `no-unsafe-enum-comparison`, and a cast would hide a real
 * question; the tag name is a string here by construction.
 */
const FALLBACK_TAG: string = HDVL_TAG_NAMES.FALLBACK;

/** Compared as a string, for the same reason. */
const RULE_TAG: string = HDVL_TAG_NAMES.RULE;

/**
 * The two **path** widgets — the marks that emit one `path` node for
 * a whole series and therefore carry one `Paint` for it (§2.5, §6.1).
 * Compared as strings, for the same reason as {@link RULE_TAG}.
 */
const LINE_TAG: string = HDVL_TAG_NAMES.LINE;

/** The other path widget. See {@link LINE_TAG}. */
const AREA_TAG: string = HDVL_TAG_NAMES.AREA;

/**
 * R20's budget — *"above 20 000 scene nodes: warn (W4) and keep
 * rendering. Never decimate, never truncate silently."*
 */
const NODE_BUDGET = 20000;

/**
 * The channels `hdml-rule` needs a scale for, bound or not.
 *
 * §6.1 spans a rule across *"the **other** channel's full range"*,
 * so the channel it did **not** bind is load-bearing geometry: a
 * `hdml-rule y="target"` with no `x` scale in scope has nothing to
 * span. V1 constrains only bound channels, so that page validated
 * and painted nothing.
 *
 * **The plan's scheduled D1 escalation, decided with the user on
 * 2026-08-23**: it applies to `hdml-rule` **alone** — every other
 * mark's missing channel is a step-22 V19 `missing-binding` case, so
 * a general rule would report the same authoring mistake twice — and
 * it is reported as **V1** with its existing code and message, since
 * *"no scale for channel `x` in scope"* is exactly what is wrong.
 */
const SPANNING_CHANNELS: readonly Channel[] = ["x", "y"];

/** Compared as a string, for the reason {@link RULE_TAG} gives. */
const BAR_TAG: string = HDVL_TAG_NAMES.BAR;

/** See {@link RULE_TAG}. */
const POINT_TAG: string = HDVL_TAG_NAMES.POINT;

/** See {@link RULE_TAG}. */
const ARC_TAG: string = HDVL_TAG_NAMES.ARC;

/** See {@link RULE_TAG}. */
const PIE_TAG: string = HDVL_TAG_NAMES.PIE;

/** See {@link RULE_TAG}. */
const CARTESIAN_TAG: string = HDVL_TAG_NAMES.CARTESIAN_PLANE;

/** See {@link RULE_TAG}. */
const POLAR_TAG: string = HDVL_TAG_NAMES.POLAR_PLANE;

/** SPEC §5's bindable-identifier form: a letter or `_`, then word. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * An **in-page** source ref — `?hdml-frame=sales`, no path — which
 * is the only kind V4 can complete without the network (§8.3).
 *
 * The captured tag comes out of the ref itself: `?hdml-frame=` names
 * the element that declares it, so nothing here has to know the data
 * vocabulary and R8 is untouched.
 */
const LOCAL_REF = /^\?(hdml-[a-z-]+)=([^&#]+)$/;

/**
 * The channel-bearing attributes, and the base channel each one
 * resolves.
 *
 * The ranged forms are **spellings of their base channel**, not
 * channels of their own: a widget binding `y0` resolves the `y`
 * scale (§3.3). Three published enums cover all fourteen names, so
 * R8 holds with no literal.
 */
const CHANNEL_ATTRS: readonly (readonly [string, Channel])[] = [
  [AREA_ATTRS_LIST.X, "x"],
  [AREA_ATTRS_LIST.X0, "x"],
  [AREA_ATTRS_LIST.X1, "x"],
  [AREA_ATTRS_LIST.Y, "y"],
  [AREA_ATTRS_LIST.Y0, "y"],
  [AREA_ATTRS_LIST.Y1, "y"],
  [AREA_ATTRS_LIST.ANGLE, "angle"],
  [ARC_ATTRS_LIST.A0, "angle"],
  [ARC_ATTRS_LIST.A1, "angle"],
  [AREA_ATTRS_LIST.RADIUS, "radius"],
  [AREA_ATTRS_LIST.R0, "radius"],
  [AREA_ATTRS_LIST.R1, "radius"],
  [AREA_ATTRS_LIST.COLOR, "color"],
  [POINT_ATTRS_LIST.SIZE, "size"],
];

/**
 * `hdml-axis[channel="x"]` — **selector** notation, for §8.1's
 * console prefix, which is spelled that way so DevTools' own search
 * accepts it.
 */
function label(el: Element): string {
  const ch = el.getAttribute(AXIS_ATTRS_LIST.CHANNEL);
  return ch === null
    ? el.localName
    : `${el.localName}[${AXIS_ATTRS_LIST.CHANNEL}="${ch}"]`;
}

/**
 * `hdml-axis channel="x"` — **markup** notation, for a message that
 * tells an author to move a tag. SPEC §4's V13 message quotes
 * `<hdml-axis channel="x">`, which is the element as written, not
 * as selected; the two notations are not interchangeable and a
 * message must never use the console's.
 */
function markup(el: Element): string {
  const ch = el.getAttribute(AXIS_ATTRS_LIST.CHANNEL);
  return ch === null
    ? el.localName
    : `${el.localName} ${AXIS_ATTRS_LIST.CHANNEL}="${ch}"`;
}

/**
 * The channels an element binds.
 *
 * A **guide** binds the one channel its `channel` attribute names; a
 * **mark** or **container** binds whichever of the fourteen
 * channel-bearing attributes it carries. A value outside the six is
 * V3's error (step 18), not V1's — an unrecognised channel simply
 * resolves no scale, which is what an unbound chain does anyway.
 */
function boundChannels(el: HdvlElement): Channel[] {
  if (el.family === "guide") {
    const ch = channelOf(el.getAttribute(AXIS_ATTRS_LIST.CHANNEL));
    return ch === null ? [] : [ch];
  }
  if (el.family !== "mark" && el.family !== "container") {
    return [];
  }
  const out: Channel[] = [];
  for (const [attr, channel] of CHANNEL_ATTRS) {
    if (el.hasAttribute(attr) && !out.includes(channel)) {
      out.push(channel);
    }
  }
  return out;
}

/**
 * The channels an element must resolve a scale for.
 *
 * For every element but `hdml-rule` that is exactly what it binds.
 * See {@link SPANNING_CHANNELS} for why the rule is the exception.
 */
function requiredChannels(el: HdvlElement): readonly Channel[] {
  if (el.family === "mark" && el.localName === RULE_TAG) {
    return SPANNING_CHANNELS;
  }
  return boundChannels(el);
}

/** The display children of an element — a read of the index. */
function displayKids(el: HdvlElement): HdvlElement[] {
  const out: HdvlElement[] = [];
  for (const kid of Array.from(el.children)) {
    const hit = <HdvlElement>(<unknown>kid);
    if (resolutionOf(hit) !== undefined) {
      out.push(hit);
    }
  }
  return out;
}

/** The error unit, precomputed by the index (§3.5). */
function unitOf(el: HdvlElement): HdvlElement {
  return resolutionOf(el)?.unit ?? el;
}

function error(
  rule: RuleId,
  code: DiagnosticCode,
  el: HdvlElement,
  message: string,
  channel?: Channel,
): Finding {
  return {
    rule,
    severity: "error",
    element: el,
    unit: unitOf(el),
    channel,
    code,
    message,
  };
}

function warning(
  rule: RuleId,
  code: WarningCode,
  el: HdvlElement,
  message: string,
): Finding {
  return {
    rule,
    severity: "warning",
    element: el,
    unit: unitOf(el),
    code,
    message,
  };
}

// ---------------------------------------------------------------
// The messages. SPEC quotes three of these verbatim (§8.4) and they
// ship exactly as written, em dash (U+2014) included. The channel
// name and the element are INTERPOLATED — SPEC's quoted forms are
// the `y` / `hdml-axis` instances of a template, not literals.
// ---------------------------------------------------------------

function noScaleMessage(ch: Channel): string {
  return `no scale for channel "${ch}" in scope`;
}

function duplicateMessage(ch: Channel): string {
  return `two "${ch}" scales in scope — make them siblings`;
}

function sharedLevelMessage(widget: Element, block: string): string {
  return (
    "scales and widgets cannot share a level — move " +
    `<${markup(widget)}> into one of the ${block} blocks`
  );
}

function notAPlaneMessage(kid: Element): string {
  return (
    "a view holds planes — move " + `<${markup(kid)}> into a plane`
  );
}

function notAScaleMessage(kid: Element): string {
  return (
    "a plane holds scales — move " + `<${markup(kid)}> into a scale`
  );
}

function oneFallbackMessage(): string {
  return `a view holds at most one <${FALLBACK_TAG}>`;
}

function noNameMessage(): string {
  return "no accessible name — add aria-label or aria-labelledby";
}

function sentinelMessage(): string {
  return (
    "an author transition shorthand removed the change " +
    "sentinel — the fallback observer is on for this view"
  );
}

function urlFormMessage(): string {
  return (
    "a url() clip-path or filter cannot be resolved from a " +
    "shadow tree — the value is ignored"
  );
}

function noChannelMessage(): string {
  return 'every scale declares a channel — add channel="x"';
}

function unknownChannelMessage(raw: string): string {
  return (
    `no channel "${raw}" — the channels are ` +
    "x, y, angle, radius, size and color"
  );
}

function noFloorMessage(ch: Channel): string {
  return (
    `no domain floor for channel "${ch}" — ` + "add min= or values="
  );
}

function noCeilingMessage(ch: Channel): string {
  return (
    `no domain ceiling for channel "${ch}" — ` + "add max= or values="
  );
}

function noDomainMessage(ch: Channel): string {
  return (
    `no domain for channel "${ch}" — ` +
    "add min= and max=, or values="
  );
}

function refInChannelMessage(attr: string, value: string): string {
  return (
    "a full source ref belongs in source — " +
    `move "${value}" out of ${attr}`
  );
}

function forbiddenCharMessage(attr: string, value: string): string {
  return (
    `${attr}="${value}" is not a channel binding — ` +
    "? and / are forbidden"
  );
}

function badJsonMessage(attr: string, value: string): string {
  return (
    `${attr}="${value}" is not valid JSON — ` +
    "a value that starts with it must parse"
  );
}

function badIdentifierMessage(attr: string, value: string): string {
  return (
    `${attr}="${value}" is not a bindable identifier — ` +
    "start with a letter or _"
  );
}

/** `["continuous", "datetime"]` → `"continuous or datetime"`. */
function kindList(kinds: readonly ScaleKind[]): string {
  return kinds.length < 2
    ? kinds.join("")
    : `${kinds.slice(0, -1).join(", ")} or ${
        kinds[kinds.length - 1]
      }`;
}

function modifierMessage(
  attr: string,
  kinds: readonly ScaleKind[],
  tag: string,
): string {
  return (
    `"${attr}" applies to a ${kindList(kinds)} scale — ` +
    `remove it from ${tag}`
  );
}

function kindMismatchMessage(
  column: string,
  got: string,
  tag: string,
  takes: string,
): string {
  return `column "${column}" is ${got} — ${tag} takes ${takes}`;
}

function outOfDomainMessage(ch: Channel, value: string): string {
  return (
    `"${value}" is outside the "${ch}" domain — ` +
    "the row produces no mark"
  );
}

function allDroppedMessage(ch: Channel): string {
  return (
    `every row is outside the "${ch}" domain — ` +
    "check the bound column"
  );
}

function nodeBudgetMessage(nodes: number): string {
  return (
    `${nodes} scene nodes, over the ${NODE_BUDGET} budget — ` +
    "rendering all of them"
  );
}

function varyingColorMessage(tag: string, value: string): string {
  return (
    `color="${value}" varies per row — ${tag} paints one path ` +
    "with one colour; use a scalar, like color='\"North\"'"
  );
}

function noSourceMessage(attr: string, value: string): string {
  return (
    `${attr}="${value}" names a field, but no source is in ` +
    "scope — add source= here or on an ancestor"
  );
}

function unknownFieldMessage(value: string, ref: string): string {
  return `no field "${value}" in ${ref} — check the field names`;
}

function absentFieldMessage(value: string, ref: string): string {
  return (
    `${ref} delivered no field "${value}" — ` +
    "check the column name"
  );
}

function lengthMismatchMessage(
  a: string,
  an: number,
  b: string,
  bn: number,
): string {
  return (
    `${a} has ${an} rows and ${b} has ${bn} — a widget's ` +
    "bindings must agree in length; scalars broadcast"
  );
}

function wrongPlaneMessage(
  ch: Channel,
  channels: readonly Channel[],
): string {
  return (
    `channel "${ch}" is not this plane's — ` +
    `it anchors ${channels.join(" and ")}`
  );
}

/** `[["y"], ["y0", "y1"]]` → `"y, or y0 and y1"`. */
function slotList(alts: readonly (readonly string[])[]): string {
  return alts.map((alt) => alt.join(" and ")).join(", or ");
}

function missingBindingMessage(
  ch: Channel,
  alts: readonly (readonly string[])[],
  tag: string,
): string {
  return (
    `no binding for channel "${ch}" — ` +
    `${tag} needs ${slotList(alts)}`
  );
}

function logDomainMessage(lo: number, hi: number): string {
  return (
    "a log domain cannot cross or touch zero — " +
    `[${lo}, ${hi}] does`
  );
}

// ---------------------------------------------------------------
// V1 · V13 · W2 — the structural rules
// ---------------------------------------------------------------

/**
 * V1 — every channel a widget binds resolves to **exactly one**
 * ancestor scale declaring it.
 *
 * Zero is an error; two nested same-channel scales anywhere in a
 * chain are an error. The index makes both O(depth) once: a scale's
 * own recorded `chain` is its **ancestor** chain (the walk adds the
 * scale's own channel only on the way down), so a same-channel entry
 * already present is precisely the duplicate.
 */
function checkV1(el: HdvlElement, out: Finding[]): void {
  const res = resolutionOf(el);
  if (res === undefined) {
    return;
  }
  if (el.family === "scale") {
    const ch = channelOf(el.getAttribute(AXIS_ATTRS_LIST.CHANNEL));
    if (ch !== null && res.chain[ch] !== undefined) {
      out.push(
        error("V1", "duplicate-scale", el, duplicateMessage(ch), ch),
      );
    }
    return;
  }
  for (const ch of requiredChannels(el)) {
    if (res.chain[ch] === undefined) {
      out.push(
        error("V1", "no-scale-in-scope", el, noScaleMessage(ch), ch),
      );
    }
  }
}

/**
 * V13 — a level is homogeneous.
 *
 * View → planes (plus at most one `hdml-fallback`); plane → scales;
 * scale → scales **xor** widgets. The **container** clause is V17's
 * and belongs to step 29; nothing is checked below a container here.
 *
 * `hdml-fallback` is not an `HdvlElement` (H3) and so is not in the
 * index — its "at most one" is counted from the DOM, which is the
 * one place this pass reads anything the walk did not give it.
 */
function checkV13(el: HdvlElement, out: Finding[]): void {
  if (el.family === "container" || el.family === "fallback") {
    return;
  }
  const kids = displayKids(el);
  if (el.family === "view") {
    let fallbacks = 0;
    for (const kid of Array.from(el.children)) {
      if (kid.localName === FALLBACK_TAG) {
        fallbacks++;
      }
    }
    if (fallbacks > 1) {
      out.push(
        error(
          "V13",
          "heterogeneous-children",
          el,
          oneFallbackMessage(),
        ),
      );
    }
    for (const kid of kids) {
      if (kid.family !== "plane") {
        out.push(
          error(
            "V13",
            "heterogeneous-children",
            kid,
            notAPlaneMessage(kid),
          ),
        );
      }
    }
    return;
  }
  if (el.family === "plane") {
    for (const kid of kids) {
      if (kid.family !== "scale") {
        out.push(
          error(
            "V13",
            "heterogeneous-children",
            kid,
            notAScaleMessage(kid),
          ),
        );
      }
    }
    return;
  }
  if (el.family !== "scale") {
    return;
  }
  const scales = kids.filter((k) => k.family === "scale");
  if (scales.length === 0 || scales.length === kids.length) {
    return;
  }
  // A fork carries scales only; the widget is the thing to move,
  // and the message names which blocks to move it into.
  const block =
    channelOf(scales[0].getAttribute(AXIS_ATTRS_LIST.CHANNEL)) ??
    scales[0].localName;
  for (const kid of kids) {
    if (kid.family !== "scale") {
      out.push(
        error(
          "V13",
          "heterogeneous-children",
          kid,
          sharedLevelMessage(kid, block),
        ),
      );
    }
  }
}

// ---------------------------------------------------------------
// V3 · V10 — the channel-attribute grammar (SPEC §5)
// ---------------------------------------------------------------

/**
 * The attribute values one element binds through §5's grammar: its
 * channel attributes, plus a **scale's** `values`, which SPEC §6
 * says uses the same first-character grammar.
 *
 * A guide's `values` is a `TickSpec` literal governed by V16 and is
 * deliberately not scanned here — step 24 owns it.
 */
function boundValues(el: HdvlElement): [string, string][] {
  const out: [string, string][] = [];
  for (const [attr] of CHANNEL_ATTRS) {
    const raw = el.getAttribute(attr);
    if (raw !== null && !out.some((p) => p[0] === attr)) {
      out.push([attr, raw]);
    }
  }
  if (el.family === "scale") {
    const raw = el.getAttribute(VALUES_SLOT);
    if (raw !== null) {
      out.push([VALUES_SLOT, raw]);
    }
  }
  return out;
}

/**
 * V3 and V10, which both fire on `?` and `/` and are separated by
 * **shape**: a value that names a document or carries HDML's own
 * query form is a full source specifier (V10, the more specific
 * rule, checked first); anything else carrying those characters is
 * a grammar error (V3).
 */
function checkGrammar(el: HdvlElement, out: Finding[]): void {
  for (const [attr, raw] of boundValues(el)) {
    const value = raw.trim();
    if (value === "") {
      continue;
    }
    if (looksLikeRef(value)) {
      out.push(
        error(
          "V10",
          "ref-in-channel",
          el,
          refInChannelMessage(attr, value),
        ),
      );
      continue;
    }
    if (value.includes("?") || value.includes("/")) {
      out.push(
        error(
          "V3",
          "bad-binding-grammar",
          el,
          forbiddenCharMessage(attr, value),
        ),
      );
      continue;
    }
    const head = value[0];
    if (/[[{"\-0-9]/.test(head)) {
      try {
        JSON.parse(value);
      } catch {
        out.push(
          error(
            "V3",
            "bad-binding-grammar",
            el,
            badJsonMessage(attr, value),
          ),
        );
      }
      continue;
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
      out.push(
        error(
          "V3",
          "bad-binding-grammar",
          el,
          badIdentifierMessage(attr, value),
        ),
      );
    }
  }
}

/**
 * Whether a channel value is **per-row** rather than one broadcast
 * scalar — SPEC §5's grammar, read for its *shape*.
 *
 * A bindable identifier is a column and a JSON array is a literal
 * column; every other JSON value is a scalar. A value that does not
 * classify is malformed and returns `false`, because
 * {@link checkGrammar} already reports it and a second finding on
 * one attribute would only hide the first.
 *
 * The classification is deliberately a statement about the
 * **document**, not about the delivered data: a column that happens
 * to hold one repeated value is still a per-row binding, and
 * deciding otherwise would move this rule into the binding pass and
 * make a page's validity depend on which rows came back.
 */
function varies(raw: string): boolean {
  const value = raw.trim();
  if (value === "") {
    return false;
  }
  if (/[[{"\-0-9]/.test(value[0])) {
    try {
      return Array.isArray(<unknown>JSON.parse(value));
    } catch {
      return false;
    }
  }
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

/**
 * V3, on the two **path** widgets: a `color` binding that varies per
 * row cannot be painted.
 *
 * **The plan's second scheduled D1 escalation, decided with the user
 * on 2026-08-23.** SPEC §7 grants `hdml-line` and `hdml-area` the
 * `color` channel with no scalar-only qualifier, while RFC §2.5's
 * `path` node carries **one** `Paint` for the whole series — so a
 * varying binding has no honest rendering and taking one row's
 * colour for all of them is exactly §1.5's silent wrong chart.
 *
 * Three things about its scope, all decided rather than assumed:
 *
 * - **A new `DiagnosticCode`**, `varying-path-color`, rather than a
 *   reuse of `bad-binding-grammar` — the value *is* grammatical, and
 *   a host app branching on the code should be able to tell "you
 *   mistyped this" from "this widget cannot express that".
 * - **`hdml-line` and `hdml-area` only.** `hdml-bar` emits one node
 *   per row and resolves its colour per row, so a per-row colour is
 *   honest there; `hdml-rule` publishes no `color` attribute at all,
 *   so it cannot arise. "Path widget" is not "mark".
 * - **Reported as V3**, whose §8.3 row is *"attribute parse"* and
 *   whose SPEC §11 statement is the channel-attribute grammar of §5.
 *   This narrows that grammar — on these two tags the `color`
 *   attribute takes the scalar form alone — which keeps it an
 *   attribute-only, structural-pass decision and adds no rule to
 *   SPEC §11's twenty.
 */
function checkPathColor(el: HdvlElement, out: Finding[]): void {
  if (
    el.family !== "mark" ||
    (el.localName !== LINE_TAG && el.localName !== AREA_TAG)
  ) {
    return;
  }
  const raw = el.getAttribute(AREA_ATTRS_LIST.COLOR);
  if (raw === null || !varies(raw)) {
    return;
  }
  out.push(
    error(
      "V3",
      "varying-path-color",
      el,
      varyingColorMessage(el.localName, raw.trim()),
      "color",
    ),
  );
}

// ---------------------------------------------------------------
// V9 · V19 — the plane's channels, and the bindings it requires
// ---------------------------------------------------------------

/**
 * The two positional channels each plane anchors (§2.7, §4.6).
 *
 * Read from the plane's **tag**, deliberately. `plane-polar.ts` now
 * declares a `Projection` whose `channels` say the same thing, but
 * that object exists only inside a frame and V9 and V19 are
 * *structural* rules — they answer inside `reindex()`, before any
 * frame has run.
 */
const PLANE_CHANNELS = new Map<string, readonly Channel[]>([
  [CARTESIAN_TAG, ["x", "y"]],
  [POLAR_TAG, ["angle", "radius"]],
]);

/** The four channels V9 quantifies over — `color` and `size` are
 *  not positional and belong to neither plane. */
const POSITIONAL: readonly Channel[] = ["x", "y", "angle", "radius"];

/** The channels the plane an element sits in anchors, or `null`. */
function planeChannelsOf(el: HdvlElement): readonly Channel[] | null {
  const plane = resolutionOf(el)?.plane ?? null;
  return plane === null
    ? null
    : PLANE_CHANNELS.get(plane.localName) ?? null;
}

/**
 * V9 — *positional attribute names match the plane*.
 *
 * `x`/`y` (and their ranged spellings) belong to a cartesian plane,
 * `angle`/`radius`/`a0`/`a1`/`r0`/`r1` to a polar one. `color` and
 * `size` are visual, not positional, and are legal under both.
 *
 * It reports **once per channel**, not once per attribute: an author
 * who wrote `r0` and `r1` under a cartesian plane made one mistake.
 */
function checkV9(el: HdvlElement, out: Finding[]): void {
  if (el.family !== "mark" && el.family !== "container") {
    return;
  }
  const channels = planeChannelsOf(el);
  if (channels === null) {
    return;
  }
  const seen = new Set<Channel>();
  for (const [attr, channel] of CHANNEL_ATTRS) {
    if (
      !POSITIONAL.includes(channel) ||
      channels.includes(channel) ||
      seen.has(channel) ||
      !declared(el, attr)
    ) {
      continue;
    }
    seen.add(channel);
    out.push(
      error(
        "V9",
        "wrong-plane-channel",
        el,
        wrongPlaneMessage(channel, channels),
        channel,
      ),
    );
  }
}

/**
 * One required positional channel, and the spellings that satisfy
 * it — SPEC §7's **bold** column. Any one alternative fully bound
 * is enough.
 */
interface Requirement {
  channel: Channel;
  alts: readonly (readonly string[])[];
}

/** `x`,`y` — `hdml-line` and `hdml-point`, cartesian. */
const XY: readonly Requirement[] = [
  { channel: "x", alts: [[AREA_ATTRS_LIST.X]] },
  { channel: "y", alts: [[AREA_ATTRS_LIST.Y]] },
];

/** `angle`,`radius` — the same two, polar. */
const ANGLE_RADIUS: readonly Requirement[] = [
  { channel: "angle", alts: [[AREA_ATTRS_LIST.ANGLE]] },
  { channel: "radius", alts: [[AREA_ATTRS_LIST.RADIUS]] },
];

/** `x` + (`y` | `y0`,`y1`) — `hdml-area` and `hdml-bar`. */
const XY_RANGED: readonly Requirement[] = [
  { channel: "x", alts: [[AREA_ATTRS_LIST.X]] },
  {
    channel: "y",
    alts: [
      [AREA_ATTRS_LIST.Y],
      [AREA_ATTRS_LIST.Y0, AREA_ATTRS_LIST.Y1],
    ],
  },
];

/** `angle` + (`radius` | `r0`,`r1`) — `hdml-area`, polar. */
const ANGLE_RADIUS_RANGED: readonly Requirement[] = [
  { channel: "angle", alts: [[AREA_ATTRS_LIST.ANGLE]] },
  {
    channel: "radius",
    alts: [
      [AREA_ATTRS_LIST.RADIUS],
      [AREA_ATTRS_LIST.R0, AREA_ATTRS_LIST.R1],
    ],
  },
];

/** `hdml-rule` — *exactly one of* `x`/`y`. */
const ONE_OF_XY: readonly Requirement[] = [
  {
    channel: "x",
    alts: [[AREA_ATTRS_LIST.X], [AREA_ATTRS_LIST.Y]],
  },
];

/** `hdml-arc` — (`a0`,`a1`) **or** `angle`. */
const ARC_ANGLE: readonly Requirement[] = [
  {
    channel: "angle",
    alts: [
      [ARC_ATTRS_LIST.A0, ARC_ATTRS_LIST.A1],
      [AREA_ATTRS_LIST.ANGLE],
    ],
  },
];

/** `hdml-pie` — the value column it derives fractions from. */
const PIE_ANGLE: readonly Requirement[] = [
  { channel: "angle", alts: [[AREA_ATTRS_LIST.ANGLE]] },
];

/**
 * SPEC §7's bold column, per tag **per plane form**.
 *
 * A tag with no entry for the plane it sits in requires nothing
 * there — `hdml-bar` under a polar plane, `hdml-arc` under a
 * cartesian one — because **V9 already reports that page**, and
 * naming the same mistake twice on one unit would only hide the
 * better message. A tag absent from the table entirely (the test
 * probe, the binder) requires nothing anywhere.
 */
const REQUIRED = new Map<
  string,
  ReadonlyMap<string, readonly Requirement[]>
>([
  [
    LINE_TAG,
    new Map([
      [CARTESIAN_TAG, XY],
      [POLAR_TAG, ANGLE_RADIUS],
    ]),
  ],
  [
    AREA_TAG,
    new Map([
      [CARTESIAN_TAG, XY_RANGED],
      [POLAR_TAG, ANGLE_RADIUS_RANGED],
    ]),
  ],
  [BAR_TAG, new Map([[CARTESIAN_TAG, XY_RANGED]])],
  [
    POINT_TAG,
    new Map([
      [CARTESIAN_TAG, XY],
      [POLAR_TAG, ANGLE_RADIUS],
    ]),
  ],
  [ARC_TAG, new Map([[POLAR_TAG, ARC_ANGLE]])],
  [RULE_TAG, new Map([[CARTESIAN_TAG, ONE_OF_XY]])],
  [PIE_TAG, new Map([[POLAR_TAG, PIE_ANGLE]])],
]);

/**
 * V19 — **required bindings**, and *"never an implicit index"*.
 *
 * A mark at a chain tip must bind every positional channel its
 * plane form requires. There is no fallback to the row number: a
 * `hdml-point y="v"` with no `x` is an error naming `x`, because
 * inventing an index would draw a chart the data did not describe.
 *
 * §8.3's *"a container-hoisted channel satisfies it for the
 * children"* is implemented rather than deferred: a container is an
 * ordinary channel binder to `boundChannels`, so a child under one
 * that binds the channel is satisfied. No container binds anything
 * until step 29 — the clause costs three lines and is here so that
 * step lands `hdml-stack` without also having to remember this.
 */
function checkV19(el: HdvlElement, out: Finding[]): void {
  const res = resolutionOf(el);
  if (res === undefined || !res.tip || el.family !== "mark") {
    return;
  }
  const plane = res.plane;
  if (plane === null) {
    return;
  }
  const reqs =
    REQUIRED.get(el.localName)?.get(plane.localName) ?? null;
  if (reqs === null) {
    return;
  }
  const hoisted =
    res.container === null ? [] : boundChannels(res.container);
  for (const req of reqs) {
    if (
      hoisted.includes(req.channel) ||
      req.alts.some((alt) => alt.every((slot) => declared(el, slot)))
    ) {
      continue;
    }
    out.push(
      error(
        "V19",
        "missing-binding",
        el,
        missingBindingMessage(req.channel, req.alts, el.localName),
        req.channel,
      ),
    );
  }
}

// ---------------------------------------------------------------
// V4 — a bare identifier has a source, and names a field of it
// ---------------------------------------------------------------

/**
 * The fields an **in-page** source declares, or `null` when the
 * page cannot answer.
 *
 * §8.3 splits V4 exactly here: *"an in-page `?hdml-frame=` ref is
 * checkable locally; a static ref completes at runtime via
 * `kind:"absent"`"*. A ref carrying a path names another document
 * and returns `null`; so does a ref whose element this page does not
 * declare, because *"unresolvable"* is a different claim from
 * *"resolves, and has no such field"* and only the second is V4's.
 *
 * The projected fields are the host's **direct children carrying a
 * `name`** — which is exactly the field elements, since a frame's
 * `group-by` / `sort-by` / `filter-by` blocks carry none. Derived
 * rather than matched by tag, so this module still names no data
 * vocabulary.
 */
function localFieldsOf(
  el: HdvlElement,
  ref: string,
): Set<string> | null {
  const hit = LOCAL_REF.exec(ref.trim());
  if (hit === null) {
    return null;
  }
  const root = <Document | ShadowRoot>el.getRootNode();
  let host: Element | null = null;
  for (const cand of Array.from(root.querySelectorAll(hit[1]))) {
    if (cand.getAttribute("name") === hit[2]) {
      host = cand;
      break;
    }
  }
  if (host === null) {
    return null;
  }
  const fields = new Set<string>();
  for (const kid of Array.from(host.children)) {
    const name = kid.getAttribute("name");
    if (name !== null && name.trim() !== "") {
      fields.add(name.trim());
    }
  }
  return fields.size === 0 ? null : fields;
}

/**
 * V4's **structural** half — every bare identifier has an effective
 * `source`, and names a field of it where the page declares one.
 *
 * A value that is not a bare identifier is a literal or a scalar and
 * binds no field at all; a malformed one is V3's, already reported,
 * and a second finding would only hide the first.
 */
function checkV4(el: HdvlElement, out: Finding[]): void {
  const res = resolutionOf(el);
  if (res === undefined) {
    return;
  }
  const ref = res.source;
  let fields: Set<string> | null | undefined;
  for (const [attr, raw] of boundValues(el)) {
    const value = raw.trim();
    if (!IDENTIFIER.test(value)) {
      continue;
    }
    if (ref === null) {
      out.push(
        error(
          "V4",
          "unknown-field",
          el,
          noSourceMessage(attr, value),
        ),
      );
      continue;
    }
    if (fields === undefined) {
      fields = localFieldsOf(el, ref);
    }
    if (fields !== null && !fields.has(value)) {
      out.push(
        error(
          "V4",
          "unknown-field",
          el,
          unknownFieldMessage(value, ref),
        ),
      );
    }
  }
}

/**
 * V4's **binding** half — the runtime completion, for the static
 * refs the in-page check cannot reach.
 *
 * `kind:"absent"` is the D8 seam's own answer to this rule: *"the
 * generation arrived; this column is not in the result set"*. Before
 * it existed a typo'd column span forever.
 */
function checkV4Delivery(el: HdvlElement, out: Finding[]): void {
  for (const [attr, raw] of boundValues(el)) {
    if (!IDENTIFIER.test(raw.trim())) {
      continue;
    }
    const d = adoptedOf(el, attr);
    if (d !== null && d.kind === "absent") {
      out.push(
        error(
          "V4",
          "unknown-field",
          el,
          absentFieldMessage(d.column, d.ref),
        ),
      );
    }
  }
}

// ---------------------------------------------------------------
// V5 — equal N across one widget's per-row bindings
// ---------------------------------------------------------------

/**
 * One slot's row count, or `null` when it has none to disagree
 * with.
 *
 * Three cases return `null` and each for its own reason: a
 * **scalar** broadcasts to whatever N is (SPEC §5); a **malformed**
 * value is V3's, already reported; and a **column still in flight**
 * has no delivered `rows` yet — §3.4 suppresses the paint meanwhile,
 * and counting it as zero would make every loading page a
 * mismatch.
 *
 * §8.3 says *"against `rows`"*, and this is that: a delivered
 * column answers with the delivery's own `rows`, never with a
 * length derived from the values buffer.
 *
 * It re-derives SPEC §5's shape classification rather than calling
 * `mark.ts`'s `slotValuesOf` — that module imports this one, so the
 * reverse is a cycle.
 */
function rowsOfSlot(
  el: HdvlElement,
  slot: string,
  raw: string,
): number | null {
  const value = raw.trim();
  if (value === "") {
    return null;
  }
  if (/[[{"\-0-9]/.test(value[0])) {
    try {
      const json = <unknown>JSON.parse(value);
      return Array.isArray(json) ? (<unknown[]>json).length : null;
    } catch {
      return null;
    }
  }
  if (!IDENTIFIER.test(value)) {
    return null;
  }
  const d = adoptedOf(el, slot);
  return d !== null && d.kind === "data" ? d.rows : null;
}

/**
 * V5 — *equal length N across a widget's array/column bindings;
 * scalars broadcast; mismatch = error.*
 *
 * §8.3 adds the clause that gives the rule its point: **never a
 * `Math.max` zip**. Two columns of 12 and 7 rows are not a chart of
 * 7 points plus 5 silent drops — they are a page whose author
 * believes something untrue about their data.
 *
 * **It reports; it does not stop the paint.** Every rule in this
 * module reports and lets the frame render, and §3.5 gives blanking
 * to the error *unit* — one mechanism, not two. `rowCountOf`'s
 * longest-wins is therefore unchanged, and what the rule removes is
 * the *silence*, which is the whole of what §8.3 forbids. Recorded
 * in `docs/decisions.md` so a later step does not re-litigate it.
 *
 * One finding per widget: the first disagreement names both slots
 * and their counts, and a unit carries one diagnostic anyway.
 */
function checkV5(el: HdvlElement, out: Finding[]): void {
  if (el.family !== "mark" && el.family !== "container") {
    return;
  }
  let slot = "";
  let rows = -1;
  for (const [attr, raw] of boundValues(el)) {
    const n = rowsOfSlot(el, attr, raw);
    if (n === null) {
      continue;
    }
    if (rows < 0) {
      slot = attr;
      rows = n;
      continue;
    }
    if (n === rows) {
      continue;
    }
    out.push(
      error(
        "V5",
        "length-mismatch",
        el,
        lengthMismatchMessage(slot, rows, attr, n),
      ),
    );
    return;
  }
}

// ---------------------------------------------------------------
// V8 · V18 — the scale's own structural rules
// ---------------------------------------------------------------

/** Whether an attribute is present and not blank. */
function declared(el: HdvlElement, attr: string): boolean {
  const raw = el.getAttribute(attr);
  return raw !== null && raw.trim() !== "";
}

/**
 * V8 — *no implicit scales*. `channel` is mandatory, and **every
 * endpoint must resolve from `min`/`max` or `values`** per SPEC
 * §6's combination table.
 *
 * **It is decided from ATTRIBUTES ALONE** (§4.2 step 0, §8.3). It
 * asks whether a legal domain *source* exists, never whether that
 * source returned anything: a `values` column delivering zero rows
 * is `empty`, not invalid, and conflating the two would turn every
 * genuinely-empty result set into a composition error.
 */
function checkV8(el: HdvlElement, out: Finding[]): void {
  if (el.family !== "scale") {
    return;
  }
  const raw = el.getAttribute(AXIS_ATTRS_LIST.CHANNEL);
  const ch = channelOf(raw);
  if (ch === null) {
    const trimmed = (raw ?? "").trim();
    out.push(
      error(
        "V8",
        "unresolved-domain",
        el,
        trimmed === ""
          ? noChannelMessage()
          : unknownChannelMessage(trimmed),
      ),
    );
    return;
  }
  // A malformed `values` still DECLARES a source; V3 reports the
  // malformation, and piling V8 on top would only hide it.
  if (valuesSpecOf(el.getAttribute(VALUES_SLOT)).kind !== "none") {
    return;
  }
  const low = declared(el, CONTINUOUS_SCALE_ATTRS_LIST.MIN);
  const high = declared(el, CONTINUOUS_SCALE_ATTRS_LIST.MAX);
  if (low && high) {
    return;
  }
  const message = low
    ? noCeilingMessage(ch)
    : high
    ? noFloorMessage(ch)
    : noDomainMessage(ch);
  out.push(error("V8", "unresolved-domain", el, message, ch));
}

/**
 * V18 — domain-modifier scoping. `nice` continuous/datetime ·
 * `zero` continuous-only · `clamp` continuous/datetime · `sort`
 * ordinal-only · `reverse` any kind.
 *
 * Presence is what counts, not the value: SPEC §6 says *a modifier
 * on the wrong scale kind is an error*, and `zero="false"` on a
 * datetime scale is still an author writing `zero` where it means
 * nothing.
 */
function checkV18(el: HdvlElement, out: Finding[]): void {
  const kind = el.family === "scale" ? scaleKindOf(el) : null;
  if (kind === null) {
    return;
  }
  for (const modifier of MODIFIERS) {
    if (
      !el.hasAttribute(modifier.attr) ||
      modifier.kinds.includes(kind)
    ) {
      continue;
    }
    out.push(
      error(
        "V18",
        "modifier-kind",
        el,
        modifierMessage(modifier.attr, modifier.kinds, el.localName),
      ),
    );
  }
}

// ---------------------------------------------------------------
// V2 — the binding pass's first rule
// ---------------------------------------------------------------

/** How a mismatched column reads in V2's message. */
const GOT: Readonly<Record<ScaleKind, string>> = {
  ordinal: "text",
  continuous: "a number",
  datetime: "a datetime",
};

/** What each tag takes, in V2's message. */
const TAKES: Readonly<Record<ScaleKind, string>> = {
  ordinal: "text",
  continuous: "numbers",
  datetime: "datetimes",
};

/**
 * V2 — *the binding's data kind equals the scale's tag kind*. One
 * rule, no table, which is what the three-tag collapse buys.
 *
 * Both halves are **binding-pass** rules and neither could be
 * anything else: the delivered kind is `Delivery.type`, and the
 * `log` clause is checked *after* domain resolution (§4.5), so it
 * needs the resolved `Scale` this frame drew with.
 */
function checkV2(el: HdvlElement, out: Finding[]): void {
  const kind = el.family === "scale" ? scaleKindOf(el) : null;
  if (kind === null) {
    return;
  }
  const ch = channelOf(el.getAttribute(AXIS_ATTRS_LIST.CHANNEL));
  const d = adoptedOf(el, VALUES_SLOT);
  if (d !== null && d.kind === "data") {
    const got = kindOfColumn(d.type);
    if (kind === "datetime" && d.type.kind === "time") {
      out.push(
        error(
          "V2",
          "kind-mismatch",
          el,
          kindMismatchMessage(
            d.column,
            "a time of day, not an instant",
            el.localName,
            TAKES.datetime,
          ),
          ch ?? undefined,
        ),
      );
    } else if (got !== kind) {
      out.push(
        error(
          "V2",
          "kind-mismatch",
          el,
          kindMismatchMessage(
            d.column,
            GOT[got],
            el.localName,
            TAKES[kind],
          ),
          ch ?? undefined,
        ),
      );
    }
  }
  const type = (
    el.getAttribute(CONTINUOUS_SCALE_ATTRS_LIST.TYPE) ?? ""
  )
    .trim()
    .toLowerCase();
  if (kind !== "continuous" || type !== "log") {
    return;
  }
  const extent = scaleOf(el)?.domain()?.extent;
  if (extent === undefined) {
    return;
  }
  const [lo, hi] = extent;
  if (Math.min(lo, hi) <= 0 && Math.max(lo, hi) >= 0) {
    out.push(
      error(
        "V2",
        "kind-mismatch",
        el,
        logDomainMessage(lo, hi),
        ch ?? undefined,
      ),
    );
  }
}

/** Whether the view has a resolvable accessible name (§5.10). */
function hasAccessibleName(view: HdmlViewElement): boolean {
  const label = view.getAttribute("aria-label");
  if (label !== null && label.trim() !== "") {
    return true;
  }
  const ids = (view.getAttribute("aria-labelledby") ?? "").trim();
  if (ids === "") {
    return false;
  }
  const root = <Document | ShadowRoot>view.getRootNode();
  for (const id of ids.split(/\s+/)) {
    const target = root.getElementById(id);
    if (target !== null && (target.textContent ?? "").trim() !== "") {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------
// Reporting — R25's edge-triggering, and the one console writer
// ---------------------------------------------------------------

/** R25's identity, verbatim. */
function identityOf(f: Finding): string {
  return `${f.rule}|${f.code}|${f.channel ?? ""}|${f.message}`;
}

/**
 * §8.1's console format: one line, with the element as a second
 * argument so DevTools links it.
 */
function report(f: Finding): void {
  const line = `hdml ${f.rule} ${label(f.element)} — ${f.message}`;
  if (f.severity === "error") {
    console.error(line, f.element);
  } else {
    console.warn(line, f.element);
  }
}

/**
 * Errors, edge-triggered per unit.
 *
 * A unit carries **one** current diagnostic — the first one found in
 * document order. A widget missing both `x` and `y` is one blank
 * unit, not two, and its second missing channel becomes the current
 * identity only once the first is fixed.
 */
function applyErrors(
  view: HdmlViewElement,
  found: Finding[],
  queue: EventQueue,
): void {
  const memo = memoOf(view);
  const now = new Map<HdvlElement, Finding>();
  for (const f of found) {
    if (f.severity === "error" && !now.has(f.unit)) {
      now.set(f.unit, f);
    }
  }
  for (const [unit, was] of Array.from(memo.errors)) {
    if (!now.has(unit)) {
      // error → none. `:state(error)` goes, the identity is
      // cleared, and NOTHING is dispatched: SPEC §10 defines no
      // resolution event, and inventing one would be a vocabulary
      // addition. A host app sees recovery through the state
      // disappearing, or through the next `hdml-render`.
      void was;
      memo.errors.delete(unit);
      writeState(unit, "error", false);
    }
  }
  for (const [unit, f] of now) {
    const identity = identityOf(f);
    if (memo.errors.get(unit) === identity) {
      // error → error, identity equal: nothing at all. No event,
      // no log, no state change. The unit stays blank.
      continue;
    }
    memo.errors.set(unit, identity);
    writeState(unit, "error", true);
    report(f);
    queue.push(
      unit,
      outward(HDML_ERROR, {
        code: f.code,
        rule: f.rule,
        channel: f.channel,
        message: f.message,
      }),
    );
  }
}

/**
 * Warnings, edge-triggered per `(element, rule)`.
 *
 * Console-only — a warning never blanks anything and never sets
 * `:state(error)` (§8.3). Keyed per rule rather than per unit so W5
 * and W6 on the same element do not alternate and re-print forever,
 * and re-armed when the identity changes or the element leaves the
 * view.
 */
function applyWarnings(
  view: HdmlViewElement,
  found: Finding[],
  live?: ReadonlySet<HdvlElement>,
): void {
  const memo = memoOf(view);
  // A caller that does not enumerate the view's elements — the node
  // budget, which is a property of the whole scene — must not
  // re-arm every other warning by claiming nothing is alive.
  if (live !== undefined) {
    for (const key of Array.from(memo.warned.keys())) {
      const uid = key.slice(0, key.indexOf("|"));
      let alive = false;
      for (const el of live) {
        if (el.uid === uid) {
          alive = true;
          break;
        }
      }
      if (!alive) {
        memo.warned.delete(key);
      }
    }
  }
  for (const f of found) {
    if (f.severity !== "warning") {
      continue;
    }
    const key = `${f.element.uid}|${f.rule}`;
    const identity = identityOf(f);
    if (memo.warned.get(key) === identity) {
      continue;
    }
    memo.warned.set(key, identity);
    report(f);
  }
}

// ---------------------------------------------------------------
// The three entry points
// ---------------------------------------------------------------

/**
 * The **structural pass** (§8.2) — run inside `view.reindex()`, over
 * the elements that walk just produced.
 *
 * One linear scan: each element is asked its own two questions and
 * its children are read once, so the pass is O(N) over the same
 * tree the walk covered, never O(N·depth).
 *
 * @param view - The view being validated.
 * @param elements - Its display elements, document order.
 * @param queue - The frame's outward-event queue (§5.11).
 */
export function validateStructure(
  view: HdmlViewElement,
  elements: readonly HdvlElement[],
  queue: EventQueue,
): void {
  const found: Finding[] = [];
  if (!hasAccessibleName(view)) {
    found.push(
      warning("W2", "missing-accessible-name", view, noNameMessage()),
    );
  }
  for (const el of elements) {
    checkV1(el, found);
    checkV13(el, found);
    // V3 and V10 before V8: a malformed `values` has a better
    // message than "no domain", and a unit reports one error.
    checkGrammar(el, found);
    checkPathColor(el, found);
    // V9 before V19: a widget carrying the other plane's channels
    // is missing this plane's too, and "that channel is not this
    // plane's" is the message that fixes the page.
    checkV9(el, found);
    checkV19(el, found);
    checkV4(el, found);
    checkV18(el, found);
    checkV8(el, found);
  }
  const memo = memoOf(view);
  memo.structural = found;
  applyErrors(view, [...found, ...memo.binding], queue);
  applyWarnings(view, found, new Set(elements));
}

/**
 * The **binding pass** (§8.2) — on adopted data and the resolved
 * scales, run once per frame.
 *
 * **Three rules, and each is here by necessity.** Both halves of
 * **V2** need what the frame produced: the delivered kind is
 * `Delivery.type`, and §4.5's `log`-domain clause is checked *after*
 * domain resolution. **V4**'s runtime half needs a `kind:"absent"`
 * delivery, which is the seam's own answer to *"that column is not
 * in the result set"*. **V5** counts *delivered* rows, which is what
 * §8.3's *"against `rows`"* means. V3, V8, V9, V10, V18 and V19 are
 * attribute-only and run in the structural pass beside V1 and V13,
 * V4's local-ref half included; V15 is a *behaviour* — `nice` moving
 * derived endpoints only — and is asserted as one rather than
 * reported, because SPEC says it is *"a no-op, not an error"*.
 *
 * @param view - The view being validated.
 * @param elements - Its display elements, document order.
 * @param queue - The frame's outward-event queue (§5.11).
 */
export function validateBindings(
  view: HdmlViewElement,
  elements: readonly HdvlElement[],
  queue: EventQueue,
): void {
  const memo = memoOf(view);
  const found: Finding[] = [];
  for (const el of elements) {
    checkV2(el, found);
    checkV4Delivery(el, found);
    checkV5(el, found);
  }
  // §4.7's all-drop is decided in COMPUTE, by the widget that met
  // the rows, and is drained here — the pass that runs immediately
  // after the frame and already owns every data-dependent finding.
  // Draining rather than accumulating is what makes recovery work:
  // a frame in which no widget reports one leaves the bucket empty
  // and `applyErrors` clears the state.
  found.push(...memo.computed);
  memo.computed = [];
  memo.binding = found;
  applyErrors(view, [...memo.structural, ...found], queue);
}

/**
 * §4.7's ordinal clause: *"a value outside the domain produces no
 * mark and one **console notice** naming the value."*
 *
 * **It is a notice, not a `Diagnostic`, and the distinction was
 * taken with the user on 2026-08-23.** §4.7 says *notice*; §8.3
 * enumerates W1–W6 exhaustively and none of them is this; and a row
 * whose category is not in the domain is a statement about the
 * **data**, where every `Diagnostic` in §8 is a statement about the
 * **composition**. Filing it as a seventh warning would put it into
 * `diagnosticsOf()` and so into every corpus gate's *"a valid page
 * produces none"*, where a page can be perfectly valid and still
 * meet a row the author filtered for. The all-drop **is** an error,
 * and that is {@link reportAllRowsDropped}.
 *
 * Edge-triggered per `(element, channel, value)` through the same
 * memo the warnings use (R25), so a resize drag notices nothing and
 * a second distinct value notices once more. The key is
 * `${uid}|…`-shaped, so {@link applyWarnings}'s re-arming drops it
 * when the element leaves the view.
 *
 * @param el - The widget whose row dropped.
 * @param channel - The channel that rejected it.
 * @param value - The value, as the notice names it.
 */
export function noticeOutOfDomain(
  el: HdvlElement,
  channel: Channel,
  value: string,
): void {
  const view = resolutionOf(el)?.view;
  if (view === undefined) {
    return;
  }
  const memo = memoOf(view);
  const key = `${el.uid}|out-of-domain|${channel}|${value}`;
  if (memo.warned.has(key)) {
    return;
  }
  memo.warned.set(key, key);
  console.warn(
    `hdml ${label(el)} — ${outOfDomainMessage(channel, value)}`,
    el,
  );
}

/**
 * §4.7's all-drop clause: *"If every row drops, the **scale**
 * errors (an all-drop is a mistyped column far more often than a
 * filter)."*
 *
 * Reported from a widget's `scene()` during COMPUTE and folded into
 * the binding pass that runs immediately after the frame, so it
 * edge-triggers, dispatches `hdml-error` and lands `:state(error)`
 * through exactly the same path every other error does. The
 * **scale** is the element and, by §3.5, its own unit.
 *
 * It is filed under **V2**, whose §8.3 row is the binding pass's
 * *"does the delivered data fit this scale"* question — an all-drop
 * is the strongest possible answer of *no*, and `all-rows-dropped`
 * is already its own code.
 *
 * @param scale - The scale element whose domain rejected every row.
 * @param channel - The channel it serves.
 */
export function reportAllRowsDropped(
  scale: HdvlElement,
  channel: Channel,
): void {
  const view = resolutionOf(scale)?.view;
  if (view === undefined) {
    return;
  }
  const memo = memoOf(view);
  const finding = error(
    "V2",
    "all-rows-dropped",
    scale,
    allDroppedMessage(channel),
    channel,
  );
  const identity = identityOf(finding);
  for (const seen of memo.computed) {
    if (seen.element === scale && identityOf(seen) === identity) {
      return;
    }
  }
  memo.computed.push(finding);
}

/**
 * R20's node budget — **W4**, verbatim: *"above 20 000 scene nodes:
 * warn and keep rendering. Never decimate, never truncate
 * silently."*
 *
 * The count is over the **scene**, not over one widget, so this is
 * the frame's question and not a mark's: `runFrame` totals what
 * COMPUTE produced and the view brings the number here. Nothing in
 * the pipeline reads the answer — that is the point of the rule.
 *
 * The count is part of the message and therefore part of R25's
 * identity, so a growing scene re-warns with its new figure while a
 * static one warns once. Dropping back under the budget dispatches
 * nothing.
 *
 * @param view - The view that just painted.
 * @param nodes - How many nodes its scene carried.
 */
export function validateNodeBudget(
  view: HdmlViewElement,
  nodes: number,
): void {
  const found: Finding[] = [];
  if (nodes > NODE_BUDGET) {
    found.push(
      warning("W4", "node-budget", view, nodeBudgetMessage(nodes)),
    );
  } else {
    // Re-arm, so a scene that crosses the budget again warns again.
    memoOf(view).warned.delete(`${view.uid}|W4`);
  }
  applyWarnings(view, found);
}

/**
 * The MEASURE-derived warnings — **W5 and W6**.
 *
 * Both flags are produced by MEASURE and carried on
 * {@link Measured}; this is their sink. It is not the binding pass:
 * neither rule looks at data, and both must be edge-triggered, which
 * is why `measure.ts` carries a boolean instead of warning where it
 * finds one.
 *
 * @param view - The view just measured.
 * @param measured - That frame's snapshot.
 * @returns Whether any element lost the change sentinel, so the view
 * owes itself the fallback observer (§5.6).
 */
export function validateMeasured(
  view: HdmlViewElement,
  measured: ReadonlyMap<HdvlElement, Measured>,
): boolean {
  const found: Finding[] = [];
  const live = new Set<HdvlElement>();
  let lost = false;
  for (const [el, m] of measured) {
    live.add(el);
    if (!m.sentinel) {
      lost = true;
      found.push(
        warning("W5", "detection-disabled", el, sentinelMessage()),
      );
    }
    if (m.w6) {
      found.push(
        warning(
          "W6",
          "unsupported-url-reference",
          el,
          urlFormMessage(),
        ),
      );
    }
  }
  applyWarnings(view, found, live);
  return lost;
}

/**
 * The diagnostics the last pass of each kind produced — structural
 * first, then binding, each in document order.
 *
 * Exists for the corpus gate every slice from step 25 on is built
 * out of — *a valid page produces none*.
 *
 * @param view - The view.
 * @returns Its diagnostics.
 */
export function diagnosticsOf(
  view: HdmlViewElement,
): readonly Diagnostic[] {
  const memo = memos.get(view);
  return memo === undefined
    ? []
    : [...memo.structural, ...memo.binding];
}

/**
 * Drops everything remembered about a view. Called from its
 * `disconnectedCallback`, so a reconnected view re-reports rather
 * than staying silent about a violation it still has.
 *
 * @param view - The view.
 */
export function forgetView(view: HdmlViewElement): void {
  memos.delete(view);
}
