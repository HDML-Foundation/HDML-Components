/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `hdml-label` element (RFC 016/001 §2.2, §4.9, §6.5).
 *
 * @module hdvl/guide-label
 */

import { customElement, property } from "lit/decorators.js";
import { HdvlElement } from "./base";
import type { FrameContext, Measured } from "./measure";
import type { SceneGroup, SceneNode } from "./scene";
import type { Scale, Tick } from "./scale";
import type { ResolvedGuide } from "./guide-spec";
import { paintSuppressed } from "./subscribe";
import { fillPaint } from "./mark";
import { localeOf } from "./scale";
import { formatCompactSet } from "./kernel/format-skeleton";
import {
  guideEdge,
  guideGroup,
  guidePoint,
  resolveGuide,
  tickSpecOf,
} from "./guide-spec";
import {
  HDVL_FAMILIES,
  HDVL_TAG_NAMES,
  LABEL_ATTRS_LIST,
} from "./vocabulary";

/** Where one text run hangs relative to its own point. */
interface Placement {
  anchor: "start" | "middle" | "end";
  baseline: "top" | "middle" | "bottom";
}

/**
 * ★ §6.5's *"anchor and baseline derived from which edge of its own
 * box the scale's axis runs along"*.
 *
 * **This is a derivation and must stay one.** SPEC §7 gives the tag
 * no `position` attribute, so four cases keyed on the channel would
 * be the authored placement the spec forbids, merely spelled in
 * TypeScript — and would silently stop tracking a box that CSS
 * moved.
 *
 * Two facts settle it, and both are already computed.
 * {@link guideEdge} returns the perpendicular coordinate of the edge
 * of the guide's own box **nearest the scale**; the scale's own
 * content box says where the plot is. The text hangs off that edge
 * *away* from the plot, so the whole answer is the **sign of
 * `edge − centre`** on the perpendicular axis:
 *
 * - `edge` above the plot's centre — the guide sits on the high
 *   side — the text runs on toward higher coordinates: `top`
 *   baseline on a horizontal guide, `start` anchor on a vertical
 *   one.
 * - `edge` below it — the low side — the text runs toward lower
 *   coordinates: `bottom` / `end`.
 *
 * Along the guide's own axis the run is **centred** on its tick, so
 * the remaining field is `middle` either way. The four rows §6.5
 * needs fall out of that:
 *
 * | Guide | Sits | Edge | anchor | baseline |
 * |---|---|---|---|---|
 * | x-channel | below the plot | its top | `middle` | `top` |
 * | x-channel | above the plot | its bottom | `middle` | `bottom` |
 * | y-channel | left of the plot | its right | `end` | `middle` |
 * | y-channel | right of the plot | its left | `start` | `middle` |
 *
 * A guide whose box overlaps the scale's centre exactly resolves to
 * the high side, deterministically — the same tie-break
 * {@link guideEdge} takes, and for the same reason: one answer beats
 * two equal distances.
 *
 * @param guide - The resolved guide.
 * @param edge - The coordinate {@link guideEdge} returned.
 * @returns The anchor and baseline every run in the set shares.
 */
function placementOf(guide: ResolvedGuide, edge: number): Placement {
  // The PERPENDICULAR axis: a guide on the plane's first channel
  // runs horizontally, so what it hangs across is vertical.
  const box = guide.scaleBox;
  const centre = guide.first ? box.y + box.h / 2 : box.x + box.w / 2;
  const high = edge >= centre;
  return guide.first
    ? { anchor: "middle", baseline: high ? "top" : "bottom" }
    : { anchor: high ? "start" : "end", baseline: "middle" };
}

/**
 * ★ §4.9's formatting, over the label **set**.
 *
 * Four cases, of which three are already whole in Contract 2 and the
 * fourth is `kernel/format-skeleton.ts`'s (R12/R18 — a formatter has
 * one implementation and this module is not it):
 *
 * - **ordinal** — the domain strings, verbatim. SPEC §7 is explicit
 *   and {@link Scale.format} already returns `String(v)` there. Any
 *   `format` on such a channel is **V14**'s error as of step 24, so
 *   the skeleton reaching here is inert by contract rather than by
 *   accident.
 * - **datetime** — per value, and **only** {@link Scale.format} can
 *   do it: the scale's `timeZone` is private to `scale.ts`, and a
 *   `MMM` label over a zone-sensitive instant is a different month
 *   in `UTC` than in `America/New_York`.
 * - **continuous** — {@link formatCompactSet}, over the whole set.
 *
 * **★ There is no per-value compact entry point, and this must not
 * grow one.** SPEC §7 makes axis coherence a property of the label
 * *set*: a label formatting value by value emits `900K, 1.2M, 1.5M`
 * on one axis, which is the exact output §4.9 exists to prevent. The
 * set function is **total** — a skeleton with no compact stem
 * formats value by value, and one that maps to no bag at all
 * (including the empty string a label with no `format` carries)
 * falls through to the locale's default — so the continuous branch
 * calls it unconditionally and never reaches past it.
 *
 * The locale is resolved **once for the set**, from
 * {@link localeOf}, which is the same function {@link Scale.format}
 * resolves through — so a datetime label and a continuous one under
 * one view can never disagree about it.
 *
 * @param el - The label.
 * @param scale - The scale it labels.
 * @param ticks - The positions it will paint.
 * @returns One string per tick, in the same order.
 */
function textsOf(
  el: HdvlElement,
  scale: Scale,
  ticks: readonly Tick[],
): string[] {
  const raw = el.getAttribute(LABEL_ATTRS_LIST.FORMAT);
  const skeleton = (raw ?? "").trim();
  if (scale.kind !== "continuous") {
    return ticks.map((t) => scale.format(t.value, skeleton));
  }
  // A continuous ladder yields numbers by construction; the cast is
  // total rather than defensive, and `formatCompactSet` is total
  // over non-finite input anyway.
  const values = ticks.map((t) =>
    typeof t.value === "number" ? t.value : Number(t.value),
  );
  return formatCompactSet(values, skeleton, localeOf(el));
}

/**
 * A formatted text run repeated at scale positions. Its `format`
 * skeleton and a continuous legend's ramp values share **one**
 * implementation (step-plan H6). Binds no columns and takes no
 * `source`.
 *
 * **One `text` per tick** (§6.5), `decorative: false` — a label is
 * *what the reader is told*, which is why SPEC §7 split it from
 * `hdml-tick` in the first place rather than making text a third
 * `--hdml-tick-style` value. §5.10 keeps it real text for selection
 * and copying, and the renderer writes `aria-hidden` only on the
 * decorative half.
 *
 * Its `font` is transferred from the MEASURE snapshot, where the
 * `--hdml-font-*` family already resolved it, and its `i` is `-1`:
 * §2.5's `i` is a source row index and a tick position is not one.
 *
 * **It does not call `ctx.measureText`.** §5.3's seam is available
 * during COMPUTE and exists for *"`hdml-label` anchors and
 * `hdml-legend`'s entry flow"* — but a `text` node carries `anchor`
 * and `baseline` and the renderer does the placing, so a measured
 * width buys this element nothing. What needs one is **flow**:
 * `hdml-legend` at step 31 lays a swatch and its name out
 * sequentially and cannot advance without knowing how wide the name
 * is. Collision and overflow handling on a dense axis would need it
 * too, and §6.5 asks for neither.
 *
 * @tagname hdml-label
 *
 * @attribute {string} channel - The channel this element addresses
 * (SPEC §3).
 *
 * @attribute {string} count - How many positions to repeat at (SPEC
 * §7).
 *
 * @attribute {string} step - The interval between repeated positions
 * (SPEC §7).
 *
 * @attribute {string} values - An explicit list — the domain on a
 * scale, the positions to repeat at on a guide.
 *
 * @attribute {string} format - The format skeleton for the text runs
 * (SPEC §4.9).
 */
@customElement(HDVL_TAG_NAMES.LABEL)
export class HdmlLabelElement extends HdvlElement {
  public readonly tag = HDVL_TAG_NAMES.LABEL;

  public readonly family = HDVL_FAMILIES[HDVL_TAG_NAMES.LABEL];

  /**
   * @internal
   */
  @property({ type: String })
  [LABEL_ATTRS_LIST.CHANNEL]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [LABEL_ATTRS_LIST.COUNT]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [LABEL_ATTRS_LIST.STEP]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [LABEL_ATTRS_LIST.VALUES]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [LABEL_ATTRS_LIST.FORMAT]: null | string = null;

  /**
   * @override
   *
   * One formatted text run per tick, hung off the near edge of its
   * own box.
   *
   * @param ctx - The frame's snapshot.
   * @returns Its group, or `null`.
   */
  public scene(ctx: FrameContext): SceneGroup | null {
    if (paintSuppressed(this)) {
      return null;
    }
    const guide = resolveGuide(ctx, this);
    if (guide === null) {
      return null;
    }
    const m: Measured = guide.measured;
    const across = guideEdge(guide);
    const place = placementOf(guide, across);
    const ticks = guide.scale.ticks(tickSpecOf(this));
    const texts = textsOf(this, guide.scale, ticks);
    // A text run is FILLED — `--hdml-fill-color`, whose initial is
    // `currentColor`, so an unstyled label paints in the inherited
    // text colour and `00-minimal.html` needs no CSS at all.
    const paint = fillPaint(m, null);
    const nodes: SceneNode[] = [];
    for (let i = 0; i < ticks.length; i++) {
      const at = guidePoint(guide, ticks[i].at, across);
      nodes.push({
        k: "text",
        i: -1,
        x: at.x,
        y: at.y,
        text: texts[i],
        anchor: place.anchor,
        baseline: place.baseline,
        font: m.font,
        decorative: false,
        ...paint,
      });
    }
    return guideGroup(this, m, nodes);
  }
}
