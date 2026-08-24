/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `hdml-rule` element (RFC 016/001 §2.2, §4.7, §6.1).
 *
 * @module hdvl/mark-rule
 */

import { customElement, property } from "lit/decorators.js";
import { HdvlElement } from "./base";
import type { FrameContext } from "./measure";
import type { Point, SceneGroup, SceneNode } from "./scene";
import type { Binding, Slot } from "./subscribe";
import type { Channel } from "./resolve";
import { paintSuppressed } from "./subscribe";
import {
  CHANNEL_SLOTS,
  datumOf,
  markBindings,
  markGroup,
  newTally,
  projectionOf,
  reportDrops,
  rowCountOf,
  slotValuesOf,
  strokePaint,
  tallyDrop,
} from "./mark";
import {
  HDVL_FAMILIES,
  HDVL_TAG_NAMES,
  RULE_ATTRS_LIST,
} from "./vocabulary";

/** Every slot this element can bind, for §7.2's request path. */
const SLOTS: readonly Slot[] = [RULE_ATTRS_LIST.X, RULE_ATTRS_LIST.Y];

/**
 * One range-spanning line per row, at a position on the single
 * channel it binds — the reference line every threshold chart
 * draws by hand.
 *
 * **It is the other half of §2.5's `i` contract.** `hdml-line`
 * emits one node for the whole series and carries row identity in
 * its vertices; a rule emits **one node per row**, so each one has
 * a real source row index and `NodeBase.i` is that index. The two
 * ship together because between them they exercise both readings of
 * one field.
 *
 * **What it spans is the other channel's `range()`, not its own
 * box.** §4.3 gives a positional scale a range taken from *that
 * scale's* content box, which is not the rule's box and need not
 * match it — a rule inside a padded scale spans the scale's range
 * and stops there.
 *
 * SPEC §7 gives it **no visual channel**: it publishes `x`, `y` and
 * `source` and nothing else, so a per-row colour cannot arise on it
 * and its paint is the three `--hdml-line-*` properties alone.
 *
 * @tagname hdml-rule
 *
 * @attribute {string} x - The column bound to the `x` channel (SPEC
 * §5).
 *
 * @attribute {string} y - The column bound to the `y` channel (SPEC
 * §5).
 *
 * @attribute {string} source - The data source for this subtree,
 * nearest-ancestor-wins (SPEC §4.5).
 */
@customElement(HDVL_TAG_NAMES.RULE)
export class HdmlRuleElement extends HdvlElement {
  public readonly tag = HDVL_TAG_NAMES.RULE;

  public readonly family = HDVL_FAMILIES[HDVL_TAG_NAMES.RULE];

  /**
   * @internal
   */
  @property({ type: String })
  [RULE_ATTRS_LIST.X]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [RULE_ATTRS_LIST.Y]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [RULE_ATTRS_LIST.SOURCE]: null | string = null;

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
   * One `path` per row, spanning the other channel's full range.
   *
   * @param ctx - The frame's snapshot.
   * @returns Its group, or `null`.
   */
  public scene(ctx: FrameContext): SceneGroup | null {
    if (paintSuppressed(this)) {
      return null;
    }
    const projection = projectionOf(ctx, this);
    if (projection === null) {
      return null;
    }
    const [first, second] = projection.channels;
    const a = slotValuesOf(this, CHANNEL_SLOTS[first].simple);
    const b = slotValuesOf(this, CHANNEL_SLOTS[second].simple);
    // §6.1: "exactly one of x/y". Neither, or both, is V19's at
    // step 22; a rule that cannot say which axis it sits on has no
    // honest geometry to draw meanwhile.
    const bound: Channel | null =
      a !== null && b === null
        ? first
        : b !== null && a === null
        ? second
        : null;
    if (bound === null) {
      return null;
    }
    const values = bound === first ? a : b;
    const other = bound === first ? second : first;
    // The channel it did NOT bind must resolve a scale — the D1
    // escalation V1 now reports (see `validate.ts`). This is the
    // same condition, seen from the geometry's side.
    const span = projection.span(other);
    if (span === null || values === null) {
      return null;
    }
    const rows = rowCountOf([values]);
    const tally = newTally();
    const measured = ctx.measured(this);
    const paint = strokePaint(measured, null);
    const nodes: SceneNode[] = [];
    for (let i = 0; i < rows; i++) {
      const value = values.at(i);
      const at = projection.at(bound, value);
      if (at === null) {
        tally.dropped++;
        tallyDrop(tally, this, projection, bound, value);
        continue;
      }
      const ends = (along: number): Point | null =>
        bound === first
          ? projection.point(at, along)
          : projection.point(along, at);
      const from = ends(span[0]);
      const to = ends(span[1]);
      if (from === null || to === null) {
        tally.dropped++;
        continue;
      }
      nodes.push({
        k: "path",
        // §2.5: a per-row node carries its own source row index.
        i,
        subpaths: [{ start: from, segments: [{ k: "line", to }] }],
        closed: false,
        // A rule's data vertices are its two endpoints: the row's
        // one value fixes both, so a hit on either names row `i`.
        vertices: [
          { x: from.x, y: from.y, i },
          { x: to.x, y: to.y, i },
        ],
        ...paint,
      });
    }
    reportDrops(this, projection, tally, rows, nodes.length);
    return markGroup(this, measured, nodes);
  }
}
