/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The binding probe — a **test-only** `HdvlElement` with declared
 * slots (RFC 016/001 §7.2.1, step-plan C1).
 *
 * C1 moved Contract 4's consumer half to step 13 precisely because
 * *"no element, no slot and no binding site exists"* earlier. This is
 * the first binding site in the project: a mark-family element that
 * implements `subscribe.ts`'s duck-typed `Binder`, so R29's instance
 * fence and R38's stamp predicate are exercised against **the
 * implementation that ships** rather than against a harness stub
 * (H2).
 *
 * It registers under a tag **outside** the HDML vocabulary, so the
 * twenty-one-tag registry count is untouched, and lives in
 * `src/testing/`, which is excluded from `cjs`/`esm`/`dts`.
 *
 * `tag` is `HDVL_TAG_NAMES.BAR` because `HdvlTagName` is a closed
 * union of the twenty-one; the field says which vocabulary element
 * this class stands in for. `family` is `"mark"`, so a group it emits
 * counts toward §3.4.1's `empty` and so its error unit is itself
 * unless a container encloses it.
 *
 * **Import it as a VALUE.** A `import { HdvlBinderElement }` used
 * only in a type position is elided by `tsc`, `customElements.define`
 * never runs, and the element stays an un-upgraded `HTMLElement` —
 * absent from the index with no error anywhere (step 12's T1). Import
 * {@link BINDER_TAG} alongside it.
 *
 * @module testing/binder
 */

import { HdvlElement } from "../hdvl/base";
import { HDVL_TAG_NAMES } from "../hdvl/vocabulary";
import type { FrameContext } from "../hdvl/measure";
import type { SceneGroup } from "../hdvl/scene";
import type { Binding, Slot } from "../hdvl/subscribe";
import { FramePhase, currentPhase } from "../hdvl/schedule";
import {
  adoptedOf,
  paintSuppressed,
  sourceOf,
} from "../hdvl/subscribe";

/** The tag {@link HdvlBinderElement} registers under. */
export const BINDER_TAG = "hdvl-binder";

/** One declared slot, before the effective `source` is resolved. */
interface DeclaredSlot {
  column: string;
  raw: boolean;
}

/** One recorded `scene()` call. */
export interface BinderCall {
  phase: FramePhase | null;
  /** Whether §3.4's painting clause blanked this call. */
  suppressed: boolean;
  /** The adopted generation per slot at that moment. */
  generations: Record<Slot, number | null>;
}

/**
 * A display element with declared bindings.
 *
 * Assign nothing before the fixture resolves: the legacy
 * webcomponents polyfill upgrades on connect, so a field set before
 * connection can be clobbered. Use {@link bind} afterwards.
 */
export class HdvlBinderElement extends HdvlElement {
  public readonly tag = HDVL_TAG_NAMES.BAR;

  public readonly family = "mark";

  /** Every `scene()` call, in order. */
  public readonly calls: BinderCall[] = [];

  /** slot → what it binds. */
  readonly #slots = new Map<Slot, DeclaredSlot>();

  /**
   * §7.2's request path, per slot: the effective `source` from the
   * resolution index plus the bare identifier the slot binds. A slot
   * with no effective `source` contributes no binding — which is a
   * widget bound to literals, and the reason it paints on the first
   * frame (§3.6).
   *
   * @returns The bindings this element currently wants.
   */
  public bindings(): readonly Binding[] {
    const ref = sourceOf(this);
    if (ref === null) {
      return [];
    }
    const out: Binding[] = [];
    this.#slots.forEach((declared, slot) => {
      out.push({
        slot,
        ref,
        column: declared.column,
        raw: declared.raw,
      });
    });
    return out;
  }

  /** The slots this element declares, in declaration order. */
  public get slots(): readonly Slot[] {
    return [...this.#slots.keys()];
  }

  /** Whether the last `scene()` call emitted a group. */
  public get painted(): boolean {
    const last = this.calls[this.calls.length - 1];
    return last !== undefined && !last.suppressed;
  }

  /**
   * Declares (or re-targets) one slot and reindexes, which is what
   * an observed attribute change would do through R35's funnel.
   *
   * @param slot - The binding site.
   * @param column - The bare identifier it binds.
   * @param raw - `false` for a domain-only subscription (R6).
   */
  public bind(slot: Slot, column: string, raw = true): void {
    this.#slots.set(slot, { column, raw });
    this.view?.reindex();
  }

  /**
   * Drops one slot and reindexes.
   *
   * @param slot - The binding site to unbind.
   */
  public unbind(slot: Slot): void {
    this.#slots.delete(slot);
    this.view?.reindex();
  }

  /**
   * The adopted generation for one slot, or `null` when nothing is
   * adopted or the delivery carried no stamp.
   *
   * @param slot - The binding site.
   * @returns The stamp.
   */
  public generationAt(slot: Slot): number | null {
    const d = adoptedOf(this, slot);
    if (d === null || d.generation === undefined) {
      return null;
    }
    return d.generation;
  }

  /**
   * The adopted delivery kind for one slot.
   *
   * @param slot - The binding site.
   * @returns `"data"` / `"absent"` / `"error"`, or `null`.
   */
  public kindAt(slot: Slot): null | string {
    return adoptedOf(this, slot)?.kind ?? null;
  }

  /**
   * @override
   *
   * A widget's whole §3.4 obligation in three lines: ask whether
   * painting is suppressed, and emit only when it is not and
   * something is adopted.
   *
   * @param ctx - The frame's snapshot.
   * @returns A one-rect group, or `null`.
   */
  public scene(ctx: FrameContext): SceneGroup | null {
    const suppressed = paintSuppressed(this);
    const generations: Record<Slot, number | null> = {};
    for (const slot of this.#slots.keys()) {
      generations[slot] = this.generationAt(slot);
    }
    this.calls.push({
      phase: currentPhase(),
      suppressed,
      generations,
    });
    if (suppressed) {
      return null;
    }
    const measured = ctx.measured(this);
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

if (customElements.get(BINDER_TAG) === undefined) {
  customElements.define(BINDER_TAG, HdvlBinderElement);
}
