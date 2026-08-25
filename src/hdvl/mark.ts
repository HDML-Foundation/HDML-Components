/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The mark base — **the `Projection` seam and everything every mark
 * widget shares** (RFC 016/001 §2.2, §4.3, §4.6, §4.7, §6.1, H7,
 * H8).
 *
 * §2.2 makes a mark *"a pure function from (adopted data ⊗ resolved
 * scales ⊗ own box ⊗ computed style)"*. This module is the first
 * three of those four, factored out once, so a mark widget's own
 * file is the geometry of its shape and nothing else.
 *
 * **A mark never names a channel** (H7). `hdml-line` does not read
 * `"x"` and `"y"`; it reads {@link Projection.channels}, which is
 * the *plane's* answer — `x`/`y` under a cartesian plane,
 * `angle`/`radius` under a polar one. The plane supplies its own
 * `Projection` through the duck-typed {@link ProjectionSource}, so
 * the polar implementation landed in `plane-polar.ts` alone and
 * **no widget gained a branch**. That is what H7 forbids being
 * half-applied, and it is why {@link createProjection} takes the
 * composition as an argument rather than switching on a plane kind.
 *
 * **A channel may carry one value per row, or two** (H8). §6.4 makes
 * *"the ranged form the primitive a container compiles into"*, so
 * nothing here assumes a channel has a single spelling:
 * {@link CHANNEL_SLOTS} carries the simple attribute **and** the
 * ranged pair for every channel that has one, and every reader is
 * per **slot**. `hdml-line` and `hdml-rule` happen to use the simple
 * form only; step 21 uses both without changing a line of this file.
 *
 * **§4.7's three clauses collapse into one `null`.** A value that is
 * missing, non-finite, or outside an ordinal domain projects to
 * `null` and its row produces no mark — so no widget re-implements
 * the drop rule. The *notice* is still the validator's (R25): the
 * projection reports through {@link tallyDrop}, `validate.ts`
 * diagnoses, exactly as `clipShape` reports W6 and MEASURE carries
 * it.
 *
 * @module hdvl/mark
 */

import type { HdvlElement } from "./base";
import type { FrameContext, Measured } from "./measure";
import type { Channel } from "./resolve";
import type { Paint, Point, SceneGroup, SceneNode } from "./scene";
import type { Scale } from "./scale";
import type { Binding, CellValue, Slot } from "./subscribe";
import type { CurveOptions, CurveType } from "./kernel/curves";
import { CURVE_TYPES } from "./kernel/curves";
import { rangedOverrideOf } from "./container";
import { chainScaleOf } from "./scale";
import { adoptedColumn, sourceOf } from "./subscribe";
import { noticeOutOfDomain, reportAllRowsDropped } from "./validate";
import {
  ARC_ATTRS_LIST,
  AREA_ATTRS_LIST,
  POINT_ATTRS_LIST,
} from "./vocabulary";

// ---------------------------------------------------------------
// H7 — the Projection seam
// ---------------------------------------------------------------

/**
 * How a widget turns a row's channel values into a point.
 *
 * The two positional channels are the **plane's**, in the order the
 * plane composes them, and every member is keyed by channel — so a
 * mark asks for `channels[0]` and never for `"x"`.
 */
export interface Projection {
  /** The channels this plane consumes, in composition order. */
  readonly channels: readonly [Channel, Channel];
  /** The `Scale` serving a channel in this widget's scope. */
  scale(channel: Channel): Scale | null;
  /**
   * The scale **element** serving a channel — §4.7's all-drop
   * errors on the scale, and §3.5 makes a scale its own unit.
   */
  element(channel: Channel): HdvlElement | null;
  /**
   * A domain value → the channel's range unit (CSS px for `x`, `y`
   * and `radius`, degrees for `angle`).
   *
   * `null` is §4.7's whole drop rule in one place: the value is
   * missing, or non-finite, or outside an ordinal domain, or the
   * channel resolves no scale. **Nothing is clamped** — a
   * continuous value outside the domain projects truthfully and is
   * clipped later by the UA sheet's `overflow: hidden`.
   */
  at(channel: Channel, value: CellValue): number | null;
  /**
   * A channel's **range**, in that channel's own unit — the scale's
   * `range()` where one serves, and otherwise whatever the plane
   * supplies for a channel with no scale.
   *
   * SPEC §3 gives the polar radius exactly one such default: *"when
   * no radius scale exists (a pure pie chain), the plane's content
   * box serves"*. A cartesian plane supplies none, so a channel with
   * no scale still answers `null` there — which is what every
   * pre-existing caller asserted by spelling this
   * `scale(c)?.range()` inline.
   */
  span(channel: Channel): readonly [number, number] | null;
  /**
   * Whether a value is outside an **ordinal** domain — §4.7's
   * first clause, and the only drop that owes a notice.
   */
  outOfDomain(channel: Channel, value: CellValue): boolean;
  /**
   * Two already-projected channel positions → one view point
   * (§2.7). `null` when either is `null`.
   */
  point(first: number | null, second: number | null): Point | null;
}

/**
 * A plane that can project. **Duck-typed**, exactly like
 * {@link import("./subscribe").Binder} and
 * {@link import("./events").DatumSource} — Contract 1 gains no
 * member, and a plane whose projection has not landed yet simply
 * does not declare one.
 */
export interface ProjectionSource {
  /**
   * This widget's projection under this plane.
   *
   * @param ctx - The frame's snapshot.
   * @param el - The widget asking, whose scale chain is read.
   */
  projection(ctx: FrameContext, el: HdvlElement): Projection | null;
}

/**
 * Builds a `Projection` over one widget's scale chain.
 *
 * **The whole of the plane-kind difference is `compose`.** A
 * cartesian plane passes the identity pair; the polar plane passes
 * `polarPoint(pole, degrees, radius)`. Everything else — the
 * chain lookup, §4.7's drop rule, the ordinal test — is shared, so
 * the two planes cannot disagree about when a row drops.
 *
 * @param ctx - The frame's snapshot.
 * @param el - The widget whose chain is read (R35).
 * @param channels - The plane's two channels, in composition order.
 * @param compose - How the plane turns two positions into a point.
 * @param unscaled - A channel's range where **no scale** serves it.
 *   The default answers `null` for every channel, which is the
 *   cartesian plane's answer and was every caller's before step 28.
 * @returns The projection.
 */
export function createProjection(
  ctx: FrameContext,
  el: HdvlElement,
  channels: readonly [Channel, Channel],
  compose: (first: number, second: number) => Point,
  unscaled: (
    channel: Channel,
  ) => readonly [number, number] | null = () => null,
): Projection {
  const scales = new Map<Channel, Scale | null>();
  const scaleOf = (channel: Channel): Scale | null => {
    let hit = scales.get(channel);
    if (hit === undefined) {
      hit = chainScaleOf(ctx, el, channel);
      scales.set(channel, hit);
    }
    return hit;
  };
  return {
    channels,
    scale: scaleOf,
    element: (channel: Channel): HdvlElement | null =>
      ctx.resolution(el)?.chain[channel] ?? null,
    at: (channel: Channel, value: CellValue): number | null => {
      if (value === null) {
        return null;
      }
      const scale = scaleOf(channel);
      if (scale === null) {
        return null;
      }
      const at = scale.project(value);
      return at === null || !Number.isFinite(at) ? null : at;
    },
    span: (channel: Channel): readonly [number, number] | null => {
      const scale = scaleOf(channel);
      return scale === null ? unscaled(channel) : scale.range();
    },
    outOfDomain: (channel: Channel, value: CellValue): boolean => {
      if (value === null) {
        return false;
      }
      const scale = scaleOf(channel);
      return (
        scale !== null &&
        scale.kind === "ordinal" &&
        scale.bandOf(String(value)) === null
      );
    },
    point: (
      first: number | null,
      second: number | null,
    ): Point | null =>
      first === null || second === null
        ? null
        : compose(first, second),
  };
}

/**
 * The projection a widget resolves through — **a duck-typed read of
 * its plane, and nothing else**.
 *
 * There is no branch on plane kind here and there must never be
 * one (H7): a plane that does not answer has no projection yet, and
 * its widgets paint nothing.
 *
 * @param ctx - The frame's snapshot.
 * @param el - The widget.
 * @returns Its projection, or `null`.
 */
export function projectionOf(
  ctx: FrameContext,
  el: HdvlElement,
): Projection | null {
  const plane = ctx.resolution(el)?.plane ?? null;
  if (plane === null) {
    return null;
  }
  const source = <Partial<ProjectionSource>>(<unknown>plane);
  return typeof source.projection === "function"
    ? source.projection(ctx, el)
    : null;
}

// ---------------------------------------------------------------
// H8 — channels, and the two spellings each may have
// ---------------------------------------------------------------

/** The attribute names one channel can be spelled with. */
export interface ChannelSlots {
  /** The simple form — one value per row. */
  simple: Slot;
  /**
   * The ranged pair, `null` for a channel that has none.
   *
   * §6.4 makes the ranged form the **primitive** and the simple
   * form sugar (`y` ≡ `y0="0"`), which is step 21's invariant — but
   * the vocabulary already carries both spellings and this table
   * already knows them, so step 21 adds no member here.
   */
  ranged: readonly [Slot, Slot] | null;
}

/**
 * Every channel's spellings (SPEC §3, §5; RFC §3.3).
 *
 * The ranged forms are **spellings of their base channel**, not
 * channels of their own — a widget binding `y0` resolves the `y`
 * scale — which is why they live beside the simple form rather than
 * in `CHANNELS`. Three published enums cover all fourteen names, so
 * R8 holds with no literal.
 */
export const CHANNEL_SLOTS: Readonly<Record<Channel, ChannelSlots>> =
  {
    x: {
      simple: AREA_ATTRS_LIST.X,
      ranged: [AREA_ATTRS_LIST.X0, AREA_ATTRS_LIST.X1],
    },
    y: {
      simple: AREA_ATTRS_LIST.Y,
      ranged: [AREA_ATTRS_LIST.Y0, AREA_ATTRS_LIST.Y1],
    },
    angle: {
      simple: AREA_ATTRS_LIST.ANGLE,
      ranged: [ARC_ATTRS_LIST.A0, ARC_ATTRS_LIST.A1],
    },
    radius: {
      simple: AREA_ATTRS_LIST.RADIUS,
      ranged: [AREA_ATTRS_LIST.R0, AREA_ATTRS_LIST.R1],
    },
    color: { simple: AREA_ATTRS_LIST.COLOR, ranged: null },
    size: { simple: POINT_ATTRS_LIST.SIZE, ranged: null },
  };

/** SPEC §5's bindable-identifier form: a letter or `_`, then word. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** SPEC §5's JSON heads: `[`, `{`, `"`, a digit, or `-`. */
const JSON_HEAD = /[[{"\-0-9]/;

// ---------------------------------------------------------------
// SPEC §5 — a channel attribute's per-row values
// ---------------------------------------------------------------

/**
 * What one binding slot supplies, row by row (SPEC §5).
 *
 * Three shapes reach this one interface: a **column** of the
 * effective source, a **literal column** (`x='[1, 2, 3]'`), and a
 * **scalar broadcast** (`y="80"`, `color='"North"'`). The
 * difference a caller cares about is {@link SlotValues.scalar} —
 * SPEC §5 says scalars broadcast to N and an all-scalar widget has
 * N = 1.
 */
export interface SlotValues {
  readonly slot: Slot;
  /** Rows this slot indexes. Always `0` for a scalar. */
  readonly rows: number;
  /** Whether it broadcasts one value rather than indexing. */
  readonly scalar: boolean;
  /** Row `i`'s value, or `null` when missing (§4.7). */
  at(row: number): CellValue;
}

/** A JSON item as a cell: a finite number, a string, else missing. */
function cellOf(value: unknown): CellValue {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  return typeof value === "string" ? value : null;
}

/**
 * The values one slot supplies, classified by SPEC §5's
 * **first-character grammar**.
 *
 * The classification is the same one `validate.ts`'s `checkGrammar`
 * polices, read from the other side: where the validator answers
 * *which error this is*, this answers *what it binds*. A value the
 * validator rejects — a `?`/`/` form, JSON that does not parse, a
 * non-bindable identifier — yields `null` here, so a malformed
 * attribute paints nothing rather than painting something wrong.
 *
 * SPEC §6's `values` grammar is deliberately **not** reused: a bare
 * number is a legal scalar channel binding and is not a legal scale
 * domain, so `scale.ts`'s `valuesSpecOf` and this classify the same
 * first characters differently on purpose.
 *
 * @param el - The widget.
 * @param slot - The attribute name.
 * @returns Its values, or `null` when unbound or malformed.
 */
export function slotValuesOf(
  el: HdvlElement,
  slot: Slot,
): SlotValues | null {
  const raw = el.getAttribute(slot);
  if (raw === null) {
    return null;
  }
  const text = raw.trim();
  if (text === "") {
    return null;
  }
  if (JSON_HEAD.test(text[0])) {
    let json: unknown;
    try {
      json = <unknown>JSON.parse(text);
    } catch {
      // V3 reports it; a mark paints nothing rather than guessing.
      return null;
    }
    if (Array.isArray(json)) {
      const items = <unknown[]>json;
      return {
        slot,
        rows: items.length,
        scalar: false,
        at: (row: number): CellValue =>
          row < 0 || row >= items.length ? null : cellOf(items[row]),
      };
    }
    const one = cellOf(json);
    return {
      slot,
      rows: 0,
      scalar: true,
      at: (): CellValue => one,
    };
  }
  if (!IDENTIFIER.test(text)) {
    return null;
  }
  const column = adoptedColumn(el, slot);
  if (column === null) {
    // Bound, but nothing terminal has arrived. Zero rows rather
    // than `null`: the slot IS bound, so it must not read as an
    // unbound channel — §3.4 suppresses the paint meanwhile.
    return {
      slot,
      rows: 0,
      scalar: false,
      at: (): CellValue => null,
    };
  }
  return {
    slot,
    rows: column.rows,
    scalar: false,
    at: (row: number): CellValue => column.at(row),
  };
}

/**
 * SPEC §5's **N**: the row count a widget's slots agree on.
 *
 * *"All array/column bindings of one widget must have equal length
 * N; scalars broadcast to N; an all-scalar widget has N = 1."*
 * Where they disagree, this takes the longest — the shorter slot
 * then reads `null` past its end and §4.7 drops those rows, so
 * nothing is invented and nothing is silently truncated.
 *
 * **V5 landed at step 22 and this did not change.** §8.3's *"never
 * a `Math.max` zip"* forbids the *silence*, and the rule removes
 * it: a widget whose bindings disagree in length is now an error
 * that names both slots and both counts. Blanking is the error
 * **unit's**, through `:state(error)` (§3.5) — one mechanism, not
 * two — so no rule in this project stops a frame, and a count of
 * zero here could not tell a real mismatch from a column still in
 * flight anyway.
 *
 * @param slots - The widget's slots; `null` entries are ignored.
 * @returns N.
 */
export function rowCountOf(
  slots: readonly (SlotValues | null)[],
): number {
  let indexed = false;
  let scalars = false;
  let rows = 0;
  for (const slot of slots) {
    if (slot === null) {
      continue;
    }
    if (slot.scalar) {
      scalars = true;
      continue;
    }
    indexed = true;
    if (slot.rows > rows) {
      rows = slot.rows;
    }
  }
  if (indexed) {
    return rows;
  }
  return scalars ? 1 : 0;
}

// ---------------------------------------------------------------
// ★ H8 — the ranged form is the primitive, the simple form is sugar
// ---------------------------------------------------------------

/**
 * One channel's values as a **(low, high) pair** — §6.4's primitive.
 *
 * §6.4 makes *"the ranged form the primitive a container **compiles
 * into**"*, and §6.1 spells the sugar out: `y` ≡ `y0="0"`, polar
 * `radius` ≡ `r0="0"`. {@link rangedValuesOf} resolves one into the
 * other **before any geometry exists**, so from the moment it
 * returns no code below it can tell which form the author wrote.
 * That is H8's mechanical test: a widget reads {@link low} and
 * {@link high} and never names the simple slot at all, and
 * `hdml-stack` therefore changes nothing inside `hdml-bar` or
 * `hdml-area`.
 *
 * **★ H8 was measured at step 29 and it held.** A stack's lower edge
 * is neither a literal nor a column — it is a per-row array the
 * container derives from its siblings' values during COMPUTE — and
 * it needed no new shape here, because {@link low} is an ordinary
 * {@link SlotValues}: `container-stack.ts` builds
 * `{slot, rows: N, scalar: false, at: (k) => baseline[k]}` over its
 * **own** allocated array (§12 duty 4 — never mutating a delivered
 * buffer) and publishes it through `container.ts`, which
 * {@link rangedValuesOf} consults **before** it reads attributes.
 * `mark-bar.ts` gained **not one line**, and the two "step 29"
 * references still in that file are the prediction, left where it
 * was written.
 *
 * The container hoists the **shared** channel through the same
 * override: V6 forbids a child from binding it, so a stacked
 * `hdml-bar` has no `x` attribute of its own to read and the
 * container's own resolved pair is what it gets.
 */
export interface RangedValues {
  /** The base channel both endpoints project through (§3.3). */
  readonly channel: Channel;
  /** The low endpoint — `y0`, or the sugar's synthetic zero. */
  readonly low: SlotValues;
  /** The high endpoint — `y1`, or the simple form as written. */
  readonly high: SlotValues;
  /**
   * Whether the author wrote the simple form.
   *
   * **No geometry may branch on this.** It exists so a test can
   * assert the desugaring happened; an `if (sugar)` below this
   * point is precisely the half-applied H8 the plan forbids, and
   * would reintroduce the two code paths the resolver removes.
   */
  readonly sugar: boolean;
}

/**
 * The sugar's lower edge: the scalar `0` that `y0="0"` produces,
 * synthesized rather than parsed.
 *
 * It is byte-identical to what {@link slotValuesOf} returns for the
 * literal spelling — SPEC §5's JSON head accepts `0`, which is not
 * an array, so it classifies as a **scalar broadcast** whose `at()`
 * ignores the row. That is what makes the sugar free: it is not a
 * special case, it is the same reader over a value the author did
 * not have to type.
 */
function baselineZero(slot: Slot): SlotValues {
  return {
    slot,
    rows: 0,
    scalar: true,
    at: (): CellValue => 0,
  };
}

/**
 * H8's resolver: a channel's values as a `(low, high)` pair.
 *
 * The ranged pair wins when **both** endpoints are bound, because it
 * is the primitive; a half-written pair (`y1` with no `y0`) is not
 * a range and falls through to the simple form, which V19 reports at
 * step 22. A channel with no ranged spelling — `color`, `size` —
 * has no ranged form to resolve and returns `null`.
 *
 * @param el - The widget.
 * @param channel - The base channel.
 * @returns Its endpoints, or `null` when the channel is unbound.
 */
export function rangedValuesOf(
  el: HdvlElement,
  channel: Channel,
): RangedValues | null {
  // ★ Step 29's container override, consulted BEFORE the
  // attributes: a stacked child's `(y0ₖ, y1ₖ)` and a container's
  // hoisted shared channel are derived, and a derived endpoint
  // supersedes an authored one exactly here and nowhere below.
  const derived = rangedOverrideOf(el, channel);
  if (derived !== null) {
    return derived;
  }
  const pair = CHANNEL_SLOTS[channel].ranged;
  if (pair === null) {
    return null;
  }
  const low = slotValuesOf(el, pair[0]);
  const high = slotValuesOf(el, pair[1]);
  if (low !== null && high !== null) {
    return { channel, low, high, sugar: false };
  }
  const simple = slotValuesOf(el, CHANNEL_SLOTS[channel].simple);
  if (simple === null) {
    return null;
  }
  return {
    channel,
    low: baselineZero(pair[0]),
    high: simple,
    sugar: true,
  };
}

/**
 * §7.2's request path for a mark — one `Binding` per slot bound to
 * a **column**, and none for a literal.
 *
 * `raw: true`, because a mark needs values and not a domain; a
 * scale binding the same column coalesces with it in the worker's
 * union, whose `raw` is OR-merged (R6).
 *
 * @param el - The widget.
 * @param slots - Every slot it publishes.
 * @returns Its bindings.
 */
export function markBindings(
  el: HdvlElement,
  slots: readonly Slot[],
): readonly Binding[] {
  const ref = sourceOf(el);
  if (ref === null) {
    return [];
  }
  const out: Binding[] = [];
  for (const slot of slots) {
    const raw = (el.getAttribute(slot) ?? "").trim();
    if (raw !== "" && IDENTIFIER.test(raw)) {
      out.push({ slot, ref, column: raw, raw: true });
    }
  }
  return out;
}

// ---------------------------------------------------------------
// §4.7's ordinal clauses — reported here, diagnosed by validate.ts
// ---------------------------------------------------------------

/** What one widget's rows dropped, over one frame (§4.7). */
export interface DropTally {
  /** Rows that produced no mark. */
  dropped: number;
  /** Channels whose ordinal domain rejected at least one value. */
  ordinal: Set<Channel>;
}

/**
 * A fresh tally. One per `scene()` call — it is frame state, never
 * element state.
 *
 * @returns An empty tally.
 */
export function newTally(): DropTally {
  return { dropped: 0, ordinal: new Set<Channel>() };
}

/**
 * Records one channel's contribution to a dropped row, and emits
 * §4.7's notice when the cause is an ordinal domain.
 *
 * @param tally - The frame's tally.
 * @param el - The widget.
 * @param projection - Its projection.
 * @param channel - The channel that dropped.
 * @param value - The value that dropped.
 */
export function tallyDrop(
  tally: DropTally,
  el: HdvlElement,
  projection: Projection,
  channel: Channel,
  value: CellValue,
): void {
  if (!projection.outOfDomain(channel, value)) {
    return;
  }
  tally.ordinal.add(channel);
  noticeOutOfDomain(el, channel, String(value));
}

/**
 * §4.7's all-drop clause: *"If every row drops, the **scale**
 * errors"*.
 *
 * It is scoped to the ordinal cause on purpose. A series whose every
 * `y` is null is `:state(empty)` (§3.4.1) and not an error — the RFC
 * reads the all-drop as *"a mistyped column far more often than a
 * filter"*, which is a statement about the domain and the data
 * disagreeing, not about missing values.
 *
 * @param el - The widget.
 * @param projection - Its projection.
 * @param tally - The frame's tally.
 * @param rows - The widget's N.
 * @param emitted - How many rows produced a mark.
 */
export function reportDrops(
  el: HdvlElement,
  projection: Projection,
  tally: DropTally,
  rows: number,
  emitted: number,
): void {
  if (rows === 0 || emitted > 0 || tally.ordinal.size === 0) {
    return;
  }
  for (const channel of tally.ordinal) {
    const scale = projection.element(channel);
    if (scale !== null) {
      reportAllRowsDropped(scale, channel);
      return;
    }
  }
}

// ---------------------------------------------------------------
// §6.1's paint resolution, and §6.2's parameters
// ---------------------------------------------------------------

/** A registered `<length>` / `<number>` computed value. */
function cssNumber(
  raw: undefined | string,
  fallback: number,
): number {
  const n = Number.parseFloat((raw ?? "").trim());
  return Number.isFinite(n) ? n : fallback;
}

/**
 * `--hdml-line-style` → a dash pattern, in CSS px.
 *
 * **SPEC §9 names the three keywords and no numbers**, so the
 * pattern is this runtime's convention. It is expressed as a
 * multiple of the stroke width rather than in absolute px, so a
 * `3px` emphasis line dashes proportionally instead of turning into
 * a nearly-solid one — the same reason a browser's own `dashed`
 * border scales with `border-width`.
 */
function dashOf(style: string, width: number): number[] | null {
  if (style === "dashed") {
    return [width * 4, width * 3];
  }
  return style === "dotted" ? [width, width * 2] : null;
}

/**
 * The paint of a **stroked** mark (§6.1: `hdml-line` is *"stroked,
 * `fill: null`"*).
 *
 * §6.1's paint-resolution sentence — *a bound `color` channel wins
 * over `--hdml-fill-color` and over its `_hover` variant* — is
 * written for the filled marks that are its common case. A stroked
 * mark's series colour is its **stroke**, and SPEC §9 gives
 * `--hdml-line-color` to *"stroked widgets"*, so that is what a
 * bound `color` wins over here. Both readings agree on the part
 * that matters: the channel wins. Neither `_hover` variant is read
 * at all — a per-mark hover value needs the renderer to know which
 * node is hovered, which `Paint` cannot express (SPEC §9 routes it
 * through the stroke variants at a later slice).
 *
 * @param m - The widget's measured snapshot.
 * @param color - The resolved `color`-channel paint, or `null`.
 * @returns The stroke paint.
 */
export function strokePaint(
  m: Measured,
  color: string | null,
): Paint {
  const width = cssNumber(m.props.get("--hdml-line-width"), 1.5);
  const style = (m.props.get("--hdml-line-style") ?? "solid").trim();
  return {
    fill: null,
    stroke: color ?? m.props.get("--hdml-line-color") ?? null,
    strokeWidth: width,
    dash: dashOf(style, width),
  };
}

/**
 * The paint of a **filled** mark — `hdml-area`'s band and
 * `hdml-bar`'s rect (§6.1).
 *
 * This is §6.1's paint sentence read literally, on the two marks it
 * was written for: *a bound `color` channel wins over
 * `--hdml-fill-color` and over its `_hover` variant*. SPEC §9 gives
 * the `--hdml-fill-*` properties to *"filled widgets"* and the
 * `--hdml-line-*` properties to *"stroked"* ones, so this is
 * {@link strokePaint}'s sibling and not a superset of it.
 *
 * **A filled mark does not also stroke.** §6.1 gives the area *"one
 * `path`, filled"* and the bar *"one `rect`"*, neither of which
 * mentions an outline, and SPEC §9 registers no property that would
 * control one — a stroke here would take `--hdml-line-color`'s
 * initial value and put a visible edge on every bar in the corpus
 * that no author asked for and none could turn off. `strokeWidth` is
 * therefore `0` and `stroke` is `null`.
 *
 * @param m - The widget's measured snapshot.
 * @param color - The resolved `color`-channel paint, or `null`.
 * @returns The fill paint.
 */
export function fillPaint(m: Measured, color: string | null): Paint {
  return {
    fill: color ?? m.props.get("--hdml-fill-color") ?? null,
    stroke: null,
    strokeWidth: 0,
    dash: null,
  };
}

/**
 * §6.1's paint resolution: the `color` channel's contribution, or
 * `null` when the widget binds none.
 *
 * A scalar `color='"North"'` — SPEC §5's authoring convention, and
 * every corpus use — broadcasts one colour to every row, and `row`
 * is then the only colour there is.
 *
 * **A *varying* `color` on a path widget is an error** — the plan's
 * second scheduled D1 escalation, decided with the user on
 * 2026-08-23. §2.5's `path` node carries **one** `Paint`, so a
 * `hdml-line`/`hdml-area` binding `color` to a column or a literal
 * array cannot be painted honestly; `validate.ts`'s `checkPathColor`
 * reports it as **V3** under the `varying-path-color` code and the
 * unit blanks. `hdml-bar` is deliberately **not** in that rule: it
 * emits one node per row and calls this per row, which is a per-row
 * colour carried honestly. So on a path widget this function is only
 * ever reached with a scalar binding, for which every row's answer
 * is the same one — it is not a live fallback for the varying case.
 *
 * @param ctx - The frame's snapshot.
 * @param el - The widget.
 * @param row - The row whose colour is wanted.
 * @returns The resolved CSS `<color>`, or `null`.
 */
export function channelColor(
  ctx: FrameContext,
  el: HdvlElement,
  row: number,
): string | null {
  const values = slotValuesOf(el, CHANNEL_SLOTS.color.simple);
  if (values === null) {
    return null;
  }
  const scale = chainScaleOf(ctx, el, "color");
  if (scale === null) {
    return null;
  }
  const value = values.at(row);
  return value === null ? null : scale.paint(value);
}

/** The eight values, as a set the resolver can test against. */
const TYPES: ReadonlySet<string> = new Set<string>(CURVE_TYPES);

/**
 * `--hdml-curve-type`, narrowed to §6.2's closed enum.
 *
 * The property registers with that enum as its `syntax`, so the UA
 * has already rejected anything else — this narrows the string to
 * the type rather than validating it, and falls back to the
 * registered initial.
 *
 * @param m - The widget's measured snapshot.
 * @returns The curve type.
 */
export function curveTypeOf(m: Measured): CurveType {
  const raw = (m.props.get("--hdml-curve-type") ?? "").trim();
  return TYPES.has(raw) ? <CurveType>raw : "linear";
}

/**
 * §6.2's six parameters, resolved from the **same** computed style
 * every other value on this snapshot came from.
 *
 * `kernel/curves.ts` takes numbers and plain strings only and reads
 * no CSS value; this is the whole of the translation.
 *
 * @param m - The widget's measured snapshot.
 * @returns The parameters.
 */
export function curveOptionsOf(m: Measured): CurveOptions {
  return {
    basisBeta: cssNumber(m.props.get("--hdml-curve-basis-beta"), 1),
    bezierTangents: (
      m.props.get("--hdml-curve-bezier-tangents") ?? ""
    ).trim(),
    cardinalTension: cssNumber(
      m.props.get("--hdml-curve-cardinal-tension"),
      0,
    ),
    catmullRomAlpha: cssNumber(
      m.props.get("--hdml-curve-catmull-rom-alpha"),
      0.5,
    ),
    monotonicity: cssNumber(
      m.props.get("--hdml-curve-cubic-monotonicity"),
      1,
    ),
    stepChange: (
      m.props.get("--hdml-curve-step-change") ?? "middle"
    ).trim(),
  };
}

/**
 * §5.7's `DatumSource`: the source row a hit index names,
 * **restricted to this widget's bound channels**.
 *
 * It cannot be the full row — the query union only ever fetches
 * bound columns — and it is read from the adopted data rather than
 * by inverting a scale, which §5.7 rejects outright.
 *
 * @param el - The widget.
 * @param slots - Every slot it publishes.
 * @param index - The row a hit resolved.
 * @returns The row, or `null` when the widget binds nothing.
 */
export function datumOf(
  el: HdvlElement,
  slots: readonly Slot[],
  index: number,
): Readonly<Record<string, unknown>> | null {
  const row: Record<string, unknown> = {};
  let any = false;
  for (const slot of slots) {
    const values = slotValuesOf(el, slot);
    if (values === null) {
      continue;
    }
    any = true;
    row[slot] = values.at(index);
  }
  return any ? row : null;
}

/**
 * One mark's `SceneGroup` shell — §2.5's five box-level fields,
 * transferred from the measured snapshot exactly as §5.4 requires.
 *
 * `role` is `"mark"` for every widget that goes through here, which
 * is what makes §3.4.1's `empty` decidable from the scene alone.
 *
 * @param el - The widget.
 * @param m - Its measured snapshot.
 * @param nodes - What it painted.
 * @returns The group.
 */
export function markGroup(
  el: HdvlElement,
  m: Measured,
  nodes: readonly SceneNode[],
): SceneGroup {
  return {
    widget: el.uid,
    tag: el.localName,
    role: "mark",
    box: m.box,
    opacity: m.opacity,
    filter: m.filter,
    visibility: m.visibility,
    clip: m.clip,
    clipPath: m.clipPath,
    nodes,
  };
}
