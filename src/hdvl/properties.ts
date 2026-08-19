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
 * function over the vocabulary. **Every property inherits** — that
 * is what makes plane-level scoping and theme-at-the-view work.
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
 * SPEC §9's registry, complete at thirty-five: thirty-one base
 * properties plus the four `_hover` paint variants.
 *
 * **Completeness is deliberate, not premature.** The three
 * `--hdml-legend-*` properties and the four `_hover` variants have
 * no reader until Slices E and H, but V12's premise — *every
 * `--hdml-*` in page CSS is registered* — is untestable while any
 * member is missing, and V12 gates the corpus. A property
 * registered "when its reader arrives" also falls back to
 * unregistered-custom-property semantics meanwhile: no syntax, no
 * initial value, and no transition, which would silently exclude it
 * from the frame sentinel.
 *
 * The four `_hover` variants and `--hdml-curve-bezier-tangents`
 * **omit `initialValue`** rather than passing `""`. Their SPEC
 * initial is the empty "no change" sentinel, and with syntax `*` an
 * omitted initial is the platform's own spelling of that; `""` is
 * not equivalent on every engine.
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
    name: "--hdml-line-width_hover",
    syntax: "*",
    inherits: true,
  },
  {
    name: "--hdml-line-color_hover",
    syntax: "*",
    inherits: true,
  },
  {
    name: "--hdml-line-style_hover",
    syntax: "*",
    inherits: true,
  },
  {
    name: "--hdml-fill-color_hover",
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
