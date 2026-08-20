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
  elementsOf,
  registerView,
  reindexView,
  resolutionOf,
  unregisterView,
} from "./resolve";
import { FrameLoop, createFrameLoop, runFrame } from "./schedule";

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
 * `:state(loading)` is set at connect and never cleared, which is
 * §3.6 applied rather than a placeholder: with no data layer, every
 * widget's `scene()` returns `null`. `empty` is computed from the
 * frame's mark-node count at end of frame (§3.4.1) and gated on
 * `loading`, so the two can never both be set.
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

  private readonly observed = new Set<Element>();

  private readonly loop: FrameLoop = createFrameLoop(() => {
    this.frame();
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

  /** Whether an invalidation is outstanding. */
  public get dirty(): boolean {
    return this.dirtyFlag;
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

  /** Clears the dirty flag. The frame's last act. */
  public clearDirty(): void {
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
    super.connectedCallback();
    if (!this.hasAttribute("role")) {
      this.setAttribute("role", "img");
    }
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
    const result = runFrame({
      view: this,
      elements: elementsOf(this),
      resolution: resolutionOf,
      measureText: (text, font) => renderer.measureText(text, font),
      render: (scene) => renderer.render(scene),
    });
    // §3.4.1: `empty` is decided on emitted MARK nodes, never on a
    // row count, and applied at end of frame. §3.4's first clause
    // is what keeps it from colliding with `loading` — a view that
    // has not resolved once is loading, not empty.
    this.setState(
      "empty",
      !this.hasState("loading") && result.marks === 0,
    );
    this.clearDirty();
  }
}
