/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The resolution index (RFC 016/001 §3.3, §3.5, R35).
 *
 * **One depth-first walk per structural change, owned by the view**,
 * carrying the scale chain down and the tip flag up. It answers V1,
 * V13, V17, V19 and V20's ancestor-tag lookup once for the whole
 * view rather than once per element — a 21-element view with a
 * four-deep chain would otherwise walk that chain 21 times per
 * change.
 *
 * **No `getBoundingClientRect` is called here.** §3.3 is explicit:
 * the cost is one rect-free traversal, and MEASURE is a separate
 * phase. Mixing the two would make the index a layout-thrashing
 * read.
 *
 * This module is also **the one place that knows how an element
 * finds its view** (R35). `HdvlElement.view` is a read of the index
 * and nothing else; a `closest()` anywhere else would be a second
 * resolution source that disagrees after a DOM move, *and* would
 * produce an element the `ResizeObserver` never observes (R27).
 *
 * @module hdvl/resolve
 */

import type { HdvlElement } from "./base";
import type { HdmlViewElement } from "./view";
import { AXIS_ATTRS_LIST, VIEW_ATTRS_LIST } from "./vocabulary";

/**
 * The six channels of SPEC §3 — four positional (two per plane
 * kind) and two visual.
 *
 * The ranged forms (`x0`/`x1`, `y0`/`y1`, `a0`/`a1`, `r0`/`r1`) are
 * spellings of their base channel, not channels of their own: a
 * widget binding `y0` resolves the `y` scale.
 */
export type Channel =
  | "x"
  | "y"
  | "angle"
  | "radius"
  | "color"
  | "size";

/** {@link Channel}, enumerated. */
export const CHANNELS: readonly Channel[] = [
  "x",
  "y",
  "angle",
  "radius",
  "color",
  "size",
];

/**
 * Narrows a `channel` attribute value to the vocabulary, or `null`.
 *
 * A value outside the six is V3's error, reported by the validator
 * at step 12. The index simply does not chain it — a nonexistent
 * channel resolves no scale, which is the same outcome an unbound
 * chain has.
 *
 * @param value - A raw `channel` attribute value.
 * @returns The channel, or `null`.
 */
export function channelOf(value: null | string): Channel | null {
  if (value === null) {
    return null;
  }
  const v = <Channel>value.trim();
  return CHANNELS.includes(v) ? v : null;
}

/** An element of the `plane` family. */
export type PlaneElement = HdvlElement & { readonly family: "plane" };

/** An element of the `scale` family. */
export type ScaleElement = HdvlElement & { readonly family: "scale" };

/** An element of the `container` family. */
export type ContainerElement = HdvlElement & {
  readonly family: "container";
};

/** Everything one walk knows about one element (§3.3). */
export interface Resolution {
  view: HdmlViewElement;
  plane: PlaneElement | null;
  /** Nearest ancestor scale per channel, resolution
   *  stopping at the plane boundary (SPEC §4.8). A second
   *  same-channel scale in the chain is V1's error, not a
   *  precedence question. */
  chain: Partial<Record<Channel, ScaleElement>>;
  /** A scale with no scale children: where widgets and
   *  layout containers live (V13). */
  tip: boolean;
  container: ContainerElement | null;
  /** The error unit this element blanks with (§3.5). */
  unit: HdvlElement;
  /** Effective `source`, nearest-ancestor-wins (SPEC §4.5). */
  source: string | null;
}

/** Element → its resolution. */
export type ResolutionIndex = Map<HdvlElement, Resolution>;

/**
 * One map for every registered view, not one per view.
 *
 * An element belongs to exactly one view, so a per-view map and a
 * single map keyed by element carry the same information — and a
 * single map is what makes `HdvlElement.view` a one-lookup read
 * rather than a search over views.
 */
const entries: ResolutionIndex = new Map();

/** `uid` → element, for §5.7's `resolve()` → dispatch hop. */
const uids = new Map<string, HdvlElement>();

/** Which elements each view's last walk covered, document order. */
const membership = new Map<HdmlViewElement, HdvlElement[]>();

/** Every connected view, in connection order. */
const registry = new Set<HdmlViewElement>();

/**
 * Whether a node is a display element.
 *
 * **Duck-typed on purpose, twice over.** A `familyOf(localName)`
 * test would miss a legitimate `HdvlElement` registered under a tag
 * outside the vocabulary — which is exactly what the test probe is —
 * and a runtime `instanceof HdvlElement` would make `base` ↔
 * `resolve` a *value* cycle, where today it is a type-only one.
 *
 * @param node - Any element.
 * @returns Whether it is an `HdvlElement`.
 */
function isDisplay(node: Element): node is HdvlElement {
  const el = <Partial<HdvlElement>>(<unknown>node);
  return (
    typeof el.uid === "string" &&
    typeof el.family === "string" &&
    typeof el.scene === "function"
  );
}

/** The display children of an element, in document order. */
function displayChildren(el: Element): HdvlElement[] {
  const out: HdvlElement[] = [];
  for (const child of Array.from(el.children)) {
    if (isDisplay(child)) {
      out.push(child);
    }
  }
  return out;
}

/** What one level of the walk carries down. */
interface Ctx {
  view: HdmlViewElement;
  plane: PlaneElement | null;
  chain: Partial<Record<Channel, ScaleElement>>;
  container: ContainerElement | null;
  /** The OUTERMOST container ancestor — see {@link unitOf}. */
  outer: ContainerElement | null;
  source: string | null;
  tip: boolean;
}

/**
 * The error unit (§3.5).
 *
 * §3.5's table gives a widget inside a container the **container**,
 * on SPEC §7's all-or-nothing reading: a stack missing a layer is a
 * wrong chart, not a degraded one. The table does not say what a
 * *nested* container does, and the same reasoning answers it — a
 * cluster whose inner stack failed is equally wrong — so the unit is
 * the **outermost** container ancestor. **Step 29 confirmed it**
 * when the two containers gained bodies, and V6 then read the same
 * field for a second purpose: SPEC §11 scopes the shared-channel
 * ban to *"everything inside the OUTERMOST container"*, which is
 * this answer exactly. Two rules wanting the same walk is the
 * argument for it being computed once, here.
 */
function unitOf(
  el: HdvlElement,
  outer: ContainerElement | null,
): HdvlElement {
  if (
    el.family === "view" ||
    el.family === "plane" ||
    el.family === "scale"
  ) {
    return el;
  }
  return outer ?? el;
}

/** Visits one element, then its display children. */
function visit(
  el: HdvlElement,
  parent: Ctx,
  list: HdvlElement[],
): void {
  const family = el.family;
  const plane = family === "plane" ? <PlaneElement>el : parent.plane;
  // Channel resolution stops at the plane boundary (SPEC §4.8): a
  // scale outside a plane is invisible to a widget inside one, and
  // a scale in plane A is invisible in plane B.
  const chain = family === "plane" ? {} : parent.chain;
  const container =
    family === "container" ? <ContainerElement>el : parent.container;
  const outer =
    parent.outer ??
    (family === "container" ? <ContainerElement>el : null);
  const own = el.getAttribute(VIEW_ATTRS_LIST.SOURCE);
  const source = own === null ? parent.source : own;

  const kids = displayChildren(el);
  // The tip flag is carried UP: a scale is a tip iff no child of it
  // is a scale. For everything else the flag means "sits at a chain
  // tip", which is the form V13 reads.
  const tip =
    family === "scale"
      ? !kids.some((k) => k.family === "scale")
      : parent.tip;

  list.push(el);
  entries.set(el, {
    view: parent.view,
    plane,
    chain,
    tip,
    container,
    unit: unitOf(el, outer),
    source,
  });
  uids.set(el.uid, el);

  const next: Ctx = {
    view: parent.view,
    plane,
    chain,
    container,
    outer,
    source,
    tip,
  };
  if (family === "scale") {
    const ch = channelOf(el.getAttribute(AXIS_ATTRS_LIST.CHANNEL));
    if (ch !== null) {
      next.chain = { ...chain, [ch]: <ScaleElement>el };
    }
  }
  for (const kid of kids) {
    visit(kid, next, list);
  }
}

/** Forgets every entry the given view's last walk produced. */
function forget(view: HdmlViewElement): void {
  const previous = membership.get(view);
  if (previous === undefined) {
    return;
  }
  for (const el of previous) {
    entries.delete(el);
    if (uids.get(el.uid) === el) {
      uids.delete(el.uid);
    }
  }
  membership.delete(view);
}

/**
 * Announces a connected view. Called from the view's own
 * `connectedCallback`, **before** anything can ask for its index.
 *
 * @param view - The view.
 */
export function registerView(view: HdmlViewElement): void {
  registry.add(view);
}

/**
 * Announces a disconnected view and drops its whole index slice.
 *
 * @param view - The view.
 */
export function unregisterView(view: HdmlViewElement): void {
  registry.delete(view);
  forget(view);
}

/**
 * Rebuilds one view's slice of the index — §3.3's single walk.
 *
 * @param view - The view to walk.
 * @returns Every display element in it, **document order** (the
 * view first). Document order is paint order, so the caller may use
 * this list for both the observed set and the frame.
 */
export function reindexView(
  view: HdmlViewElement,
): readonly HdvlElement[] {
  forget(view);
  if (!registry.has(view)) {
    return [];
  }
  const list: HdvlElement[] = [];
  visit(
    view,
    {
      view,
      plane: null,
      chain: {},
      container: null,
      outer: null,
      // The view's own effective source is its own attribute; the
      // walk overwrites this with it on the first visit.
      source: null,
      tip: false,
    },
    list,
  );
  membership.set(view, list);
  return list;
}

/**
 * The elements of a view's last walk, document order.
 *
 * @param view - The view.
 * @returns The list, or an empty one if it has never been walked.
 */
export function elementsOf(
  view: HdmlViewElement,
): readonly HdvlElement[] {
  return membership.get(view) ?? [];
}

/**
 * The live index. Exported so a test can prove that
 * `HdvlElement.view` reads *this* and not the DOM.
 *
 * @returns The map itself, not a copy.
 */
export function resolutionIndex(): ResolutionIndex {
  return entries;
}

/**
 * One element's resolution.
 *
 * @param el - The element.
 * @returns Its resolution, or `undefined` before the first walk.
 */
export function resolutionOf(
  el: HdvlElement,
): Resolution | undefined {
  return entries.get(el);
}

/**
 * The element carrying a given `uid` (§5.7's dispatch hop).
 *
 * @param uid - A `SceneGroup.widget`.
 * @returns The element, or `null`.
 */
export function byUid(uid: string): HdvlElement | null {
  return uids.get(uid) ?? null;
}

/**
 * The owning view — **the whole of R35's seam**.
 *
 * The index answers first, and answers for an element that has just
 * been *removed* from the DOM, which is what makes
 * `disconnectedCallback` able to invalidate the right view at all.
 *
 * The containment fallback covers exactly one window: between an
 * element's `connectedCallback` and the walk that connection
 * triggers, it has no entry yet. It is a `contains()` test against
 * the registered views — a single platform call, confined to this
 * module — not a second tree traversal, and it is the reason no
 * element anywhere else needs to know about the DOM.
 *
 * @param el - The element.
 * @returns Its view, or `null`.
 */
export function viewOf(el: HdvlElement): HdmlViewElement | null {
  const hit = entries.get(el);
  if (hit !== undefined) {
    return hit.view;
  }
  // A registered view owns itself, so `view.invalidate()` needs no
  // special case anywhere. The Set lookup answers that exactly,
  // ahead of the containment scan a nested view would confuse.
  const self = <HdmlViewElement>(<unknown>el);
  if (registry.has(self)) {
    return self;
  }
  for (const view of registry) {
    if (view.contains(el)) {
      return view;
    }
  }
  return null;
}
