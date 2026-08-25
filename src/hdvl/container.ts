/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The two seams a layout container re-parameterises its children
 * through (RFC 016/001 §6.4, §12; SPEC §7, R19).
 *
 * **A container paints nothing and its children know nothing about
 * it.** SPEC §7's division of labour — *"the container carries the
 * relation, its parameters, and the shared independent channel; the
 * child tag carries the geometry kind"* — is only true if the child
 * is an ordinary mark that a container may re-parameterise from
 * outside. That is what this module is: two registries a container
 * writes during COMPUTE and two readers consult, so `hdml-bar` and
 * `hdml-area` contain no container branch at all.
 *
 * **1. The ranged override** — `hdml-stack`'s. §6.4 makes the
 * ranged form the primitive a container *compiles into*, so a
 * stacked child is a plain ranged mark from `y0ₖ` to `y0ₖ + yₖ`.
 * {@link import("./mark").rangedValuesOf} consults
 * {@link rangedOverrideOf} **before** it reads attributes, and both
 * widgets already read `.low`/`.high` and nothing else.
 *
 * **2. The band slot** — `hdml-cluster`'s. SPEC §7 calls the
 * subdivision *"an anonymous inner band scale whose domain is the
 * children in DOM order"*, and that is exactly what
 * {@link subdivide} returns: the same `Scale`, answering §4.4's band
 * for slot *k* of *n* inside the outer one.
 * {@link import("./scale").chainScaleOf} applies it, so the scale a
 * clustered widget resolves *is* the inner one and no mark divides
 * anything.
 *
 * **★ R19 — one band formula.** The inner band is
 * {@link import("./kernel/scale-band").bandOf} at **`b = 1`**, not
 * `outer.width / n`: *"there is no authorable inner gap"*, and `b`
 * is an ordinary parameter of §4.4's formula with no special case.
 * This module therefore contains no arithmetic of its own for it.
 *
 * **★ The overrides are keyed by the CHILD and fenced by its
 * parent.** A container writes onto its **direct** children only —
 * a stack inside a cluster re-hoists to its own — so `owner` is
 * always the child's `parentElement`, and comparing the two is an
 * exact staleness test: a child moved out of its container stops
 * reading the entry on the next frame without anything having to
 * clear it. The maps are `WeakMap`s, so a removed child's entry is
 * collectable rather than leaked.
 *
 * **★ Containers precede their children in document order**, which
 * `schedule.ts` walks and `resolve.ts` builds, so a container's
 * `scene(ctx)` has always run before the children that read what it
 * wrote. That ordering is the whole synchronisation mechanism, and
 * it is a property of the walk rather than of a phase this module
 * introduces.
 *
 * @module hdvl/container
 */

import type { HdvlElement } from "./base";
import type { Channel } from "./resolve";
import type { RangedValues } from "./mark";
import type { Scale, ScaleBand } from "./scale";
import { resolutionOf } from "./resolve";
import { bandOf } from "./kernel/scale-band";
import {
  ARC_ATTRS_LIST,
  AREA_ATTRS_LIST,
  HDVL_TAG_NAMES,
} from "./vocabulary";

/** §6.4's slot: child *k* of *n*, both derived from structure. */
export interface BandSlot {
  /** The channel whose band is subdivided — the shared one. */
  readonly channel: Channel;
  /** The child's index among its container's rendered children. */
  readonly index: number;
  /** How many children are rendered. */
  readonly count: number;
}

/** What one container wrote for one child, this frame. */
interface Entry<T> {
  /** The container that wrote it — always the child's parent. */
  readonly owner: HdvlElement;
  readonly value: T;
}

const ranged = new WeakMap<
  HdvlElement,
  Entry<Partial<Record<Channel, RangedValues>>>
>();

const slots = new WeakMap<HdvlElement, Entry<BandSlot>>();

/**
 * An entry, if the container that wrote it is still this element's
 * parent.
 *
 * @param map - The registry.
 * @param el - The child.
 * @returns The value, or `null`.
 */
function live<T>(
  map: WeakMap<HdvlElement, Entry<T>>,
  el: HdvlElement,
): T | null {
  const hit = map.get(el);
  if (hit === undefined) {
    return null;
  }
  return hit.owner === el.parentElement ? hit.value : null;
}

/**
 * The container ancestors of an element, nearest first.
 *
 * V13 makes containers **contiguous** — a container's parent is a
 * tip scale or another container — so the walk stops at the first
 * ancestor that is not one, and the list is at most two long
 * (stack-in-cluster is V17's only legal nesting).
 *
 * It is a DOM walk rather than a read of `Resolution.container`,
 * which for a container element is the element **itself** (the
 * nearest container of a stack is that stack) and so cannot be
 * followed upward.
 *
 * @param el - Any display element.
 * @returns Its container ancestors, nearest first.
 */
export function containerChainOf(el: HdvlElement): HdvlElement[] {
  const out: HdvlElement[] = [];
  let node = el.parentElement;
  while (node !== null) {
    const kid = <HdvlElement>(<unknown>node);
    if (
      resolutionOf(kid) === undefined ||
      kid.family !== "container"
    ) {
      break;
    }
    out.push(kid);
    node = node.parentElement;
  }
  return out;
}

/**
 * The children a container renders, in DOM order.
 *
 * **`hidden` is the platform's** (see `container-stack.ts`), so
 * this is one `el.hidden` read and no HDVL machinery. Slot count is
 * the *rendered*-child count and the baseline derive runs over the
 * *rendered* children, which is SPEC §7's *"a child's `hidden`
 * re-derives the relation"* in the one place both containers share.
 *
 * @param el - The container.
 * @returns Its rendered display children, in DOM order.
 */
export function renderedChildrenOf(el: HdvlElement): HdvlElement[] {
  const out: HdvlElement[] = [];
  for (const node of Array.from(el.children)) {
    const kid = <HdvlElement>(<unknown>node);
    if (resolutionOf(kid) !== undefined && !kid.hidden) {
      out.push(kid);
    }
  }
  return out;
}

/**
 * The **shared independent channel** a container owns (SPEC §7, V6).
 *
 * The container that binds it may be this one or an outer one:
 * `04-grouped-stacked` E writes `x` on the `hdml-cluster` and
 * nothing on the two `hdml-stack`s inside it, and the inner stacks
 * still have to know which of the plane's two channels they must
 * not treat as the dependent one.
 *
 * **It names no channel** (H7): the candidates are the plane's own
 * two, in the plane's composition order.
 *
 * @param el - The container.
 * @param channels - The plane's channels, in composition order.
 * @returns The shared channel, or `null` when nothing binds one.
 */
export function sharedChannelOf(
  el: HdvlElement,
  channels: readonly [Channel, Channel],
): Channel | null {
  for (const node of [el, ...containerChainOf(el)]) {
    for (const channel of channels) {
      if (rangedOverrideOf(node, channel) !== null) {
        return channel;
      }
      for (const slot of SPELLINGS[channel]) {
        const raw = node.getAttribute(slot);
        if (raw !== null && raw.trim() !== "") {
          return channel;
        }
      }
    }
  }
  return null;
}

/**
 * Every attribute name each positional channel can be spelled with.
 *
 * Reading {@link import("./mark").CHANNEL_SLOTS} would be the
 * obvious move and is the wrong one: `mark.ts` reads *this* module,
 * so a value import back into it is a cycle. The names still come
 * from the published enums and never from a literal (R8). The four
 * positional channels are what a container can hoist; `color` and
 * `size` are per-child by SPEC §7's own division of labour.
 */
const SPELLINGS: Readonly<Record<Channel, readonly string[]>> = {
  x: [AREA_ATTRS_LIST.X, AREA_ATTRS_LIST.X0, AREA_ATTRS_LIST.X1],
  y: [AREA_ATTRS_LIST.Y, AREA_ATTRS_LIST.Y0, AREA_ATTRS_LIST.Y1],
  angle: [
    AREA_ATTRS_LIST.ANGLE,
    ARC_ATTRS_LIST.A0,
    ARC_ATTRS_LIST.A1,
  ],
  radius: [
    AREA_ATTRS_LIST.RADIUS,
    AREA_ATTRS_LIST.R0,
    AREA_ATTRS_LIST.R1,
  ],
  color: [],
  size: [],
};

/**
 * Publishes what a container derived for one child, this frame.
 *
 * Replaces the child's whole entry rather than merging into it, so
 * a channel a container stopped hoisting cannot survive a frame.
 *
 * @param child - The direct child.
 * @param owner - The container.
 * @param values - Its channels' resolved `(low, high)` pairs.
 */
export function setRangedOverrides(
  child: HdvlElement,
  owner: HdvlElement,
  values: Partial<Record<Channel, RangedValues>>,
): void {
  ranged.set(child, { owner, value: values });
}

/**
 * Withdraws a child's overrides — a `hidden` child, or one whose
 * container could not derive anything this frame.
 *
 * @param child - The direct child.
 */
export function clearRangedOverrides(child: HdvlElement): void {
  ranged.delete(child);
}

/**
 * H8's per-frame, per-element override — read by
 * {@link import("./mark").rangedValuesOf} **before** it reads
 * attributes.
 *
 * @param el - The widget.
 * @param channel - The base channel.
 * @returns The container's pair, or `null`.
 */
export function rangedOverrideOf(
  el: HdvlElement,
  channel: Channel,
): RangedValues | null {
  return live(ranged, el)?.[channel] ?? null;
}

/**
 * Publishes a child's slot in its cluster's band.
 *
 * @param child - The direct child.
 * @param owner - The cluster.
 * @param slot - Its slot.
 */
export function setBandSlot(
  child: HdvlElement,
  owner: HdvlElement,
  slot: BandSlot,
): void {
  slots.set(child, { owner, value: slot });
}

/**
 * Withdraws a child's slot.
 *
 * @param child - The direct child.
 */
export function clearBandSlot(child: HdvlElement): void {
  slots.delete(child);
}

/**
 * The slot a widget renders in, or `null` outside a cluster.
 *
 * A cluster writes onto its **direct** children, so a bar inside a
 * clustered stack finds its slot on the stack — one step up the
 * container chain. That is why the lookup walks and the write does
 * not: the stack does not re-hoist a slot it has no reason to know
 * about, and the answer is the same object either way.
 *
 * @param el - The widget.
 * @returns Its slot, or `null`.
 */
export function bandSlotOf(el: HdvlElement): BandSlot | null {
  const own = live(slots, el);
  if (own !== null) {
    return own;
  }
  for (const node of containerChainOf(el)) {
    const hit = live(slots, node);
    if (hit !== null) {
      return hit;
    }
  }
  return null;
}

/**
 * SPEC §7's *"anonymous inner band scale"* — the same `Scale`, with
 * §4.4's band taken **inside** the outer one.
 *
 * **★ R19: `bandOf(k, n, …, 1)`, and no arithmetic here.** The
 * inner bandwidth is `1` because §6.4 gives the subdivision no
 * authorable gap, and `b` is an ordinary parameter of the one band
 * formula — so a cluster is that formula at `b = 1` rather than a
 * second entry point. `--hdml-bandwidth` still opens the gap
 * between *categories*, on the outer band, where the scale reads it.
 *
 * `project` is re-derived rather than delegated because §4.4 makes
 * an ordinal projection *the band's centre*: leaving it pointing at
 * the outer band would put a clustered `hdml-point` in the middle
 * of the group while its bar sat in a slot.
 *
 * @param scale - The resolved outer scale.
 * @param slot - The widget's slot.
 * @returns The subdivided scale, or `scale` where there is no band
 * to subdivide (V17 reports a non-ordinal shared scale).
 */
export function subdivide(scale: Scale, slot: BandSlot): Scale {
  if (scale.kind !== "ordinal") {
    return scale;
  }
  const inner = (v: string): ScaleBand | null => {
    const outer = scale.bandOf(v);
    if (outer === null) {
      return null;
    }
    return bandOf(
      slot.index,
      slot.count,
      [outer.start, outer.start + outer.width],
      1,
    );
  };
  return {
    ...scale,
    bandOf: inner,
    project: (v: number | string): number | null =>
      inner(String(v))?.centre ?? null,
  };
}

/**
 * The element §9's `--hdml-curve-*` rows name as the reader.
 *
 * *"`hdml-line`, `hdml-area`; **for a stacked area, `hdml-stack`**
 * (children's curve properties are inert inside a stack, §7)"* —
 * and §7 gives the reason: *"band k's top is band k+1's baseline,
 * so per-child curves would tear the shared edges"*. One element
 * answers for the whole stack, so the edges cannot disagree.
 *
 * A child's own declaration still **computes** — it is a registered
 * inheriting property and CSS is not being lied to — and is simply
 * never read, which is what SPEC means by *inert*.
 *
 * @param el - The mark.
 * @returns The stack it is in, or the mark itself.
 */
export function curveSourceOf(el: HdvlElement): HdvlElement {
  const container = resolutionOf(el)?.container ?? null;
  return container !== null &&
    container !== el &&
    container.localName === <string>HDVL_TAG_NAMES.STACK
    ? container
    : el;
}
