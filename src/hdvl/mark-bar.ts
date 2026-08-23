/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `hdml-bar` element (RFC 016/001 §2.2, §4.4, §4.7, §6.1, H8).
 *
 * @module hdvl/mark-bar
 */

import { customElement, property } from "lit/decorators.js";
import { HdvlElement } from "./base";
import type { FrameContext } from "./measure";
import type { Rect, SceneGroup, SceneNode } from "./scene";
import type { Binding, Slot } from "./subscribe";
import type { Channel } from "./resolve";
import type { ScaleBand } from "./scale";
import type { Projection } from "./mark";
import { paintSuppressed } from "./subscribe";
import {
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
  tallyDrop,
} from "./mark";
import {
  BAR_ATTRS_LIST,
  HDVL_FAMILIES,
  HDVL_TAG_NAMES,
} from "./vocabulary";

/**
 * Every slot this element can bind, for §7.2's request path.
 *
 * §6.1's bar row is **cartesian-only** — `x` + (`y` | `y0`,`y1`) —
 * and the vocabulary shipped it that way at step 01: there is no
 * `angle`, no `radius` and no polar ranged pair on this tag.
 */
const SLOTS: readonly Slot[] = [
  BAR_ATTRS_LIST.X,
  BAR_ATTRS_LIST.X0,
  BAR_ATTRS_LIST.X1,
  BAR_ATTRS_LIST.Y,
  BAR_ATTRS_LIST.Y0,
  BAR_ATTRS_LIST.Y1,
  BAR_ATTRS_LIST.COLOR,
];

/** A signed zero is neither `Object.is`- nor `deepEqual`-equal to
 *  zero, and `Math.min(0, -0)` is `-0` (plan rule 9). */
function num(v: number): number {
  return v === 0 ? 0 : v;
}

/**
 * One row's rectangle: the band across, the projected range along.
 *
 * `{start, width}` is §4.4's **low-edge** convention, so the ordinal
 * extent is `[start, start + width]` whichever way the range runs
 * and nothing here normalises a signed one (H15). The other extent
 * is ordered rather than assumed, because §4.3 gives `y` a
 * bottom → top range that is *descending* in §2.7's view
 * coordinates: a bar's `y0` therefore projects **below** its `y1` on
 * a vertical chart and above it on a reversed one.
 *
 * @param projection - The widget's projection.
 * @param bandIsFirst - Whether the ordinal channel is the plane's
 * first, i.e. whether the bar stands up or lies down.
 * @param band - The ordinal side's band.
 * @param lo - One projected end of the continuous side.
 * @param hi - The other.
 * @returns The rect in view coordinates, or `null`.
 */
function rectOf(
  projection: Projection,
  bandIsFirst: boolean,
  band: ScaleBand,
  lo: number,
  hi: number,
): Rect | null {
  const b0 = band.start;
  const b1 = band.start + band.width;
  const a0 = Math.min(lo, hi);
  const a1 = Math.max(lo, hi);
  const p0 = bandIsFirst
    ? projection.point(b0, a0)
    : projection.point(a0, b0);
  const p1 = bandIsFirst
    ? projection.point(b1, a1)
    : projection.point(a1, b1);
  if (p0 === null || p1 === null) {
    return null;
  }
  return {
    x: num(Math.min(p0.x, p1.x)),
    y: num(Math.min(p0.y, p1.y)),
    w: num(Math.abs(p1.x - p0.x)),
    h: num(Math.abs(p1.y - p0.y)),
  };
}

/**
 * One band-filling rectangle per row (§6.1).
 *
 * **★ It is written against the RANGED form** (step-plan H8): every
 * channel is resolved through
 * {@link import("./mark").rangedValuesOf} into a `(low, high)` pair
 * before any geometry exists, and the simple form is sugar for
 * `y0="0"`. So `y="v"` and `y0="0" y1="v"` produce byte-identical
 * scenes, there is no `if (y0 !== null)` anywhere below the
 * resolver, and step 29's `hdml-stack` supplies a per-row `y0ₖ`
 * through that same seam without changing a line in here. A floating
 * bar and a stacked bar are one primitive, differently
 * parameterised.
 *
 * **★ Its orientation is DERIVED, never authored** (§6.1). There is
 * no orientation attribute on this tag and there must not be one:
 * the band-filling side is whichever channel resolves an **ordinal**
 * scale, so `x="cat" y="n"` stands the bars up and `x="n" y="cat"`
 * lays them down, from the same markup. If neither channel is
 * ordinal there is no band and therefore no bar, and the element
 * paints nothing rather than inventing a width.
 *
 * **★ It is the one widget that reads `bandOf().width`** (§4.4). A
 * bar *spans* `width_k`, centred by construction; every other lookup
 * in the project — line vertices, area vertices, points, rules,
 * ticks, labels, grids — resolves to `centre`, and *nothing ever
 * resolves to a band edge*.
 *
 * A per-row `color` is honest here, unlike on a path widget: this
 * emits one node per row and resolves each row's colour separately.
 * That is why `validate.ts`'s `varying-path-color` rule excludes it.
 *
 * @tagname hdml-bar
 *
 * @attribute {string} x - The column bound to the `x` channel (SPEC
 * §5).
 *
 * @attribute {string} x0 - The column bound to the ranged `x0`
 * endpoint (SPEC §6.4).
 *
 * @attribute {string} x1 - The column bound to the ranged `x1`
 * endpoint (SPEC §6.4).
 *
 * @attribute {string} y - The column bound to the `y` channel (SPEC
 * §5).
 *
 * @attribute {string} y0 - The column bound to the ranged `y0`
 * endpoint (SPEC §6.4).
 *
 * @attribute {string} y1 - The column bound to the ranged `y1`
 * endpoint (SPEC §6.4).
 *
 * @attribute {string} color - The column bound to the `color` channel
 * (SPEC §3).
 *
 * @attribute {string} hidden - Whether this element is withheld from
 * painting; its container re-derives without it (SPEC §7).
 *
 * @attribute {string} source - The data source for this subtree,
 * nearest-ancestor-wins (SPEC §4.5).
 */
@customElement(HDVL_TAG_NAMES.BAR)
export class HdmlBarElement extends HdvlElement {
  public readonly tag = HDVL_TAG_NAMES.BAR;

  public readonly family = HDVL_FAMILIES[HDVL_TAG_NAMES.BAR];

  /**
   * @internal
   */
  @property({ type: String })
  [BAR_ATTRS_LIST.X]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [BAR_ATTRS_LIST.X0]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [BAR_ATTRS_LIST.X1]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [BAR_ATTRS_LIST.Y]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [BAR_ATTRS_LIST.Y0]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [BAR_ATTRS_LIST.Y1]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [BAR_ATTRS_LIST.COLOR]: null | string = null;

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
    attribute: BAR_ATTRS_LIST.HIDDEN,
  })
  public hiddenAttr: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [BAR_ATTRS_LIST.SOURCE]: null | string = null;

  /**
   * §7.2's request path — one subscription per column-bound slot,
   * the ranged pair included.
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
   * One `rect` per row: the ordinal side spans `bandOf().width`, the
   * continuous side spans its resolved `(low, high)` pair.
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
    // §6.1: orientation is DERIVED from which channel is ordinal.
    // `first` is tried first, so a page whose both scales are
    // ordinal is deterministic rather than incidental; V17 makes
    // that composition an error at step 29.
    const band: Channel | null =
      projection.scale(first)?.kind === "ordinal"
        ? first
        : projection.scale(second)?.kind === "ordinal"
        ? second
        : null;
    if (band === null) {
      return null;
    }
    const along = band === first ? second : first;
    const scale = projection.scale(band);
    // ★ H8 — both channels come back as (low, high) pairs. The
    // ordinal side's category is the pair's HIGH end, which for the
    // sugar the author actually writes (`x="month"`) is exactly
    // that attribute; no simple slot is named in this file.
    const cats = rangedValuesOf(this, band);
    const span = rangedValuesOf(this, along);
    if (scale === null || cats === null || span === null) {
      return null;
    }
    const rows = rowCountOf([cats.high, span.low, span.high]);
    const tally = newTally();
    const measured = ctx.measured(this);
    const nodes: SceneNode[] = [];
    for (let i = 0; i < rows; i++) {
      const cat = cats.high.at(i);
      const low = span.low.at(i);
      const high = span.high.at(i);
      const slot = cat === null ? null : scale.bandOf(String(cat));
      const lo = projection.at(along, low);
      const hi = projection.at(along, high);
      if (slot === null || lo === null || hi === null) {
        tally.dropped++;
        tallyDrop(tally, this, projection, band, cat);
        tallyDrop(tally, this, projection, along, low);
        tallyDrop(tally, this, projection, along, high);
        continue;
      }
      const rect = rectOf(projection, band === first, slot, lo, hi);
      if (rect === null) {
        tally.dropped++;
        continue;
      }
      nodes.push({
        k: "rect",
        // §2.5: a per-row node carries its own source row index.
        i,
        ...rect,
        // A row whose two ends are equal is a REAL datum and gets a
        // zero-extent rect. §4.7's "absent, never zero" is the
        // opposite case — a value that is missing.
        ...fillPaint(measured, channelColor(ctx, this, i)),
      });
    }
    reportDrops(this, projection, tally, rows, nodes.length);
    return markGroup(this, measured, nodes);
  }
}
