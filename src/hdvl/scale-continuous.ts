/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `hdml-continuous-scale` element (RFC 016/001 §2.2).
 *
 * @module hdvl/scale-continuous
 */

import { customElement, property } from "lit/decorators.js";
import { HdvlElement } from "./base";
import type { SceneGroup } from "./scene";
import type { FrameContext } from "./measure";
import type { Binding } from "./subscribe";
import type { Scale, ScaleDomain } from "./scale";
import { resolveScaleFrame, scaleBindings, scaleOf } from "./scale";
import {
  CONTINUOUS_SCALE_ATTRS_LIST,
  HDVL_FAMILIES,
  HDVL_TAG_NAMES,
} from "./vocabulary";

/**
 * A numeric `domain → range` map. The domain is data-side and
 * async; the range is derived from this element's own **content
 * box** along its channel's axis (§4.3). The five transforms —
 * `linear`, `log`, `pow`, `sqrt`, `symlog` — resolve in
 * `kernel/scale-continuous.ts`, and Contract 2 itself in
 * [`scale.ts`](./scale.ts), shared by all three scale tags.
 *
 * @tagname hdml-continuous-scale
 *
 * @attribute {string} channel - The channel this element addresses
 * (SPEC §3).
 *
 * @attribute {string} min - The lower bound of the authored domain
 * (SPEC §6).
 *
 * @attribute {string} max - The upper bound of the authored domain
 * (SPEC §6).
 *
 * @attribute {string} values - An explicit list — the domain on a
 * scale, the positions to repeat at on a guide.
 *
 * @attribute {string} type - The continuous transform (SPEC §6).
 *
 * @attribute {string} base - The logarithm base, for the `log`
 * transform.
 *
 * @attribute {string} exponent - The exponent, for the `pow`
 * transform.
 *
 * @attribute {string} constant - The linear-region constant, for the
 * `symlog` transform.
 *
 * @attribute {string} nice - Whether the domain extends to round
 * values.
 *
 * @attribute {string} zero - Whether the domain includes zero.
 *
 * @attribute {string} clamp - Whether out-of-domain values clamp into
 * the range.
 *
 * @attribute {string} reverse - Whether the range runs in the
 * opposite direction.
 *
 * @attribute {string} source - The data source for this subtree,
 * nearest-ancestor-wins (SPEC §4.5).
 */
@customElement(HDVL_TAG_NAMES.CONTINUOUS_SCALE)
export class HdmlContinuousScaleElement extends HdvlElement {
  public readonly tag = HDVL_TAG_NAMES.CONTINUOUS_SCALE;

  public readonly family =
    HDVL_FAMILIES[HDVL_TAG_NAMES.CONTINUOUS_SCALE];

  /**
   * @internal
   */
  @property({ type: String })
  [CONTINUOUS_SCALE_ATTRS_LIST.CHANNEL]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONTINUOUS_SCALE_ATTRS_LIST.MIN]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONTINUOUS_SCALE_ATTRS_LIST.MAX]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONTINUOUS_SCALE_ATTRS_LIST.VALUES]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONTINUOUS_SCALE_ATTRS_LIST.TYPE]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONTINUOUS_SCALE_ATTRS_LIST.BASE]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONTINUOUS_SCALE_ATTRS_LIST.EXPONENT]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONTINUOUS_SCALE_ATTRS_LIST.CONSTANT]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONTINUOUS_SCALE_ATTRS_LIST.NICE]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONTINUOUS_SCALE_ATTRS_LIST.ZERO]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONTINUOUS_SCALE_ATTRS_LIST.CLAMP]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONTINUOUS_SCALE_ATTRS_LIST.REVERSE]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CONTINUOUS_SCALE_ATTRS_LIST.SOURCE]: null | string = null;

  /**
   * §7.2's request path — R6's *"a scale's `values` is an ordinary
   * D8 subscription"*. `raw: false`, on the `values` slot, and none
   * at all for a literal domain.
   *
   * @returns The bindings this scale currently wants.
   */
  public bindings(): readonly Binding[] {
    return scaleBindings(this);
  }

  /**
   * The **resolved** domain this scale last drew with — §5.11's
   * `hdml-data` `domains`, which is the resolved domain and not the
   * delivered one (H14).
   *
   * @returns The domain, or `null` while it is unresolved.
   */
  public resolvedDomain(): ScaleDomain | null {
    return scaleOf(this)?.domain() ?? null;
  }

  /**
   * This element's Contract 2 object for the frame in flight.
   *
   * @param ctx - The frame's snapshot.
   * @returns The `Scale`, or `null` with no legal `channel`.
   */
  public scale(ctx: FrameContext): Scale | null {
    return resolveScaleFrame(this, ctx);
  }

  /**
   * @override
   *
   * §5.1: a scale emits **no group at all**. It resolves a domain
   * and a range for the widgets below it and paints nothing itself.
   * Permanent — this is the `Scale`'s per-frame hook, not a scene:
   * resolving here is what makes a scale with no widgets under it
   * still report its domain and still fire `hdml-scale-change`.
   *
   * @param ctx - The frame's snapshot.
   * @returns Always `null`.
   */
  public scene(ctx: FrameContext): SceneGroup | null {
    resolveScaleFrame(this, ctx);
    return null;
  }
}
