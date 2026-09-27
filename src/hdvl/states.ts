/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * SPEC §9/§10's **interaction states**, generated (017 R7, step
 * 09-2).
 *
 * `properties.ts` registers sixteen state variants — the eight
 * presentation-attribute properties × `{hover, active}` — and this
 * module is the half that reads them. **The runtime never chooses a
 * value per node. It emits both rules and the browser chooses**,
 * per node, natively:
 *
 * ```css
 * g[data-w="{uid}"] > *:hover  { fill: …; stroke-width: … }
 * g[data-w="{uid}"] > *:active { … }
 * ```
 *
 * That is what dissolves §10's *"irreplaceable"* argument at its
 * root. §10 is right that base and state values must be
 * **simultaneously** readable from one computed style — eleven marks
 * paint base while one paints hover — and right that a `:state()`
 * rule on the element cannot express per-mark. Its unstated leap was
 * that the runtime must therefore *choose*. It does not, so **no
 * per-node index is needed** (the selector matches whatever node is
 * hovered, which is why `i: -1` guides come along for free) and
 * **no frame runs per `pointermove`**.
 *
 * ── ★ No BASE rule is emitted, and that is load-bearing ──
 *
 * The PoC's `getSvgStyles` wrote four rules, base included, because
 * it had no per-node paint to write. This renderer does: `applyPaint`
 * stamps `fill` / `stroke` / `stroke-width` / `stroke-dasharray` as
 * **presentation attributes on every node**, and those values are
 * §6.1's *resolved* paint — channel-first. Re-deriving a base rule
 * from `--hdml-fill-color` would therefore
 *
 * 1. **invert §6.1 on every channel-coloured widget**, because any
 *    CSS rule beats a presentation attribute: every palette colour
 *    would collapse to one flat author value; and
 * 2. **flatten a group whose nodes legitimately differ** —
 *    `mark-bar` calls `fillPaint` once per row, so one `<g>` can
 *    hold eight colours that one rule cannot express.
 *
 * It is also what keeps R7's *"the base paint stays in the `Scene`,
 * untouched"* true, and with it all 29 whole-`Scene` goldens.
 *
 * ── The selector is `g[data-w] > *`, not `> [data-i]` ──
 *
 * The two match the same set: `paintNodes` appends every node as a
 * **direct child** of the group and `applyClip` puts clip paths in
 * `<defs>`, so a group has no other children. `> *` is preferred
 * because it is `hitOf`'s own structural assumption
 * (`el.closest("g[data-w]")` then `entry.els.indexOf`), and because
 * depending on `data-i` would tie this mechanism to the **index** it
 * explicitly does not need. The `uid` is a UUID, so it cannot carry
 * a quote out of the attribute selector.
 *
 * ── ★ A rule may only emit what the widget's own paint can say ──
 *
 * Two suppressions, both measured from the tree rather than assumed,
 * and between them the reason this module emits **seven** attributes
 * at most rather than always eight.
 *
 * **1. A stroked host has no fill at all.** `strokePaint` returns
 * `fill: null` unconditionally and SPEC §9 gives `--hdml-fill-color`
 * to *filled* widgets, so `--hdml-fill-color--hover` on an
 * `hdml-line` would fill the series path on hover — a state no base
 * state can express, and a defect the scene could never show,
 * because the scene's `fill` stays `null`. `fill` is therefore never
 * emitted for {@link strokePaint}'s four hosts.
 *
 * **2. SPEC §10's channel rule.** *"Channel-bound paint wins over
 * `--hdml-fill-color` and its state variants alike … hovering a
 * channel-colored mark is styled through properties the channel does
 * not own — the stroke variants."* That sentence is live and
 * `09-polar-area`'s CSS comment depends on it, so a bound `color`
 * channel also drops the paint it owns: the **stroke** on one of
 * `strokePaint`'s hosts, the **fill** everywhere else.
 *
 * The *width*, *style* and *font* variants are never dropped — they
 * are precisely what the channel does not own. **A width variant
 * alone still paints nothing on a filled host that set no
 * `--hdml-line-color`**, because R4 made the outline opt-in and the
 * base `stroke` attribute is then `none`; that is the author's
 * decision to make, and emitting a base colour to "help" would be
 * the base rule this module refuses to write.
 *
 * @module hdvl/states
 */

import type { HdvlElement } from "./base";
import { HDVL_TAG_NAMES } from "./vocabulary";
import { CHANNEL_SLOTS, dashOf } from "./mark";

/**
 * The v1 state list (SPEC §9, amended 017 R7).
 *
 * **A list, not two hard-coded branches**, which is the flexibility
 * the founder asked for: `focus` and `selected` are deferred to v2
 * not for cost but because neither has a browser state to hang a
 * rule on today — SVG shapes are not focusable and `selected` is not
 * a pseudo-class at all — so adding either is a row here plus its
 * own machinery, never a rewrite of this module.
 */
export const HDVL_STATES: readonly string[] = ["hover", "active"];

/**
 * {@link strokePaint}'s four hosts — the widgets whose paint is a
 * **stroke**, whose `fill` is structurally `null`, and on which a
 * bound `color` channel is therefore the stroke.
 *
 * Everything that reaches `fillPaint` is the complement: its fill is
 * the channel's when one is bound, and its stroke is R4's opt-in
 * outline, which the channel never owns.
 */
const STROKE_PAINTED: ReadonlySet<string> = new Set<string>([
  HDVL_TAG_NAMES.LINE,
  HDVL_TAG_NAMES.RULE,
  HDVL_TAG_NAMES.AXIS,
  HDVL_TAG_NAMES.GRID,
]);

/** One widget's contribution to the sheet. */
export interface StateInput {
  /** `HdvlElement.uid` — the renderer's `data-w`. */
  uid: string;
  /** The widget's harvested properties, all forty-seven. */
  props: ReadonlyMap<string, string>;
  /**
   * The presentation attributes this widget may not state-vary —
   * see {@link suppressedOf}. Empty for most widgets.
   */
  suppress: ReadonlySet<string>;
}

/**
 * The presentation attributes a widget may **not** state-vary — the
 * one DOM read this module makes.
 *
 * Both rules are argued at the head of this module. A stroked host
 * loses `fill` outright; a widget binding `color` loses whichever
 * paint that channel resolves into.
 *
 * **The channel predicate is the ATTRIBUTE, not the resolved
 * colour.** `channelColor` additionally needs a colour scale in
 * scope, and a binding with no scale is **V1 `no-scale-in-scope`, an
 * error** — so the only documents this over-suppresses on are ones
 * that already report an error and paint nothing. Reading the
 * attribute also keeps this free of the frame context, which is what
 * lets {@link stateRules} stay a pure function of the snapshot.
 *
 * **`hdml-legend` is a deliberate exception.** It binds
 * `channel="color"`, not `color`, so nothing is suppressed for it —
 * and its swatches *are* scale-painted while its two text runs are
 * not. One selector cannot tell those nodes apart, and a legend's
 * `--hdml-fill-color--hover` reaching a swatch is a reasonable
 * reading of the author's intent rather than a defect. Recorded here
 * so it is a decision instead of an oversight.
 *
 * @param el - The widget.
 * @returns The attributes to drop, possibly empty.
 */
export function suppressedOf(el: HdvlElement): ReadonlySet<string> {
  const stroked = STROKE_PAINTED.has(el.tag);
  const out = new Set<string>();
  if (stroked) {
    out.add("fill");
  }
  const raw = el.getAttribute(CHANNEL_SLOTS.color.simple);
  if (raw !== null && raw.trim() !== "") {
    out.add(stroked ? "stroke" : "fill");
  }
  return out;
}

/**
 * The seven variants that map **one-to-one** onto a presentation
 * attribute, in emission order.
 *
 * `--hdml-line-style` is absent on purpose: it has no attribute of
 * its own and reaches the DOM only through {@link dashOf}. That is
 * the eighth, and it is handled by {@link dashDeclaration}.
 */
const DIRECT: readonly (readonly [string, string])[] = [
  ["--hdml-fill-color", "fill"],
  ["--hdml-line-color", "stroke"],
  ["--hdml-line-width", "stroke-width"],
  ["--hdml-font-family", "font-family"],
  ["--hdml-font-size", "font-size"],
  ["--hdml-font-weight", "font-weight"],
  ["--hdml-font-style", "font-style"],
];

/**
 * The **eight** base properties this module can state-vary —
 * {@link DIRECT}'s seven plus `--hdml-line-style`.
 *
 * Exported for one reason: it is the only thing that makes R7's
 * eight-property boundary **enforced** rather than remembered. The
 * boundary is otherwise structural-but-silent — `measure.ts` harvests
 * the registry, so a ninth entry added here would look for a variant
 * nobody registered, `props.get` would return `undefined`, and the
 * generator would emit nothing at all. Nothing would fail; the
 * property would simply never work, which is exactly the defect R7
 * exists to close. `states.test.ts` closes it by asserting this list
 * against `HDVL_PROPERTIES` in both directions.
 */
export const STATE_PROPERTIES: readonly string[] = [
  ...DIRECT.map(([base]) => base),
  "--hdml-line-style",
];

/**
 * Anything that could end a declaration or open a block.
 *
 * ★ **This is the one place an author string reaches a
 * *stylesheet*** — the sibling of `renderer-svg`'s *"the ONE place
 * an author string reaches the DOM, and it reaches it as text"*. A
 * state variant registers with syntax `*`, so its computed value is
 * whatever the author wrote, and this module builds CSS **text**.
 * CSS already forbids an unbalanced `}` in a custom-property value,
 * so this is **defence in depth rather than a known escape**: a
 * value carrying one of these is dropped, and dropping one
 * declaration is the mildest possible failure.
 */
const UNSAFE = /[{};@]|\/\*|\*\//;

/** A variant's value, or `null` for "no change in that state". */
function valueOf(
  props: ReadonlyMap<string, string>,
  base: string,
  state: string,
): string | null {
  // ★ Trap 11: a registered property always computes to its initial
  // value, and these sixteen OMIT one — so the test for "is there a
  // value here" is `=== ""`, and NO literal default may be passed.
  const raw = (props.get(`${base}--${state}`) ?? "").trim();
  return raw === "" || UNSAFE.test(raw) ? null : raw;
}

/** A `<length>` computed value as a number, or `null`. */
function lengthOf(raw: undefined | string): number | null {
  const n = Number.parseFloat((raw ?? "").trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * ★ The derived `stroke-dasharray`, regenerated for the state.
 *
 * **The wrinkle that would otherwise ship silently wrong.** The dash
 * pattern is not a property the author sets; {@link dashOf} derives
 * it from `--hdml-line-style` **× `--hdml-line-width`**, so a state
 * that changes *either* input must re-derive it. Emit
 * `stroke-width: 2.5px` alone on a dashed line and it thickens while
 * keeping gaps computed for the old width — a wrong picture with no
 * error, on the one page that already authors a width variant.
 *
 * The same holds in reverse: a state that changes only
 * `--hdml-line-style` needs the new pattern at the **base** width.
 *
 * `none` is emitted rather than omitted whenever either input moved,
 * because the base node may carry a `stroke-dasharray` attribute
 * that a `solid` state has to switch **off**. A non-positive
 * effective width derives `none` too: `dashOf` would return
 * `[0, 0]`, which is a pattern no renderer draws.
 */
function dashDeclaration(
  props: ReadonlyMap<string, string>,
  state: string,
): string | null {
  const widthVariant = valueOf(props, "--hdml-line-width", state);
  const styleVariant = valueOf(props, "--hdml-line-style", state);
  if (widthVariant === null && styleVariant === null) {
    return null;
  }
  const width =
    widthVariant === null
      ? lengthOf(props.get("--hdml-line-width"))
      : lengthOf(widthVariant);
  const style =
    styleVariant ?? (props.get("--hdml-line-style") ?? "").trim();
  if (width === null || width <= 0) {
    return "stroke-dasharray: none";
  }
  const dash = dashOf(style, width);
  return dash === null
    ? "stroke-dasharray: none"
    : `stroke-dasharray: ${dash.join(" ")}`;
}

/** One widget's declarations for one state, in emission order. */
function declarationsOf(input: StateInput, state: string): string[] {
  const out: string[] = [];
  for (const [base, attribute] of DIRECT) {
    if (input.suppress.has(attribute)) {
      // Either the host has no such paint at all (a stroked widget
      // has no fill), or SPEC §10's channel rule owns it. Both are
      // argued at the head of this module.
      continue;
    }
    const value = valueOf(input.props, base, state);
    if (value !== null) {
      out.push(`${attribute}: ${value}`);
    }
  }
  const dash = dashDeclaration(input.props, state);
  if (dash !== null) {
    out.push(dash);
  }
  return out;
}

/**
 * The state sheet's whole text — the generator.
 *
 * **Pure**: a function of the snapshot and nothing else, so the rule
 * text is assertable without a DOM, a pointer or a renderer. That is
 * the cheap half of R7's evidence; the other half needs a real
 * pointer (step 09-3).
 *
 * A widget with no state variant set contributes **nothing** — not
 * an empty rule — so an unstyled view's sheet is the empty string
 * and the common case costs one string comparison per frame.
 *
 * @param inputs - One entry per measured widget.
 * @returns The sheet text, `""` when no widget declares a state.
 */
export function stateRules(inputs: readonly StateInput[]): string {
  const rules: string[] = [];
  for (const input of inputs) {
    for (const state of HDVL_STATES) {
      const declarations = declarationsOf(input, state);
      if (declarations.length === 0) {
        continue;
      }
      rules.push(
        `g[data-w="${input.uid}"] > *:${state} { ` +
          `${declarations.join("; ")} }`,
      );
    }
  }
  return rules.join("\n");
}
