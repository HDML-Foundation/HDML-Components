/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The renderer seam (RFC 016/001 §5.3, §5.9).
 *
 * Six methods, and **SVG is the only renderer in this project**
 * (§5.9). Neutrality is preserved where it costs nothing or
 * simplifies — parameterised `arc` nodes hit-test and clip more
 * simply than pre-serialized paths, and `resolve()` behind the
 * interface needs nearest-vertex maths the SVG renderer requires
 * anyway, since `isPointInStroke` answers *whether* a point is on a
 * stroke and never *which row*.
 *
 * @module hdvl/renderer
 */

import type { Scene, SceneFont } from "./scene";
import { createSvgRenderer } from "./renderer-svg";

/** What `resolve()` answers with. */
export interface Hit {
  widget: string;
  index: number;
}

/**
 * Text extents in CSS px. Named with a `2` because the platform
 * already owns `TextMetrics`, and this is the three-field subset the
 * seam carries rather than that interface.
 */
export interface TextMetrics2 {
  width: number;
  ascent: number;
  descent: number;
}

/** Everything the view asks of whatever owns its pixels. */
export interface Renderer {
  /**
   * Takes over a view's shadow root. Reuses an `<svg>` the root
   * already holds rather than adding a second one.
   */
  mount(root: ShadowRoot): void;
  /**
   * Under SVG the CSS-px → device-px mapping is an identity, so
   * `dpr` is recorded and nothing is scaled by it (§5.8).
   */
  resize(cssW: number, cssH: number, dpr: number): void;
  render(scene: Scene): void;
  /** View-local CSS px (§2.7) — never viewport coords. */
  resolve(x: number, y: number): Hit | null;
  /**
   * Available during COMPUTE, before `render()`: `hdml-label`
   * anchors and `hdml-legend`'s entry flow both need text extents
   * while building their scene (§6.5, §6.6).
   */
  measureText(text: string, font: SceneFont): TextMetrics2;
  unmount(): void;
}

/**
 * The construction seam.
 *
 * Step 11's `view.ts` calls `renderers.create()`; a test mounts the
 * recording stub instead by assigning to the property. It is a
 * **module singleton**, never a per-instance field, because the
 * legacy webcomponents polyfill upgrades on connect and races
 * per-instance injection — `HdmlIo.ts`'s exported mutable `nav` and
 * `endpoints` are the same shape, for the same reason.
 */
export const renderers: { create: () => Renderer } = {
  create: (): Renderer => createSvgRenderer(),
};
