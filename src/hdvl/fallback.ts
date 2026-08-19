/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `hdml-fallback` element — the one display tag that is **not**
 * display vocabulary (RFC 016/001 §2.2, step-plan H3).
 *
 * @module hdvl/fallback
 */

import { HDVL_TAG_NAMES } from "./vocabulary";

/**
 * Light-DOM flow content shown only while the view is not upgraded;
 * exempt from every V-rule, never slotted, never revived.
 *
 * **It must not extend `HdvlElement`, and the reason is not
 * stylistic.** The element sheet opens with a generic
 * `:host { position: absolute; inset: 0 }`. If this element adopted
 * that sheet, the author's flow content would become absolutely
 * positioned — and §3.1's zero-JavaScript promise would break in
 * precisely the one window the element exists for: the page has not
 * upgraded, the author's "your browser can't render this chart"
 * paragraph is all the user has, and it is now stacked on top of
 * itself.
 *
 * So this is a bare `HTMLElement` with **no shadow root, no adopted
 * sheet and no internals**. Its two rules are pure CSS in the
 * document sheet (`ua.ts`), which is where §3.2 puts them.
 *
 * **The empty body is the implementation, not an omission.**
 * Registration exists only so `HDML.supports()` answers true for
 * this tag, W1's unknown-element warning stays quiet, and V13 can
 * count "at most one".
 *
 * @tagname hdml-fallback
 */
export class HdmlFallbackElement extends HTMLElement {}

customElements.define(HDVL_TAG_NAMES.FALLBACK, HdmlFallbackElement);
