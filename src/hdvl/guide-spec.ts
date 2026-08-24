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
 * four times over, so it lives here: step 24's tick and label
 * import it rather than writing it again — needing no member it did
 * not already have — and step 31's legend is the one consumer left
 * (H6, the plan's Slice E ripple).
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
 * ★ The **angular** channel — the one channel name left in the
 * guide half, and it replaces a pair that named the cartesian
 * plane's two (landed at step 27).
 *
 * What it is asked is *does this plane compose about a pole* — the
 * identical question `hdml-line`'s `closedOf` asks to decide
 * whether its `closed` means anything and `hdml-arc` asks to decide
 * whether it has a pole at all. That is a question about
 * **channels**, which H7 allows, and explicitly not a branch on
 * plane kind, which it forbids: a plane answering `angle` first
 * composes radially however it is spelled or classed.
 *
 * Everything else in the guide half reads it back off
 * {@link ResolvedGuide.pole} and {@link ResolvedGuide.first}, so no
 * guide element names a channel at all — a ring is *"my own channel
 * is this plane's first and there is a pole"*, and
 * `--hdml-grid-shape`'s home is *"my own channel is its second and
 * there is a pole"*.
 */
const ANGULAR: Channel = "angle";

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
  /**
   * §4.6's **pole**, when this plane composes about one; `null`
   * when it composes in view space.
   *
   * It is `projection.point(0, 0)` — the same read `hdml-arc`
   * makes, and exact, because §4.6's `radius = 0` lands on the pole
   * at every angle. Resolved through the **guide's own**
   * projection, so it is the centre of the radius scale this
   * guide's chain reaches and not the plane's (R35).
   *
   * Everything polar in the guide half is `pole !== null` plus
   * {@link ResolvedGuide.first}; no guide file tests a channel or a
   * plane kind.
   */
  readonly pole: Point | null;
}

/**
 * Resolves a positional guide against the frame, or `null`.
 *
 * Four conditions, every one of which means *paint nothing*: no
 * legal `channel`, no plane, a channel the plane does not consume,
 * and no scale for that channel in scope. The last of those is
 * already **V1**'s error — `boundChannels` returns a guide's one
 * channel — so no rule is added here and none is needed: the
 * diagnostic and the blank box are the same condition seen from two
 * sides, exactly as they are on `hdml-rule`.
 *
 * **A fifth used to be here and is gone** (step 27): the plane had
 * to be the cartesian one, because everything below composed
 * `(along, across)` as a view point. It now composes through
 * {@link Projection.point}, so a polar plane resolves like any
 * other and the channel pair this module used to name does not
 * exist.
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
    pole: first === ANGULAR ? projection.point(0, 0) : null,
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
 * One point of a guide's geometry, **through the plane** (H7).
 *
 * `along` is a position in the guide's own channel's range unit and
 * `across` one in the other channel's — view px against view px
 * under a cartesian plane, degrees against px under a polar one.
 * Composing them is the plane's job and nothing else's, so this
 * hands both to {@link Projection.point} in the plane's own channel
 * order and normalises what comes back.
 *
 * **Its cartesian output is unchanged** (step 27): the cartesian
 * plane composes with the identity pair precisely because *"an `x`
 * position already is a view x"* (§2.7), so `point(along, across)`
 * *is* `{x: along, y: across}` — the spelling this function used to
 * carry inline, and the reason the guide half could get as far as
 * step 26 without a plane seam at all.
 *
 * @param guide - The resolved guide.
 * @param along - A position along its own channel.
 * @param across - A position across it.
 * @returns The point, in view coordinates.
 */
export function guidePoint(
  guide: ResolvedGuide,
  along: number,
  across: number,
): Point {
  // `Projection.point` is `null` only when a position is (§2.7),
  // and both of these are numbers.
  const at = guide.first
    ? guide.projection.point(along, across)
    : guide.projection.point(across, along);
  return { x: px(at?.x ?? 0), y: px(at?.y ?? 0) };
}

/**
 * The **full ring** a guide draws when its own channel is the
 * angular one — §6.5's *"a full arc"*.
 *
 * A ring is a `arc` node and not a `path`, for the reason §2.5
 * gives arcs at all: `Segment` carries lines and cubics, so a
 * circle spelled as a path would be an approximation of one. The
 * node is a **zero-thickness annulus** — `r0 === r1` — which is what
 * a stroked ring is, and it is honest in a way `r0: 0` would not
 * be: that spells *a filled disc* and merely happens to stroke the
 * same outline over a full turn.
 *
 * Its two consumers are `hdml-axis` on an angular channel (the
 * whole angular range at the radial ceiling) and `hdml-grid` on a
 * radial one under `--hdml-grid-shape: circle` (the whole angular
 * range at each tick's radius). One formula, two callers (R12).
 *
 * @param pole - The plane's pole, in view coordinates.
 * @param radius - The ring's radius, in CSS px.
 * @param a0 - The angular range's start, in degrees.
 * @param a1 - Its end.
 * @param paint - The resolved stroke.
 * @returns The node.
 */
export function guideRing(
  pole: Point,
  radius: number,
  a0: number,
  a1: number,
  paint: Paint,
): SceneNode {
  return {
    k: "arc",
    // §2.5, exactly as `guideLine`: a guide has no source row.
    i: -1,
    cx: px(pole.x),
    cy: px(pole.y),
    r0: px(radius),
    r1: px(radius),
    a0: px(a0),
    a1: px(a1),
    ...paint,
  };
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
 * **{@link guidePlacement} reuses this verbatim.** §6.5 derives a
 * label's anchor and baseline from the same fact, so a label under
 * the plot is `middle`/`top` and one to its left is `end`/`middle`:
 * the edge this returns is the side its text hangs off.
 *
 * **It answers for a cartesian plane only**, and that is a fact
 * about units rather than a restriction: it returns a **view**
 * coordinate, and a view coordinate is a legal `across` exactly
 * when the other channel's range is measured in one.
 * {@link guideAcross} is the question this half-answers.
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
 * ★ **Where a guide sits across its own channel**, in the other
 * channel's range unit — the one question all four guides ask
 * before they repeat anything (§6.5, SPEC §7).
 *
 * Two answers, and the split is forced by **units**, not by taste:
 *
 * - **In view space** — the plane composes positions as view
 *   coordinates — the answer is the guide's own measured box, via
 *   {@link guideEdge}. SPEC §7 gives placement to CSS and the tag
 *   no `position` attribute, and the UA sheet gives an x guide a
 *   bottom gutter and a y guide a left one, so the box *is* the
 *   author's statement.
 * - **About a pole** — the other channel's range is in degrees or
 *   in a radius, and **no box edge is a value in either**. A polar
 *   guide's box is also the plane's, since the UA sheet places no
 *   gutter under a plane that has none, so there is nothing to read
 *   even in principle. The one honest source left is that range's
 *   own **far end**: the rim for a guide repeating around it, the
 *   end of the turn for one repeating outward along a spoke. On the
 *   full turn every corpus polar page but one writes, `360deg`
 *   **is** `0deg`, so a radial guide lands on the twelve-o'clock
 *   spoke. `12-coverage` B is the exception — a gauge sweeping
 *   `-120deg` to `120deg` — and its guide lands on the sweep's end,
 *   which is the same rule and not a special case.
 *
 * @param guide - The resolved guide.
 * @returns The position across its channel.
 */
export function guideAcross(guide: ResolvedGuide): number {
  if (guide.pole === null) {
    return guideEdge(guide);
  }
  const span = guide.projection.span(guide.other);
  return span === null ? 0 : px(span[1]);
}

/** Where one text run hangs relative to its own point (§6.5). */
export interface Placement {
  anchor: "start" | "middle" | "end";
  baseline: "top" | "middle" | "bottom";
}

/**
 * How far off an axis a component must be to count as pointing
 * along it.
 *
 * The normal is compared **relative to its own magnitude**, because
 * the polar one is a radius long and the cartesian one is a unit
 * vector. `cos(π / 2)` is `6.1e-17`, so a three-o'clock tick's
 * vertical component is that fraction of its radius — fifteen
 * orders of magnitude under this — while the smallest angle an
 * author can distinguish is nine orders of magnitude over it.
 */
const ALONG_AXIS = 1e-6;

/**
 * ★ **The outward normal at a point** — the direction a guide's
 * glyphs hang, and the whole of §6.5's placement derivation.
 *
 * Under a plane composing in view space it is **constant and
 * axis-aligned**: the guide runs along one view axis, so it hangs
 * across the other, away from the plot — `(0, ±1)` for a guide on
 * the plane's first channel and `(±1, 0)` for one on its second.
 * That single zero component is *why* §6.5's four cartesian rows
 * each carry a `middle`.
 *
 * Under a plane composing about a pole it is **radial**: the point
 * itself, less the pole. A ring's text faces out of the circle at
 * every tick, so the vector varies per tick where the cartesian one
 * does not — which is the whole difference between the two, stated
 * once.
 *
 * @param guide - The resolved guide.
 * @param at - The point its glyph sits on.
 * @param across - The coordinate {@link guideAcross} returned.
 * @returns The outward direction. Not normalised.
 */
function normalOf(
  guide: ResolvedGuide,
  at: Point,
  across: number,
): Point {
  if (guide.pole !== null) {
    return { x: at.x - guide.pole.x, y: at.y - guide.pole.y };
  }
  const box = guide.scaleBox;
  const centre = guide.first ? box.y + box.h / 2 : box.x + box.w / 2;
  // A guide whose box overlaps the scale's centre exactly resolves
  // to the high side, the tie-break `guideEdge` takes and for the
  // same reason: one answer beats two equal distances.
  const away = across >= centre ? 1 : -1;
  return guide.first ? { x: 0, y: away } : { x: away, y: 0 };
}

/**
 * ★ §6.5's *"anchor and baseline derived from which edge of its own
 * box the scale's axis runs along"*, generalised to any plane.
 *
 * **This is a derivation and must stay one.** SPEC §7 gives the tag
 * no `position` attribute, so cases keyed on the channel would be
 * the authored placement the spec forbids, merely spelled in
 * TypeScript — and would silently stop tracking a box that CSS
 * moved.
 *
 * **One predicate: the per-axis sign of the outward normal.** The
 * text hangs off its point in the direction {@link normalOf}
 * returns, so a component pointing at higher coordinates runs the
 * text on (`start` across x, `top` down y), one pointing at lower
 * coordinates runs it back (`end`, `bottom`), and a component that
 * points along neither leaves the run **centred** on its tick.
 *
 * | Guide | Sits | Normal | anchor | baseline |
 * |---|---|---|---|---|
 * | 1st channel, flat | below it | `(0, +)` | `middle` | `top` |
 * | 1st channel, flat | above it | `(0, −)` | `middle` | `bottom` |
 * | 2nd channel, flat | left of it | `(−, 0)` | `end` | `middle` |
 * | 2nd channel, flat | right of it | `(+, 0)` | `start` | `middle` |
 * | either, polar | 12 o'clock | `(0, −)` | `middle` | `bottom` |
 * | either, polar | 3 o'clock | `(+, 0)` | `start` | `middle` |
 * | either, polar | 4:30 | `(+, +)` | `start` | `top` |
 *
 * *("flat" is a plane composing in view space, "polar" one
 * composing about a pole — neither is a class this file can see.)*
 *
 * The four cartesian rows are the ones §6.5 names, unchanged since
 * step 24; the polar rows are the same rule met by a vector that
 * turns. A tick **on** the pole has no direction at all and
 * resolves to `middle`/`middle`, which is the truthful answer
 * rather than a guarded one.
 *
 * @param guide - The resolved guide.
 * @param at - The point the run sits on.
 * @param across - The coordinate {@link guideAcross} returned.
 * @returns The anchor and baseline for that run.
 */
export function guidePlacement(
  guide: ResolvedGuide,
  at: Point,
  across: number,
): Placement {
  const n = normalOf(guide, at, across);
  const edge = ALONG_AXIS * Math.hypot(n.x, n.y);
  return {
    anchor: n.x > edge ? "start" : n.x < -edge ? "end" : "middle",
    baseline: n.y > edge ? "top" : n.y < -edge ? "bottom" : "middle",
  };
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
 * V16 reports that (step 24); the page still paints meanwhile, so
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
