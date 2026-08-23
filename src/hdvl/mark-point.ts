/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `hdml-point` element (RFC 016/001 §2.2, §4.3, §6.1, H8).
 *
 * @module hdvl/mark-point
 */

import { customElement, property } from "lit/decorators.js";
import { HdvlElement } from "./base";
import type { FrameContext, Measured } from "./measure";
import type { SceneGroup, SceneNode } from "./scene";
import type { Binding, Slot } from "./subscribe";
import type { Projection, SlotValues } from "./mark";
import { paintSuppressed } from "./subscribe";
import {
  CHANNEL_SLOTS,
  channelColor,
  datumOf,
  fillPaint,
  markBindings,
  markGroup,
  newTally,
  projectionOf,
  rangedValuesOf,
  reportDrops,
  rowCountOf,
  slotValuesOf,
  tallyDrop,
} from "./mark";
import {
  HDVL_FAMILIES,
  HDVL_TAG_NAMES,
  POINT_ATTRS_LIST,
} from "./vocabulary";

/**
 * Every slot this element can bind, for §7.2's request path.
 *
 * SPEC §7 gives it **both** plane forms — `x`,`y` cartesian and
 * `angle`,`radius` polar — plus the two visual channels, and it is
 * the only tag in the vocabulary that publishes `size`.
 */
const SLOTS: readonly Slot[] = [
  POINT_ATTRS_LIST.X,
  POINT_ATTRS_LIST.Y,
  POINT_ATTRS_LIST.ANGLE,
  POINT_ATTRS_LIST.RADIUS,
  POINT_ATTRS_LIST.COLOR,
  POINT_ATTRS_LIST.SIZE,
];

/** `--hdml-tick-style`'s other value; its initial is `rect`. */
const ELLIPSE = "ellipse";

/** A signed zero is not `deepEqual` to zero (plan rule 9). */
function num(v: number): number {
  return v === 0 ? 0 : v;
}

/** A registered `<length>` computed value, in CSS px. */
function cssNumber(
  raw: undefined | string,
  fallback: number,
): number {
  const n = Number.parseFloat((raw ?? "").trim());
  return Number.isFinite(n) ? n : fallback;
}

/** One glyph's extent, in CSS px — a width and a height. */
interface Extent {
  w: number;
  h: number;
}

/**
 * §6.1's *"extent from `--hdml-tick-width/-height`, or from the
 * `size` channel when bound"*.
 *
 * **Both forms are DIAMETERS**, so an `ellipse` takes half of each.
 * `--hdml-tick-width` is a *width*, and reading it as a radius would
 * draw every glyph at twice its declared size — 05-scatter's
 * `8px` dot would be 16 across. `--hdml-size-min`'s `2px` initial
 * reads the same way: a 2 px dot, not a 4 px one.
 *
 * **A bound `size` supplies both extents, so the glyph is a
 * circle**, and `--hdml-tick-width/-height` are ignored. The channel
 * is *one* number and there is no second one to keep an authored
 * aspect ratio against; 06-bubble — the corpus's only `size` user —
 * declares neither tick property and asks for area ∝ value, which a
 * circle of that diameter through a `sqrt` scale is exactly.
 *
 * **The ramp is the SCALE's** (R12, §4.3): `--hdml-size-min` and
 * `--hdml-size-max` are the `size` channel's *range*, read once in
 * `scale.ts` from the **size scale's** own measured snapshot, so
 * this asks `projection.at("size", v)` and interpolates nothing.
 *
 * @param m - The widget's measured snapshot.
 * @param projection - Its projection.
 * @param size - The `size` slot's values, or `null` when unbound.
 * @param row - The row being sized.
 * @returns The extent, or `null` when a bound `size` does not
 * resolve — which drops the row, as any bound channel does.
 */
function extentOf(
  m: Measured,
  projection: Projection,
  size: SlotValues | null,
  row: number,
): Extent | null {
  if (size === null) {
    return {
      w: cssNumber(m.props.get("--hdml-tick-width"), 1),
      h: cssNumber(m.props.get("--hdml-tick-height"), 6),
    };
  }
  const at = projection.at("size", size.at(row));
  return at === null ? null : { w: at, h: at };
}

/**
 * One glyph per row, shaped by `--hdml-tick-style` and sized by
 * the `size` channel between `--hdml-size-min` and
 * `--hdml-size-max`.
 *
 * **`--hdml-tick-style`'s registered initial is `rect`** — SPEC §9's
 * registry table and `properties.ts` agree — so an unstyled page
 * gets squares and every corpus page that wants dots says
 * `--hdml-tick-style: ellipse` explicitly. §6.1's *"one `ellipse`
 * per row; `--hdml-tick-style: rect` emits `rect` instead"* is
 * naming the two forms, not the default.
 *
 * Both forms are centred on the projected point and share one
 * extent, so switching the property moves nothing.
 *
 * **It is filled and does not stroke** (see
 * {@link import("./mark").fillPaint}), and its `color` may vary per
 * row: it emits one node per row, so `validate.ts`'s
 * `varying-path-color` rule — which is `hdml-line`/`hdml-area`'s
 * alone — deliberately excludes it.
 *
 * @tagname hdml-point
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
 * @attribute {string} size - The column bound to the `size` channel
 * (SPEC §3).
 *
 * @attribute {string} source - The data source for this subtree,
 * nearest-ancestor-wins (SPEC §4.5).
 */
@customElement(HDVL_TAG_NAMES.POINT)
export class HdmlPointElement extends HdvlElement {
  public readonly tag = HDVL_TAG_NAMES.POINT;

  public readonly family = HDVL_FAMILIES[HDVL_TAG_NAMES.POINT];

  /**
   * @internal
   */
  @property({ type: String })
  [POINT_ATTRS_LIST.X]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [POINT_ATTRS_LIST.Y]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [POINT_ATTRS_LIST.ANGLE]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [POINT_ATTRS_LIST.RADIUS]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [POINT_ATTRS_LIST.COLOR]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [POINT_ATTRS_LIST.SIZE]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [POINT_ATTRS_LIST.SOURCE]: null | string = null;

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
   * One `ellipse` — or one `rect` — per row, centred on the
   * projected point.
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
    // ★ H8 — both positional channels come back as (low, high)
    // pairs, and a point reads the HIGH end, which for the simple
    // form the author writes (`x="units"`) is exactly that
    // attribute. No simple slot is named here; `size` is the one
    // exception, and it has no ranged spelling to resolve.
    const a = rangedValuesOf(this, first);
    const b = rangedValuesOf(this, second);
    if (a === null || b === null) {
      return null;
    }
    const size = slotValuesOf(this, CHANNEL_SLOTS.size.simple);
    const rows = rowCountOf([a.high, b.high, size]);
    const tally = newTally();
    const m = ctx.measured(this);
    const style = (m.props.get("--hdml-tick-style") ?? "").trim();
    const nodes: SceneNode[] = [];
    for (let i = 0; i < rows; i++) {
      const u = a.high.at(i);
      const v = b.high.at(i);
      const point = projection.point(
        projection.at(first, u),
        projection.at(second, v),
      );
      const extent = extentOf(m, projection, size, i);
      if (point === null || extent === null) {
        tally.dropped++;
        tallyDrop(tally, this, projection, first, u);
        tallyDrop(tally, this, projection, second, v);
        continue;
      }
      const paint = fillPaint(m, channelColor(ctx, this, i));
      nodes.push(
        style === ELLIPSE
          ? {
              k: "ellipse",
              // §2.5: a per-row node carries its own row index.
              i,
              cx: num(point.x),
              cy: num(point.y),
              rx: num(extent.w / 2),
              ry: num(extent.h / 2),
              ...paint,
            }
          : {
              k: "rect",
              i,
              x: num(point.x - extent.w / 2),
              y: num(point.y - extent.h / 2),
              w: num(extent.w),
              h: num(extent.h),
              ...paint,
            },
      );
    }
    reportDrops(this, projection, tally, rows, nodes.length);
    return markGroup(this, m, nodes);
  }
}
