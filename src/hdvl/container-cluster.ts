/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `hdml-cluster` element (RFC 016/001 §2.2).
 *
 * @module hdvl/container-cluster
 */

import { customElement, property } from "lit/decorators.js";
import { HdvlElement } from "./base";
import type { FrameContext } from "./measure";
import type { SceneGroup } from "./scene";
import type { Binding, Slot } from "./subscribe";
import { markBindings, projectionOf, rangedValuesOf } from "./mark";
import {
  clearBandSlot,
  clearRangedOverrides,
  renderedChildrenOf,
  setBandSlot,
  setRangedOverrides,
  sharedChannelOf,
} from "./container";
import {
  CLUSTER_ATTRS_LIST,
  HDVL_FAMILIES,
  HDVL_TAG_NAMES,
} from "./vocabulary";

/** The container's own request path — the shared channel (V6). */
const SLOTS: readonly Slot[] = [
  CLUSTER_ATTRS_LIST.X,
  CLUSTER_ATTRS_LIST.Y,
];

/**
 * §6.4's subdivision: slot *k* of *n* over the rendered children.
 *
 * **Both numbers are structural** — `k` is the child's index in DOM
 * order and `n` is how many children render — which is SPEC §7's
 * whole argument against the retired `--hdml-band-slot` /
 * `--hdml-band-slots` pair: *"slot = child index, slots = rendered
 * child count — derived from structure, as `<ol>` numbers its
 * `<li>`s"*. Adding a series and forgetting to update a count is
 * unwritable here.
 *
 * The arithmetic is **not** here: `container.ts`'s `subdivide` asks
 * `kernel/scale-band.ts` for §4.4's band at `b = 1` (R19), and the
 * scale a clustered widget resolves is what carries it.
 *
 * @param cluster - The container.
 * @param ctx - The frame's snapshot.
 */
function reslot(cluster: HdvlElement, ctx: FrameContext): void {
  const rendered = renderedChildrenOf(cluster);
  for (const node of Array.from(cluster.children)) {
    const kid = <HdvlElement>(<unknown>node);
    if (!rendered.includes(kid)) {
      clearBandSlot(kid);
      clearRangedOverrides(kid);
    }
  }
  const projection = projectionOf(ctx, cluster);
  const shared =
    projection === null
      ? null
      : sharedChannelOf(cluster, projection.channels);
  const hoisted =
    shared === null ? null : rangedValuesOf(cluster, shared);
  if (shared === null || hoisted === null) {
    rendered.forEach(clearBandSlot);
    rendered.forEach(clearRangedOverrides);
    return;
  }
  for (let k = 0; k < rendered.length; k++) {
    setBandSlot(rendered[k], cluster, {
      channel: shared,
      index: k,
      count: rendered.length,
    });
    setRangedOverrides(rendered[k], cluster, { [shared]: hoisted });
  }
}

/**
 * **Not a painter.** It subdivides the band among its rendered
 * children, which then emit as ordinary ranged marks. Slot is the
 * child index and slot count is the rendered-child count, both
 * derived from structure — never from CSS. It is the error unit
 * for its own subtree (SPEC §7's all-or-nothing).
 *
 * **★ It declares no channel of its own.** SPEC §7 calls the inner
 * band *"internal machinery, no channel declared — invisible to V1
 * and to channel resolution"*, and that is literally true here: the
 * cluster publishes a `BandSlot`, and `scale.ts` answers a
 * clustered widget with the *same* scale carrying §4.4's band taken
 * inside the outer one. Nothing gains a channel, no domain moves,
 * and every guide over that scale still addresses the category.
 *
 * **★ It hoists the shared channel, exactly as `hdml-stack` does.**
 * V6 forbids a child from binding it, so the child has none to
 * read; `04-grouped-stacked` E's two inner stacks bind nothing at
 * all and take the cluster's `x` through this same write.
 *
 * @tagname hdml-cluster
 *
 * @tagname hdml-cluster
 *
 * @attribute {string} x - The column bound to the `x` channel (SPEC
 * §5).
 *
 * @attribute {string} y - The column bound to the `y` channel (SPEC
 * §5).
 *
 * @attribute {string} source - The data source for this subtree,
 * nearest-ancestor-wins (SPEC §4.5).
 */
@customElement(HDVL_TAG_NAMES.CLUSTER)
export class HdmlClusterElement extends HdvlElement {
  public readonly tag = HDVL_TAG_NAMES.CLUSTER;

  public readonly family = HDVL_FAMILIES[HDVL_TAG_NAMES.CLUSTER];

  /**
   * @internal
   */
  @property({ type: String })
  [CLUSTER_ATTRS_LIST.X]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CLUSTER_ATTRS_LIST.Y]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [CLUSTER_ATTRS_LIST.SOURCE]: null | string = null;

  /**
   * §7.2's request path — the **shared** channel is the container's
   * subscription, because V6 makes it the container's binding.
   *
   * @returns The bindings this element currently wants.
   */
  public bindings(): readonly Binding[] {
    return markBindings(this, SLOTS);
  }

  /**
   * @override
   *
   * §6.4: a layout container emits **no nodes of its own** — it
   * re-parameterises its children, and the ranged form is the
   * primitive it compiles into. The `null` is permanent; what
   * changed at step 29 is that the call now *does* something, and
   * everything it does is to what its children emit.
   *
   * @param ctx - The frame's snapshot.
   * @returns `null`, always.
   */
  public scene(ctx: FrameContext): SceneGroup | null {
    reslot(this, ctx);
    return null;
  }
}
