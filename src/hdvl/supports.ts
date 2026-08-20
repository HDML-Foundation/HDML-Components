/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * `HDML.supports()` — the feature-detection surface (RFC 016/001
 * §8.5).
 *
 * ```ts
 * HDML.supports("hdml-stack")             // → boolean
 * HDML.supports("hdml-stack", "offset")   // → boolean
 * ```
 *
 * **It is registration-based, and that is a decision.** §8.5 says it
 * answers what this runtime *implements*, not what the vocabulary
 * names — and during v1 the two differ, because seventeen of the
 * twenty-one tags are registered with their attributes and no body
 * yet. "Implements" is not mechanically knowable: there is no
 * per-element completeness bit, and inventing one would be a
 * hand-maintained list that goes stale the moment a slice lands —
 * exactly the drift §8.5's last sentence exists to rule out. So the
 * answer is the one the platform actually holds: *is this tag
 * registered by this build, and is that attribute in its published
 * enum?* A page that never imports `@hdml/components/hdvl` gets
 * `false` for all twenty-one, which is the question a host app is
 * really asking.
 *
 * This module registers **additively** on `globalThis.HDML` at
 * import time, never replacing an existing object: a page may load
 * two builds, or a host app may own the namespace already.
 *
 * @module hdvl/supports
 */

import {
  ARC_ATTRS_LIST,
  AREA_ATTRS_LIST,
  AXIS_ATTRS_LIST,
  BAR_ATTRS_LIST,
  CARTESIAN_PLANE_ATTRS_LIST,
  CLUSTER_ATTRS_LIST,
  CONTINUOUS_SCALE_ATTRS_LIST,
  DATETIME_SCALE_ATTRS_LIST,
  GRID_ATTRS_LIST,
  HDVL_TAG_NAMES,
  HdvlTagName,
  LABEL_ATTRS_LIST,
  LEGEND_ATTRS_LIST,
  LINE_ATTRS_LIST,
  ORDINAL_SCALE_ATTRS_LIST,
  PIE_ATTRS_LIST,
  POINT_ATTRS_LIST,
  POLAR_PLANE_ATTRS_LIST,
  RULE_ATTRS_LIST,
  STACK_ATTRS_LIST,
  TICK_ATTRS_LIST,
  VIEW_ATTRS_LIST,
  familyOf,
} from "./vocabulary";

/** What this package puts on `globalThis.HDML`. */
export interface HdmlNamespace {
  supports(tag: string, attr?: string): boolean;
}

declare global {
  interface Window {
    HDML?: HdmlNamespace;
  }
}

/**
 * Tag → its published attribute names.
 *
 * Read off the same twenty `*_ATTRS_LIST` enums the elements take
 * their `@property` keys from (§9.6), so it cannot drift from what
 * is registered. `hdml-fallback` has no attributes and its content
 * is exempt from every V-rule (§2.2), so it maps to the empty list.
 *
 * The `Record<HdvlTagName, …>` annotation is load-bearing in the
 * same way `HDVL_FAMILIES`' is: a twenty-second tag becomes a
 * compile error rather than a silent `undefined`.
 */
const HDVL_ATTRS: Readonly<Record<HdvlTagName, readonly string[]>> = {
  [HDVL_TAG_NAMES.VIEW]: Object.values(VIEW_ATTRS_LIST),
  [HDVL_TAG_NAMES.CARTESIAN_PLANE]: Object.values(
    CARTESIAN_PLANE_ATTRS_LIST,
  ),
  [HDVL_TAG_NAMES.POLAR_PLANE]: Object.values(POLAR_PLANE_ATTRS_LIST),
  [HDVL_TAG_NAMES.CONTINUOUS_SCALE]: Object.values(
    CONTINUOUS_SCALE_ATTRS_LIST,
  ),
  [HDVL_TAG_NAMES.DATETIME_SCALE]: Object.values(
    DATETIME_SCALE_ATTRS_LIST,
  ),
  [HDVL_TAG_NAMES.ORDINAL_SCALE]: Object.values(
    ORDINAL_SCALE_ATTRS_LIST,
  ),
  [HDVL_TAG_NAMES.LINE]: Object.values(LINE_ATTRS_LIST),
  [HDVL_TAG_NAMES.AREA]: Object.values(AREA_ATTRS_LIST),
  [HDVL_TAG_NAMES.BAR]: Object.values(BAR_ATTRS_LIST),
  [HDVL_TAG_NAMES.POINT]: Object.values(POINT_ATTRS_LIST),
  [HDVL_TAG_NAMES.ARC]: Object.values(ARC_ATTRS_LIST),
  [HDVL_TAG_NAMES.RULE]: Object.values(RULE_ATTRS_LIST),
  [HDVL_TAG_NAMES.PIE]: Object.values(PIE_ATTRS_LIST),
  [HDVL_TAG_NAMES.CLUSTER]: Object.values(CLUSTER_ATTRS_LIST),
  [HDVL_TAG_NAMES.STACK]: Object.values(STACK_ATTRS_LIST),
  [HDVL_TAG_NAMES.AXIS]: Object.values(AXIS_ATTRS_LIST),
  [HDVL_TAG_NAMES.TICK]: Object.values(TICK_ATTRS_LIST),
  [HDVL_TAG_NAMES.LABEL]: Object.values(LABEL_ATTRS_LIST),
  [HDVL_TAG_NAMES.GRID]: Object.values(GRID_ATTRS_LIST),
  [HDVL_TAG_NAMES.LEGEND]: Object.values(LEGEND_ATTRS_LIST),
  [HDVL_TAG_NAMES.FALLBACK]: [],
};

/**
 * Whether this build supports a display tag, or one of its
 * attributes.
 *
 * @param tag - A display tag name.
 * @param attr - An attribute of it, or omitted.
 * @returns Whether the runtime carries it.
 */
export function supports(tag: string, attr?: string): boolean {
  if (familyOf(tag) === null) {
    return false;
  }
  if (customElements.get(tag) === undefined) {
    return false;
  }
  if (attr === undefined) {
    return true;
  }
  const attrs = (<Record<string, readonly string[]>>HDVL_ATTRS)[tag];
  return attrs !== undefined && attrs.includes(attr);
}

/**
 * Registers {@link supports} on `globalThis.HDML`, additively.
 *
 * Idempotent, and it never replaces the object it finds: a second
 * build importing this module installs the same function beside
 * whatever else already lives in the namespace.
 */
export function registerNamespace(): void {
  const scope = <{ HDML?: Record<string, unknown> }>(
    (<unknown>globalThis)
  );
  const ns = scope.HDML ?? {};
  ns.supports = supports;
  scope.HDML = ns;
}

registerNamespace();
