/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `hdml-stack` element (RFC 016/001 §2.2).
 *
 * @module hdvl/container-stack
 */

import { customElement, property } from "lit/decorators.js";
import { HdvlElement } from "./base";
import type { FrameContext } from "./measure";
import type { SceneGroup } from "./scene";
import type { Binding, CellValue, Slot } from "./subscribe";
import type { Channel } from "./resolve";
import type { SlotValues } from "./mark";
import {
  CHANNEL_SLOTS,
  markBindings,
  projectionOf,
  rangedValuesOf,
  rowCountOf,
  slotValuesOf,
} from "./mark";
import {
  clearRangedOverrides,
  renderedChildrenOf,
  setRangedOverrides,
  sharedChannelOf,
} from "./container";
import {
  HDVL_FAMILIES,
  HDVL_TAG_NAMES,
  STACK_ATTRS_LIST,
} from "./vocabulary";

/** The container's own request path — the shared channel (V6). */
const SLOTS: readonly Slot[] = [
  STACK_ATTRS_LIST.X,
  STACK_ATTRS_LIST.Y,
];

/** SPEC §7's one named offset. Absent is the zero baseline. */
const NORMALIZE = "normalize";

/** A cell as a finite number, or `null` — §4.7's missing value. */
function numberOf(value: CellValue): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

/**
 * One derived endpoint column, over the container's **own** array.
 *
 * §12 duty 4: a delivered `Float64Array` is a view over a buffer
 * the worker owns and is never written to. `NaN` is the absent
 * cell, so one array carries both the value and its presence — and
 * `at()` converts it back to the `null` §4.7 drops on, which is the
 * only spelling anything below the resolver understands.
 *
 * @param slot - The endpoint's attribute name, for `SlotValues`.
 * @param cells - The derived column.
 * @param rows - Its length.
 * @returns The endpoint, shaped exactly like a delivered one.
 */
function derived(
  slot: Slot,
  cells: Float64Array,
  rows: number,
): SlotValues {
  return {
    slot,
    rows,
    scalar: false,
    at: (row: number): CellValue => {
      if (row < 0 || row >= rows) {
        return null;
      }
      const v = cells[row];
      return Number.isNaN(v) ? null : v;
    },
  };
}

/**
 * SPEC §6.4's baseline derive, over the stack's rendered children.
 *
 * ```
 * y0ₖ[i] = Σ_{j<k} (yⱼ[i] ?? 0)      k = child index, DOM order
 * y1ₖ[i] = yₖ[i] === null ? absent : y0ₖ[i] + yₖ[i]
 * ```
 *
 * **A null contributes 0 and renders nothing** (§7): child *k*
 * drops row *i* — its own high endpoint is absent — while the
 * children above it stay anchored where they were, *"rather than
 * collapsing the column"*.
 *
 * **`offset="normalize"`** divides both endpoints by the row's
 * total over the rendered children, and a row whose total is `0`
 * *"produces no bands for that row"* — the pie's zero-total rule
 * applied per row, and the reason the division is guarded rather
 * than allowed to produce `Infinity`.
 *
 * @param stack - The container.
 * @param ctx - The frame's snapshot.
 */
function restack(stack: HdvlElement, ctx: FrameContext): void {
  const rendered = renderedChildrenOf(stack);
  for (const node of Array.from(stack.children)) {
    const kid = <HdvlElement>(<unknown>node);
    if (!rendered.includes(kid)) {
      clearRangedOverrides(kid);
    }
  }
  const projection = projectionOf(ctx, stack);
  if (projection === null || rendered.length === 0) {
    rendered.forEach(clearRangedOverrides);
    return;
  }
  const [first, second] = projection.channels;
  const shared = sharedChannelOf(stack, projection.channels);
  const hoisted =
    shared === null ? null : rangedValuesOf(stack, shared);
  if (shared === null || hoisted === null) {
    // V6 and V19 report it; re-parameterising nothing is what
    // leaves the children's own attributes in force, which is the
    // honest answer while a container owns no channel.
    rendered.forEach(clearRangedOverrides);
    return;
  }
  const dep: Channel = shared === first ? second : first;
  const pair = CHANNEL_SLOTS[dep].ranged;
  if (pair === null) {
    rendered.forEach(clearRangedOverrides);
    return;
  }
  // V6: the simple form only — the container owns the baseline, so
  // a child's own `y0`/`y1` is an error and is never read.
  const series = rendered.map((kid) =>
    slotValuesOf(kid, CHANNEL_SLOTS[dep].simple),
  );
  const rows = rowCountOf([hoisted.high, ...series]);
  const normalize =
    (stack.getAttribute(STACK_ATTRS_LIST.OFFSET) ?? "").trim() ===
    NORMALIZE;
  const lows = series.map(() => new Float64Array(rows));
  const highs = series.map(() => new Float64Array(rows));
  for (let i = 0; i < rows; i++) {
    let acc = 0;
    for (let k = 0; k < series.length; k++) {
      const v = numberOf(series[k]?.at(i) ?? null);
      lows[k][i] = v === null ? NaN : acc;
      acc += v ?? 0;
      highs[k][i] = v === null ? NaN : acc;
    }
    if (!normalize) {
      continue;
    }
    for (let k = 0; k < series.length; k++) {
      // A zero total produces no bands for the row (§7). Dividing
      // would give ±Infinity or NaN and paint a band off the plot.
      lows[k][i] = acc === 0 ? NaN : lows[k][i] / acc;
      highs[k][i] = acc === 0 ? NaN : highs[k][i] / acc;
    }
  }
  for (let k = 0; k < rendered.length; k++) {
    setRangedOverrides(rendered[k], stack, {
      [shared]: hoisted,
      [dep]: {
        channel: dep,
        low: derived(pair[0], lows[k], rows),
        high: derived(pair[1], highs[k], rows),
        sugar: false,
      },
    });
  }
}

/**
 * **Not a painter.** It supplies each child's baseline, so band
 * *k*'s top is band *k+1*'s baseline. Curve properties are read
 * from the stack rather than its children — per-child curves would
 * tear the shared edges — and a child's `hidden` rebases the whole
 * stack without touching any scale's domain.
 *
 * **★ The children do not change** (H8). §6.4 makes the ranged form
 * the primitive a container compiles into, so a stacked child is an
 * ordinary ranged mark from `y0ₖ` to `y0ₖ + yₖ`: this element hands
 * `container.ts` a `(low, high)` pair per child and
 * `mark.ts`'s `rangedValuesOf` consults it before it reads
 * attributes. `mark-bar.ts` gained **no line** at this step.
 *
 * **★ It hoists the shared channel too.** V6 forbids a child from
 * binding it, so the child has no `x` attribute to read — the
 * container's own resolved pair is published onto every rendered
 * child under the same seam. That is why the derive and the hoist
 * are one write and not two mechanisms.
 *
 * **★ HDVL's `hidden` IS the platform's** *(decided at step 29;
 * the tag surface left the question open at step 09)*. The
 * observed attribute is read through {@link hiddenAttr} because a
 * `null | string` field named `hidden` would shadow the IDL
 * boolean and not type-check — but the **predicate** is
 * `HTMLElement.hidden`, so a hidden child is withheld from
 * painting, from layout and from the accessibility tree by one
 * declaration. Two mechanisms could disagree: a page that made a
 * `hidden` element `display: block` would get a series that paints
 * and is excluded from the relation, which is exactly the silent
 * wrong chart §1.5 forbids. `subscribe.ts`'s `paintSuppressed` is
 * where the read lands, so every widget honours it and no widget
 * spells it.
 *
 * @tagname hdml-stack
 *
 * @tagname hdml-stack
 *
 * @attribute {string} x - The column bound to the `x` channel (SPEC
 * §5).
 *
 * @attribute {string} y - The column bound to the `y` channel (SPEC
 * §5).
 *
 * @attribute {string} offset - The stacking offset mode (SPEC §7).
 *
 * @attribute {string} hidden - Whether this element is withheld from
 * painting; its container re-derives without it (SPEC §7).
 *
 * @attribute {string} source - The data source for this subtree,
 * nearest-ancestor-wins (SPEC §4.5).
 */
@customElement(HDVL_TAG_NAMES.STACK)
export class HdmlStackElement extends HdvlElement {
  public readonly tag = HDVL_TAG_NAMES.STACK;

  public readonly family = HDVL_FAMILIES[HDVL_TAG_NAMES.STACK];

  /**
   * @internal
   */
  @property({ type: String })
  [STACK_ATTRS_LIST.X]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [STACK_ATTRS_LIST.Y]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [STACK_ATTRS_LIST.OFFSET]: null | string = null;

  /**
   * SPEC's `hidden` collides with `HTMLElement.hidden`, which is a
   * platform **boolean** IDL attribute. Declaring a `null | string`
   * field of that name would shadow it and does not type-check.
   * The observed attribute is still `hidden` — named through the
   * `attribute` option — so `observedAttributes` and the
   * invalidation funnel are exactly as SPEC §7 specifies, and the
   * platform's own property is left alone rather than overwritten.
   * Whether HDVL's `hidden` *is* the platform's is a semantic
   * question the slice that implements it decides.
   *
   * @internal
   */
  @property({
    type: String,
    attribute: STACK_ATTRS_LIST.HIDDEN,
  })
  public hiddenAttr: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [STACK_ATTRS_LIST.SOURCE]: null | string = null;

  /**
   * §7.2's request path — the **shared** channel is the container's
   * subscription, because V6 makes it the container's binding.
   *
   * @returns The bindings this element currently wants.
   */
  public bindings(): readonly Binding[] {
    return markBindings(this, SLOTS);
  }

  /**
   * @override
   *
   * §6.4: a layout container emits **no nodes of its own** — it
   * re-parameterises its children, and the ranged form is the
   * primitive it compiles into. The `null` is permanent; what
   * changed at step 29 is that the call now *does* something, and
   * everything it does is to what its children emit.
   *
   * **It runs before them**, because `resolve.ts` lists a view's
   * elements in document order and `schedule.ts` walks that list —
   * so the overrides a child reads are always this frame's.
   *
   * @param ctx - The frame's snapshot.
   * @returns `null`, always.
   */
  public scene(ctx: FrameContext): SceneGroup | null {
    restack(this, ctx);
    return null;
  }
}
