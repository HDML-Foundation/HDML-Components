/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * SPEC §9's `--hdml-*` registry, and its guarded boot
 * (RFC 016/001 §5.5).
 *
 * The registry is the display vocabulary's UA default stylesheet:
 * every appearance decision a chart makes reads a registered custom
 * property, so registration is what gives an unstyled chart a
 * legible default and what makes `getComputedStyle` a total
 * function over the vocabulary. **Every property inherits except
 * two** — `--hdml-tick-count` and `--hdml-text-format`, 019 items
 * 18+19 — and inheritance is otherwise what makes plane-level
 * scoping and theme-at-the-view work.
 *
 * ★ **The two exceptions are a detector, not a convenience**
 * (RFC 019/001 §6.3, decision A1). A non-inherited registered
 * property computes to its initial wherever it is not declared, so
 * a computed value other than the initial means *a rule matched
 * this element*. That is what a reader needs in order to prefer an
 * author's stylesheet over an author's attribute without inventing
 * a third state, and it is what keeps `format`'s three error
 * clauses — V20(b), V14's ordinal clause and V14's kind agreement —
 * from firing on elements the author never addressed. With
 * `inherits: true` a single page-wide `--hdml-text-format` would
 * fire all three, and **an error blanks the element** (SPEC §3.5).
 *
 * ⚠ `--hdml-text-rotate` and `--hdml-text-anchor` stay
 * `inherits: true` on purpose: **no V-rule reads either**, so their
 * inheritance is harmless. The `--hdml-text-*` family is not
 * uniform by necessity, and this note exists so that a later reader
 * does not "fix" the inconsistency.
 *
 * ★ An author who wants one of the two at the plane has a
 * one-keyword opt-in: `--hdml-tick-count: inherit` **does** pull
 * the ancestor's value, measured on all three engines.
 *
 * @module hdvl/properties
 */

/**
 * The eight-colour categorical default (SPEC §9). Split at a space
 * that ends the preceding fragment, because the whole value is 63
 * characters and `max-len` is 70.
 */
const PALETTE =
  "#1c8cf4 #f59e0b #10b981 #8b5cf6 " +
  "#ef4444 #06b6d4 #d946ef #84cc16";

/** SPEC §9's closed curve enum, in SPEC order. */
const CURVE_TYPES =
  "linear | natural | basis | bezier | " +
  "cardinal | catmull-rom | monotone | step";

/**
 * SPEC §9's registry, complete at fifty-three: thirty-seven
 * base properties plus the sixteen **state variants** — the eight
 * presentation-attribute properties × `{hover, active}`.
 *
 * **Completeness is deliberate, not premature.** The three
 * `--hdml-legend-*` properties had no reader until Slice H and the
 * sixteen state variants had none until 017 R7's generator in
 * `states.ts` (step 09-2), and in both cases the registry came
 * first: V12's premise — *every `--hdml-*` in page CSS is
 * registered* — is untestable while any member is missing, and V12
 * gates the corpus. A property registered "when its reader arrives"
 * also falls back to unregistered-custom-property semantics
 * meanwhile: no syntax, no initial value, and no transition, which
 * would silently exclude it from the frame sentinel.
 *
 * ── Why exactly eight carry variants (017 R7) ──
 *
 * The boundary is **architectural, not budgetary**: a generated
 * state rule can only override what the renderer writes as a
 * **presentation attribute** per node, and that is exactly these
 * eight — `stroke-width`, `stroke`, `stroke-dasharray`, `fill` and
 * the four `font-*`. Every other registered property is either
 * geometry, which COMPUTE bakes into the scene where no CSS rule can
 * reach it, or a channel-colour *source* resolved into per-node
 * fills. Adding a variant to one of those would register a property
 * nothing can ever read — which is the defect R7 exists to close,
 * not to repeat.
 *
 * ── The separator is `--`, on the founder's call (017 R7) ──
 *
 * `--hdml-fill-color--hover`, not `_hover`. The doubled dash is
 * unmistakably a separator rather than part of a name, and it keeps
 * a property and its variants adjacent when sorted.
 *
 * ── The initial is OMITTED, never `""` ──
 *
 * The sixteen state variants and `--hdml-curve-bezier-tangents`
 * **omit `initialValue`** rather than passing `""`. Their SPEC
 * initial is the empty "no change in that state" sentinel, and with
 * syntax `*` an omitted initial is the platform's own spelling of
 * that; `""` is not equivalent on every engine. **Nothing may fall
 * back to a literal here** — a registered property always computes
 * to its initial value, so a literal default in a reader's second
 * argument is unreachable code.
 *
 * ── ★ `--hdml-text-anchor`'s fourth keyword is `auto` (017 R2) ──
 *
 * The three placements SPEC §9 names are `start | middle | end`, and
 * the registered enum carries a **fourth**, `auto`, which is its
 * initial. That is forced by the clause above rather than chosen: a
 * registered property **always** computes to its initial, so a
 * reader cannot tell "the author said nothing" from "the author said
 * the initial." The property overrides a value `guidePlacement`
 * **derives** — `middle` under a plane composing in view space, the
 * turning outward normal under one composing about a pole — and
 * there is no member of the three that means *that*. An initial of
 * `middle` would therefore flatten every polar ring to `middle` the
 * moment this property existed, which is the opposite of an
 * override. `auto` is CSS's own word for *"the UA decides"*, and it
 * leaves `middle` free to mean what it says: **centre this run,
 * including on a ring, where the derivation would not have.**
 *
 * ★ **The typed enum is why it is not `*`.** `*` would also carry
 * "empty means derived", the idiom above — but it accepts any string
 * at all, so `--hdml-text-anchor: centre` would compute to `centre`
 * and the reader would have to either ignore it silently (the defect
 * class 017 exists to close) or invent a diagnostic for what CSS
 * already diagnoses. With a closed enum the typo is
 * invalid-at-computed-value-time, falls back to `auto`, and DevTools
 * shows it struck through. The platform does the rejecting.
 *
 * ★ **`--hdml-text-rotate` needs no such member, and the asymmetry
 * is derived.** Rotation has no derivation behind it — every run was
 * unrotated before this registry entry existed — so its neutral
 * value is `0deg`, a real member of `<angle>`. A property whose
 * neutral value is expressible in its own syntax does not need a
 * sentinel; one whose neutral value is *"ask the derivation"* does.
 */
export const HDVL_PROPERTIES: readonly PropertyDefinition[] = [
  {
    name: "--hdml-line-width",
    syntax: "<length>",
    inherits: true,
    initialValue: "1.5px",
  },
  {
    name: "--hdml-line-color",
    syntax: "<color>",
    inherits: true,
    initialValue: "currentColor",
  },
  {
    name: "--hdml-line-style",
    syntax: "solid | dashed | dotted",
    inherits: true,
    initialValue: "solid",
  },
  {
    name: "--hdml-fill-color",
    syntax: "<color>",
    inherits: true,
    initialValue: "currentColor",
  },
  {
    name: "--hdml-font-family",
    syntax: "*",
    inherits: true,
    initialValue: "system-ui",
  },
  {
    name: "--hdml-font-size",
    syntax: "<length>",
    inherits: true,
    initialValue: "11px",
  },
  {
    name: "--hdml-font-weight",
    syntax: "normal | bold | <integer>",
    inherits: true,
    initialValue: "normal",
  },
  {
    name: "--hdml-font-style",
    syntax: "normal | italic",
    inherits: true,
    initialValue: "normal",
  },
  {
    name: "--hdml-tick-style",
    syntax: "rect | ellipse",
    inherits: true,
    initialValue: "rect",
  },
  {
    name: "--hdml-tick-width",
    syntax: "<length>",
    inherits: true,
    initialValue: "1px",
  },
  {
    name: "--hdml-tick-height",
    syntax: "<length>",
    inherits: true,
    initialValue: "6px",
  },
  {
    name: "--hdml-curve-type",
    syntax: CURVE_TYPES,
    inherits: true,
    initialValue: "linear",
  },
  {
    name: "--hdml-curve-basis-beta",
    syntax: "<number>",
    inherits: true,
    initialValue: "1",
  },
  {
    name: "--hdml-curve-bezier-tangents",
    syntax: "*",
    inherits: true,
  },
  {
    name: "--hdml-curve-cardinal-tension",
    syntax: "<number>",
    inherits: true,
    initialValue: "0",
  },
  {
    name: "--hdml-curve-catmull-rom-alpha",
    syntax: "<number>",
    inherits: true,
    initialValue: "0.5",
  },
  {
    name: "--hdml-curve-cubic-monotonicity",
    syntax: "<number>",
    inherits: true,
    initialValue: "1",
  },
  {
    name: "--hdml-curve-step-change",
    syntax: "start | middle | end",
    inherits: true,
    initialValue: "middle",
  },
  {
    name: "--hdml-bandwidth",
    syntax: "<number>",
    inherits: true,
    initialValue: "0.8",
  },
  // ★ 019 item 10 / R2 — the INNER band, read on `hdml-cluster`.
  // Adjacent to its outer sibling on purpose: the two differ by
  // one word and act on different bands, so a reader comparing
  // them should not have to go looking. The initial `1` is
  // bit-identical to the literal `subdivide` used to pass, which
  // is what makes this entry additive.
  {
    name: "--hdml-cluster-bandwidth",
    syntax: "<number>",
    inherits: true,
    initialValue: "1",
  },
  {
    name: "--hdml-palette",
    syntax: "<color>+",
    inherits: true,
    initialValue: PALETTE,
  },
  {
    name: "--hdml-color-interpolate",
    syntax: "<color>+",
    inherits: true,
    initialValue: "#1c2b6b #7ee3d0",
  },
  {
    name: "--hdml-color-interpolate-space",
    syntax: "srgb | srgb-linear | hsl | oklab | oklch",
    inherits: true,
    initialValue: "oklch",
  },
  {
    name: "--hdml-legend-direction",
    syntax: "column | row",
    inherits: true,
    initialValue: "column",
  },
  {
    name: "--hdml-legend-swatch-size",
    syntax: "<length>",
    inherits: true,
    initialValue: "10px",
  },
  {
    name: "--hdml-legend-gap",
    syntax: "<length>",
    inherits: true,
    initialValue: "4px",
  },
  // ── ★ 019 item 6 (D3, Note 004): swatch↔name order ──
  //
  // The family's fourth, and the one that answers 017 R10 — an
  // entry's name may precede its swatch. `keyNodes` already
  // computes both offsets along the entry's own cross axis, so the
  // property selects which of the two comes first and nothing else:
  // the entry's SPAN is the measured name width either way, so the
  // flow does not move.
  //
  // ⚠ One character from `--hdml-legend-swatch-size`, in a position
  // authors mistype, and the two do unrelated things. The hazard
  // was put to the founder at drafting and the NAME WAS KEPT (A12)
  // — recorded in docs/decisions.md so it is not re-litigated. A
  // registered property's invalid value is
  // invalid-at-computed-value-time and falls back to its initial,
  // so the typo silently resizes a swatch with NO diagnostic, and
  // V12 cannot catch it because V12 restricts page CSS to
  // *registered* properties and both of these are registered.
  //
  // ★ No third `auto` keyword. A registered property has no
  // absence, but here the two states are behaviourally identical,
  // so `start` is both the initial and the honest default — unlike
  // `--hdml-text-anchor`, whose `auto` names a DERIVATION that
  // differs per plane.
  {
    name: "--hdml-legend-swatch-side",
    syntax: "start | end",
    inherits: true,
    initialValue: "start",
  },
  {
    name: "--hdml-size-min",
    syntax: "<length>",
    inherits: true,
    initialValue: "2px",
  },
  {
    name: "--hdml-size-max",
    syntax: "<length>",
    inherits: true,
    initialValue: "12px",
  },
  {
    name: "--hdml-angle-start",
    syntax: "<angle>",
    inherits: true,
    initialValue: "0deg",
  },
  {
    name: "--hdml-angle-end",
    syntax: "<angle>",
    inherits: true,
    initialValue: "360deg",
  },
  {
    name: "--hdml-inner-radius",
    syntax: "<length-percentage>",
    inherits: true,
    initialValue: "0%",
  },
  {
    name: "--hdml-grid-shape",
    syntax: "circle | polygon",
    inherits: true,
    initialValue: "circle",
  },
  {
    name: "--hdml-text-rotate",
    syntax: "<angle>",
    inherits: true,
    initialValue: "0deg",
  },
  {
    name: "--hdml-text-anchor",
    syntax: "start | middle | end | auto",
    inherits: true,
    initialValue: "auto",
  },
  // ── ★ 019 items 18 + 19: the two that do NOT inherit ──
  //
  // RFC 019/001 §6.1's portability rule: a value whose correct
  // setting depends on the DATASET cannot live in a stylesheet
  // without welding that stylesheet to one document. `values` and
  // `step` are such values and stay attributes; tick density and
  // number formatting are portable across datasets and become CSS.
  //
  // `inherits: false` on both is decision A1 and is argued in this
  // module's header. Neither may be declared by the UA sheet: a
  // constructed sheet adopted into a shadow root is AUTHOR origin,
  // so a UA declaration would be indistinguishable from an
  // author's and would defeat the detector.
  {
    // `auto` is the initial because a registered property always
    // computes to its initial, so absence has to be spelled as a
    // value — `--hdml-text-anchor`'s argument above, a second
    // time. It resolves to the width-aware derivation at item 8;
    // until then it behaves exactly as an absent `count` does,
    // which `Scale.ticks` reads as `count = 10`.
    name: "--hdml-tick-count",
    syntax: "auto | <integer>",
    inherits: false,
    initialValue: "auto",
  },
  {
    // `*`, because the corpus's own skeletons are space-separated
    // ICU token runs — `currency/USD compact-short`,
    // `percent precision-integer` — that no typed syntax accepts
    // (§6.7). `initialValue` is therefore **OMITTED, never `""`**:
    // with syntax `*` an omitted initial is the platform's own
    // spelling of "empty", `""` is not equivalent on every engine,
    // and the sixteen state variants below rely on the identical
    // combination.
    name: "--hdml-text-format",
    syntax: "*",
    inherits: false,
  },
  {
    name: "--hdml-line-width--hover",
    syntax: "*",
    inherits: true,
  },
  {
    name: "--hdml-line-width--active",
    syntax: "*",
    inherits: true,
  },
  {
    name: "--hdml-line-color--hover",
    syntax: "*",
    inherits: true,
  },
  {
    name: "--hdml-line-color--active",
    syntax: "*",
    inherits: true,
  },
  {
    name: "--hdml-line-style--hover",
    syntax: "*",
    inherits: true,
  },
  {
    name: "--hdml-line-style--active",
    syntax: "*",
    inherits: true,
  },
  {
    name: "--hdml-fill-color--hover",
    syntax: "*",
    inherits: true,
  },
  {
    name: "--hdml-fill-color--active",
    syntax: "*",
    inherits: true,
  },
  {
    name: "--hdml-font-family--hover",
    syntax: "*",
    inherits: true,
  },
  {
    name: "--hdml-font-family--active",
    syntax: "*",
    inherits: true,
  },
  {
    name: "--hdml-font-size--hover",
    syntax: "*",
    inherits: true,
  },
  {
    name: "--hdml-font-size--active",
    syntax: "*",
    inherits: true,
  },
  {
    name: "--hdml-font-weight--hover",
    syntax: "*",
    inherits: true,
  },
  {
    name: "--hdml-font-weight--active",
    syntax: "*",
    inherits: true,
  },
  {
    name: "--hdml-font-style--hover",
    syntax: "*",
    inherits: true,
  },
  {
    name: "--hdml-font-style--active",
    syntax: "*",
    inherits: true,
  },
];

/**
 * Registers {@link HDVL_PROPERTIES}. Idempotent by construction.
 *
 * **The `try` wraps one registration, never the loop** (step-plan
 * H5). `CSS.registerProperty` throws `InvalidModificationError` on
 * re-registration — measured on all three engines — and a page may
 * load two builds of this package. A loop-level `try` would abort at
 * the first duplicate and leave the second build with a registry
 * truncated to nothing: correct on first load, subtly wrong on
 * double import, and the damage is invisible because a missing
 * registration degrades to unregistered-custom-property semantics
 * rather than to an error.
 */
export function registerProperties(): void {
  for (const def of HDVL_PROPERTIES) {
    try {
      CSS.registerProperty(def);
    } catch {
      // Already registered by another build of this package on the
      // same page. The registration that won is identical to this
      // one, so there is nothing to reconcile — and the next
      // property must still be attempted.
    }
  }
}
