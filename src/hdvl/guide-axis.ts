/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `hdml-axis` element (RFC 016/001 §2.2).
 *
 * @module hdvl/guide-axis
 */

import { customElement, property } from "lit/decorators.js";
import { HdvlElement } from "./base";
import type { FrameContext } from "./measure";
import type { SceneGroup } from "./scene";
import { paintSuppressed } from "./subscribe";
import { strokePaint } from "./mark";
import {
  guideEdge,
  guideGroup,
  guideLine,
  guidePoint,
  resolveGuide,
} from "./guide-spec";
import {
  AXIS_ATTRS_LIST,
  HDVL_FAMILIES,
  HDVL_TAG_NAMES,
} from "./vocabulary";

/**
 * One line spanning the whole range of a **positional** channel
 * (V20). Like every guide it binds no columns and takes no
 * `source`: it is a function of the resolved scale, its own box
 * and its computed style.
 *
 * **What it spans is the scale's `range()`, not its own box** —
 * §4.3 gives a positional scale a range taken from *that scale's*
 * content box, which is the same rule `hdml-rule` already follows.
 * **Where it sits across that span is its own box**: the edge
 * nearest the scale, derived from the two measured boxes by
 * `guide-spec.ts` because SPEC §7 leaves placement to CSS and gives
 * the tag no `position` attribute. Move it with one rule and the
 * line moves with it.
 *
 * **It publishes `channel` and nothing else.** §6.5 is explicit —
 * *"takes no `count`/`step`/`values`"* — so the whole-range span is
 * not a default it could be talked out of; there is no attribute
 * with which to ask for anything narrower. `AXIS_ATTRS_LIST` has
 * one member, which is that sentence enforced by the vocabulary,
 * and **V16** — live since step 24 — adds the diagnostic for an
 * author who writes one anyway. It reports; it does not blank, so
 * this element's scene is unmoved by one (§8.3).
 *
 * @tagname hdml-axis
 *
 * @attribute {string} channel - The channel this element addresses
 * (SPEC §3).
 */
@customElement(HDVL_TAG_NAMES.AXIS)
export class HdmlAxisElement extends HdvlElement {
  public readonly tag = HDVL_TAG_NAMES.AXIS;

  public readonly family = HDVL_FAMILIES[HDVL_TAG_NAMES.AXIS];

  /**
   * @internal
   */
  @property({ type: String })
  [AXIS_ATTRS_LIST.CHANNEL]: null | string = null;

  /**
   * @override
   *
   * One stroked `path` over the whole of its channel's range.
   *
   * @param ctx - The frame's snapshot.
   * @returns Its group, or `null`.
   */
  public scene(ctx: FrameContext): SceneGroup | null {
    // §3.4's painting clause names axes in its own words: until the
    // view has resolved once, a chart that reveals its axes and
    // then its bars is worse than one that appears whole.
    if (paintSuppressed(this)) {
      return null;
    }
    const guide = resolveGuide(ctx, this);
    if (guide === null) {
      return null;
    }
    const span = guide.scale.range();
    if (span === null) {
      return null;
    }
    const at = guideEdge(guide);
    const paint = strokePaint(guide.measured, null);
    const node = guideLine(
      guidePoint(guide, span[0], at),
      guidePoint(guide, span[1], at),
      paint,
    );
    return guideGroup(this, guide.measured, [node]);
  }
}
