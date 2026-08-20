/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The subscription spine — Contract 4's **consumer** half (RFC
 * 016/001 §7.2–§7.4, R6, R21, R22, R29, R34, R38).
 *
 * `src/hdio/` produces deliveries; this module consumes them. It owns
 * four things and nothing else: **who is subscribed to what**, **the
 * deterministic reconciler** that keeps that set equal to what the
 * tree asks for, **the five adoption duties**, and the **`loading` /
 * `error` quantifiers** those adoptions decide.
 *
 * Two identities run through all of it, and neither is decorative:
 *
 * - The **key** is the binding site, `` `${element.uid}:${slot}` ``,
 *   because the column is exactly what changes. `y="revenue"` →
 *   `y="profit"` is one site changing target, not one site dying and
 *   another being born — and the adopted map is keyed by slot too, so
 *   a rebind *replaces* the widget's data instead of leaving a dead
 *   `revenue` entry beside a live `profit` one.
 * - The **id** is minted per subscription *instance*, because
 *   `HdmlIo.#onRequest` de-dupes by `id`
 *   ([HdmlIo.ts:398](../hdio/HdmlIo.ts)). A `source` swap that leaves
 *   the column name unchanged would otherwise mint the same id, be
 *   discarded as a duplicate, and never subscribe at all — while the
 *   widget kept painting the previous frame's data forever.
 *
 * **`deliver` stores and invalidates. It never paints, never
 * measures, never writes a custom state** (D8 clause 1.3). The frame
 * gives it a whole rAF of margin; that margin is not a licence to do
 * work here. Every lifecycle state this module owns is applied by
 * {@link applyLifecycle}, at end of frame, beside `empty`.
 *
 * **This is the only module in `src/hdvl/` that imports
 * `../hdio/delivery`, and it imports it `type`-only** (§2.1 edge). A
 * value import would pull the worker, `@hdml/parser` and Arrow into
 * every chart page and would compile silently; `check-dist.mjs`'s
 * check 6 is the only thing that catches it.
 *
 * @module hdvl/subscribe
 */

import { uid } from "@hdml/hash";
import type { Delivery, RequestDetail } from "../hdio/delivery";
import type { HdmlViewElement } from "./view";
import type { EventQueue } from "./events";
import { HdvlElement, writeState } from "./base";
import { HDML_DATA, outward } from "./events";
import { resolutionOf } from "./resolve";
import { readConfig } from "../hdio/config";

/**
 * A binding site: a channel attribute name (`"y"`, `"a0"`,
 * `"color"`), or a scale's domain slot (`"values"`).
 */
export type Slot = string;

/** What an element wants subscribed, per slot. */
export interface Binding {
  slot: Slot;
  /**
   * The effective `source` ref — nearest-ancestor-wins, read from the
   * resolution index through {@link sourceOf}. It **never** carries a
   * `&column=` tail: the worker coalesces frames by verbatim ref
   * string, so a tailed ref would split one frame's union into
   * several queries.
   */
  ref: string;
  /** The bare identifier the slot binds. */
  column: string;
  /**
   * `false` = domain-only — a scale's `values` (§4.2, R6). A scale is
   * therefore an ordinary subscriber, which is why this spine
   * precedes the scale elements rather than the marks.
   */
  raw: boolean;
}

/**
 * An element that subscribes.
 *
 * **Duck-typed, exactly like {@link
 * import("./events").DatumSource}.** Contract 1 does not grow a
 * member: an element declares bindings when it has some, and the
 * seventeen that do not are unchanged. A widget whose channels are
 * all literal contributes no binding and has no subscription, which
 * is §3.6's "paints on the first frame".
 */
export interface Binder {
  readonly uid: string;
  /** Every currently bound slot. Literals contribute none. */
  bindings(): readonly Binding[];
}

/** One live subscription instance. */
interface Sub {
  /** `` `${element.uid}:${slot}` `` — the SITE. */
  key: string;
  slot: Slot;
  element: HdvlElement;
  ref: string;
  column: string;
  raw: boolean;
  /** Fresh per INSTANCE. Re-dispatching mints a new one. */
  id: string;
  /** One per subscription, never one per element. */
  controller: AbortController;
  /** Duty 1's watermark, reset to 0 by REMOVE, ready and gone. */
  latest: number;
  /** Whether any of `data` / `absent` / `error` has arrived. */
  terminal: boolean;
  adopted: Delivery | null;
  /** Set by `deliver`, cleared when `hdml-data` is drained. */
  changed: boolean;
}

/** One view's whole subscription state. */
interface ViewSubs {
  view: HdmlViewElement;
  /** key → subscription. */
  subs: Map<string, Sub>;
  /**
   * Whether the view has resolved **once** — every required
   * subscription terminal at the same time. §3.4's whole-view paint
   * suppression applies until this is true and never again.
   */
  resolved: boolean;
  /** The units THIS module put into `:state(error)`. */
  errored: Set<HdvlElement>;
}

/**
 * One entry per view with a subscription registry, in registration
 * order. A `Map` rather than a `WeakMap` because the ready/gone
 * handlers iterate every view; {@link forgetSubscriptions} is the
 * matching teardown, wired into the view's `disconnectedCallback`
 * exactly as `forgetView` is.
 */
const states = new Map<HdmlViewElement, ViewSubs>();

/**
 * The `deliver` trace seam.
 *
 * A **module singleton**, spelled like `renderers.create` and
 * `frameTrace.record`, because the legacy webcomponents polyfill
 * upgrades on connect and clobbers per-instance injection. It exists
 * so D8 clause 1.3 — *`deliver` stores and invalidates and never
 * paints* — is assertable from **inside** `deliver` rather than
 * inferred from the frame afterwards.
 */
export const deliveryTrace: {
  record: null | ((el: HdvlElement, slot: Slot, d: Delivery) => void);
} = { record: null };

/** The discovery-bus names the document listeners were wired for. */
let wiredReady: null | string = null;
let wiredGone: null | string = null;

/**
 * The element's effective `source` — a read of the resolution index
 * and nothing else (§7.2, R35).
 *
 * `Resolution.source` is nearest-ancestor-wins and was computed by
 * the walk, so an inherited `source` changed on the view reaches
 * every descendant through this one field.
 *
 * @param el - Any display element.
 * @returns The ref, or `null` when no ancestor declares one.
 */
export function sourceOf(el: HdvlElement): string | null {
  return resolutionOf(el)?.source ?? null;
}

/** Duck-typed: an element declares bindings when it has some. */
function bindingsOf(el: HdvlElement): readonly Binding[] | null {
  const binder = <Partial<Binder>>(<unknown>el);
  return typeof binder.bindings === "function"
    ? binder.bindings()
    : null;
}

/** This view's state, created on first use. */
function stateOf(view: HdmlViewElement): ViewSubs {
  let state = states.get(view);
  if (state === undefined) {
    state = {
      view,
      subs: new Map(),
      resolved: false,
      errored: new Set(),
    };
    states.set(view, state);
  }
  return state;
}

/**
 * Recomputes the sticky first-resolution flag.
 *
 * Called from the reconciler and from `deliver` — **never from
 * COMPUTE**, so a widget's `scene()` cannot observe it flipping
 * mid-frame.
 */
function refresh(state: ViewSubs): void {
  if (state.resolved || state.subs.size === 0) {
    return;
  }
  for (const sub of state.subs.values()) {
    if (!sub.terminal) {
      return;
    }
  }
  state.resolved = true;
}

/**
 * Duty 3's reset, in one place: a fresh generation space.
 *
 * `adopted` is deliberately **kept**. Discarding it belongs to
 * REMOVE, where the binding itself changed; a provider restart has
 * not changed what this slot is bound to, and the unit blanks anyway
 * because it is no longer terminal.
 */
function resetGeneration(sub: Sub): void {
  sub.latest = 0;
  sub.terminal = false;
}

/**
 * Dispatches one `hdml-io-request` with a **fresh** id, on
 * `document` — the target both providers listen on.
 */
function dispatchRequest(state: ViewSubs, sub: Sub): void {
  sub.id = uid();
  sub.controller = new AbortController();
  const detail: RequestDetail = {
    id: sub.id,
    ref: sub.ref,
    column: sub.column,
    raw: sub.raw,
    signal: sub.controller.signal,
    deliver: deliverTo(state, sub.key, sub.id),
  };
  document.dispatchEvent(
    new CustomEvent<RequestDetail>(readConfig().requestEvent, {
      bubbles: true,
      composed: true,
      detail,
    }),
  );
}

/**
 * §7.3's closure, created **once per subscription instance**,
 * capturing the site key and the instance id.
 *
 * @param state - The owning view's registry.
 * @param key - The binding site.
 * @param id - The subscription instance this closure speaks for.
 * @returns The `deliver` callback handed to the provider.
 */
function deliverTo(
  state: ViewSubs,
  key: string,
  id: string,
): (d: Delivery) => void {
  return (d: Delivery): void => {
    const sub = state.subs.get(key);
    // THE INSTANCE FENCE. The subscription that produced this
    // delivery may already have been replaced (§7.2.2), and the
    // generation cannot decide it: generations are monotonic only
    // within one (session, ref) pair, so after a source swap the
    // NEW ref's generation 1 is not comparable with the OLD ref's
    // generation 7 — and duty 1's `G >= latest` would reject the
    // new data outright. The id decides, and a loser is dropped
    // silently.
    if (sub === undefined || sub.id !== id) {
      return;
    }
    deliveryTrace.record?.(sub.element, sub.slot, d);
    // Duty 1 — adopt iff `generation >= latest` for THIS instance.
    // `>=`, so a replay of an already-adopted generation is
    // idempotent. A stale delivery is discarded WHOLESALE and
    // silently: no field adopted, no event, no state change.
    //
    // Duty 2 — the test is the STAMP, never the kind. An error MAY
    // be stamped, and a stamped one obeys ordering exactly like
    // data: a late error stamped generation 7 must not blank a
    // widget already showing generation 8. Only the UNSTAMPED
    // error — the pre-submit gate timeout — is current by ordering
    // and is always adopted. `absent` carries a required
    // generation and is covered by the same predicate.
    if (d.generation !== undefined) {
      if (d.generation < sub.latest) {
        return;
      }
      sub.latest = d.generation;
    }
    // Duty 4 — payloads are immutable and non-transferable:
    // `values`/`nulls` are shared BY REFERENCE with sibling
    // subscribers and with the provider's replay cache. Nothing is
    // derived here, so nothing is copied; every later step that
    // derives (stack baselines, pie prefix sums) allocates.
    //
    // Duty 5 — re-adoption of identical data under a new generation
    // is normal; rendering is idempotent because the scene is a
    // pure function of the adopted set.
    //
    // Clause 1.3 — store and invalidate. NEVER paint here, never
    // measure, and never write a custom state: `writeState` would
    // invalidate style outside the frame the whole design funnels
    // through. Lifecycle states are applied by `applyLifecycle`.
    sub.adopted = d; // ← BY SLOT (the key), never by column.
    sub.terminal = true;
    sub.changed = true;
    refresh(state);
    state.view.markDirty();
  };
}

/** REMOVE: abort, discard the adopted delivery, reset `latest`. */
function drop(state: ViewSubs, sub: Sub): void {
  state.subs.delete(sub.key);
  sub.adopted = null;
  sub.changed = false;
  resetGeneration(sub);
  // Aborting is what makes the provider post `unsubscribe`, and one
  // controller per subscription is why it cannot reach a sibling.
  sub.controller.abort();
}

/** ADD: a new subscription instance for a binding site. */
function add(
  state: ViewSubs,
  el: HdvlElement,
  key: string,
  b: Binding,
): void {
  const sub: Sub = {
    key,
    slot: b.slot,
    element: el,
    ref: b.ref,
    column: b.column,
    raw: b.raw,
    id: "",
    controller: new AbortController(),
    latest: 0,
    terminal: false,
    adopted: null,
    changed: false,
  };
  state.subs.set(key, sub);
  dispatchRequest(state, sub);
}

/**
 * §7.2.2's reconciler — a pure set diff over data the index already
 * holds, so it is O(bindings) and runs in the same pass as the
 * structural validator.
 *
 * REPLACE is **REMOVE then ADD**, never a mutation in place: the id
 * must change (§7.2.1) and the adopted data must go. That is what
 * makes §7.2.2's first consequence true — no stale data can survive a
 * binding change, because the discard happens at reconcile time and
 * not on the replacement's arrival.
 *
 * @param view - The view being reindexed.
 * @param elements - Its display elements, document order.
 */
export function reconcileView(
  view: HdmlViewElement,
  elements: readonly HdvlElement[],
): void {
  ensureWired();
  const state = stateOf(view);
  const desired = new Map<string, { el: HdvlElement; b: Binding }>();
  for (const el of elements) {
    const bindings = bindingsOf(el);
    if (bindings === null) {
      continue;
    }
    for (const b of bindings) {
      if (b.ref === "" || b.column === "") {
        continue;
      }
      desired.set(`${el.uid}:${b.slot}`, { el, b });
    }
  }
  for (const sub of Array.from(state.subs.values())) {
    const want = desired.get(sub.key);
    if (
      want === undefined ||
      want.b.ref !== sub.ref ||
      want.b.column !== sub.column ||
      want.b.raw !== sub.raw
    ) {
      drop(state, sub);
    }
  }
  for (const [key, want] of desired) {
    if (!state.subs.has(key)) {
      add(state, want.el, key, want.b);
    }
  }
  refresh(state);
}

/**
 * Drops a view's whole registry, aborting every subscription — the
 * shape `forgetView` uses, wired into the same
 * `disconnectedCallback`.
 *
 * @param view - The view.
 */
export function forgetSubscriptions(view: HdmlViewElement): void {
  const state = states.get(view);
  if (state === undefined) {
    return;
  }
  for (const sub of state.subs.values()) {
    sub.controller.abort();
  }
  states.delete(view);
  if (states.size === 0) {
    unwire();
  }
}

/**
 * §3.4's quantifier, exactly: **≥ 1 currently-required subscription
 * in the view has no terminal delivery**, where *currently required*
 * is the reconciler's `desired` set and *terminal* is any of `data`,
 * `absent` or `error`.
 *
 * An `error` **resolves** loading; it does not prolong it. A view
 * with no subscriptions at all is **not** loading — which is what
 * makes `:state(empty)` reachable for a literal-only page (§3.6).
 *
 * @param view - The view.
 * @returns Whether it is loading.
 */
export function loadingOf(view: HdmlViewElement): boolean {
  const state = states.get(view);
  if (state === undefined) {
    return false;
  }
  for (const sub of state.subs.values()) {
    if (!sub.terminal) {
      return true;
    }
  }
  return false;
}

/**
 * This element's adopted delivery for one slot (§7.3) — the read
 * every widget's `scene()` makes once it has channels.
 *
 * @param el - The bound element.
 * @param slot - The binding site.
 * @returns The delivery, or `null`.
 */
export function adoptedOf(
  el: HdvlElement,
  slot: Slot,
): Delivery | null {
  const view = el.view;
  const state = view === null ? undefined : states.get(view);
  return state?.subs.get(`${el.uid}:${slot}`)?.adopted ?? null;
}

/**
 * Whether this element must paint **nothing** right now (§3.4's
 * painting clause, §3.5).
 *
 * Three causes, in order:
 *
 * 1. **First-resolution atomicity.** Until the view has resolved
 *    once, `loading` suppresses *all* painting in it — a chart that
 *    reveals its axes, then its bars, then its line is worse than one
 *    that appears whole.
 * 2. **After that first resolution `loading` is a status flag.** A
 *    rebind leaves its own **unit** blank and its siblings painting;
 *    re-suppressing the whole view would blank an entire dashboard on
 *    every series toggle.
 * 3. **A failed unit stays blank**, independently of both (§3.5).
 *
 * @param el - The element about to build a group.
 * @returns Whether `scene()` must return `null`.
 */
export function paintSuppressed(el: HdvlElement): boolean {
  const view = el.view;
  const state = view === null ? undefined : states.get(view);
  if (state === undefined || state.subs.size === 0) {
    return false;
  }
  if (!state.resolved) {
    return true;
  }
  const unit = resolutionOf(el)?.unit ?? el;
  for (const sub of state.subs.values()) {
    if (unitOf(sub) !== unit) {
      continue;
    }
    if (!sub.terminal || failed(sub)) {
      return true;
    }
  }
  return false;
}

/** Every live subscription of a view — for assertions (§10.4). */
export function subscriptionsOf(
  view: HdmlViewElement,
): ReadonlyArray<{
  key: string;
  id: string;
  slot: Slot;
  ref: string;
  column: string;
  raw: boolean;
  generation: number;
}> {
  const state = states.get(view);
  if (state === undefined) {
    return [];
  }
  return [...state.subs.values()].map((s) => ({
    key: s.key,
    id: s.id,
    slot: s.slot,
    ref: s.ref,
    column: s.column,
    raw: s.raw,
    generation: s.latest,
  }));
}

/**
 * §7.4's delivery → lifecycle mapping, applied at **end of frame**
 * beside `empty` — never from `deliver` (clause 1.3).
 *
 * `loading` lands on the view and its planes (§3.4's table).
 * `absent` and `error` land `:state(error)` on the **owning unit**
 * from the index (§3.5).
 *
 * The validator writes the same state for composition errors and the
 * two owners do not collide: each clears only the units **it** put
 * there, exactly as `applyErrors` does. When V4 and V5 land at step
 * 22 the `absent` branch becomes a validator finding with a teaching
 * message, and this writer loses the `absent` half.
 *
 * @param view - The view whose frame is ending.
 * @param elements - Its display elements, document order.
 */
export function applyLifecycle(
  view: HdmlViewElement,
  elements: readonly HdvlElement[],
): void {
  const state = states.get(view);
  const loading = loadingOf(view);
  writeState(view, "loading", loading);
  for (const el of elements) {
    if (el.family === "plane") {
      writeState(el, "loading", loading);
    }
  }
  if (state === undefined) {
    return;
  }
  const now = new Set<HdvlElement>();
  for (const sub of state.subs.values()) {
    if (failed(sub)) {
      now.add(unitOf(sub));
    }
  }
  for (const unit of Array.from(state.errored)) {
    if (!now.has(unit)) {
      state.errored.delete(unit);
      writeState(unit, "error", false);
    }
  }
  for (const unit of now) {
    if (!state.errored.has(unit)) {
      state.errored.add(unit);
      writeState(unit, "error", true);
    }
  }
}

/**
 * §5.11's `hdml-data`, queued for the after-PAINT drain.
 *
 * **Edge-triggered on the adopted set**, so a resize does not re-fire
 * it: `deliver` is the only writer of `changed`, and draining clears
 * it. Dispatched from the element that adopted, so a host app reads
 * series identity off `event.target`.
 *
 * @param view - The view whose frame is ending.
 * @param queue - The frame's outward-event queue.
 */
export function drainDataEvents(
  view: HdmlViewElement,
  queue: EventQueue,
): void {
  const state = states.get(view);
  if (state === undefined) {
    return;
  }
  const touched = new Set<HdvlElement>();
  for (const sub of state.subs.values()) {
    if (sub.changed) {
      sub.changed = false;
      touched.add(sub.element);
    }
  }
  for (const el of touched) {
    queue.push(el, outward(HDML_DATA, detailFor(state, el)));
  }
}

/** Whether a subscription's adopted delivery is a failure (§7.4). */
function failed(sub: Sub): boolean {
  const d = sub.adopted;
  return d !== null && (d.kind === "error" || d.kind === "absent");
}

/** The error unit that owns a subscription's element (§3.5). */
function unitOf(sub: Sub): HdvlElement {
  return resolutionOf(sub.element)?.unit ?? sub.element;
}

/**
 * `hdml-data`'s detail — `{channels, length, domains}` (§5.11).
 *
 * **`domains` carries the DELIVERED domain, not the resolved one.**
 * §5.11 specifies the resolved domain — what the chart actually drew,
 * including `zero`, `nice` and authored endpoints — and no `Scale`
 * exists until **step 18**. Shipping the field with the delivered
 * value keeps the event's shape stable across that step and improves
 * only the provenance; omitting it would make step 18 a breaking
 * change to a published event detail. Named here rather than left to
 * be discovered.
 */
function detailFor(
  state: ViewSubs,
  el: HdvlElement,
): {
  channels: Slot[];
  length: number;
  domains: Record<Slot, unknown>;
} {
  const channels: Slot[] = [];
  const domains: Record<Slot, unknown> = {};
  let length = 0;
  for (const sub of state.subs.values()) {
    if (sub.element !== el || sub.adopted === null) {
      continue;
    }
    channels.push(sub.slot);
    const d = sub.adopted;
    if (d.kind === "data") {
      domains[sub.slot] = d.domain;
    }
    if (d.kind !== "error" && d.rows > length) {
      length = d.rows;
    }
  }
  return { channels, length, domains };
}

/**
 * §7.2's re-dispatch: every subscription gets a **fresh id** and a
 * fresh generation space, and the provider de-dupes what it already
 * has. Consumer-first and provider-first therefore both converge.
 */
const onReady = (): void => {
  for (const state of states.values()) {
    for (const sub of state.subs.values()) {
      // Abort first, so the provider drops the previous instance
      // rather than keeping a second registration for the same site.
      sub.controller.abort();
      resetGeneration(sub);
      dispatchRequest(state, sub);
    }
    if (state.subs.size > 0) {
      state.view.markDirty();
    }
  }
};

/**
 * §7.4's last row, and **H11's owed half** — step 07 shipped the
 * dispatch and asserted only that, because nothing consumed it.
 *
 * The provider's generation space has ended: reset `latest` to 0,
 * drop back to un-terminal so the view returns to `:state(loading)`
 * on its next frame, and await the next `hdml-io-ready`.
 *
 * **R38 lives or dies here.** "The provider went away" reads like a
 * delivery kind and is not one: no `Delivery` is synthesized, no
 * `:state(error)` is set, and `"provider-gone"` stays the reserved,
 * unproduced code `delivery.ts` says it is. A widget cannot be
 * `:state(loading)` and `:state(error)` for one cause.
 */
const onGone = (): void => {
  for (const state of states.values()) {
    for (const sub of state.subs.values()) {
      resetGeneration(sub);
    }
    if (state.subs.size > 0) {
      state.view.markDirty();
    }
  }
};

/**
 * Wires the two discovery-bus listeners, re-wiring if the configured
 * names changed.
 *
 * `readConfig()` is read at each use so a host that sets
 * `window.HDML_CONFIG` after import is honoured — which means the
 * names this module listened for can go stale. Comparing the captured
 * pair on every reconcile costs two string compares and removes a
 * whole class of "the test overrode `goneEvent` and nothing
 * happened".
 */
function ensureWired(): void {
  const cfg = readConfig();
  if (wiredReady === cfg.readyEvent && wiredGone === cfg.goneEvent) {
    return;
  }
  unwire();
  wiredReady = cfg.readyEvent;
  wiredGone = cfg.goneEvent;
  document.addEventListener(wiredReady, onReady);
  document.addEventListener(wiredGone, onGone);
}

/** Drops both listeners, if any are wired. */
function unwire(): void {
  if (wiredReady !== null) {
    document.removeEventListener(wiredReady, onReady);
    wiredReady = null;
  }
  if (wiredGone !== null) {
    document.removeEventListener(wiredGone, onGone);
    wiredGone = null;
  }
}
