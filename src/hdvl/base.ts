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
import {
  HdvlFamily,
  HdvlTagName,
  HDVL_TAG_NAMES,
} from "./vocabulary";
import { elementSheet, adoptDocumentSheet } from "./ua";
import { registerProperties } from "./properties";

registerProperties();
adoptDocumentSheet();

/**
 * The four custom states of SPEC §1's lifecycle surface
 * (RFC §3.4). Step 09 sets `loading` only: `empty` is decided on
 * emitted marks after COMPUTE, and `error` needs the validator.
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
 * Every display element.
 *
 * `scene(ctx: FrameContext): SceneGroup | null` is deliberately
 * **not** declared here. `FrameContext` is made of the frame's
 * MEASURE snapshot, which does not exist until the scheduler does,
 * so it and `scene()` land together at step 11 (step-plan C6).
 * Returning `null` is a contract-complete state, which is what lets
 * the spine land box-first without half-applying Contract 1.
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
  }

  /**
   * The owning view, or `null`.
   *
   * Step 09 answers by an ancestor walk; step 11 replaces the body
   * with a read of the resolution index. **The getter is the seam**
   * — no caller ever walks the DOM itself (R35), so that swap is a
   * one-file change rather than a twenty-one-file one. A field
   * would not be swappable at all.
   *
   * `closest` includes the element itself, so a view owns itself:
   * `view.invalidate()` marks the right view dirty with no special
   * case.
   */
  public get view(): HdmlViewElement | null {
    const el = this.closest(HDVL_TAG_NAMES.VIEW);
    return el === null ? null : <HdmlViewElement>el;
  }

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
    this.invalidate();
  }

  /**
   * @override
   *
   * **The single funnel.** R35 forbids classifying an attribute
   * change into structural vs presentational, so every observed
   * attribute lands here and goes one place. At step 09 that place
   * is `invalidate()`; at step 11 it becomes `view.reindex()`, and
   * because there is exactly one call site that is one edit.
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
    this.invalidate();
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
   * Never paints, never measures (§5.6). The view's implementation
   * is a flag and a counter at step 09; step 11 gives it the rAF.
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
