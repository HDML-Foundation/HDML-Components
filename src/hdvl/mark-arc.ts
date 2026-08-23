/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `hdml-arc` element (RFC 016/001 §2.2, §2.5, §4.6, §6.1, H8).
 *
 * @module hdvl/mark-arc
 */

import { customElement, property } from "lit/decorators.js";
import { HdvlElement } from "./base";
import type { FrameContext, Measured } from "./measure";
import type { SceneGroup, SceneNode } from "./scene";
import type { Binding, Slot } from "./subscribe";
import type { Channel } from "./resolve";
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
  ARC_ATTRS_LIST,
  HDVL_FAMILIES,
  HDVL_TAG_NAMES,
} from "./vocabulary";

/**
 * Every slot this element can bind, for §7.2's request path.
 *
 * SPEC §7's arc row is **polar-only** — there is no `x`, no `y` and
 * no cartesian ranged pair on this tag, the mirror of `hdml-bar`
 * being cartesian-only.
 */
const SLOTS: readonly Slot[] = [
  ARC_ATTRS_LIST.A0,
  ARC_ATTRS_LIST.A1,
  ARC_ATTRS_LIST.ANGLE,
  ARC_ATTRS_LIST.RADIUS,
  ARC_ATTRS_LIST.R0,
  ARC_ATTRS_LIST.R1,
  ARC_ATTRS_LIST.COLOR,
];

/** The two channels this tag's attributes belong to (SPEC §7). */
const CHANNELS: readonly [Channel, Channel] = ["angle", "radius"];

/** A signed zero is not `deepEqual` to zero (plan rule 9). */
function num(v: number): number {
  return v === 0 ? 0 : v;
}

/**
 * `--hdml-inner-radius` as a radius in CSS px — §4.6's
 * **default-extent floor**.
 *
 * The property registers as a `<length-percentage>`, and a
 * registered `<length-percentage>` **computes to a percentage
 * unresolved** (there is no layout box for the UA to resolve it
 * against). So the two forms are separated here, and §4.6 says
 * which reference a percentage takes: *"a percentage in any radial
 * `<length-percentage>` resolves against that **ceiling**"* — the
 * radius range's `min(w, h) / 2`. Its `0%` initial therefore
 * resolves to `0` whatever the ceiling is, so an unstyled arc's two
 * branches agree.
 *
 * @param m - The widget's measured snapshot.
 * @param ceiling - The radius range's top, in CSS px.
 * @returns The floor, in CSS px.
 */
function innerRadiusOf(m: Measured, ceiling: number): number {
  const raw = (m.props.get("--hdml-inner-radius") ?? "").trim();
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return num(raw.endsWith("%") ? (n / 100) * ceiling : n);
}

/**
 * One annular sector per row, in a polar plane. It consumes the
 * plane's `Projection` like every other mark and carries no polar
 * branch of its own (step-plan H7): what it asks is whether the
 * plane projects **its** channels, and a plane that answers `x`/`y`
 * is one this tag has no attribute for, so it paints nothing there.
 *
 * **The node is parameterised, not pre-serialized** (§2.5): it
 * carries `{cx, cy, r0, r1, a0, a1}` and the SVG renderer owns the
 * annulus and the 360° two-command case. Angles are **degrees**,
 * `0` at 12 o'clock, increasing clockwise — so `a0`/`a1` are
 * `projection.at("angle", v)` **directly, with no conversion**; the
 * radians live inside `kernel/project-polar.ts` and the renderer.
 *
 * **Three radial cases, and the third is the arc's one real special
 * case** (§6.1, SPEC §7):
 *
 * | Bound | `r0` | `r1` |
 * |---|---|---|
 * | `r0` **and** `r1` | the author's | the author's |
 * | `radius` (sugar) | the floor, else 0 | the author's |
 * | nothing | the floor, else 0 | the range's ceiling |
 *
 * The third is what `rangedValuesOf` cannot express — it returns
 * `null` for an unbound channel — and it is what makes 08-C's pure
 * `a0`/`a1` form interchangeable with `hdml-pie`.
 *
 * **`--hdml-inner-radius` supplies the SYNTHETIC `r0` only.** §4.6:
 * *"it supplies `r0` where the author bound none. A bound
 * `r0`/`radius` may legally paint inside the hole — authored data is
 * sacred."* {@link import("./mark").RangedValues.sugar} is exactly
 * that predicate, and this is **the one place in the project it is
 * read**: not a geometry branch — the two branches compute the same
 * kind of number — but the question *did the author say anything
 * about the lower edge*, which is what the flag means.
 *
 * **The ordinal `angle` equal-slices form is step 26's**, with its
 * band-vs-step escalation; an arc under an ordinal angle scale
 * paints nothing meanwhile.
 *
 * @tagname hdml-arc
 *
 * @attribute {string} a0 - The column bound to the ranged `a0`
 * endpoint (SPEC §6.4).
 *
 * @attribute {string} a1 - The column bound to the ranged `a1`
 * endpoint (SPEC §6.4).
 *
 * @attribute {string} angle - The column bound to the `angle` channel
 * (SPEC §3).
 *
 * @attribute {string} radius - The column bound to the `radius`
 * channel (SPEC §3).
 *
 * @attribute {string} r0 - The column bound to the ranged `r0`
 * endpoint (SPEC §6.4).
 *
 * @attribute {string} r1 - The column bound to the ranged `r1`
 * endpoint (SPEC §6.4).
 *
 * @attribute {string} color - The column bound to the `color` channel
 * (SPEC §3).
 *
 * @attribute {string} source - The data source for this subtree,
 * nearest-ancestor-wins (SPEC §4.5).
 */
@customElement(HDVL_TAG_NAMES.ARC)
export class HdmlArcElement extends HdvlElement {
  public readonly tag = HDVL_TAG_NAMES.ARC;

  public readonly family = HDVL_FAMILIES[HDVL_TAG_NAMES.ARC];

  /**
   * @internal
   */
  @property({ type: String })
  [ARC_ATTRS_LIST.A0]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [ARC_ATTRS_LIST.A1]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [ARC_ATTRS_LIST.ANGLE]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [ARC_ATTRS_LIST.RADIUS]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [ARC_ATTRS_LIST.R0]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [ARC_ATTRS_LIST.R1]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [ARC_ATTRS_LIST.COLOR]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [ARC_ATTRS_LIST.SOURCE]: null | string = null;

  /**
   * §7.2's request path — one subscription per column-bound slot,
   * both ranged pairs included.
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
   * One parameterised `arc` per row.
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
    // Not a branch on plane KIND (H7) — a question about this
    // plane's channels. A plane projecting x/y projects nothing
    // this tag can bind, so there is no honest geometry and no
    // pole; inventing one would be step 26's job done wrong.
    const [first, second] = projection.channels;
    if (first !== CHANNELS[0] || second !== CHANNELS[1]) {
      return null;
    }
    const angles = rangedValuesOf(this, first);
    const angleScale = projection.scale(first);
    // §4.3 gives the radial extent its ceiling, so an arc needs a
    // radius scale even when it binds nothing radially.
    const span = projection.scale(second)?.range() ?? null;
    if (angles === null || angleScale === null || span === null) {
      return null;
    }
    // §6.1's second angle form — `angle` on an ORDINAL scale, equal
    // slices — is step 26's, with its band-vs-step escalation.
    if (angleScale.kind === "ordinal") {
      return null;
    }
    const m = ctx.measured(this);
    const ceiling = span[1];
    const floor = innerRadiusOf(m, ceiling);
    // §6.1's third radial case: fully unbound is the full radius
    // range, floored — what `rangedValuesOf` cannot express, since
    // an unbound channel is exactly what it returns `null` for.
    const radial = rangedValuesOf(this, second);
    const rows = rowCountOf([
      angles.low,
      angles.high,
      radial === null ? null : radial.low,
      radial === null ? null : radial.high,
    ]);
    const pole = projection.point(0, 0);
    if (pole === null) {
      return null;
    }
    const tally = newTally();
    const nodes: SceneNode[] = [];
    for (let i = 0; i < rows; i++) {
      const lo = angles.low.at(i);
      const hi = angles.high.at(i);
      const a0 = projection.at(first, lo);
      const a1 = projection.at(first, hi);
      // ★ THE ONE READ OF `sugar` IN THE PROJECT. §4.6's floor
      // replaces the SYNTHETIC lower edge and never an authored
      // one: "a bound r0/radius may legally paint inside the hole
      // — authored data is sacred."
      const r0 =
        radial === null || radial.sugar
          ? floor
          : projection.at(second, radial.low.at(i));
      const r1 =
        radial === null
          ? ceiling
          : projection.at(second, radial.high.at(i));
      if (a0 === null || a1 === null || r0 === null || r1 === null) {
        tally.dropped++;
        tallyDrop(tally, this, projection, first, lo);
        tallyDrop(tally, this, projection, first, hi);
        continue;
      }
      nodes.push({
        k: "arc",
        // §2.5: a per-row node carries its own row index.
        i,
        cx: num(pole.x),
        cy: num(pole.y),
        r0: num(r0),
        r1: num(r1),
        a0: num(a0),
        a1: num(a1),
        ...fillPaint(m, channelColor(ctx, this, i)),
      });
    }
    reportDrops(this, projection, tally, rows, nodes.length);
    return markGroup(this, m, nodes);
  }
}
