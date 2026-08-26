/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `hdml-legend` element (RFC 016/001 §2.2, §5.5, §6.6, R18).
 *
 * @module hdvl/guide-legend
 */

import { customElement, property } from "lit/decorators.js";
import { HdvlElement } from "./base";
import type { FrameContext, Measured } from "./measure";
import type { Paint, Rect, SceneGroup, SceneNode } from "./scene";
import type { Scale } from "./scale";
import { paintSuppressed } from "./subscribe";
import { fillPaint } from "./mark";
import { channelOf } from "./resolve";
import { chainScaleOf } from "./scale";
import { textsOf } from "./guide-label";
import { guideGroup, tickSpecOf } from "./guide-spec";
import {
  HDVL_FAMILIES,
  HDVL_TAG_NAMES,
  LEGEND_ATTRS_LIST,
} from "./vocabulary";

/** `--hdml-tick-style`'s other value; its initial is `rect`. */
const ELLIPSE = "ellipse";

/** `--hdml-legend-direction`'s other value; the initial is
 *  `column`. */
const ROW = "row";

/**
 * How many rects the continuous ramp bar is sampled into.
 *
 * A `Paint` carries **one** colour (§2.5), so a gradient is a run of
 * flat samples and there is no node kind that would make it one
 * object — which is the same reason `--hdml-color-interpolate` is a
 * stop list rather than a gradient string. Fixed rather than derived
 * from the bar's pixel length on purpose: the UA default sizes the
 * box with `width: max-content`, so a length-derived count would be
 * **text-derived** and could differ by one between engines (plan
 * rule 8), putting a cross-engine split into every golden that
 * carries a ramp.
 */
const RAMP_SAMPLES = 32;

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
 * §9's three `--hdml-legend-*` properties, resolved once, plus the
 * box they lay out in.
 *
 * **One axis question, asked once.** `--hdml-legend-direction` is
 * *"the entry flow axis; also orients a continuous legend's ramp
 * bar"* (§9), so both modes below are written against `along` (the
 * flow axis) and `across` (the other one) and neither names `x` or
 * `y` twice. That is what keeps the two orientations one code path
 * rather than two transposed copies of the same arithmetic.
 */
interface Flow {
  /** Whether entries advance along **x** (`direction: row`). */
  horizontal: boolean;
  /** `--hdml-legend-gap` — between swatch and name, and between
   *  entries, which §9 makes one property deliberately. */
  gap: number;
  /** `--hdml-legend-swatch-size` — a swatch's extent, and a ramp
   *  bar's thickness. **Not** `--hdml-tick-width`, whose §9 row
   *  says so in as many words. */
  swatch: number;
  /** `--hdml-tick-style` — the swatch's shape. */
  style: string;
  /** The legend's own **content** box, in view coordinates. */
  box: Rect;
}

/** Reads {@link Flow} off the frame's snapshot. */
function flowOf(m: Measured): Flow {
  const direction = (
    m.props.get("--hdml-legend-direction") ?? ""
  ).trim();
  return {
    horizontal: direction === ROW,
    gap: cssNumber(m.props.get("--hdml-legend-gap"), 4),
    swatch: cssNumber(m.props.get("--hdml-legend-swatch-size"), 10),
    style: (m.props.get("--hdml-tick-style") ?? "").trim(),
    box: m.content,
  };
}

/** Where the flow starts, and how far it may run. */
function span(flow: Flow): [number, number] {
  return flow.horizontal
    ? [flow.box.x, flow.box.w]
    : [flow.box.y, flow.box.h];
}

/** The other axis's origin — the lane the flow starts in. */
function lane(flow: Flow): number {
  return flow.horizontal ? flow.box.y : flow.box.x;
}

/**
 * One swatch, centred in the entry's own line — §6.6's *"a swatch
 * (`rect` or `ellipse` per `--hdml-tick-style`, sized by
 * `--hdml-legend-swatch-size`)"*.
 *
 * **★ Its size is `--hdml-legend-swatch-size` and not
 * `--hdml-tick-width`.** SPEC §9's `--hdml-tick-width` row reads
 * *"`hdml-tick`, `hdml-point` only — a legend swatch's geometry is
 * `--hdml-legend-swatch-size`"*, and reading the wrong property is
 * invisible in a scene: both give a number of pixels and both draw
 * a plausible square. The test therefore asserts against the
 * **computed property**, which is the same defence
 * `guide-tick.ts`'s diameter rule takes.
 *
 * **★ Where its `decorative: true` lives.** §6.6 calls the swatch
 * decoration and the name real text, and *inside one element* that
 * pair is an implementation invariant rather than something an
 * author can get wrong — which is the whole of finding 17's
 * argument for a dedicated element. But §2.5 gives `decorative` to
 * the `text` node **alone**, so a swatch has no such field to set:
 * its decorative-ness is carried by **the node kind it emits**,
 * exactly as `hdml-tick`'s is. The invariant the test asserts
 * directly is therefore the structural one — an entry emits exactly
 * one `text` node, it is the name, and the swatch is never one.
 *
 * @param flow - The resolved properties.
 * @param cx - The swatch centre's view x.
 * @param cy - Its view y.
 * @param paint - The resolved fill.
 * @returns The node.
 */
function swatch(
  flow: Flow,
  cx: number,
  cy: number,
  paint: Paint,
): SceneNode {
  const r = flow.swatch / 2;
  return flow.style === ELLIPSE
    ? {
        k: "ellipse",
        // §2.5: `i` is a SOURCE ROW index, and a domain value is
        // not one — a key entry exists whether or not any row has
        // that value (§6).
        i: -1,
        cx: num(cx),
        cy: num(cy),
        rx: num(r),
        ry: num(r),
        ...paint,
      }
    : {
        k: "rect",
        i: -1,
        x: num(cx - r),
        y: num(cy - r),
        w: num(flow.swatch),
        h: num(flow.swatch),
        ...paint,
      };
}

/** One entry, measured before anything is placed. */
interface Entry {
  /** The domain value, rendered. */
  text: string;
  /** Its colour, or `null` when the palette is exhausted. */
  color: string | null;
  /** Swatch + gap + the name's width. */
  w: number;
  /** The line's height — never under the swatch's. */
  h: number;
}

/**
 * ★ **§6.6's ordinal key — one entry per domain value, always the
 * whole domain.**
 *
 * *"A thinned key lies"*, which is why `count`/`step`/`values` are a
 * **V20 error** here rather than being quietly ignored: an author
 * who asks for four of nine categories is asking for a key that
 * misreports the mapping, and the honest answers are to say so or to
 * paint nine.
 *
 * The domain comes from `Scale.domain()` and **not** from the marks:
 * §6 makes a scale's domain the author's statement, so a category no
 * row uses still gets its entry, and the key does not flicker as
 * data arrives.
 *
 * **One entry is one datum of a mapping**, so the swatch and the
 * name are generated together, in one loop, from one value —
 * `entry k`'s colour is `paint(domain[k])` and its text is
 * `domain[k]` by construction. That is finding 17's whole reason for
 * a dedicated element: the `hdml-tick` + `hdml-label` spelling made
 * swatch↔name alignment cascade-determined geometry no validator
 * could check, and here there is no cascade to disagree with.
 *
 * **An exhausted palette does not skip the entry.** `paletteColor`
 * returns `null` past the end rather than wrapping, and this paints
 * that entry in `--hdml-fill-color` — the same visible, uniform
 * fallback the marks take — because a key that silently dropped its
 * ninth category would be a key that disagrees with the chart.
 * SPEC §9 makes the *scale* error for it (`palette-exhausted`,
 * reported by `validate.ts`), and this is what the reader sees
 * meanwhile.
 *
 * @param ctx - The frame's snapshot.
 * @param scale - The resolved colour scale.
 * @param m - The legend's MEASURE snapshot.
 * @param flow - Its resolved properties.
 * @returns Two nodes per domain value, in domain order.
 */
function keyNodes(
  ctx: FrameContext,
  scale: Scale,
  m: Measured,
  flow: Flow,
): SceneNode[] {
  const values = scale.domain()?.values ?? [];
  const entries: Entry[] = values.map((v) => {
    // SPEC §7: an ordinal channel renders its domain strings
    // verbatim, and `Scale.format` already is that sentence (R12).
    const text = scale.format(v);
    const metrics = ctx.measureText(text, m.font);
    return {
      text,
      color: scale.paint(v),
      w: flow.swatch + flow.gap + metrics.width,
      h: Math.max(flow.swatch, metrics.ascent + metrics.descent),
    };
  });
  const nodes: SceneNode[] = [];
  const [start, limit] = span(flow);
  let along = start;
  let across = lane(flow);
  let thickest = 0;
  for (let k = 0; k < entries.length; k++) {
    const entry = entries[k];
    const size = flow.horizontal ? entry.w : entry.h;
    // ★ The wrap, and its one guard: a box with NO extent along the
    // flow axis wraps nothing. The UA default sizes the cross axis
    // with `width: max-content` over an empty shadow tree, so a
    // zero extent is the DEFAULT case and not a degenerate one —
    // wrapping on it would put every entry on its own line forever.
    if (k > 0 && limit > 0 && along + size > start + limit) {
      across += thickest + flow.gap;
      along = start;
      thickest = 0;
    }
    const x = flow.horizontal ? along : across;
    const y = flow.horizontal ? across : along;
    nodes.push(
      swatch(
        flow,
        x + flow.swatch / 2,
        y + entry.h / 2,
        fillPaint(m, entry.color),
      ),
      {
        k: "text",
        i: -1,
        x: num(x + flow.swatch + flow.gap),
        y: num(y + entry.h / 2),
        text: entry.text,
        anchor: "start",
        baseline: "middle",
        font: m.font,
        // ★ The name is what the reader is told, so it is real
        // text: selectable, copyable, and not `aria-hidden` (§5.10).
        decorative: false,
        ...fillPaint(m, null),
      },
    );
    thickest = Math.max(
      thickest,
      flow.horizontal ? entry.h : entry.w,
    );
    along += size + flow.gap;
  }
  return nodes;
}

/**
 * ★ **§6.6's continuous ramp — the bar, and its graduations.**
 *
 * **R18, and this is the last place it could have been broken.** *"A
 * ramp sample's colour comes from `Scale.paint(v)` and from nowhere
 * else"*: the bar is sampled at real domain values and each sample
 * is painted by the same call a mark bound to the same scale makes,
 * so the legend and the chart cannot disagree about a colour. A
 * gradient looks like something a legend would own, and it is not —
 * `kernel/color.ts` does no colour-space maths on purpose, because
 * `color-mix(in <space>, …)` is the platform's interpolator and a
 * second one can disagree with the page's own CSS.
 *
 * **The bar's axis is the ramp fraction, not the domain.** Sample
 * *i* spans `project(vᵢ)` to `project(vᵢ₊₁)` — the scale's own
 * transform — so a `log` colour scale's colours sit where its values
 * sit, and the graduations from `ticks(spec)` land on the same axis
 * because `Tick.at` **is** that fraction. The samples themselves are
 * taken uniformly in the *domain*, because Contract 2 publishes no
 * inverse and inventing one here would be exactly the second
 * implementation R12 forbids; the cost is that a strongly non-linear
 * transform samples one end of the bar more coarsely than the other,
 * and every sample is still a real value painted where it belongs.
 *
 * **The graduations are formatted over the whole set** — `textsOf`,
 * `hdml-label`'s, called here as its second caller. SPEC §7 makes
 * that coherence a property of the label *set*: value-by-value
 * formatting reads `900K, 1.2M, 1.5M` on one colorbar, which is the
 * output §4.9 exists to prevent.
 *
 * @param ctx - The frame's snapshot.
 * @param el - The legend.
 * @param scale - The resolved colour scale.
 * @param m - The legend's MEASURE snapshot.
 * @param flow - Its resolved properties.
 * @returns The bar's samples, then one `text` per graduation.
 */
function rampNodes(
  ctx: FrameContext,
  el: HdvlElement,
  scale: Scale,
  m: Measured,
  flow: Flow,
): SceneNode[] {
  const extent = scale.domain()?.extent ?? null;
  const [start, length] = span(flow);
  const across = lane(flow);
  if (extent === null || length <= 0) {
    return [];
  }
  const [lo, hi] = extent;
  const valueAt = (t: number): number => lo + t * (hi - lo);
  const nodes: SceneNode[] = [];
  for (let i = 0; i < RAMP_SAMPLES; i++) {
    const v0 = valueAt(i / RAMP_SAMPLES);
    const v1 = valueAt((i + 1) / RAMP_SAMPLES);
    const f0 = scale.project(v0);
    const f1 = scale.project(v1);
    if (f0 === null || f1 === null) {
      continue;
    }
    const a0 = start + f0 * length;
    const size = (f1 - f0) * length;
    // The sample's colour is its own MIDPOINT's, so the bar's two
    // ends are the domain's two ends painted half a sample in —
    // never a stop repeated at an edge it does not reach.
    const paint = fillPaint(m, scale.paint((v0 + v1) / 2));
    nodes.push({
      k: "rect",
      i: -1,
      x: num(flow.horizontal ? a0 : across),
      y: num(flow.horizontal ? across : a0),
      w: num(flow.horizontal ? size : flow.swatch),
      h: num(flow.horizontal ? flow.swatch : size),
      ...paint,
    });
  }
  const ticks = scale.ticks(tickSpecOf(el));
  const texts = textsOf(el, scale, ticks);
  const paint = fillPaint(m, null);
  const off = across + flow.swatch + flow.gap;
  for (let i = 0; i < ticks.length; i++) {
    const at = start + ticks[i].at * length;
    nodes.push({
      k: "text",
      i: -1,
      x: num(flow.horizontal ? at : off),
      y: num(flow.horizontal ? off : at),
      text: texts[i],
      // The values hang off the bar's far side, so a `row` bar's
      // labels sit under it centred and a `column` bar's sit beside
      // it — the placement §6.5 derives for an axis, here decided by
      // the one axis fact this element has.
      anchor: flow.horizontal ? "middle" : "start",
      baseline: flow.horizontal ? "top" : "middle",
      font: m.font,
      decorative: false,
      ...paint,
    });
  }
  return nodes;
}

/**
 * The **visual-channel** guide: the color scale's key, as a
 * swatch-and-name entry per ordinal domain value or a labeled ramp
 * on a continuous one. It fuses glyph and text because a key entry
 * is one datum of a mapping — a swatch without its name is not a
 * key. Binds no columns and takes no `source`.
 *
 * **★ Its two modes are DERIVED, never authored** (§6.6): the mode
 * is the resolved scale's **tag**, a static tree lookup, and there
 * is no `mode` attribute and must not be one. `09-polar-area` A
 * re-keys the same markup from a ramp to a key by changing the scale
 * it sits under, which is the whole claim.
 *
 * **★ It is the last element in the vocabulary.** Finding 17
 * reversed SPEC §2's earlier *"no separate legend element"* with
 * cause, and both losing candidates fail here rather than in the
 * abstract: `hdml-axis channel="color"` needs **modal attribute
 * sets** (`format`/`count` legal on one channel only), and
 * `hdml-tick` + `hdml-label` on the color channel makes swatch↔name
 * alignment **cascade-determined geometry no validator can check**.
 * One element generating each entry whole dissolves both
 * *structurally* — see {@link keyNodes}.
 *
 * **★ It is not a `Binder`.** SPEC §6.6: *"binds no columns and
 * takes no `source`: it is the **scale's** key, not the marks'"*. It
 * declares no `bindings()`, so `subscribe.ts` never sees it, and a
 * page carrying a legend over a literal domain renders its key with
 * no data provider on the page at all.
 *
 * **★ Its overflow clips, and v1 builds no scrollport** (§9,
 * superseding §7's *"one box, one scrollport"*). Nothing here
 * implements that: `guideGroup` transfers `Measured.clip` — computed
 * `overflow` is not `visible` — onto the group, and the renderer
 * clips the group to its box, which is §5.4's reach rule applied to
 * every widget alike. `auto` and `scroll` therefore clip **without**
 * a scrollbar, and the reason is structural rather than an omission:
 * the entries paint on the **view's** surface, so this element's own
 * box has no scrollable content of its own for the platform to move.
 *
 * @tagname hdml-legend
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
@customElement(HDVL_TAG_NAMES.LEGEND)
export class HdmlLegendElement extends HdvlElement {
  public readonly tag = HDVL_TAG_NAMES.LEGEND;

  public readonly family = HDVL_FAMILIES[HDVL_TAG_NAMES.LEGEND];

  /**
   * @internal
   */
  @property({ type: String })
  [LEGEND_ATTRS_LIST.CHANNEL]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [LEGEND_ATTRS_LIST.COUNT]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [LEGEND_ATTRS_LIST.STEP]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [LEGEND_ATTRS_LIST.VALUES]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [LEGEND_ATTRS_LIST.FORMAT]: null | string = null;

  /**
   * @override
   *
   * The colour scale's key, in whichever of §6.6's two modes that
   * scale's tag names.
   *
   * **It resolves no plane and asks for no position** — which is why
   * it does not call `guide-spec.ts`'s `resolveGuide`, and could
   * not: that function's contract is a channel the *plane* consumes,
   * and `color` is consumed by no plane. What it does share with the
   * four positional guides is exactly two things, both taken from
   * that module unchanged: `tickSpecOf`, so the three density
   * attributes have one reader (R12), and `guideGroup`, so a
   * legend's group carries `role: "guide"` and the same five
   * box-level fields every other guide's does. **H6 measured:
   * `guide-spec.ts` needed no member it did not already have.**
   *
   * @param ctx - The frame's snapshot.
   * @returns Its group, or `null`.
   */
  public scene(ctx: FrameContext): SceneGroup | null {
    if (paintSuppressed(this)) {
      return null;
    }
    const channel = channelOf(
      this.getAttribute(LEGEND_ATTRS_LIST.CHANNEL),
    );
    if (channel === null) {
      return null;
    }
    const scale = chainScaleOf(ctx, this, channel);
    if (scale === null) {
      return null;
    }
    const m: Measured = ctx.measured(this);
    const flow = flowOf(m);
    // ★ §6.6's derivation, in one expression: the mode IS the
    // resolved scale's kind, which SPEC §6 makes its tag. No
    // attribute, no computed style, and nothing a page can say to
    // pick the other one.
    return guideGroup(
      this,
      m,
      scale.kind === "ordinal"
        ? keyNodes(ctx, scale, m, flow)
        : rampNodes(ctx, this, scale, m, flow),
    );
  }
}
