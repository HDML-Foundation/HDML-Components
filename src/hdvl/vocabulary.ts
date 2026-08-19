/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The display vocabulary, and the **only** module under `src/hdvl/`
 * allowed to import from `@hdml/types` (RFC 016/001 §9.6, R8).
 *
 * Every display element takes its tag name from
 * {@link HDVL_TAG_NAMES} and its attribute keys from the
 * `*_ATTRS_LIST` enums re-exported here — never from a literal, and
 * never from a second direct `@hdml/types` import. One file to
 * audit, and a compile error rather than a silently unregistered
 * element if the published enum set changes.
 *
 * The data half of the vocabulary is deliberately **not**
 * re-exported: `src/hdql/` imports `CONN_ATTRS_LIST` and its seven
 * siblings directly, as it always has.
 *
 * @module hdvl/vocabulary
 */

import { HDML_TAG_NAMES } from "@hdml/types";

export {
  VIEW_ATTRS_LIST,
  CARTESIAN_PLANE_ATTRS_LIST,
  POLAR_PLANE_ATTRS_LIST,
  CONTINUOUS_SCALE_ATTRS_LIST,
  DATETIME_SCALE_ATTRS_LIST,
  ORDINAL_SCALE_ATTRS_LIST,
  LINE_ATTRS_LIST,
  AREA_ATTRS_LIST,
  BAR_ATTRS_LIST,
  POINT_ATTRS_LIST,
  ARC_ATTRS_LIST,
  RULE_ATTRS_LIST,
  PIE_ATTRS_LIST,
  CLUSTER_ATTRS_LIST,
  STACK_ATTRS_LIST,
  AXIS_ATTRS_LIST,
  TICK_ATTRS_LIST,
  LABEL_ATTRS_LIST,
  GRID_ATTRS_LIST,
  LEGEND_ATTRS_LIST,
} from "@hdml/types";

/**
 * The twenty-one display tag names (SPEC §2), lifted out of the
 * 33-member `HDML_TAG_NAMES` so a display element never sees a data
 * tag. `hdml-fallback` is included — it is registered, so
 * `HDML.supports()` answers for it and V13 can count "at most one" —
 * even though SPEC §2 exempts its content from every V-rule.
 *
 * The values are read from `HDML_TAG_NAMES`; no tag string is
 * written literally in this file.
 */
export const HDVL_TAG_NAMES = {
  VIEW: HDML_TAG_NAMES.VIEW,
  CARTESIAN_PLANE: HDML_TAG_NAMES.CARTESIAN_PLANE,
  POLAR_PLANE: HDML_TAG_NAMES.POLAR_PLANE,
  CONTINUOUS_SCALE: HDML_TAG_NAMES.CONTINUOUS_SCALE,
  DATETIME_SCALE: HDML_TAG_NAMES.DATETIME_SCALE,
  ORDINAL_SCALE: HDML_TAG_NAMES.ORDINAL_SCALE,
  LINE: HDML_TAG_NAMES.LINE,
  AREA: HDML_TAG_NAMES.AREA,
  BAR: HDML_TAG_NAMES.BAR,
  POINT: HDML_TAG_NAMES.POINT,
  ARC: HDML_TAG_NAMES.ARC,
  RULE: HDML_TAG_NAMES.RULE,
  PIE: HDML_TAG_NAMES.PIE,
  CLUSTER: HDML_TAG_NAMES.CLUSTER,
  STACK: HDML_TAG_NAMES.STACK,
  AXIS: HDML_TAG_NAMES.AXIS,
  TICK: HDML_TAG_NAMES.TICK,
  LABEL: HDML_TAG_NAMES.LABEL,
  GRID: HDML_TAG_NAMES.GRID,
  LEGEND: HDML_TAG_NAMES.LEGEND,
  FALLBACK: HDML_TAG_NAMES.FALLBACK,
} as const;

/**
 * A display tag name — the value type of {@link HDVL_TAG_NAMES}.
 */
export type HdvlTagName =
  (typeof HDVL_TAG_NAMES)[keyof typeof HDVL_TAG_NAMES];

/**
 * The seven families of the display vocabulary (RFC 016/001 §2.2).
 *
 * `view` and `fallback` are families of one rather than a shared
 * `structural` bucket: V13 asks "a view's children are planes plus
 * at most one fallback", which has to tell those two apart, and a
 * `SceneGroup`'s `role` is `mark | guide` — so a family that maps to
 * neither must be visibly distinct.
 */
export type HdvlFamily =
  | "view"
  | "plane"
  | "scale"
  | "mark"
  | "container"
  | "guide"
  | "fallback";

/**
 * Tag → family, over every member of {@link HDVL_TAG_NAMES}.
 *
 * With one flat `HDML_TAG_NAMES`, family membership has no home in
 * `@hdml/types` (step-plan S3), yet V13's homogeneity check, W1's
 * unknown-element warning, `HDML.supports()` and `SceneGroup.role`
 * all need it. The `Record<HdvlTagName, HdvlFamily>` annotation is
 * load-bearing: a twenty-second tag becomes a compile error rather
 * than a silent `undefined`.
 *
 * `hdml-pie` is a **mark**, not a container. §2.2 calls it a layout
 * *widget* — "the same, with one cross-row `derive()` in data space
 * before projection" — while a layout *container* "is not a
 * painter". A pie paints, and §3.4.1 decides `empty` on
 * mark-producing widgets, so a pie of four zero rows must count as
 * "produced no marks" rather than be excluded from the question.
 */
export const HDVL_FAMILIES: Readonly<
  Record<HdvlTagName, HdvlFamily>
> = {
  [HDVL_TAG_NAMES.VIEW]: "view",
  [HDVL_TAG_NAMES.CARTESIAN_PLANE]: "plane",
  [HDVL_TAG_NAMES.POLAR_PLANE]: "plane",
  [HDVL_TAG_NAMES.CONTINUOUS_SCALE]: "scale",
  [HDVL_TAG_NAMES.DATETIME_SCALE]: "scale",
  [HDVL_TAG_NAMES.ORDINAL_SCALE]: "scale",
  [HDVL_TAG_NAMES.LINE]: "mark",
  [HDVL_TAG_NAMES.AREA]: "mark",
  [HDVL_TAG_NAMES.BAR]: "mark",
  [HDVL_TAG_NAMES.POINT]: "mark",
  [HDVL_TAG_NAMES.ARC]: "mark",
  [HDVL_TAG_NAMES.RULE]: "mark",
  [HDVL_TAG_NAMES.PIE]: "mark",
  [HDVL_TAG_NAMES.CLUSTER]: "container",
  [HDVL_TAG_NAMES.STACK]: "container",
  [HDVL_TAG_NAMES.AXIS]: "guide",
  [HDVL_TAG_NAMES.TICK]: "guide",
  [HDVL_TAG_NAMES.LABEL]: "guide",
  [HDVL_TAG_NAMES.GRID]: "guide",
  [HDVL_TAG_NAMES.LEGEND]: "guide",
  [HDVL_TAG_NAMES.FALLBACK]: "fallback",
};

/**
 * The family of a tag name, or `null` if it is not display
 * vocabulary.
 *
 * The own-property guard is not defensive noise: the argument is an
 * author-supplied `localName`, and a plain object literal carries
 * `Object.prototype`, so `familyOf("constructor")` would otherwise
 * answer with a function. No case folding is done — `localName` is
 * already lowercased by the platform.
 *
 * @param tag - The tag name to classify.
 * @returns The family, or `null`.
 */
export function familyOf(tag: string): HdvlFamily | null {
  if (!Object.prototype.hasOwnProperty.call(HDVL_FAMILIES, tag)) {
    return null;
  }
  return (<Record<string, HdvlFamily>>HDVL_FAMILIES)[tag];
}
