/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `hdml-ordinal-scale` element (RFC 016/001 §2.2).
 *
 * @module hdvl/scale-ordinal
 */

import { customElement, property } from "lit/decorators.js";
import { HdvlElement } from "./base";
import type { SceneGroup } from "./scene";
import type { FrameContext } from "./measure";
import type { Binding } from "./subscribe";
import type { Scale, ScaleDomain } from "./scale";
import { resolveScaleFrame, scaleBindings, scaleOf } from "./scale";
import {
  HDVL_FAMILIES,
  HDVL_TAG_NAMES,
  ORDINAL_SCALE_ATTRS_LIST,
} from "./vocabulary";

/**
 * A categorical `domain → range` map, banded by `--hdml-bandwidth`
 * (§4.4). On `channel="color"` it is the palette scale, and its
 * key is what `hdml-legend` renders. Contract 2 itself lives in
 * [`scale.ts`](./scale.ts), shared by all three scale tags.
 *
 * @tagname hdml-ordinal-scale
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
 * @attribute {string} sort - The domain ordering (ordinal only).
 *
 * @attribute {string} reverse - Whether the range runs in the
 * opposite direction.
 *
 * @attribute {string} source - The data source for this subtree,
 * nearest-ancestor-wins (SPEC §4.5).
 */
@customElement(HDVL_TAG_NAMES.ORDINAL_SCALE)
export class HdmlOrdinalScaleElement extends HdvlElement {
  public readonly tag = HDVL_TAG_NAMES.ORDINAL_SCALE;

  public readonly family =
    HDVL_FAMILIES[HDVL_TAG_NAMES.ORDINAL_SCALE];

  /**
   * @internal
   */
  @property({ type: String })
  [ORDINAL_SCALE_ATTRS_LIST.CHANNEL]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [ORDINAL_SCALE_ATTRS_LIST.MIN]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [ORDINAL_SCALE_ATTRS_LIST.MAX]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [ORDINAL_SCALE_ATTRS_LIST.VALUES]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [ORDINAL_SCALE_ATTRS_LIST.SORT]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [ORDINAL_SCALE_ATTRS_LIST.REVERSE]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [ORDINAL_SCALE_ATTRS_LIST.SOURCE]: null | string = null;

  /**
   * §7.2's request path — R6's `raw: false` `values` subscription.
   *
   * @returns The bindings this scale currently wants.
   */
  public bindings(): readonly Binding[] {
    return scaleBindings(this);
  }

  /**
   * The **resolved** domain this scale last drew with (§5.11, H14).
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
   * §5.1: a scale emits **no group at all**. Permanent — this is
   * the `Scale`'s per-frame hook, not a scene.
   *
   * @param ctx - The frame's snapshot.
   * @returns Always `null`.
   */
  public scene(ctx: FrameContext): SceneGroup | null {
    resolveScaleFrame(this, ctx);
    return null;
  }
}
