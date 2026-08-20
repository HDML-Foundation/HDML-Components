/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The frame probe — a **test-only** `HdvlElement` (RFC 016/001
 * §2.3, step-plan *the reduced-fixture boundary*).
 *
 * Slice B gates on "a view + plane + a test-only probe whose
 * `scene()` returns a hand-built one-rect group", and this is that
 * probe. It records the phase it was called in, the `FrameContext`
 * it was handed and how many times — which is the instrument nearly
 * every frame assertion reads.
 *
 * It registers under a tag **outside** the HDML vocabulary, so the
 * twenty-one-tag registry count is untouched and R8's grep sees no
 * `hdml-` literal. It lives in `src/testing/`, which is excluded
 * from `cjs`/`esm`/`dts`, because anything else under `src/` ships.
 *
 * `tag` is `HDVL_TAG_NAMES.LINE` because `HdvlTagName` is a closed
 * union of the twenty-one and a probe is not one of them; the field
 * says which vocabulary element this class stands in for. `family`
 * is `"mark"` so a group it emits counts toward §3.4.1's `empty`.
 *
 * @module testing/probe
 */

import { HdvlElement } from "../hdvl/base";
import { HDVL_TAG_NAMES } from "../hdvl/vocabulary";
import type { FrameContext, Measured } from "../hdvl/measure";
import type { SceneGroup } from "../hdvl/scene";
import { FramePhase, currentPhase } from "../hdvl/schedule";

/** The tag {@link HdvlProbeElement} registers under. */
export const PROBE_TAG = "hdvl-probe";

/** One recorded `scene()` call. */
export interface ProbeCall {
  /** The phase the call happened in — always `"compute"`. */
  phase: FramePhase | null;
  /** The context it was handed. */
  ctx: FrameContext;
  /** Its own measured snapshot, read through that context. */
  measured: Measured;
}

/**
 * A recording display element.
 *
 * Assign {@link emit} **after** the fixture resolves: the legacy
 * webcomponents polyfill upgrades on connect, so a field set before
 * connection can be clobbered.
 */
export class HdvlProbeElement extends HdvlElement {
  public readonly tag = HDVL_TAG_NAMES.LINE;

  public readonly family = "mark";

  /** Every `scene()` call, in order. */
  public readonly calls: ProbeCall[] = [];

  /**
   * When true, `scene()` returns a one-rect group over the probe's
   * own measured box instead of `null`.
   */
  public emit = false;

  /** The most recent call, or `null`. */
  public get last(): ProbeCall | null {
    return this.calls.length === 0
      ? null
      : this.calls[this.calls.length - 1];
  }

  /**
   * @override
   *
   * @param ctx - The frame's snapshot.
   * @returns A one-rect group, or `null`.
   */
  public scene(ctx: FrameContext): SceneGroup | null {
    const measured = ctx.measured(this);
    this.calls.push({ phase: currentPhase(), ctx, measured });
    if (!this.emit) {
      return null;
    }
    return {
      widget: this.uid,
      tag: this.localName,
      role: "mark",
      box: measured.box,
      opacity: measured.opacity,
      filter: measured.filter,
      visibility: measured.visibility,
      clip: measured.clip,
      clipPath: measured.clipPath,
      nodes: [
        {
          k: "rect",
          i: 0,
          fill: measured.props.get("--hdml-fill-color") ?? null,
          stroke: null,
          strokeWidth: 0,
          dash: null,
          ...measured.box,
        },
      ],
    };
  }
}

if (customElements.get(PROBE_TAG) === undefined) {
  customElements.define(PROBE_TAG, HdvlProbeElement);
}
