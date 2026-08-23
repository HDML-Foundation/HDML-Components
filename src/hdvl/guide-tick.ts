/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `hdml-tick` element (RFC 016/001 §2.2, §6.5).
 *
 * @module hdvl/guide-tick
 */

import { customElement, property } from "lit/decorators.js";
import { HdvlElement } from "./base";
import type { FrameContext, Measured } from "./measure";
import type { Paint, SceneGroup, SceneNode } from "./scene";
import { paintSuppressed } from "./subscribe";
import { fillPaint } from "./mark";
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
  TICK_ATTRS_LIST,
} from "./vocabulary";

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

/**
 * One glyph, centred on a point — §6.1's point geometry, on a tick
 * position rather than on a projected datum.
 *
 * **★ `--hdml-tick-width` and `-height` are DIAMETERS in both
 * forms**, so an `ellipse` takes half of each. This is the identical
 * trap `mark-point.ts` documents: reading a width as a radius draws
 * every glyph at twice its declared size, and no scene assertion
 * catches it, because both readings are internally consistent. The
 * test therefore asserts against the *computed property*.
 *
 * The `rect` form is **centred** exactly as the ellipse is, so
 * switching `--hdml-tick-style` moves nothing.
 *
 * @param style - The computed `--hdml-tick-style`.
 * @param cx - The glyph centre's view x.
 * @param cy - Its view y.
 * @param w - The diameter across x.
 * @param h - The diameter across y.
 * @param paint - The resolved fill.
 * @returns The node.
 */
function glyph(
  style: string,
  cx: number,
  cy: number,
  w: number,
  h: number,
  paint: Paint,
): SceneNode {
  return style === ELLIPSE
    ? {
        k: "ellipse",
        // §2.5: `i` is a SOURCE ROW index and a tick position is
        // not one — `guideLine` says the same of its paths.
        i: -1,
        cx: num(cx),
        cy: num(cy),
        rx: num(w / 2),
        ry: num(h / 2),
        ...paint,
      }
    : {
        k: "rect",
        i: -1,
        x: num(cx - w / 2),
        y: num(cy - h / 2),
        w: num(w),
        h: num(h),
        ...paint,
      };
}

/**
 * A glyph repeated at scale positions, shaped by
 * `--hdml-tick-style` and sized by `--hdml-tick-width` /
 * `--hdml-tick-height`. Binds no columns and takes no `source`.
 *
 * **One `rect` or `ellipse` per tick** (§6.5), centred on the tick's
 * position along its channel and on the edge of its **own** box
 * nearest the scale across it — the same derivation `hdml-axis`
 * draws its line on, because SPEC §7 leaves placement to CSS and
 * gives the tag no `position` attribute. Move the box with one rule
 * and the glyphs move with it.
 *
 * The positions come from `scale.ticks(spec)` and are never
 * re-derived here (R12): a tick and a sibling `hdml-label` at
 * different densities agree because there is **one** generator, not
 * because two ladders match. SPEC §7 makes those densities
 * independent on purpose — `hdml-tick count="12"` beside
 * `hdml-label count="6"` marks every month and labels every other —
 * so each element reads its own `tickSpecOf` and neither consults
 * the other.
 *
 * **Where its `decorative: true` lives.** §6.5 calls a tick glyph
 * decoration and §5.10 gives decoration an `aria-hidden` floor, but
 * §2.5 puts `decorative` on the `text` node **alone** — Contract 3
 * has been whole since step 10 and a `rect` has no such field. That
 * is not an omission: `decorative` exists on `text` precisely
 * because text is the one node kind that would otherwise be exposed
 * *and* selectable, so the distinction between a tick's glyph and a
 * label's string has to be written down there and nowhere else. A
 * tick's decorative-ness is therefore carried by **the node kind it
 * emits** — it emits no `text`, and §5.10's floor has nothing to
 * apply to: `hdml-view` is `role="img"`, which prunes the whole SVG
 * subtree, and a bare SVG shape contributes nothing to the
 * accessibility tree in the first place. `guide-tick.test.ts`
 * asserts the invariant that makes this true — no node this element
 * emits is a `text` node.
 *
 * **Cartesian only in this slice**, for the reason `guide-spec.ts`
 * gives: a polar plane resolves to nothing until step 27, rather
 * than to glyphs laid along a straight line through polar space.
 *
 * @tagname hdml-tick
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
 */
@customElement(HDVL_TAG_NAMES.TICK)
export class HdmlTickElement extends HdvlElement {
  public readonly tag = HDVL_TAG_NAMES.TICK;

  public readonly family = HDVL_FAMILIES[HDVL_TAG_NAMES.TICK];

  /**
   * @internal
   */
  @property({ type: String })
  [TICK_ATTRS_LIST.CHANNEL]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [TICK_ATTRS_LIST.COUNT]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [TICK_ATTRS_LIST.STEP]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [TICK_ATTRS_LIST.VALUES]: null | string = null;

  /**
   * @override
   *
   * One glyph per tick, on the near edge of its own box.
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
    // The property registers as `rect | ellipse`, so the UA has
    // already rejected anything else — this narrows a string, it
    // does not validate one.
    const style = (m.props.get("--hdml-tick-style") ?? "").trim();
    const w = cssNumber(m.props.get("--hdml-tick-width"), 1);
    const h = cssNumber(m.props.get("--hdml-tick-height"), 6);
    // A glyph is a FILLED shape, so `--hdml-fill-color` is its
    // property — whose initial is `currentColor`, already resolved
    // by MEASURE, so an unstyled tick paints in the inherited text
    // colour and `01-line.html`'s `#64748b` is honoured.
    const paint = fillPaint(m, null);
    const nodes: SceneNode[] = [];
    // A tick whose value does not project is dropped by `ticksFor`
    // before it is seen here, so §4.7 needs no restatement.
    for (const tick of guide.scale.ticks(tickSpecOf(this))) {
      const at = guidePoint(guide, tick.at, across);
      nodes.push(glyph(style, at.x, at.y, w, h, paint));
    }
    return guideGroup(this, m, nodes);
  }
}
