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
import { paintSuppressed } from "./subscribe";
import { fillPaint } from "./mark";
import { cssAngle, localeOf } from "./scale";
import { formatCompactSet } from "./kernel/format-skeleton";
import type { Placement } from "./guide-spec";
import {
  atPole,
  guideAcross,
  guideGroup,
  guidePlacement,
  guidePoint,
  resolveGuide,
  tickSpecOf,
} from "./guide-spec";
import {
  HDVL_FAMILIES,
  HDVL_TAG_NAMES,
  LABEL_ATTRS_LIST,
} from "./vocabulary";

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
 * **★ Exported at step 31, for its second caller.** SPEC §7: *"the
 * shared compact prefix applies to a continuous legend's value set
 * exactly as to a label set"* — the same sentence, about the same
 * three cases, so `hdml-legend`'s ramp calls this rather than
 * carrying a fourth copy of §4.9's dispatch (R12/R18). It reads the
 * `format` attribute by name, and the legend publishes the same
 * name, so nothing about it is label-specific.
 *
 * @param el - The label, or the legend.
 * @param scale - The scale it labels.
 * @param ticks - The positions it will paint.
 * @returns One string per tick, in the same order.
 */
export function textsOf(
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
 * ★ 017 R2's **author override** of the run's anchor —
 * `--hdml-text-anchor`, resolved once for the guide.
 *
 * `null` means *"the author said nothing"*, and that is what the
 * registered initial `auto` is for: a registered property **always**
 * computes to its initial, so `props.get` can never come back
 * undefined and absence has to be spelled as a value. Without a
 * fourth keyword an initial of `middle` would be indistinguishable
 * from an authored one and would flatten every **polar** ring to
 * `middle` the moment the property was registered — see
 * `properties.ts` for the whole argument.
 *
 * ★ **The override is the author's on BOTH planes, deliberately.**
 * It does not ask which plane it is under and there is nothing here
 * to ask with. Three reasons, and the first is the binding one:
 * `--hdml-text-rotate` is one angle for a whole ring too, and a
 * pair that ships together and pivots about the same point cannot
 * have one half plane-sensitive and the other not. A property
 * silently ignored on a plane would need a **W7** to be honest, and
 * 017 declined a seventh warning code twice already. And both
 * properties **inherit**, so a view-level declaration aimed at
 * cartesian labels would warn from a polar label the author never
 * addressed.
 *
 * The cost, stated rather than discovered: one anchor over a ring is
 * lopsided — `start` runs the text inward at 9 o'clock. That is the
 * author's instruction and it is **visible**, which is the kind of
 * wrong this project's visual gate exists to catch. `auto` remains
 * the way back to the per-tick derivation, and `middle` now means
 * something on a ring that `auto` never did: centre every run.
 *
 * @param raw - The computed value off the MEASURE snapshot.
 * @returns The author's anchor, or `null` for the derivation.
 */
function authoredAnchor(
  raw: undefined | string,
): null | Placement["anchor"] {
  switch ((raw ?? "").trim()) {
    case "start":
      return "start";
    case "middle":
      return "middle";
    case "end":
      return "end";
    // `auto`, and — unreachably — anything else: the registered
    // enum is closed, so a typo is invalid at computed-value time
    // and the platform substitutes `auto` before this ever sees it
    // (trap 11's shape). Written for the reader, not as a branch.
    default:
      return null;
  }
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
 * **Its baseline is `guide-spec.ts`'s, and so is its anchor until
 * the author says otherwise.** The derivation lives there — one
 * predicate over both planes, the per-axis sign of the outward
 * normal, which since 017 R2 is the polar half alone. This file used
 * to own the cartesian case; step 27 moved it up rather than adding a
 * second one beside it, because a polar label asks the identical
 * question of a vector that turns.
 *
 * **Two registered properties reach past it** (017 R2, step 10-4):
 * `--hdml-text-anchor` replaces the derived **anchor**, and
 * `--hdml-text-rotate` supplies an angle the derivation never had an
 * opinion about. They are read **here**, at the call site, and not in
 * `guide-spec.ts`: that module reads no `--hdml-*` at all, every
 * property in the guide half is read by the element that consumes it,
 * and keeping the override out of `guidePlacement` is what lets its
 * *"this is a derivation and must stay one"* warning go on meaning
 * only the derivation. Rotation would have had no home there anyway —
 * it is not placement — and splitting the pair across two modules to
 * put the anchor there would cost more than it buys.
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
    const across = guideAcross(guide);
    const ticks = guide.scale.ticks(tickSpecOf(this));
    const texts = textsOf(this, guide.scale, ticks);
    // A text run is FILLED — `--hdml-fill-color`, whose initial is
    // `currentColor`, so an unstyled label paints in the inherited
    // text colour and `00-minimal.html` needs no CSS at all.
    const paint = fillPaint(m, null);
    // ★ 017 R2's two properties, read ONCE for the guide. Neither is
    // per tick: an author states one angle and one anchor for the
    // whole run set, so reading them inside the loop would re-read a
    // constant `ticks.length` times and invite the next reader to
    // think they vary. `guidePlacement` below is the opposite case
    // and says why it is.
    const rotate = cssAngle(m.props.get("--hdml-text-rotate"), 0);
    const anchor = authoredAnchor(m.props.get("--hdml-text-anchor"));
    const nodes: SceneNode[] = [];
    for (let i = 0; i < ticks.length; i++) {
      // ★ 017 R11's cause 2, the label half. A run at the pole has
      // no outward normal to hang off — `guidePlacement` already
      // says so, answering `middle`/`middle` — and it lands on the
      // one point every angle of the chart shares, under every mark
      // the page draws. `09-polar-area`'s `0B` was painting there.
      // The text set is still formatted over ALL the ticks (§4.9's
      // coherence is a property of the set, and dropping a member
      // before `textsOf` could change the shared compact prefix),
      // so this skips the NODE and not the value.
      if (atPole(guide, ticks[i].at)) {
        continue;
      }
      const at = guidePoint(guide, ticks[i].at, across);
      // ★ PER TICK, not once for the set. Under a plane composing
      // in view space every run answers the same — R2 centres it
      // on its tick — and under one composing about a pole it
      // turns with the ring, which is the only difference left
      // between them. Hoisting the flat answer out of the loop
      // would case on the plane here, which is the derivation
      // `guidePlacement` exists to keep in one place.
      const place = guidePlacement(guide, at);
      nodes.push({
        k: "text",
        i: -1,
        x: at.x,
        y: at.y,
        text: texts[i],
        // ★ The author's anchor beats the derivation, and the
        // BASELINE is never authored — `--hdml-text-anchor` moves
        // the pinned point **along** the run, which is one
        // dimension, and R2 has no property for the other. On a
        // polar label that means the anchor stops turning while the
        // baseline still does; on a cartesian one the derivation is
        // `middle` either way.
        anchor: anchor ?? place.anchor,
        baseline: place.baseline,
        font: m.font,
        // 017 R2's angle, in degrees, about this run's own anchor
        // point. `0deg` is the registered initial, so an unstyled
        // label is unrotated exactly as it was before 10-4.
        rotate,
        decorative: false,
        ...paint,
      });
    }
    return guideGroup(this, m, nodes);
  }
}
