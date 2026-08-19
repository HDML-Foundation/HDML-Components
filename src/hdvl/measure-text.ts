/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * Shared text measurement (RFC 016/001 §5.3, step-plan H10).
 *
 * **This is deliberately not private to the SVG renderer.**
 * `hdml-label` and `hdml-legend` call `renderer.measureText` during
 * COMPUTE, so their scenes *depend on it*. If the recording stub
 * carried its own implementation, `sceneOf` under the two renderers
 * would differ for every text-bearing guide and §5.9's
 * byte-identity check would be permanently red — structurally,
 * from the first guide slice onward, rather than as a bug. Both the
 * SVG renderer and the stub delegate here.
 *
 * A measurement utility, explicitly **not** a canvas renderer
 * (§5.9). Chosen over SVG's `getComputedTextLength`, which needs a
 * live node in the render tree and forces layout, and which —
 * measured — returned 37 / 45 / 48px across the three engines for
 * the same string, while the 2D context returns an identical width
 * on all three. Determinism across engines is what makes a scene
 * assertion a usable test.
 *
 * @module hdvl/measure-text
 */

import type { SceneFont } from "./scene";
import type { TextMetrics2 } from "./renderer";

/** Which 2D context backed the measurement. */
export type MeasureBackend = "offscreen" | "canvas";

type Ctx =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;

interface Backing {
  ctx: Ctx;
  backend: MeasureBackend;
}

let backing: Backing | null = null;

const cache = new Map<string, TextMetrics2>();

/**
 * The CSS `font` shorthand a {@link SceneFont} resolves to.
 *
 * Exported so the renderer-contract suite can assert the string
 * rather than infer it from a width. **Order is load-bearing**:
 * `style weight size family` is the only order the shorthand
 * accepts, and a wrong one leaves the context silently on its
 * previous font — a wrong measurement, not an error.
 *
 * @param font - The resolved font.
 * @returns A CSS `font` shorthand value.
 */
export function fontString(font: SceneFont): string {
  return (
    `${font.style} ${font.weight} ` + `${font.size}px ${font.family}`
  );
}

/**
 * Which backing store the module measured with.
 *
 * A capability the step-08 platform probe did not cover, so the
 * suite asserts what it actually got rather than assuming
 * `OffscreenCanvas`.
 *
 * @returns `"offscreen"` or `"canvas"`.
 */
export function measureBackend(): MeasureBackend {
  return context().backend;
}

/**
 * Measures a string, memoised per `(text, font)` (§5.3).
 *
 * @param text - The string to measure.
 * @param font - The resolved font it is drawn in.
 * @returns Its extents in CSS px — the identical frozen object for
 * every repeat call with the same key.
 */
export function measureText(
  text: string,
  font: SceneFont,
): TextMetrics2 {
  // A CSS font shorthand cannot contain U+0000, so no (font, text)
  // pair can collide with another across the separator.
  const key = `${fontString(font)}\u0000${text}`;
  const hit = cache.get(key);
  if (hit !== undefined) {
    return hit;
  }
  const { ctx } = context();
  ctx.font = fontString(font);
  const m = ctx.measureText(text);
  const out: TextMetrics2 = Object.freeze({
    width: finite(m.width),
    ascent: finite(m.actualBoundingBoxAscent),
    descent: finite(m.actualBoundingBoxDescent),
  });
  cache.set(key, out);
  return out;
}

/**
 * An empty label is legal (a bound column may deliver `""`), and an
 * engine that reports `undefined` or `NaN` for its ascent must not
 * be allowed to poison a scene with `NaN` — a `NaN` coordinate
 * silently drops a whole SVG path.
 *
 * **`-0` is normalised to `0`.** Measured: `measureText("")` reports
 * `actualBoundingBoxAscent === -0` on chromium and firefox and `0`
 * on webkit. The two are `===` but not `Object.is`-equal, they
 * serialize to different `d` strings, and `deepEqual` separates
 * them — so an unnormalised `-0` would put an engine split into
 * every scene carrying an empty label.
 */
function finite(v: number | undefined): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    return 0;
  }
  return Object.is(v, -0) ? 0 : v;
}

/**
 * The 2D context is created once, lazily, and reused: constructing
 * one per measurement is what makes the naive form slow, not the
 * measurement itself.
 */
function context(): Backing {
  if (backing !== null) {
    return backing;
  }
  if (typeof OffscreenCanvas !== "undefined") {
    const off = new OffscreenCanvas(1, 1).getContext("2d");
    if (off !== null) {
      backing = { ctx: off, backend: "offscreen" };
      return backing;
    }
  }
  const el = document.createElement("canvas");
  const ctx = el.getContext("2d");
  if (ctx === null) {
    throw new Error("hdvl: no 2D context for text measurement");
  }
  backing = { ctx, backend: "canvas" };
  return backing;
}
