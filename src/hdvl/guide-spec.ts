/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The guide base — **everything all four positional guides share**
 * (RFC 016/001 §2.2, §4.3, §4.8, §6.5; SPEC §3, §7; H6).
 *
 * §6.5 opens by saying the four *"differ only in what is
 * repeated"*: an axis draws one line over the whole range, a grid
 * one line per tick, a tick one glyph per tick, a label one string
 * per tick. Everything before *what is repeated* — which channel,
 * which scale, which spec, which box, which edge — is the same
 * four times over, so it lives here and steps 24 and 31 import it
 * rather than writing it again (H6, the plan's Slice E ripple).
 *
 * **A guide is not a mark and this is not `mark.ts`.** It takes no
 * `source`, binds no columns, implements no `Binder` and has no
 * `datumAt`: §6.5 makes it *"a function of the resolved scale, its
 * own box and its computed style"*. Its one input from the document
 * is its `channel` attribute. That is also why {@link guideGroup}
 * is a sibling of `markGroup` rather than a `role` parameter on it
 * — §3.4.1 decides `empty` on **mark** nodes, so a chart of axes
 * over no data must read as empty, and a `role` argument would let
 * a mark pass `"guide"` and quietly invert that.
 *
 * **A guide calls `scale.ticks(spec)` and never reimplements a
 * ladder** (R12/R18). Contract 2 has been whole since step 18 and
 * this module is its first consumer: {@link tickSpecOf} turns three
 * attributes into a {@link TickSpec} and hands it over. It resolves
 * no precedence of its own either — see that function's note.
 *
 * @module hdvl/guide-spec
 */

import type { HdvlElement } from "./base";
import type { FrameContext, Measured } from "./measure";
import type { Channel } from "./resolve";
import type {
  Paint,
  Point,
  Rect,
  SceneGroup,
  SceneNode,
} from "./scene";
import type { Scale, TickSpec } from "./scale";
import type { Projection } from "./mark";
import { projectionOf } from "./mark";
import { channelOf } from "./resolve";
import { AXIS_ATTRS_LIST, GRID_ATTRS_LIST } from "./vocabulary";

/**
 * The plane whose guides this slice paints, as its channel pair.
 *
 * §6.5's grid row ends *"on a radius channel `--hdml-grid-shape:
 * circle` emits a full arc and `polygon` a closed path through the
 * angle-scale positions"*, and an angle axis spanning its whole
 * range is a **circle**, not a segment. Both forms are step 27's,
 * with `hdml-pie` and the rest of the polar guides — so until they
 * land a guide under a polar plane paints **nothing**, rather than
 * a straight line drawn through polar space. §1.5 makes the
 * plausible wrong chart the worst outcome available, and a spoke
 * where a ring belongs is exactly that.
 *
 * This is the **one** place in the guide half that names a channel,
 * and step 27 is where it stops existing. Everywhere else a guide
 * reads {@link Projection.channels}, as H7 requires of a mark.
 */
const CARTESIAN: readonly [Channel, Channel] = ["x", "y"];

/**
 * A positional guide's whole resolved context, for one frame.
 *
 * Every member is derived — nothing here is authored but
 * {@link ResolvedGuide.channel}, and that comes from the one
 * attribute a guide publishes in common.
 */
export interface ResolvedGuide {
  /** The channel its `channel` attribute names. */
  readonly channel: Channel;
  /** The other positional channel of this plane (§4.3). */
  readonly other: Channel;
  /**
   * Whether {@link ResolvedGuide.channel} is the plane's **first**
   * composition channel — under a cartesian plane, whether the
   * guide's line runs horizontally.
   */
  readonly first: boolean;
  /** The `Scale` serving its channel. Never `null` here. */
  readonly scale: Scale;
  /** That scale's **element**, whose content box §4.3 uses. */
  readonly element: HdvlElement | null;
  /**
   * That element's **content** box — §4.3's range source, and the
   * reference {@link guideEdge} measures "nearest" against.
   */
  readonly scaleBox: Rect;
  /** The plane's projection, for the other channel's range. */
  readonly projection: Projection;
  /** The guide's own MEASURE snapshot. */
  readonly measured: Measured;
}

/**
 * Resolves a positional guide against the frame, or `null`.
 *
 * Five conditions, every one of which means *paint nothing*:
 * no legal `channel`, no plane, a plane this slice cannot draw for
 * (see {@link CARTESIAN}), a channel the plane does not consume,
 * and no scale for that channel in scope. The last of those is
 * already **V1**'s error — `boundChannels` returns a guide's one
 * channel — so no rule is added here and none is needed: the
 * diagnostic and the blank box are the same condition seen from two
 * sides, exactly as they are on `hdml-rule`.
 *
 * @param ctx - The frame's snapshot.
 * @param el - The guide.
 * @returns Its resolved context, or `null`.
 */
export function resolveGuide(
  ctx: FrameContext,
  el: HdvlElement,
): ResolvedGuide | null {
  const channel = channelOf(el.getAttribute(AXIS_ATTRS_LIST.CHANNEL));
  if (channel === null) {
    return null;
  }
  const projection = projectionOf(ctx, el);
  if (projection === null) {
    return null;
  }
  const [first, second] = projection.channels;
  if (first !== CARTESIAN[0] || second !== CARTESIAN[1]) {
    return null;
  }
  if (channel !== first && channel !== second) {
    return null;
  }
  const scale = projection.scale(channel);
  if (scale === null) {
    return null;
  }
  const element = projection.element(channel);
  const measured = ctx.measured(el);
  return {
    channel,
    other: channel === first ? second : first,
    first: channel === first,
    scale,
    element,
    scaleBox:
      element === null
        ? measured.content
        : ctx.measured(element).content,
    projection,
    measured,
  };
}

/**
 * A signed zero is `===` zero but neither `Object.is`-equal nor
 * `deepEqual` to it, and serializes to `"-0"` (plan rule 9).
 *
 * {@link guidePoint} is a scene-coordinate **producer**, so it
 * normalises rather than assuming its inputs did: a tick at the
 * range origin and a zero-extent gutter both reach it.
 */
function px(v: number): number {
  return Object.is(v, -0) ? 0 : v;
}

/**
 * One point of a **cartesian** guide's geometry.
 *
 * `along` is a position in the guide's own channel's range unit and
 * `across` a view coordinate on the perpendicular axis. Under a
 * cartesian plane those are one space — `plane-cartesian.ts`
 * composes with the identity pair precisely because *"an `x`
 * position already is a view x"* (§2.7) — which is why
 * {@link resolveGuide} refuses a polar plane outright instead of
 * composing through {@link Projection.point} and quietly producing
 * a spiral.
 *
 * @param guide - The resolved guide.
 * @param along - A position along its own channel.
 * @param across - A view coordinate across it.
 * @returns The point, in view coordinates.
 */
export function guidePoint(
  guide: ResolvedGuide,
  along: number,
  across: number,
): Point {
  return guide.first
    ? { x: px(along), y: px(across) }
    : { x: px(across), y: px(along) };
}

/** One box's extent along one axis, as `[low, high]`. */
function extent(rect: Rect, horizontal: boolean): [number, number] {
  return horizontal
    ? [rect.x, rect.x + rect.w]
    : [rect.y, rect.y + rect.h];
}

/**
 * ★ **Which edge of its own box the scale's axis runs along**
 * (§6.5's label row, SPEC §7).
 *
 * SPEC §7 is categorical that *"placement is pure CSS… no
 * `position` attribute"*, so this cannot be authored and must be
 * **derived from the two measured boxes**: the edge of the guide's
 * own content box nearest the scale it serves. A zero-CSS x-axis
 * lands in the plane's bottom gutter and draws on its own **top**
 * edge; a y-axis lands in the left gutter and draws on its
 * **right** edge; move either with one CSS rule and the line moves
 * with it, because the derivation reads the box the rule produced.
 *
 * "Nearest" is measured against the scale's **centre** rather than
 * its near edge, so a guide overlapping the plot still has one
 * answer instead of a tie between two zero distances. A guide whose
 * box is exactly the scale's — `hdml-grid`'s `inset: 0` — resolves
 * to the low edge, deterministically; the grid does not ask.
 *
 * **Step 24 reuses this verbatim.** §6.5 derives `hdml-label`'s
 * anchor and baseline from the same fact, so a label under the plot
 * is `middle`/`top` and one to its left is `end`/`middle`: the edge
 * this returns is the side its text hangs off.
 *
 * @param guide - The resolved guide.
 * @returns The perpendicular view coordinate its glyphs sit on.
 */
export function guideEdge(guide: ResolvedGuide): number {
  // The PERPENDICULAR axis: a guide on the plane's first channel
  // runs horizontally, so the edge it draws on is a horizontal one
  // and the extent to compare is vertical.
  const horizontal = !guide.first;
  const own = extent(guide.measured.content, horizontal);
  const toward = extent(guide.scaleBox, horizontal);
  const centre = (toward[0] + toward[1]) / 2;
  return Math.abs(own[0] - centre) <= Math.abs(own[1] - centre)
    ? px(own[0])
    : px(own[1]);
}

/**
 * Every value a `count` / `step` / `values` attribute can carry,
 * read from the attribute the three guides publish in common.
 *
 * `hdml-grid`'s enum is used for all of them because the names are
 * one vocabulary — `hdml-tick` publishes the identical three and
 * `hdml-label` those plus `format` — and R8 asks for the enum
 * rather than the literal, not for a fourth copy of the same three
 * strings.
 */
const A_COUNT = GRID_ATTRS_LIST.COUNT;
const A_STEP = GRID_ATTRS_LIST.STEP;
const A_VALUES = GRID_ATTRS_LIST.VALUES;

/** An attribute's trimmed text, or `null` when absent or empty. */
function textOf(el: HdvlElement, name: string): string | null {
  const raw = el.getAttribute(name);
  if (raw === null) {
    return null;
  }
  const text = raw.trim();
  return text === "" ? null : text;
}

/** A positive finite number, or `undefined`. */
function positive(text: string | null): number | undefined {
  if (text === null) {
    return undefined;
  }
  const n = Number(text);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * SPEC §7's *"literal JSON"* tick list.
 *
 * **Parsed here rather than through `mark.ts`'s `slotValuesOf`**,
 * and the difference is not stylistic: that reader classifies SPEC
 * §5's *binding* grammar, where a bare identifier names a column
 * and a bare number broadcasts. A guide binds nothing, so neither
 * of those forms means anything on it — `values="a"` is not a
 * column and `values="3"` is not a tick set — and reusing the
 * binding reader would silently accept both. What is legal here is
 * a JSON **array**, and that is all this accepts.
 */
function literalValues(
  text: string | null,
): readonly (number | string)[] | undefined {
  if (text === null) {
    return undefined;
  }
  let json: unknown;
  try {
    json = <unknown>JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!Array.isArray(json)) {
    return undefined;
  }
  const out: (number | string)[] = [];
  for (const item of <unknown[]>json) {
    if (typeof item === "number" && Number.isFinite(item)) {
      out.push(item);
    } else if (typeof item === "string") {
      out.push(item);
    }
  }
  return out;
}

/**
 * §6.5's `spec`: *"`count`, `step` or `values`, mutually exclusive
 * (V16)"*.
 *
 * **★ The precedence is Contract 2's, not this module's.** SPEC §7
 * makes the three *modes* rather than options — *"`step=` states
 * the interval exactly and invokes no tick algorithm"* — so an
 * author who writes two of them has asked two questions at once.
 * V16 reports that at step 24; the page still paints meanwhile, so
 * *some* answer is given, and the honest one is the one §4.8's
 * implementation already publishes: `ticksFor` tests `values`, then
 * `step`, then `count`, and `thinOrdinal` does the same in the same
 * order — its own doc comment says it *"states the precedence it
 * applies if more than one arrives anyway"*. This function
 * therefore forwards every member the author wrote and **resolves
 * nothing**. A second resolution here would be a second ladder
 * entry point in all but name (R12), and the two could disagree.
 *
 * An attribute present but **empty** reads as absent, so one
 * fixture helper can spell all three modes and the unset one.
 *
 * @param el - The guide.
 * @returns Its spec. `{}` — which `Scale.ticks` reads as
 *   `count = 10` — when it writes none of the three, which is
 *   `hdml-axis`'s permanent case and a bare `hdml-grid`'s default.
 */
export function tickSpecOf(el: HdvlElement): TickSpec {
  const spec: TickSpec = {};
  const count = positive(textOf(el, A_COUNT));
  if (count !== undefined) {
    spec.count = count;
  }
  const step = positive(textOf(el, A_STEP));
  if (step !== undefined) {
    spec.step = step;
  }
  const values = literalValues(textOf(el, A_VALUES));
  if (values !== undefined) {
    spec.values = values;
  }
  return spec;
}

/**
 * One straight guide line, as §2.5's `path`.
 *
 * **`i` is `-1` and `vertices` is empty, and both are deliberate.**
 * §2.5 defines `i` as *"the SOURCE ROW index the node was built
 * from, or -1"* and `vertices` as *"projected **data** vertices,
 * for hit resolution (§5.7)"*. A guide has no rows and no data: it
 * is a function of the scale, not of the delivery. A tick's
 * position is not a row index, so putting one in `i` would name a
 * row that may not exist; and listing the endpoints as vertices
 * would make `nearestVertex` resolve a hit to a widget that
 * implements no `DatumSource` and can answer nothing about it.
 * Empty is the truthful answer to both questions.
 *
 * @param from - One end, in view coordinates.
 * @param to - The other.
 * @param paint - The resolved stroke.
 * @returns The node.
 */
export function guideLine(
  from: Point,
  to: Point,
  paint: Paint,
): SceneNode {
  return {
    k: "path",
    i: -1,
    subpaths: [{ start: from, segments: [{ k: "line", to }] }],
    closed: false,
    vertices: [],
    ...paint,
  };
}

/**
 * One guide's `SceneGroup` shell — §2.5's five box-level fields,
 * transferred from the measured snapshot exactly as §5.4 requires.
 *
 * Identical to `markGroup` in every field but `role`, and a
 * separate function for that reason: see this module's header.
 *
 * @param el - The guide.
 * @param m - Its measured snapshot.
 * @param nodes - What it painted.
 * @returns The group.
 */
export function guideGroup(
  el: HdvlElement,
  m: Measured,
  nodes: readonly SceneNode[],
): SceneGroup {
  return {
    widget: el.uid,
    tag: el.localName,
    role: "guide",
    box: m.box,
    opacity: m.opacity,
    filter: m.filter,
    visibility: m.visibility,
    clip: m.clip,
    clipPath: m.clipPath,
    nodes,
  };
}
