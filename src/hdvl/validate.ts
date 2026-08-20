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
 * - **binding** — per widget in COMPUTE, on adopted data. Its first
 *   rule lands at step 18; {@link validateBindings} names the seam
 *   so that step adds a rule rather than a caller.
 *
 * @module hdvl/validate
 */

import type { HdmlViewElement } from "./view";
import type { Measured } from "./measure";
import type { Channel } from "./resolve";
import type { EventQueue } from "./events";
import { HdvlElement, writeState } from "./base";
import { channelOf, resolutionOf } from "./resolve";
import { HDML_ERROR, outward } from "./events";
import {
  ARC_ATTRS_LIST,
  AREA_ATTRS_LIST,
  AXIS_ATTRS_LIST,
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
  /** The last pass's diagnostics, for {@link diagnosticsOf}. */
  last: Finding[];
}

const memos = new Map<HdmlViewElement, Memo>();

function memoOf(view: HdmlViewElement): Memo {
  let memo = memos.get(view);
  if (memo === undefined) {
    memo = { errors: new Map(), warned: new Map(), last: [] };
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
  for (const ch of boundChannels(el)) {
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
  live: ReadonlySet<HdvlElement>,
): void {
  const memo = memoOf(view);
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
  }
  const memo = memoOf(view);
  memo.last = found;
  applyErrors(view, found, queue);
  applyWarnings(view, found, new Set(elements));
}

/**
 * The **binding pass** (§8.2) — per widget in COMPUTE, on adopted
 * data.
 *
 * **Deliberately empty at step 12.** Every data-dependent rule needs
 * either a resolved `Scale` (V2, V8, V15, V18 — step 18) or an
 * adopted delivery (V4, V5, V7 — steps 22 and 29), and neither
 * exists yet. The seam is named here so the step that lands the
 * first of them adds a *rule*, rather than moving a caller the
 * scheduler would then have to grow.
 *
 * @param view - The view being validated.
 * @param elements - Its display elements, document order.
 */
export function validateBindings(
  view: HdmlViewElement,
  elements: readonly HdvlElement[],
): void {
  void view;
  void elements;
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
 * The diagnostics the last structural pass produced.
 *
 * Exists for the corpus gate every slice from step 25 on is built
 * out of — *a valid page produces none*.
 *
 * @param view - The view.
 * @returns Its diagnostics, in document order.
 */
export function diagnosticsOf(
  view: HdmlViewElement,
): readonly Diagnostic[] {
  return memos.get(view)?.last ?? [];
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
