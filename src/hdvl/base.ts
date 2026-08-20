/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * Contract 1 — the display element base (RFC 016/001 §2.3, §3.1).
 *
 * Lit supplies reactivity; this class adds the three things every
 * display element shares and nothing else: a stable identity, the
 * custom-state surface, and **one** invalidation path.
 *
 * It is **not** modelled on `HdqlElement`, and the difference is
 * load-bearing: `hdom-changed` announces that the *HDML document*
 * changed, and `<hdml-io>`'s canonical listener answers it by
 * re-serializing and re-POSTing the whole document. A display
 * element changes no part of that document, so HDVL elements never
 * dispatch it (§3.7) — a `hdml-bar` whose `y` attribute changed
 * would otherwise trigger a full document re-upload. Display
 * invalidation travels the scheduler path and nowhere else.
 *
 * This module is also the display half's boot. Every `HdvlElement`
 * subclass imports it, so importing any display element registers
 * SPEC §9's property registry and adopts the document sheet before
 * that element can be constructed. Putting the two calls in
 * `index.ts` instead would not achieve that: `import` declarations
 * are hoisted and evaluated before any statement in their module,
 * so the element modules would already have run.
 *
 * @module hdvl/base
 */

import { LitElement, TemplateResult, html } from "lit";
import { uid } from "@hdml/hash";
import type { HdmlViewElement } from "./view";
import type { SceneGroup } from "./scene";
import type { FrameContext } from "./measure";
import { HdvlFamily, HdvlTagName } from "./vocabulary";
import { elementSheet, adoptDocumentSheet } from "./ua";
import { registerProperties } from "./properties";
import { viewOf } from "./resolve";

registerProperties();
adoptDocumentSheet();

/**
 * The four custom states of SPEC §1's lifecycle surface (RFC §3.4).
 *
 * Every one of them is **derived**, never authored: `loading` from
 * whether a required subscription has a terminal delivery, `empty`
 * from the mark nodes COMPUTE emitted, `error` from the validator,
 * and `hover` from hit resolution. That is why the two writers are
 * {@link writeState} and nothing wider.
 */
export type HdvlState = "loading" | "empty" | "error" | "hover";

/**
 * `CustomStateSet` in TS 5.5's `lib.dom` declares only `forEach`,
 * so the three set operations are reached through this shape.
 */
interface StateSet {
  add(value: string): void;
  delete(value: string): void;
  has(value: string): boolean;
}

/**
 * The custom-state surface, granted to the two modules that own a
 * state the element itself cannot decide: the validator (`error`,
 * §8.1) and the pointer path (`hover`, §5.7).
 *
 * {@link HdvlElement.setState} stays **protected**, deliberately.
 * Making it public would put SPEC §1's lifecycle states — which are
 * *derived*, never authored — on the element's public API, where a
 * host app could set `error` on a chart that is fine and `hover` on
 * a mark the pointer is nowhere near. This map is the narrower
 * grant: the class hands its own state set to its own module at
 * construction, and the module exports exactly the two capabilities
 * needed. Nothing outside `src/hdvl/` can reach either.
 */
const stateOf = new WeakMap<HdvlElement, StateSet>();

/**
 * Adds or removes a custom state from outside the class.
 *
 * @param el - The element.
 * @param name - The state.
 * @param on - Whether to add it.
 */
export function writeState(
  el: HdvlElement,
  name: HdvlState,
  on: boolean,
): void {
  const states = stateOf.get(el);
  if (states === undefined) {
    return;
  }
  if (on) {
    states.add(name);
  } else {
    states.delete(name);
  }
}

/**
 * Reads a custom state from outside the class.
 *
 * @param el - The element.
 * @param name - The state.
 * @returns Whether it carries it.
 */
export function readState(el: HdvlElement, name: HdvlState): boolean {
  return stateOf.get(el)?.has(name) ?? false;
}

/**
 * Every display element. **Contract 1 is complete here.**
 *
 * `scene()` is declared `abstract` rather than defaulted to
 * `return null` on purpose. A default would be the smaller diff and
 * the wrong call: a silently inherited `null` is indistinguishable
 * from a widget whose body was forgotten, and the base's job is to
 * make every subclass state its own answer.
 */
export abstract class HdvlElement extends LitElement {
  /**
   * Stable scene-diff key, minted **once per instance at
   * construction** — never in `connectedCallback`, so an element
   * that disconnects and reconnects keeps its key. The per
   * subscription id R21 mints is a different identity.
   */
  public readonly uid: string = uid();

  /** The tag this class registers, from `HDVL_TAG_NAMES`. */
  public abstract readonly tag: HdvlTagName;

  /** This element's family, from `HDVL_FAMILIES`. */
  public abstract readonly family: HdvlFamily;

  /** `:state(loading|empty|error|hover)`. */
  protected readonly internals: ElementInternals;

  public constructor() {
    super();
    this.internals = this.attachInternals();
    stateOf.set(this, <StateSet>(<unknown>this.internals.states));
  }

  /**
   * The owning view, or `null` — **a read of the resolution index
   * and nothing else** (R35, §3.3).
   *
   * Step 09 answered by an ancestor walk and made this a getter so
   * that this swap would be a one-file change rather than a
   * twenty-element one. A second resolution source would disagree
   * after a DOM move *and* produce an element the `ResizeObserver`
   * never observes (R27), so `src/hdvl/` now contains no
   * `closest()` at all.
   *
   * The index answers for an element that has already been removed
   * from the DOM, which is the whole reason
   * {@link HdvlElement.disconnectedCallback} can invalidate
   * anything.
   */
  public get view(): HdmlViewElement | null {
    return viewOf(this);
  }

  /**
   * Called in the COMPUTE phase. Pure: reads only the measured box,
   * the measured style, the adopted data and the resolved scales.
   * Returns null to paint nothing (hidden, errored, or still
   * loading).
   *
   * @param ctx - The frame's MEASURE snapshot and resolved scales.
   * @returns This widget's contribution, or `null`.
   */
  public abstract scene(ctx: FrameContext): SceneGroup | null;

  /**
   * @override
   *
   * §3.1's promise, kept literally: an element that upgrades
   * **registers and invalidates**. It resolves no neighbour, reads
   * no ancestor attribute and asserts no ordering — every question
   * about neighbours is answered later, from the index built on the
   * view's frame.
   */
  public connectedCallback(): void {
    super.connectedCallback();
    this.view?.reindex();
  }

  /**
   * @override
   *
   * The other half of §5.6's structural pair, and **the one step 09
   * could not wire**: an ancestor walk from a removed element finds
   * no view, so there was nothing to invalidate. The index still
   * holds this element's `Resolution` — including its view — until
   * that view's next walk drops it, so the answer is available
   * exactly when it is needed.
   */
  public disconnectedCallback(): void {
    const view = this.view;
    super.disconnectedCallback();
    view?.reindex();
  }

  /**
   * @override
   *
   * **The single funnel.** R35 forbids classifying an attribute
   * change into structural vs presentational — one attribute filed
   * under the wrong class leaves a stale subscription or an
   * unvalidated tree — so every observed attribute lands here and
   * goes one place: **reindex first, then dirty**, exactly as §2.8's
   * pipeline shows. Because there is exactly one call site, that is
   * one edit rather than twenty.
   *
   * @param name - The attribute that changed.
   * @param old - Its previous value.
   * @param value - Its new value.
   */
  public attributeChangedCallback(
    name: string,
    old: null | string,
    value: null | string,
  ): void {
    super.attributeChangedCallback(name, old, value);
    this.view?.reindex();
  }

  /**
   * @override
   *
   * Prepends the shared element sheet to the render root's adopted
   * sheets. Prepended, not appended: a subclass's own `static
   * styles` must beat the UA defaults, exactly as an author rule
   * does.
   */
  protected createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot();
    const shadow = <ShadowRoot>(<unknown>root);
    shadow.adoptedStyleSheets = [
      elementSheet,
      ...shadow.adoptedStyleSheets,
    ];
    return root;
  }

  /**
   * @override
   *
   * R15's positioned wrapper, and the only shadow content a
   * non-view display element has in v1. `.plot` **is** the host's
   * content box, so an absolutely positioned *slotted* child
   * resolves against the parent's content box rather than its
   * padding box — which is SPEC §3's "a guide's containing block is
   * its scale", achieved with ordinary positioning instead of the
   * PoC's negative-margin slot.
   */
  protected render(): TemplateResult<1> {
    return html`<div class="plot"><slot></slot></div>`;
  }

  /**
   * The single invalidation path: mark the **owning view** dirty.
   * Never paints, never measures (§5.6) — the view answers with one
   * `requestAnimationFrame`, coalesced.
   */
  protected invalidate(): void {
    this.view?.markDirty();
  }

  /**
   * Adds or removes a custom state.
   *
   * @param name - The state.
   * @param on - Whether to add it.
   */
  protected setState(name: HdvlState, on: boolean): void {
    const states = <StateSet>(<unknown>this.internals.states);
    if (on) {
      states.add(name);
    } else {
      states.delete(name);
    }
  }

  /**
   * @param name - The state.
   * @returns Whether the element currently carries it.
   */
  protected hasState(name: HdvlState): boolean {
    const states = <StateSet>(<unknown>this.internals.states);
    return states.has(name);
  }
}
