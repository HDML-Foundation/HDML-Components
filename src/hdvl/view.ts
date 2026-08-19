/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `hdml-view` element — the only display element that owns
 * pixels (RFC 016/001 §2.2).
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

/**
 * The view holds the shadow root, the single `<svg>` surface (R1)
 * and the collapsed slot that keeps every descendant's box
 * measurable. `role="img"` prunes the whole subtree — including an
 * unupgraded `hdml-fallback` — from the accessibility tree
 * (SPEC §10).
 *
 * **This element is deliberately partial at step 09.** It owns a
 * surface that nothing draws into yet: the renderer is step 10's,
 * and the `ResizeObserver`, the resolution index, the frame and the
 * scheduler are step 11's. `markDirty` is therefore a flag and a
 * counter — the whole of invalidation until a frame exists to
 * consume it.
 *
 * `:state(loading)` is set at connect and never cleared, which is
 * not a placeholder but §3.6 applied: with no data layer, every
 * widget's `scene()` would return `null`, and `loading` is exactly
 * the state that describes.
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

  /** Whether an invalidation is outstanding. */
  public get dirty(): boolean {
    return this.dirtyFlag;
  }

  /**
   * How many invalidations this view has taken. Exists so the
   * single-funnel claim (R35) is assertable before a scheduler can
   * express it as frames.
   */
  public get dirtyCount(): number {
    return this.dirtyCounter;
  }

  /**
   * The end of every display element's `invalidate()`. Step 11
   * replaces the body with "mark dirty and request one animation
   * frame"; nothing about the call sites changes.
   */
  public markDirty(): void {
    this.dirtyFlag = true;
    this.dirtyCounter++;
  }

  /** Clears the dirty flag. The frame's last act, from step 11. */
  public clearDirty(): void {
    this.dirtyFlag = false;
  }

  /**
   * @override
   */
  public connectedCallback(): void {
    super.connectedCallback();
    if (!this.hasAttribute("role")) {
      this.setAttribute("role", "img");
    }
    this.setState("loading", true);
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
}
