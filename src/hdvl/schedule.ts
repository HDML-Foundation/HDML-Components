/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The frame (RFC 016/001 §2.8, §5.6, R5).
 *
 * **One `requestAnimationFrame` per view, three phases, no
 * interleaving** — MEASURE reads every descendant's box and computed
 * style top-down and writes nothing; COMPUTE calls each widget's
 * pure `scene()`; PAINT hands one `Scene` to the renderer. The
 * ordering is the point: no element ever reads a box after another
 * has written one, which is what makes a widget's `scene()` a pure
 * function of the snapshot rather than of whoever ran before it.
 *
 * *n* invalidations before the frame produce **one** frame. That is
 * also how §5.6's clause 1.3 is satisfied structurally rather than
 * by discipline: `deliver` (step 13) stores and sets a boolean, and
 * paint happens a whole frame later, so the D8 contract's
 * tear-freedom argument holds with a full frame of margin.
 *
 * @module hdvl/schedule
 */

import type { HdvlElement } from "./base";
import type { HdmlViewElement } from "./view";
import type { Scene, SceneFont, SceneGroup } from "./scene";
import type { TextMetrics2 } from "./renderer";
import type { Resolution } from "./resolve";
import type { FrameContext, Measured } from "./measure";
import { emptyScene } from "./scene";
import { measureView } from "./measure";

/** The three phases, in the only order they may run in. */
export type FramePhase = "measure" | "compute" | "paint";

let phase: FramePhase | null = null;

/**
 * Which phase is running, or `null` outside a frame.
 *
 * Exported so a widget's own code can assert where it is being
 * called from — the non-interleaving claim is otherwise only
 * observable from outside.
 *
 * @returns The current phase.
 */
export function currentPhase(): FramePhase | null {
  return phase;
}

/**
 * The frame's trace seam.
 *
 * A **module singleton**, spelled like `renderers.create` and
 * `HdmlIo`'s `nav`/`endpoints`, because the legacy webcomponents
 * polyfill upgrades on connect and clobbers per-instance injection.
 * A test assigns `record` in `setup()` and restores it in
 * `teardown()`.
 */
export const frameTrace: {
  record: null | ((p: FramePhase) => void);
} = { record: null };

function enter(p: FramePhase): void {
  phase = p;
  frameTrace.record?.(p);
}

/** A coalescing one-frame-at-a-time rAF loop. */
export interface FrameLoop {
  /** Requests a frame. Idempotent until that frame runs. */
  request(): void;
  /** Cancels an outstanding frame, if any. */
  cancel(): void;
  /** Whether a frame is outstanding. */
  readonly pending: boolean;
  /** How many frames have run. */
  readonly frames: number;
}

/**
 * Builds a loop that runs `run` at most once per animation frame.
 *
 * The handle is cleared **before** `run`, so an invalidation raised
 * *during* a frame schedules the next one rather than being
 * swallowed.
 *
 * @param run - The frame body.
 * @returns The loop.
 */
export function createFrameLoop(run: () => void): FrameLoop {
  let handle = 0;
  let frames = 0;
  return {
    request(): void {
      if (handle !== 0) {
        return;
      }
      handle = requestAnimationFrame(() => {
        handle = 0;
        frames++;
        run();
      });
    },
    cancel(): void {
      if (handle !== 0) {
        cancelAnimationFrame(handle);
        handle = 0;
      }
    },
    get pending(): boolean {
      return handle !== 0;
    },
    get frames(): number {
      return frames;
    },
  };
}

/** Everything one frame needs, supplied by the view. */
export interface FrameInput {
  view: HdmlViewElement;
  /** Document order, the view first (§2.5's paint order). */
  elements: readonly HdvlElement[];
  resolution(el: HdvlElement): Resolution | undefined;
  measureText(text: string, font: SceneFont): TextMetrics2;
  render(scene: Scene): void;
}

/** What one frame produced. */
export interface FrameResult {
  scene: Scene;
  measured: ReadonlyMap<HdvlElement, Measured>;
  /**
   * Nodes emitted by mark-role groups. §3.4.1 decides `empty` on
   * **this**, never on a row count — a pie of four zero rows and a
   * line whose every `y` is null both emit nothing while reporting
   * rows.
   */
  marks: number;
  /**
   * Every node in the scene, marks and guides alike — R20's budget
   * is a property of the **view**, not of one widget, so it can
   * only be counted where every `scene()` has already returned.
   */
  nodes: number;
}

/**
 * Runs one frame: MEASURE → COMPUTE → PAINT.
 *
 * Every `scene()` may legitimately return `null` — §2.3 calls that
 * a contract-complete answer for a hidden, errored or still-loading
 * widget — so a frame in which every widget returns `null` renders
 * a real, empty `Scene` rather than skipping PAINT.
 *
 * @param input - The frame's inputs.
 * @returns The scene, the snapshot and the mark-node count.
 */
export function runFrame(input: FrameInput): FrameResult {
  enter("measure");
  const snapshot = measureView(input.view, input.elements);

  enter("compute");
  const ctx: FrameContext = {
    width: snapshot.width,
    height: snapshot.height,
    measured(el: HdvlElement): Measured {
      const hit = snapshot.measured.get(el);
      if (hit === undefined) {
        throw new Error(`hdvl: ${el.localName} was not measured`);
      }
      return hit;
    },
    resolution: input.resolution,
    measureText: input.measureText,
  };
  const groups: SceneGroup[] = [];
  let marks = 0;
  let nodes = 0;
  for (const el of input.elements) {
    const group = el.scene(ctx);
    if (group === null) {
      continue;
    }
    groups.push(group);
    nodes += group.nodes.length;
    if (group.role === "mark") {
      marks += group.nodes.length;
    }
  }
  const scene: Scene =
    groups.length === 0
      ? emptyScene(snapshot.width, snapshot.height)
      : {
          width: snapshot.width,
          height: snapshot.height,
          groups,
        };

  enter("paint");
  input.render(scene);

  phase = null;
  return { scene, measured: snapshot.measured, marks, nodes };
}
