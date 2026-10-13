/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * SPEC §9's **interaction states**, generated (017 R7, step
 * 09-2).
 *
 * `properties.ts` registers twenty state variants in two classes,
 * and this module reads **sixteen** of them — the eight
 * presentation-attribute properties × `{hover, active}`. The other
 * four are 019 R1's channel-colour sources, which no generated rule
 * can carry and `Scale.paintState` reads per datum instead; see
 * `CHANNEL_STATE_PROPERTIES` in `scale.ts`.
 *
 * **The runtime never chooses a value per node. It emits both
 * rules and the browser chooses**, per node, natively:
 *
 * ```css
 * g[data-w="{uid}"] > *:hover  { fill: …; stroke-width: … }
 * g[data-w="{uid}"] > *:active { … }
 * ```
 *
 * That is what dissolves §9's *"irreplaceable"* argument at its
 * root. §9 is right that base and state values must be
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
 * **2. SPEC §9's channel rule.** *"Channel-bound paint wins over
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
import { HDVL_TAG_NAMES, LEGEND_ATTRS_LIST } from "./vocabulary";
import { channelOf } from "./resolve";
import { CHANNEL_STATE_PROPERTIES } from "./scale";
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
 * ★ 019 R1 — the attribute `renderer-svg.ts` stamps on a node that
 * **carries a channel state colour**, and the selector half of the
 * two halves that meet at the DOM.
 *
 * ── Why a marker at all ──
 *
 * The channel rule reads its colour out of a per-node custom
 * property ({@link stateProperty}), and `var()` on a property that
 * is not set is **invalid at computed-value time** — which is not
 * the same as absent. The declaration becomes `unset`, and `fill`
 * and `stroke` are both *inherited* SVG properties, so an unmarked
 * node would hover to whatever its `<g>` inherits rather than
 * keeping the presentation attribute `applyPaint` wrote. A `var()`
 * fallback cannot fix it: the right fallback is the node's **own**
 * base paint, which differs per node and is exactly what the rule
 * cannot say.
 *
 * So the selector carries `[data-s]` and the rule simply **does not
 * match** a node with no state colour. A node that does carry one
 * always has a value for every member of {@link HDVL_STATES} — an
 * unauthored state is stamped with the node's own base paint — so
 * inside the rule the `var()` can never fail.
 *
 * It also raises the channel rule's specificity above the
 * `--hdml-fill-color--hover` rule's by one attribute selector,
 * which is SPEC §9's *"channel-bound paint wins … and its state
 * variants alike"* falling out of the cascade rather than being
 * arranged.
 */
export const STATE_MARK = "data-s";

/**
 * ★ 019 R1 — the per-node custom property carrying one state's
 * channel colour.
 *
 * **One property per state, not one carrying "the current state's
 * colour".** A single property would need the renderer to know
 * which state is live, and *"the runtime never chooses a value per
 * node — it emits both rules and the browser chooses"* is the whole
 * of this module's argument. Two properties are stamped once per
 * node per frame and read by two rules the browser arbitrates.
 *
 * ── `--hdvl-`, not `--hdml-`, and it is NOT registered ──
 *
 * `--hdml-*` is the **author's** vocabulary: fifty-seven registered
 * properties, and V13's `check-dist.mjs` holds page CSS to exactly
 * that set. This property is neither authored nor read by an
 * author — it is a wire between two halves of the runtime — so
 * registering it would add a 58th entry to a list whose whole
 * meaning is *"what a page may say"*. `--hdvl-` is already this
 * repo's prefix for runtime-internal properties (`platform.test.ts`
 * probes with three of them), so this is an established namespace
 * rather than a second one.
 *
 * Unregistered means it inherits and computes to a token sequence,
 * both of which are what is wanted: the value is a `<color>` the
 * runtime wrote and the runtime reads back.
 *
 * @param state - A member of {@link HDVL_STATES}.
 * @returns The property name.
 */
export function stateProperty(state: string): string {
  return `--hdvl-state-${state}`;
}

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
  /** The widget's harvested properties, all fifty-seven. */
  props: ReadonlyMap<string, string>;
  /**
   * The presentation attributes this widget may not state-vary —
   * see {@link suppressedOf}. Empty for most widgets.
   */
  suppress: ReadonlySet<string>;
  /**
   * ★ 019 R1. The paint property this widget's `color` channel
   * owns, or `null` when it binds no colour channel — see
   * {@link channelPropOf}.
   *
   * **A scalar beside `suppress`, never the resolved colours.**
   * That is what keeps {@link stateRules} a pure function of the
   * snapshot: the colours are per *datum* and live on the scene
   * node, so putting them here would need a frame, a scale and a
   * row, and the generator would stop being assertable without a
   * DOM.
   *
   * It is not a plain boolean, for the reason `PaintStates.prop`
   * is not: the reader cannot re-derive it. `suppressedOf` knows
   * the same fact and **throws it away** — a stroked host binding
   * `color` suppresses `{fill, stroke}`, and nothing in that set
   * says which of the two the channel owns.
   */
  channelProp: ChannelProp;
}

/** The paint property a `color` channel owns, or `null`. */
export type ChannelProp = "fill" | "stroke" | null;

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
 * ★ 019 R1 — the paint property a widget's `color` channel owns.
 *
 * The **writer's** counterpart is `PaintStates.prop`, which
 * `mark.ts` hands to the node because `applyPaint(el, node)` sees
 * the node and nothing else (C298). This is the **sheet's** answer
 * to the same question, and it exists for the same reason one
 * layer up: {@link StateInput} carries no tag, so the generator
 * cannot re-derive it either.
 *
 * ⚠ **The two are computed from opposite ends and neither can
 * import the other** — `mark-line.ts` passes `"stroke"` at its call
 * site, this reads {@link STROKE_PAINTED}. `states.test.ts`
 * cross-checks them tag-by-tag, which is the only thing making them
 * agree.
 *
 * ── `hdml-legend` is the one widget that is not a mark ──
 *
 * It binds `channel="color"`, not `color`, so the `color`-attribute
 * read below answers `null` for it — and its swatches are the very
 * nodes a channel palette paints (D2). Its swatches are **filled**,
 * so the answer is `"fill"`, and the group's two text runs carry no
 * state colour and are therefore never matched by the rule this
 * drives. That is what retires `suppressedOf`'s documented *"one
 * selector cannot tell those nodes apart"* exception: the marker
 * attribute tells them apart per node.
 *
 * @param el - The widget.
 * @returns The property, or `null` when no colour channel is bound.
 */
export function channelPropOf(el: HdvlElement): ChannelProp {
  if (el.tag === HDVL_TAG_NAMES.LEGEND) {
    const channel = channelOf(
      el.getAttribute(LEGEND_ATTRS_LIST.CHANNEL),
    );
    return channel === "color" ? "fill" : null;
  }
  const raw = el.getAttribute(CHANNEL_SLOTS.color.simple);
  if (raw === null || raw.trim() === "") {
    return null;
  }
  return STROKE_PAINTED.has(el.tag) ? "stroke" : "fill";
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
 *
 * ── ★ It is now ONE of TWO classes (019 R1) ──
 *
 * *"This module can state-vary"* is the whole of what this list
 * claims, and R1 did not widen it. A registered variant must have
 * **a** reader; it need not have **this** reader. R1's four are read
 * per datum by `Scale.paintState` and are listed by
 * `CHANNEL_STATE_PROPERTIES` (`scale.ts`), because a palette feeds
 * `n` colours through one declaration and there is no literal for
 * the generator to emit.
 *
 * So the reverse half of `states.test.ts`'s assertion now runs
 * against the **union** of the two lists, and a new clause asserts
 * they are **disjoint** — which is what stops the union from being
 * a way to satisfy the boundary without naming a reader. A ninth
 * entry here still has to be generated, and a third class still has
 * to arrive with its own list and its own reader.
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
  // value, and all twenty OMIT one — so the test for "is there a
  // value here" is `=== ""`, and NO literal default may be passed.
  // `Scale.paintState` relies on the identical sentinel, which is
  // what makes its `null` mean "no state rule" (019 R1).
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
      // has no fill), or SPEC §9's channel rule owns it. Both are
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
 * ★ 019 R1 — the channel rule's one declaration, or `null`.
 *
 * **The `continue` in {@link declarationsOf} stays a `continue`.**
 * SPEC §9 still forbids a *literal* `--hdml-fill-color--hover` from
 * reaching a channel-coloured mark, and that is what the
 * suppression says; this emits a different declaration, into a
 * different rule, under a different selector. Folding it into
 * `declarationsOf`'s list would put it under `> *:{state}` and
 * recolour every node in the group — including the ones with no
 * state colour, which is the defect {@link STATE_MARK} exists to
 * prevent.
 *
 * ⇒ **{@link suppressedOf} keeps its purity and its body**. R1
 * trap 4's *"one structural regression"* was a prediction about a
 * design in which this declaration joined the others; it does not,
 * so there is no regression to accept.
 *
 * ── Why the per-state source is read from `props` ──
 *
 * A palette state is authored on the **scale**, not on the widget,
 * and {@link StateInput} carries the widget's own snapshot. It
 * reaches it anyway, and structurally: `chainScaleOf` resolves a
 * widget's scale off `resolve.ts`'s chain, which is carried **down
 * the document tree**, so the scale that paints a widget is always
 * an *ancestor* of it — and all four
 * {@link CHANNEL_STATE_PROPERTIES} variants register
 * `inherits: true`. The widget's computed style therefore has the
 * scale's value.
 *
 * Emitting only for the states a palette actually exists for is
 * what keeps this module's *"a widget with no state variant set
 * contributes nothing"* promise true: a `color`-bound widget under
 * a scale with no state palette still produces the empty sheet.
 *
 * @param input - The widget's entry.
 * @param state - The state.
 * @returns The declaration, or `null`.
 */
function channelDeclarationOf(
  input: StateInput,
  state: string,
): string | null {
  if (input.channelProp === null) {
    return null;
  }
  const authored = CHANNEL_STATE_PROPERTIES.some(
    (base) => valueOf(input.props, base, state) !== null,
  );
  return authored
    ? `${input.channelProp}: var(${stateProperty(state)})`
    : null;
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
      if (declarations.length > 0) {
        rules.push(
          `g[data-w="${input.uid}"] > *:${state} { ` +
            `${declarations.join("; ")} }`,
        );
      }
      // ★ 019 R1's SECOND rule, and it is second in emission order
      // on purpose: it is the more specific of the two, so a sheet
      // read top to bottom reads in cascade order.
      const channel = channelDeclarationOf(input, state);
      if (channel !== null) {
        rules.push(
          `g[data-w="${input.uid}"] > *[${STATE_MARK}]:${state} ` +
            `{ ${channel} }`,
        );
      }
    }
  }
  return rules.join("\n");
}
