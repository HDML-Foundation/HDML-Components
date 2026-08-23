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
 *   `container` and `unit` are all read.
 * - **binding** — per widget in COMPUTE, on adopted data.
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
  | "negative-pie-value";

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
 * **V2 is its whole content, and both halves of V2 belong here by
 * necessity**: the delivered kind is `Delivery.type`, and §4.5's
 * `log`-domain clause is checked *after* domain resolution. V3,
 * V8, V10 and V18 are attribute-only and run in the structural
 * pass beside V1 and V13; V15 is a *behaviour* — `nice` moving
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
