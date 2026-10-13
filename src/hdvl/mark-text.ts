/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `hdml-text` element — **019 item 5, the seventh mark**
 * (Note 003 §7, D9, D9a).
 *
 * @module hdvl/mark-text
 */

import { customElement, property } from "lit/decorators.js";
import { HdvlElement } from "./base";
import type { FrameContext, Measured } from "./measure";
import type { SceneGroup, SceneNode } from "./scene";
import type { Binding, CellValue, Slot } from "./subscribe";
import type { SlotValues } from "./mark";
import { paintSuppressed } from "./subscribe";
import {
  channelColor,
  channelStates,
  datumOf,
  fillPaint,
  markBindings,
  markGroup,
  newTally,
  projectionOf,
  rangedValuesOf,
  reportDrops,
  rowCountOf,
  slotKindOf,
  slotValuesOf,
  tallyDrop,
} from "./mark";
import { cssAngle, localeOf } from "./scale";
import { formatValue } from "./kernel/format-skeleton";
import type { TextFormat } from "./guide-label";
import { authoredAnchor, textsOf } from "./guide-label";
import {
  HDVL_FAMILIES,
  HDVL_TAG_NAMES,
  TEXT_ATTRS_LIST,
} from "./vocabulary";

/**
 * Every slot this element can bind, for §7.2's request path.
 *
 * ★ **Six, and one of them is not a channel.** `x`/`y` cartesian,
 * `angle`/`radius` polar and `color` are the point-like five;
 * **`text`** is D9's new kind of binding — the printed column, which
 * needs no scale and contributes no required channel to V1 because
 * `validate.ts`'s `CHANNEL_ATTRS` table does not carry it (Note 003
 * §2.2). There is deliberately **no `size`**: a run's size is
 * `--hdml-font-size`, a registered property, not a channel.
 */
const SLOTS: readonly Slot[] = [
  TEXT_ATTRS_LIST.X,
  TEXT_ATTRS_LIST.Y,
  TEXT_ATTRS_LIST.ANGLE,
  TEXT_ATTRS_LIST.RADIUS,
  TEXT_ATTRS_LIST.COLOR,
  TEXT_ATTRS_LIST.TEXT,
];

/** A signed zero is not `deepEqual` to zero (plan rule 9). */
function num(v: number): number {
  return v === 0 ? 0 : v;
}

/**
 * ★ The **scale-less** half of §4.9's dispatch (Note 003 §2.3).
 *
 * `hdml-label` and `hdml-legend` hand `textsOf` their scale's own
 * `format`, because only the scale knows its `timeZone`. A text
 * mark has no scale at all, so it supplies the same function over
 * the **delivered column's** own zone hint — `slotKindOf`'s, read
 * off D9's `ColumnType` — and `formatValue` is the identical kernel
 * entry point `Scale.format` reaches through. Nothing here formats
 * a number itself.
 *
 * ⚠ **`hdml-text` is `--hdml-text-format`'s THIRD reader**, and the
 * property is registered `inherits: false` (RFC 019/001 §6.2, A1),
 * so a page-wide skeleton needs a selector naming all three:
 * `hdml-label, hdml-legend, hdml-text { --hdml-text-format: … }`.
 *
 * @param el - The mark.
 * @param m - Its measured snapshot.
 * @param zone - The bound column's IANA zone hint, or `null`.
 * @returns Its formatting context.
 */
function columnTextFormat(
  el: HdvlElement,
  m: Measured,
  zone: string | null,
): TextFormat {
  const locale = localeOf(el);
  return {
    skeleton: (m.props.get("--hdml-text-format") ?? "").trim(),
    locale,
    value: (v: CellValue, skeleton: string): string => {
      const n = typeof v === "number" ? v : Number(v);
      return typeof v === "string" || !Number.isFinite(n)
        ? String(v)
        : formatValue(n, skeleton, locale, zone);
    },
  };
}

/**
 * The printed strings, one per row, formatted over the **set**.
 *
 * ★ **The set is what §4.9 quantifies over**, so this cannot be a
 * per-row call: a continuous column formatted value by value emits
 * `900K, 1.2M, 1.5M` across one chart, which is the output §4.9
 * exists to prevent. `textsOf` is `hdml-label`'s, shared (R12).
 *
 * A **missing** value contributes nothing to the set and gets no
 * string — its row drops, as any bound slot's missing value does
 * (§4.7) — so the compact prefix is chosen from the values actually
 * printed and not from a `NaN` standing in for an absent one.
 *
 * @param el - The mark.
 * @param m - Its measured snapshot.
 * @param text - The `text` slot's values.
 * @param rows - The widget's N.
 * @returns Row index → its run, missing rows absent.
 */
function runsOf(
  el: HdvlElement,
  m: Measured,
  text: SlotValues,
  rows: number,
): Map<number, string> {
  const at: number[] = [];
  const values: CellValue[] = [];
  for (let i = 0; i < rows; i++) {
    const v = text.at(i);
    if (v !== null) {
      at.push(i);
      values.push(v);
    }
  }
  const { kind, zone } = slotKindOf(
    el,
    TEXT_ATTRS_LIST.TEXT,
    values.length === 0 ? null : values[0],
  );
  const out = new Map<number, string>();
  const texts = textsOf(
    kind,
    columnTextFormat(el, m, zone),
    <readonly (number | string)[]>values,
  );
  for (let k = 0; k < at.length; k++) {
    out.set(at[k], texts[k]);
  }
  return out;
}

/**
 * One formatted text run per row, at that row's projected position
 * (Note 003 §7).
 *
 * **It is positioned like an `hdml-point`** — both plane forms, read
 * off `Projection.channels` so the element names no channel (H7) —
 * and **painted like an `hdml-label`**: a `text` node carrying its
 * own `anchor`, `baseline`, `font` and `rotate`, which the renderer
 * places. It therefore adds **no registered property, no V-rule and
 * no `DiagnosticCode`** (Note 003 §7.3, §7.4); the whole
 * `--hdml-text-*` family is reused as 017 R2 named it to be.
 *
 * **Its `anchor` default is `middle`/`middle`, not a derivation.**
 * `hdml-label` derives an anchor from the outward normal of the
 * guide it hangs off; a mark hangs off nothing — its datum *is* the
 * point — so the run is centred on it, which is the same answer 017
 * R2's step 10-3 gave every cartesian label. `--hdml-text-anchor`
 * reaches past it through `authoredAnchor`, the guide half's reader,
 * shared rather than copied. The **baseline** is never authored,
 * exactly as on a label: R2 has a property for one dimension only.
 *
 * **`text` is REQUIRED** — V19, through its existing
 * `missing-binding` code and **no new one** (step 42's decision; row
 * 44 owns the 25th). A text mark that prints nothing is a no-op with
 * a box, and V19's shape is *"a missing required binding is an error
 * naming the slot, never an implicit index"*.
 *
 * **Its reach is standalone only** (D9a, founder's call): a sibling
 * text at the same binding lands on a **simple** bar's top, and
 * *inside* a stacked child's box, because a container's derived
 * endpoints are internal by design. V17 already forbids it as a
 * stack or cluster child, so the limit needs no rule of its own —
 * it is enforced structurally, and the nested form is a named
 * successor.
 *
 * @tagname hdml-text
 *
 * @attribute {string} x - The column bound to the `x` channel (SPEC
 * §5).
 *
 * @attribute {string} y - The column bound to the `y` channel (SPEC
 * §5).
 *
 * @attribute {string} angle - The column bound to the `angle` channel
 * (SPEC §3).
 *
 * @attribute {string} radius - The column bound to the `radius`
 * channel (SPEC §3).
 *
 * @attribute {string} color - The column bound to the `color` channel
 * (SPEC §3).
 *
 * @attribute {string} text - The column whose values are printed —
 * D9's new kind of binding, which resolves no scale (Note 003 §2.2).
 *
 * @attribute {string} source - The data source for this subtree,
 * nearest-ancestor-wins (SPEC §4.5).
 *
 * @attribute {string} initial-x - A literal `x` to paint before the
 * subscription resolves (019 item 3).
 *
 * @attribute {string} initial-y - A literal `y` to paint before the
 * subscription resolves (019 item 3).
 *
 * @attribute {string} initial-angle - A literal `angle` to paint
 * before the subscription resolves (019 item 3).
 *
 * @attribute {string} initial-radius - A literal `radius` to paint
 * before the subscription resolves (019 item 3).
 *
 * @attribute {string} initial-color - A literal `color` to paint
 * before the subscription resolves (019 item 3).
 *
 * @attribute {string} initial-text - A literal `text` to paint before
 * the subscription resolves (019 item 3).
 */
@customElement(HDVL_TAG_NAMES.TEXT)
export class HdmlTextElement extends HdvlElement {
  public readonly tag = HDVL_TAG_NAMES.TEXT;

  public readonly family = HDVL_FAMILIES[HDVL_TAG_NAMES.TEXT];

  /**
   * @internal
   */
  @property({ type: String })
  [TEXT_ATTRS_LIST.X]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [TEXT_ATTRS_LIST.Y]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [TEXT_ATTRS_LIST.ANGLE]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [TEXT_ATTRS_LIST.RADIUS]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [TEXT_ATTRS_LIST.COLOR]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [TEXT_ATTRS_LIST.TEXT]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [TEXT_ATTRS_LIST.SOURCE]: null | string = null;

  /**
   * 019 item 3's literals — declared here, **read by row 44**.
   *
   * @internal
   */
  @property({ type: String })
  [TEXT_ATTRS_LIST.INITIAL_X]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [TEXT_ATTRS_LIST.INITIAL_Y]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [TEXT_ATTRS_LIST.INITIAL_ANGLE]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [TEXT_ATTRS_LIST.INITIAL_RADIUS]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [TEXT_ATTRS_LIST.INITIAL_COLOR]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [TEXT_ATTRS_LIST.INITIAL_TEXT]: null | string = null;

  /**
   * §7.2's request path — one subscription per column-bound slot,
   * `text` among them.
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
   * One `text` node per row, pinned at the projected datum.
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
    const text = slotValuesOf(this, TEXT_ATTRS_LIST.TEXT);
    if (text === null) {
      // V19 reports it; a mark with nothing to print paints
      // nothing rather than painting a box of empty runs.
      return null;
    }
    const [first, second] = projection.channels;
    // ★ H8, exactly as `hdml-point` reads it — both positional
    // channels come back as (low, high) pairs and a run reads the
    // HIGH end, which for the simple form the author writes is that
    // attribute. `hdml-text` publishes no ranged spelling at all,
    // so the resolver always desugars; going through it anyway is
    // what keeps the simple form from being a second code path.
    const a = rangedValuesOf(this, first);
    const b = rangedValuesOf(this, second);
    if (a === null || b === null) {
      return null;
    }
    const rows = rowCountOf([a.high, b.high, text]);
    const tally = newTally();
    const m = ctx.measured(this);
    const runs = runsOf(this, m, text, rows);
    // ★ Read ONCE for the widget, as `hdml-label` reads them for a
    // guide: an author states one angle and one anchor for a whole
    // mark, so reading them per row would re-read a constant N
    // times and invite the next reader to think they vary.
    const rotate = cssAngle(m.props.get("--hdml-text-rotate"), 0);
    const anchor = authoredAnchor(m.props.get("--hdml-text-anchor"));
    const nodes: SceneNode[] = [];
    for (let i = 0; i < rows; i++) {
      const u = a.high.at(i);
      const v = b.high.at(i);
      const point = projection.point(
        projection.at(first, u),
        projection.at(second, v),
      );
      const run = runs.get(i);
      if (point === null || run === undefined) {
        tally.dropped++;
        tallyDrop(tally, this, projection, first, u);
        tallyDrop(tally, this, projection, second, v);
        continue;
      }
      nodes.push({
        k: "text",
        // §2.5: a per-row node carries its own row index, and on
        // this mark it is a real one — unlike a label's `-1`.
        i,
        x: num(point.x),
        y: num(point.y),
        text: run,
        anchor: anchor ?? "middle",
        baseline: "middle",
        font: m.font,
        rotate,
        // Real text, selectable and copyable (§5.10) — a run that
        // prints a datum is what the reader is told, which is the
        // same reason `hdml-label`'s is not decorative.
        decorative: false,
        ...fillPaint(m, channelColor(ctx, this, i)),
        // R1: per row, beside the resolved fill.
        ...channelStates(ctx, this, i, "fill"),
      });
    }
    reportDrops(this, projection, tally, rows, nodes.length);
    return markGroup(this, m, nodes);
  }
}
