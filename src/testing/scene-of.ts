/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * `sceneOf(view, {precision: 6})` — the step-plan's **cross-engine
 * assertion rule 3**, as a function (RFC 016/001 §10.4).
 *
 * A scene assertion is the project's primary test mechanism, and a
 * raw `deepEqual` over one would be a cross-engine trap: V8,
 * SpiderMonkey and JavaScriptCore agree on rational arithmetic and
 * differ in the last ulp of anything through `Math.log/pow/sin/cos`,
 * so a projected coordinate is only equal to six or seven decimals.
 * Quantizing to **six** is sub-nanometre in CSS px and is what makes
 * `deepEqual` safe on all three.
 *
 * **The scene itself is never quantized.** That would be a rendering
 * decision, and R2 forbids anyone writing to a scene at all — so
 * this returns a fresh deep copy and leaves the original alone.
 *
 * Reading the scene needs a renderer that keeps one, so this module
 * also owns the recorder swap: {@link installSceneRecorder} puts the
 * `src/testing/` recording stub behind `renderers.create` and
 * {@link restoreRenderers} puts the real one back. The recorder is
 * found by the shadow root it mounted on, which the stub already
 * records — no second test double is introduced (§5.9).
 *
 * @module testing/scene-of
 */

import type { Renderer } from "../hdvl/renderer";
import type { Scene } from "../hdvl/scene";
import type { HdmlViewElement } from "../hdvl/view";
import { renderers } from "../hdvl/renderer";
import {
  RecordingRenderer,
  createRecordingRenderer,
} from "./recording-renderer";

/** Every recorder this module handed out, in creation order. */
let made: RecordingRenderer[] = [];

/** The real factory, while a recorder is installed. */
let real: null | (() => Renderer) = null;

/**
 * Swaps the recording stub in behind `renderers.create`.
 *
 * A **module singleton**, as every seam in this repo is: the legacy
 * webcomponents polyfill upgrades on connect and clobbers
 * per-instance injection, so a per-view field would race.
 * Idempotent, so a nested `setup()` cannot lose the real factory.
 */
export function installSceneRecorder(): void {
  if (real !== null) {
    return;
  }
  real = renderers.create;
  made = [];
  renderers.create = (): Renderer => {
    const rec = createRecordingRenderer();
    made.push(rec);
    return rec;
  };
}

/** Restores the real renderer factory and drops every recorder. */
export function restoreRenderers(): void {
  if (real === null) {
    return;
  }
  renderers.create = real;
  real = null;
  made = [];
}

/** The recorder mounted on a view's shadow root, or `null`. */
export function recorderOf(
  view: HdmlViewElement,
): RecordingRenderer | null {
  const root = view.shadowRoot;
  if (root === null) {
    return null;
  }
  for (let i = made.length - 1; i >= 0; i--) {
    if (made[i].mounts.includes(root)) {
      return made[i];
    }
  }
  return null;
}

/** How {@link sceneOf} rounds. */
export interface SceneOfOptions {
  /**
   * Decimal places every number is rounded to. Rule 3's value is
   * **6**; omit it to read the scene verbatim.
   */
  precision?: number;
}

/**
 * A signed zero is `===` zero but is neither `Object.is`-equal nor
 * `deepEqual` to it, and `(-0).toFixed(6)` is `"-0.000000"` — so
 * rounding is itself a `-0` producer and normalising after it is
 * mandatory (plan rule 9).
 */
function round(value: number, digits: number): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  const out = Number(value.toFixed(digits));
  return Object.is(out, -0) ? 0 : out;
}

/**
 * A deep copy with every number rounded — {@link sceneOf}'s
 * quantizer, exported so a test can put its **expected** value
 * through the same one.
 *
 * That matters for anything the test computes rather than
 * transcribes: comparing a quantized scene against an unquantized
 * `curve()` result would fail on the very last-ulp differences rule
 * 3 exists to absorb.
 *
 * @param value - Any plain value.
 * @param digits - Decimal places.
 * @returns A rounded deep copy.
 */
export function roundDeep(value: unknown, digits: number): unknown {
  return quantize(value, digits);
}

/** A deep copy with every number rounded. */
function quantize(value: unknown, digits: number): unknown {
  if (typeof value === "number") {
    return round(value, digits);
  }
  if (Array.isArray(value)) {
    return (<unknown[]>value).map((item) => quantize(item, digits));
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  const out: Record<string, unknown> = {};
  const source = <Record<string, unknown>>value;
  for (const key of Object.keys(source)) {
    out[key] = quantize(source[key], digits);
  }
  return out;
}

/**
 * The last scene a view painted, deep-copied and quantized.
 *
 * @param view - The view.
 * @param options - Rounding. Rule 3's is `{precision: 6}`.
 * @returns The scene.
 * @throws If no recorder is installed, or the view never painted —
 * both of which are a broken fixture rather than a failed
 * assertion, and a `null` return would surface several layers away.
 */
export function sceneOf(
  view: HdmlViewElement,
  options?: SceneOfOptions,
): Scene {
  const rec = recorderOf(view);
  if (rec === null) {
    throw new Error(
      "sceneOf: no recorder for this view — call " +
        "installSceneRecorder() in setup(), before the fixture",
    );
  }
  const last = rec.last;
  if (last === null) {
    throw new Error("sceneOf: the view has not painted yet");
  }
  const digits = options?.precision;
  return digits === undefined ? last : <Scene>quantize(last, digits);
}
