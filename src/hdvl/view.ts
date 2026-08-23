/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `hdml-view` element — the only display element that owns
 * pixels (RFC 016/001 §2.2), and the owner of the frame (§5.6, R5).
 *
 * @module hdvl/view
 */

import { TemplateResult, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { HdvlElement } from "./base";
import {
  HDVL_FAMILIES,
  HDVL_TAG_NAMES,
  VIEW_ATTRS_LIST,
} from "./vocabulary";
import type { Renderer } from "./renderer";
import type { SceneGroup } from "./scene";
import { renderers } from "./renderer";
import {
  byUid,
  elementsOf,
  registerView,
  reindexView,
  resolutionOf,
  unregisterView,
} from "./resolve";
import { FrameLoop, createFrameLoop, runFrame } from "./schedule";
import {
  EventQueue,
  HDML_RENDER,
  POINTER_TYPES,
  PointerBridge,
  createEventQueue,
  createPointerBridge,
  outward,
} from "./events";
import {
  forgetView,
  validateBindings,
  validateMeasured,
  validateNodeBudget,
  validateStructure,
} from "./validate";
import {
  applyLifecycle,
  drainDataEvents,
  forgetSubscriptions,
  reconcileView,
} from "./subscribe";
import { drainScaleEvents } from "./scale";
import { readConfig } from "../hdio/config";

/**
 * The view holds the shadow root, the single `<svg>` surface (R1)
 * and the collapsed slot that keeps every descendant's box
 * measurable. `role="img"` prunes the whole subtree — including an
 * unupgraded `hdml-fallback` — from the accessibility tree
 * (SPEC §10).
 *
 * **It also owns the frame.** Every invalidation in the view, from
 * whatever source, ends here as "mark dirty and request one
 * animation frame"; the frame then runs MEASURE → COMPUTE → PAINT
 * with no interleaving. The five sources of §5.6 are all wired: an
 * observed attribute change and a child connect/disconnect
 * (`HdvlElement`, both through `reindex()`), one `ResizeObserver`
 * instance observing the view **and every HDVL descendant** (R27),
 * a capturing `transitionrun` listener for the CSS sentinel (R24),
 * and — at step 13 — a D8 delivery.
 *
 * `:state(loading)` is set at connect — §3.6's "before the first
 * delivery" — and from the first frame on it is **derived**: §3.4's
 * quantifier over the reconciler's `desired` set, computed by
 * `subscribe.ts` and applied at end of frame. A view with no
 * subscriptions at all is therefore not loading after its first
 * frame, which is what makes `empty` reachable: `empty` is computed
 * from the frame's mark-node count (§3.4.1) and gated on `loading`,
 * so the two can never both be set.
 *
 * @tagname hdml-view
 *
 * @attribute {string} source - The default data source for the
 * subtree, nearest-ancestor-wins (SPEC §4.5).
 */
@customElement(HDVL_TAG_NAMES.VIEW)
export class HdmlViewElement extends HdvlElement {
  public readonly tag = HDVL_TAG_NAMES.VIEW;
  public readonly family = HDVL_FAMILIES[HDVL_TAG_NAMES.VIEW];

  /**
   * @internal
   */
  @property({ type: String })
  [VIEW_ATTRS_LIST.SOURCE]: null | string = null;

  private dirtyFlag = false;

  private dirtyCounter = 0;

  private frameCounter = 0;

  private renderer: Renderer | null = null;

  private observer: ResizeObserver | null = null;

  private fallback: MutationObserver | null = null;

  private readonly observed = new Set<Element>();

  private readonly loop: FrameLoop = createFrameLoop(() => {
    this.frame();
  });

  /** §5.11's after-PAINT dispatch queue. */
  private readonly events: EventQueue = createEventQueue();

  /**
   * §5.7's single delegated listener. The renderer answers the hit;
   * the view owns the listener and dispatches from the widget, so
   * the series identity is the event target (R10, SPEC §10).
   */
  private readonly pointer: PointerBridge = createPointerBridge({
    rect: () => this.surfaceRect(),
    resolve: (x, y) => this.renderer?.resolve(x, y) ?? null,
    widget: (uid) => byUid(uid),
  });

  /**
   * R27: geometry is driven by *each* element's own box — a scale's
   * range is its own content box, a guide's placement resolves
   * against its scale, and a plane can resize independently of the
   * view through `@container`, a percentage width or its own
   * padding. Observing only the view would miss every one of those.
   */
  private readonly onResize = (
    entries: ResizeObserverEntry[],
  ): void => {
    for (const entry of entries) {
      if (entry.target !== this) {
        continue;
      }
      const box = entry.contentBoxSize[0];
      if (box !== undefined) {
        // §5.8: `devicePixelContentBoxSize` is deliberately NOT
        // read and the WebKit fallback branch is not written — no
        // MVP consumer reads the result, and under SVG the
        // CSS-px → device-px mapping is an identity.
        this.renderer?.resize(
          box.inlineSize,
          box.blockSize,
          window.devicePixelRatio,
        );
      }
    }
    this.markDirty();
  };

  /**
   * The CSS half of §5.6, and the reason the PoC's document-wide
   * `MutationObserver` is retired. Capturing, because the 1 ms UA
   * transition runs on the **descendant** whose property changed.
   */
  private readonly onTransition = (): void => {
    this.markDirty();
  };

  /** §5.7's delegated listener, one per view for every type. */
  private readonly onPointer = (e: Event): void => {
    this.pointer.handle(e);
  };

  /** The pointer left the view entirely; nothing is hovered. */
  private readonly onPointerLeave = (): void => {
    this.pointer.clear();
  };

  /** Whether an invalidation is outstanding. */
  public get dirty(): boolean {
    return this.dirtyFlag;
  }

  /**
   * Whether the `MutationObserver` fallback is running for this
   * view (§5.6).
   *
   * It is switched on by W5 — an author `transition` shorthand
   * replaced the UA sentinel wholesale, so a later stylesheet-driven
   * `--hdml-*` change would schedule no frame — or unconditionally
   * by `HDML_CONFIG.paranoidObserver`. Exposed because "the
   * self-heal happened" is otherwise unobservable from outside, and
   * a silent self-heal is indistinguishable from a broken one.
   */
  public get observingFallback(): boolean {
    return this.fallback !== null;
  }

  /** The element under the pointer, or `null` (§5.7). */
  public get hovered(): Element | null {
    return this.pointer.hovered;
  }

  /**
   * How many invalidations this view has taken. Exists so the
   * single-funnel claim (R35) is assertable independently of how
   * many frames those invalidations coalesced into.
   */
  public get dirtyCount(): number {
    return this.dirtyCounter;
  }

  /**
   * How many frames have run. The honest counterpart to
   * {@link dirtyCount}: *n* invalidations before a frame produce
   * exactly one increment here.
   */
  public get framesRun(): number {
    return this.frameCounter;
  }

  /**
   * §3.3's single walk, plus R27's observed-set maintenance.
   *
   * The set is updated **here and nowhere else** — two places
   * maintaining it would eventually disagree about which elements
   * are observed, and an unobserved element is one whose CSS box
   * silently stops driving geometry.
   */
  public reindex(): void {
    const elements = reindexView(this);
    const wanted = new Set<Element>(elements);
    for (const el of Array.from(this.observed)) {
      if (!wanted.has(el)) {
        this.observer?.unobserve(el);
        this.observed.delete(el);
      }
    }
    for (const el of wanted) {
      if (!this.observed.has(el)) {
        this.observer?.observe(el);
        this.observed.add(el);
      }
    }
    // §8.2's STRUCTURAL pass, over the walk that just ran and the
    // index it just filled — V1 and V13 read `chain`, `tip`,
    // `container` and `unit` rather than re-deriving any of them.
    // Its `hdml-error`s are queued, not dispatched: §5.11 puts every
    // outward event after PAINT, and `markDirty()` below guarantees
    // the frame that drains them.
    validateStructure(this, elements, this.events);
    // §7.2.2 runs in the SAME pass, over the same walk: R35 funnels
    // every observed attribute change through here, so "after every
    // structural reindex and after any attribute change that can
    // alter a binding" is exactly this call site. It is a set diff
    // over data the index already holds — O(bindings), and a no-op
    // when nothing moved.
    reconcileView(this, elements);
    this.markDirty();
  }

  /**
   * The end of every display element's `invalidate()`: mark dirty
   * and request **one** animation frame. *n* calls before that
   * frame produce one frame.
   *
   * A disconnected view takes no invalidation at all — an rAF that
   * fires against a detached shadow root paints into nothing, and
   * would re-mount a renderer `disconnectedCallback` has just
   * unmounted.
   */
  public markDirty(): void {
    if (!this.isConnected) {
      return;
    }
    this.dirtyFlag = true;
    this.dirtyCounter++;
    this.loop.request();
  }

  /**
   * Clears the dirty flag. The frame's last act.
   *
   * It is a no-op while another frame is already outstanding, which
   * is not defensiveness: §5.11 drains the outward-event queue just
   * before this call, and a listener is entitled to mutate the DOM.
   * Clearing unconditionally would leave `dirty` false with a frame
   * pending — and `dirty` is what every quiescence check reads.
   */
  public clearDirty(): void {
    if (this.loop.pending) {
      return;
    }
    this.dirtyFlag = false;
  }

  /**
   * @override
   *
   * §5.1: the view, both planes, the scales and the layout
   * containers emit **no group at all** — only mark and guide
   * widgets do. This override is permanent; no later slice fills
   * it.
   */
  public scene(): SceneGroup | null {
    return null;
  }

  /**
   * @override
   */
  public connectedCallback(): void {
    // Before anything can ask for the index: `HdvlElement`'s own
    // `connectedCallback` resolves `this.view`, and for the view
    // that answer is "itself, if registered".
    registerView(this);
    if (this.observer === null) {
      this.observer = new ResizeObserver(this.onResize);
    }
    this.addEventListener("transitionrun", this.onTransition, true);
    // §5.7, R10: ONE delegated listener per type, on the view.
    for (const type of POINTER_TYPES) {
      this.addEventListener(type, this.onPointer);
    }
    this.addEventListener("pointerleave", this.onPointerLeave);
    super.connectedCallback();
    if (!this.hasAttribute("role")) {
      this.setAttribute("role", "img");
    }
    // §3.6: between upgrade and the first frame nothing is known
    // about who subscribes, so the honest answer is `loading`. The
    // first `applyLifecycle` replaces it with §3.4's quantifier —
    // including clearing it outright for a literal-only view.
    this.setState("loading", true);
  }

  /**
   * @override
   *
   * A removed view must leak neither an observer nor a frame: one
   * of each per page navigation is a real leak, and an rAF that
   * fires against a detached shadow root paints into nothing.
   */
  public disconnectedCallback(): void {
    this.loop.cancel();
    this.observer?.disconnect();
    this.observed.clear();
    this.removeEventListener(
      "transitionrun",
      this.onTransition,
      true,
    );
    for (const type of POINTER_TYPES) {
      this.removeEventListener(type, this.onPointer);
    }
    this.removeEventListener("pointerleave", this.onPointerLeave);
    this.pointer.clear();
    this.fallback?.disconnect();
    this.fallback = null;
    // A queued outward event whose frame never came must not fire
    // into a detached tree on some later reconnection.
    this.events.clear();
    forgetView(this);
    // Aborts every subscription this view owns — one controller per
    // subscription, so this is the only place they all go at once.
    forgetSubscriptions(this);
    this.renderer?.unmount();
    this.renderer = null;
    // Drops this view's whole index slice, which is also what makes
    // `HdvlElement.disconnectedCallback` a no-op for the
    // descendants that disconnect after it.
    unregisterView(this);
    super.disconnectedCallback();
  }

  /**
   * @override
   *
   * The `<svg>` exists only after Lit's first render, so the
   * renderer adopts it here. `mount()` reuses a surface the root
   * already holds rather than adding a second, and `unmount()`
   * leaves an adopted one in place.
   */
  protected firstUpdated(): void {
    this.mountRenderer();
  }

  /**
   * @override
   *
   * The view is the one element with no `.plot` wrapper: §3.2's
   * `:host(hdml-view) > slot` and `> svg` rules address direct
   * children of this shadow root. The `<svg>` is written inside an
   * `html` template rather than created by hand because the HTML
   * parser puts `<svg>` in the SVG namespace as foreign content —
   * `document.createElement("svg")` would produce an
   * `HTMLUnknownElement` that lays out identically and accepts no
   * SVG child, a failure invisible until the renderer arrives.
   */
  protected render(): TemplateResult<1> {
    return html`<slot></slot><svg></svg>`;
  }

  /** Creates and mounts the renderer, at most once per connection. */
  private mountRenderer(): Renderer | null {
    if (this.renderer !== null) {
      return this.renderer;
    }
    const root = this.shadowRoot;
    if (root === null) {
      return null;
    }
    // `renderers.create` is a MODULE singleton, so a test swaps the
    // renderer by assigning to it in `setup()`.
    const next = renderers.create();
    next.mount(root);
    this.renderer = next;
    return next;
  }

  /** One frame: MEASURE → COMPUTE → PAINT, then `clearDirty()`. */
  private frame(): void {
    const renderer = this.mountRenderer();
    if (renderer === null) {
      // No shadow root yet. Lit will render and `firstUpdated` will
      // mount; the outstanding dirty flag brings us back.
      this.loop.request();
      return;
    }
    this.frameCounter++;
    const elements = elementsOf(this);
    const result = runFrame({
      view: this,
      elements,
      resolution: resolutionOf,
      measureText: (text, font) => renderer.measureText(text, font),
      render: (scene) => renderer.render(scene),
    });
    // §8.2's BINDING pass, over the scales COMPUTE just resolved
    // and the deliveries they adopted. It runs here rather than
    // inside COMPUTE because both halves of V2 read what the frame
    // produced — the resolved domain most of all — and because a
    // `writeState` mid-phase would invalidate style in the middle
    // of the pass that is reading it.
    validateBindings(this, elements, this.events);
    // R20's W4. The scene is already painted, deliberately: the
    // rule is "warn and keep rendering", so the warning follows the
    // paint it did not prevent, and the count is of what was
    // actually drawn rather than of what was proposed.
    validateNodeBudget(this, result.nodes);
    // W5 and W6 — MEASURE produced both flags and reported
    // neither, because §8's warnings are edge-triggered (R25).
    if (
      validateMeasured(this, result.measured) ||
      readConfig().paranoidObserver
    ) {
      this.enableFallback();
    }
    // §7.4's delivery → lifecycle mapping, applied HERE rather than
    // in `deliver`: clause 1.3 forbids `deliver` touching style at
    // all, and the frame is where every other derived state lands.
    applyLifecycle(this, elements);
    // §3.4.1: `empty` is decided on emitted MARK nodes, never on a
    // row count, and applied at end of frame. §3.4's first clause
    // is what keeps it from colliding with `loading` — a view that
    // has not resolved once is loading, not empty.
    this.setState(
      "empty",
      !this.hasState("loading") && result.marks === 0,
    );
    // §5.11's `hdml-scale-change`, edge-triggered on the resolved
    // `(domain, range)` pair — a DIFFERENT edge from `hdml-data`'s:
    // a resize changes a range and so re-fires this, while §5.11
    // says a resize does not re-fire `hdml-data`.
    drainScaleEvents(elements, this.events);
    // §5.11's `hdml-data`, edge-triggered on the adopted set and
    // dispatched from the element that adopted — queued ahead of
    // `hdml-render`, so a listener sees the data before the frame
    // that painted it is announced.
    drainDataEvents(this, this.events);
    // §5.11: every outward event is dispatched AFTER PAINT, from
    // the queue collected during the frame. A listener may mutate
    // the DOM, and a mutation mid-phase corrupts the pass in
    // flight; here it simply marks the view dirty for the next one.
    this.events.push(this, outward(HDML_RENDER));
    this.events.flush();
    this.clearDirty();
  }

  /** The surface's viewport rect, read fresh per event (§5.7). */
  private surfaceRect(): DOMRect | null {
    const svg = this.shadowRoot?.querySelector("svg") ?? null;
    return svg === null ? null : svg.getBoundingClientRect();
  }

  /**
   * Switches on the document-wide `MutationObserver` fallback
   * (§5.6), at most once per connection.
   *
   * The cost is paid only by pages that actually override
   * `transition` — which is the whole point of detecting the loss
   * rather than running the observer for everyone, as the PoC did.
   * It watches the light DOM only; the renderer writes into the
   * shadow root, which a `MutationObserver` never crosses, so there
   * is no feedback loop.
   */
  private enableFallback(): void {
    if (this.fallback !== null) {
      return;
    }
    const observer = new MutationObserver(() => {
      this.markDirty();
    });
    observer.observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["style", "class"],
    });
    this.fallback = observer;
  }
}
