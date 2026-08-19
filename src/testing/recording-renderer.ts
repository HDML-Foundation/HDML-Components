/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The recording renderer — a **test double, not a second renderer**
 * (RFC 016/001 §5.9, verbatim: *"The stub records the scene and
 * draws nothing … and an implementing agent should build no more
 * than that."*).
 *
 * It exists for one assertion: `sceneOf(page)` is byte-identical
 * with the SVG renderer mounted and with this mounted. If a widget
 * ever needed to know which renderer it had, that equality would
 * break. It therefore has no geometry, no DOM and no hit resolution.
 *
 * **`measureText` delegates** to `hdvl/measure-text` — that module
 * exists precisely so this one cannot have its own implementation
 * (step-plan H10). A guide calls `measureText` during COMPUTE, so
 * its scene depends on the value; two implementations would make the
 * byte-identity check red for every text-bearing guide, structurally
 * rather than as a bug.
 *
 * @module testing/recording-renderer
 */

import type { Hit, Renderer, TextMetrics2 } from "../hdvl/renderer";
import type { Scene, SceneFont } from "../hdvl/scene";
import { measureText } from "../hdvl/measure-text";

/** One `resize()` call's arguments. */
export interface RecordedResize {
  cssW: number;
  cssH: number;
  dpr: number;
}

/** A {@link Renderer} that records and draws nothing. */
export interface RecordingRenderer extends Renderer {
  /** Every scene handed to `render()`, in order. */
  readonly scenes: readonly Scene[];
  /** The most recent scene, or null. */
  readonly last: Scene | null;
  /** Every root handed to `mount()`, in order. */
  readonly mounts: readonly ShadowRoot[];
  /** Every `resize()` call, in order. */
  readonly resizes: readonly RecordedResize[];
  /** How many times `unmount()` was called. */
  readonly unmounts: number;
}

/**
 * Builds a fresh recorder.
 *
 * @returns A recording renderer with empty logs.
 */
export function createRecordingRenderer(): RecordingRenderer {
  const scenes: Scene[] = [];
  const mounts: ShadowRoot[] = [];
  const resizes: RecordedResize[] = [];
  let unmounts = 0;

  return {
    get scenes(): readonly Scene[] {
      return scenes;
    },
    get last(): Scene | null {
      return scenes.length === 0 ? null : scenes[scenes.length - 1];
    },
    get mounts(): readonly ShadowRoot[] {
      return mounts;
    },
    get resizes(): readonly RecordedResize[] {
      return resizes;
    },
    get unmounts(): number {
      return unmounts;
    },
    mount(root: ShadowRoot): void {
      mounts.push(root);
    },
    resize(cssW: number, cssH: number, dpr: number): void {
      resizes.push({ cssW, cssH, dpr });
    },
    render(scene: Scene): void {
      scenes.push(scene);
    },
    /** No geometry, so nothing to resolve. */
    resolve(): Hit | null {
      return null;
    },
    measureText(text: string, font: SceneFont): TextMetrics2 {
      return measureText(text, font);
    },
    unmount(): void {
      unmounts++;
    },
  };
}
