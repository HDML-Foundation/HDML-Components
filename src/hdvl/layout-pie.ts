/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `hdml-pie` element (RFC 016/001 §2.2, §6.3, §12; SPEC §7).
 *
 * @module hdvl/layout-pie
 */

import { customElement, property } from "lit/decorators.js";
import { HdvlElement } from "./base";
import type { FrameContext } from "./measure";
import type { SceneGroup } from "./scene";
import type { Binding, CellValue, Slot } from "./subscribe";
import type { Channel } from "./resolve";
import type { Scale } from "./scale";
import type { Projection, SlotValues } from "./mark";
import type { AngleForm, Sector } from "./mark-arc";
import { sectorScene } from "./mark-arc";
import {
  CHANNEL_SLOTS,
  datumOf,
  markBindings,
  rowCountOf,
  slotValuesOf,
} from "./mark";
import { reportNegativePieValue } from "./validate";
import {
  HDVL_FAMILIES,
  HDVL_TAG_NAMES,
  PIE_ATTRS_LIST,
} from "./vocabulary";

/**
 * Every slot this element can bind, for §7.2's request path.
 *
 * **Two, and the absence of a third is the design.** SPEC §7 gives
 * the pie `angle` and `color` and no radial attribute at all, which
 * is what makes its radial extent always `sectorScene`'s third case
 * — the full range, floored by `--hdml-inner-radius`.
 */
const SLOTS: readonly Slot[] = [
  PIE_ATTRS_LIST.ANGLE,
  PIE_ATTRS_LIST.COLOR,
];

/** One row's share of the turn, as fractions of the total. */
interface Share {
  readonly a0: number;
  readonly a1: number;
}

/**
 * ★ §6.3's `derive()` — **the project's one cross-row computation
 * in data space**, run before any scale sees a number.
 *
 * ```
 * total = Σ non-null, non-negative values
 *   any value < 0  → V7 error (unit: the pie)
 *   null           → excluded from the total, no slice
 *   total === 0    → :state(empty), no slices
 * a0ₖ = (Σ_{j<k} vⱼ) / total       a1ₖ = a0ₖ + vₖ / total
 * ```
 *
 * **★ §12 duty 4.** The prefix sum allocates its **own** array. A
 * delivered column arrives as a typed-array *view* over a buffer
 * the worker still owns and other widgets still read, so it is
 * read here and never written — and the fixture asserts that
 * against the column itself rather than trusting this sentence.
 *
 * **★ `a1ₖ` is spelled `acc / total`, not `a0ₖ + vₖ / total`.** The
 * two are algebraically identical and only the first closes the
 * circle: `acc` after the last row is the same sum, accumulated in
 * the same order, that `total` is — so the final `a1` is exactly
 * `1`, and the last slice ends exactly on the angular range's end
 * rather than a float's width short of it. Summing the quotients
 * instead leaves a hairline the renderer draws.
 *
 * **A `null` costs nothing and takes nothing.** It contributes no
 * slice and no term, so the slice after it starts where the slice
 * before it ended and the remaining slices still close the turn —
 * SPEC's *"excluded from the total and produce no slice"* is one
 * statement, not two.
 *
 * @param values - The `angle` slot, as delivered.
 * @param rows - §5's N for this widget.
 * @returns One share per row, `null` for a row that has none; or
 * `null` for the whole widget when a value is negative, which is
 * V7's error and paints nothing.
 */
function derive(
  values: SlotValues,
  rows: number,
): readonly (Share | null)[] | null {
  const own = new Array<number | null>(rows);
  let total = 0;
  for (let k = 0; k < rows; k++) {
    const cell = values.at(k);
    const n = typeof cell === "number" ? cell : Number(cell);
    if (cell === null || !Number.isFinite(n)) {
      own[k] = null;
      continue;
    }
    if (n < 0) {
      return null;
    }
    own[k] = n;
    total += n;
  }
  const out = new Array<Share | null>(rows);
  if (total === 0) {
    // §3.4.1's empty state, not a divide by zero and not a full
    // ring: every row is `null`, so no slice is emitted and R34
    // decides `empty` over the mark nodes that were not.
    out.fill(null);
    return out;
  }
  let acc = 0;
  for (let k = 0; k < rows; k++) {
    const n = own[k];
    if (n === null) {
      out[k] = null;
      continue;
    }
    const a0 = acc / total;
    acc += n;
    out[k] = { a0, a1: acc / total };
  }
  return out;
}

/**
 * The pie's {@link AngleForm} — §6.3's derive behind the same
 * interface `hdml-arc`'s two forms sit behind.
 *
 * The negative-value case is reported **here**, from COMPUTE, and
 * returns `null` so the widget paints nothing: it is V7's error,
 * the unit blanks, and §1.5 makes a partly-drawn pie the worse of
 * the two available outcomes.
 *
 * The **first negative value wins** and is the one the message
 * names. R25's identity carries the message, so correcting one of
 * two negatives re-reports with the second rather than falling
 * silent — which is the honest sequence.
 *
 * @param el - The pie.
 * @param projection - Its projection.
 * @param _scale - The angle scale. Unread: fractions project
 * through `projection.at`, and §6.3 pins the domain to `[0, 1]`
 * from the page rather than from the scale's kind.
 * @param channel - The angle channel, from the plane.
 * @returns The form, or `null`.
 */
function pieAngles(
  el: HdvlElement,
  projection: Projection,
  _scale: Scale,
  channel: Channel,
): AngleForm | null {
  const values = slotValuesOf(el, CHANNEL_SLOTS[channel].simple);
  if (values === null) {
    // V19's error at step 22; a pie with no value column has no
    // slices to derive and paints nothing meanwhile.
    return null;
  }
  const rows = rowCountOf([values]);
  const shares = derive(values, rows);
  if (shares === null) {
    reportNegativePieValue(el, negativeOf(values, rows));
    return null;
  }
  return {
    slots: [values],
    cells: (k: number): readonly CellValue[] => [values.at(k)],
    at: (k: number): Sector | null => {
      const share = shares[k] ?? null;
      if (share === null) {
        return null;
      }
      const a0 = projection.at(channel, share.a0);
      const a1 = projection.at(channel, share.a1);
      return a0 === null || a1 === null ? null : [a0, a1];
    },
  };
}

/** The first negative value, for V7's message. */
function negativeOf(values: SlotValues, rows: number): number {
  for (let k = 0; k < rows; k++) {
    const cell = values.at(k);
    const n = typeof cell === "number" ? cell : Number(cell);
    if (cell !== null && Number.isFinite(n) && n < 0) {
      return n;
    }
  }
  return 0;
}

/**
 * A layout **widget**, not a container: it paints. One cross-row
 * {@link derive} in data space turns each row's `angle` value into
 * a sector extent before projection, and the sectors it emits are
 * ordinary marks — which is why its family is `mark`, and why a pie
 * of four zero rows counts as "produced no marks" for §3.4.1's
 * `empty` rather than being excluded from the question.
 *
 * **★ Its geometry is `hdml-arc`'s, to the node** (step 27). §6.3
 * calls it *"the same, with one cross-row `derive()` in data space
 * before projection"*, and that is implemented as exactly that
 * sentence: it hands {@link pieAngles} to
 * {@link import("./mark-arc").sectorScene} and inherits the pole,
 * the three radial cases, `--hdml-inner-radius`, §4.7's drop and
 * the `arc` node unchanged. SPEC's claim that 08-A's pie and 08-C's
 * `hdml-arc a0/a1` over the same numbers are interchangeable is
 * therefore a property of the code and not a promise about it —
 * and `arc.test.ts`'s fixture asserts the two scenes agree.
 *
 * **It normalises to FRACTIONS, so its angle scale is always
 * `min="0" max="1"`** — authored by the page, never derived here.
 * That is what makes the pure `a0`/`a1` form take the same domain,
 * and the corpus writes it on every pie.
 *
 * **Row order is slice order, and nothing sorts.** The duty to pin
 * it attaches to the **frame** — `hdml-sort-by` — and is **V7**'s,
 * reported where the validator can see the frame (a local `?` ref).
 *
 * `color` is optional; when bound it wins over `--hdml-fill-color`,
 * which is `fillPaint`'s ordinary rule and needs nothing here.
 *
 * @tagname hdml-pie
 *
 * @attribute {string} angle - The column bound to the `angle` channel
 * (SPEC §3).
 *
 * @attribute {string} color - The column bound to the `color` channel
 * (SPEC §3).
 *
 * @attribute {string} source - The data source for this subtree,
 * nearest-ancestor-wins (SPEC §4.5).
 */
@customElement(HDVL_TAG_NAMES.PIE)
export class HdmlPieElement extends HdvlElement {
  public readonly tag = HDVL_TAG_NAMES.PIE;

  public readonly family = HDVL_FAMILIES[HDVL_TAG_NAMES.PIE];

  /**
   * @internal
   */
  @property({ type: String })
  [PIE_ATTRS_LIST.ANGLE]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [PIE_ATTRS_LIST.COLOR]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [PIE_ATTRS_LIST.SOURCE]: null | string = null;

  /**
   * §7.2's request path — one subscription per column-bound slot.
   *
   * @returns The bindings this element currently wants.
   */
  public bindings(): readonly Binding[] {
    return markBindings(this, SLOTS);
  }

  /**
   * §5.7's `DatumSource` — the row a hit resolved.
   *
   * **The row, not the share.** A hit answers with what the author
   * bound, so a slice reports its own value and not the fraction
   * the derive made of it: §5.7 is about the datum, and the
   * fraction is machinery.
   *
   * @param index - The row index a hit named.
   * @returns The row, or `null`.
   */
  public datumAt(
    index: number,
  ): Readonly<Record<string, unknown>> | null {
    return datumOf(this, SLOTS, index);
  }

  /**
   * @override
   *
   * One `arc` per row, over derived cumulative fractions.
   *
   * @param ctx - The frame's snapshot.
   * @returns Its group, or `null`.
   */
  public scene(ctx: FrameContext): SceneGroup | null {
    return sectorScene(ctx, this, pieAngles);
  }
}
