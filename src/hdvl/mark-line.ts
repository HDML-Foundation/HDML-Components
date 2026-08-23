/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `hdml-line` element (RFC 016/001 §2.2, §4.7, §6.1, §6.2).
 *
 * @module hdvl/mark-line
 */

import { customElement, property } from "lit/decorators.js";
import { HdvlElement } from "./base";
import type { FrameContext } from "./measure";
import type { Point, SceneGroup, SceneNode } from "./scene";
import type { Binding, Slot } from "./subscribe";
import { paintSuppressed } from "./subscribe";
import {
  CHANNEL_SLOTS,
  channelColor,
  curveOptionsOf,
  curveTypeOf,
  datumOf,
  markBindings,
  markGroup,
  newTally,
  projectionOf,
  reportDrops,
  rowCountOf,
  slotValuesOf,
  strokePaint,
  tallyDrop,
} from "./mark";
import { curve } from "./kernel/curves";
import {
  HDVL_FAMILIES,
  HDVL_TAG_NAMES,
  LINE_ATTRS_LIST,
} from "./vocabulary";

/**
 * Every slot this element can bind, for §7.2's request path.
 *
 * All five are declared, not just the two its plane will use: a
 * `bindings()` call happens inside `reindex()`, outside any frame,
 * where no `FrameContext` and therefore no plane is available. An
 * unauthored attribute contributes no binding anyway, so declaring
 * both plane forms costs a page nothing.
 */
const SLOTS: readonly Slot[] = [
  LINE_ATTRS_LIST.X,
  LINE_ATTRS_LIST.Y,
  LINE_ATTRS_LIST.ANGLE,
  LINE_ATTRS_LIST.RADIUS,
  LINE_ATTRS_LIST.COLOR,
];

/**
 * A stroked path through one vertex per row, curved by
 * `--hdml-curve-type`. Row-wise: vertex *i* = f(row *i*).
 *
 * **It names no channel.** The two it projects through are
 * {@link import("./mark").Projection.channels} — the plane's
 * answer, `x`/`y` under a cartesian plane and `angle`/`radius`
 * under a polar one — so step 26's polar planes reach this element
 * without adding a branch to it (H7).
 *
 * **One `path` node for the whole series**, per §6.1, which is why
 * its `i` is `-1`: §2.5 defines `i` as *"the source row index the
 * node was built from, or -1"*, and a node built from every row has
 * no single one. Row identity lives in `vertices`, each carrying
 * its own — and that is also what hit resolution reads, never an
 * inverted scale.
 *
 * **A gap is never bridged** (§4.7). Rows are split into runs at
 * every dropped row and each run is curved **independently**;
 * `natural`'s tridiagonal solve is global over its run, so a
 * bridged-then-cut path would bend around data that is not there.
 *
 * @tagname hdml-line
 *
 * @attribute {string} x - The column bound to the `x` channel (SPEC
 * §5).
 *
 * @attribute {string} y - The column bound to the `y` channel (SPEC
 * §5).
 *
 * @attribute {string} angle - The column bound to the `angle` channel
 * (SPEC §3).
 *
 * @attribute {string} radius - The column bound to the `radius`
 * channel (SPEC §3).
 *
 * @attribute {string} color - The column bound to the `color` channel
 * (SPEC §3).
 *
 * @attribute {string} closed - Whether the path closes back on its
 * first vertex.
 *
 * @attribute {string} source - The data source for this subtree,
 * nearest-ancestor-wins (SPEC §4.5).
 */
@customElement(HDVL_TAG_NAMES.LINE)
export class HdmlLineElement extends HdvlElement {
  public readonly tag = HDVL_TAG_NAMES.LINE;

  public readonly family = HDVL_FAMILIES[HDVL_TAG_NAMES.LINE];

  /**
   * @internal
   */
  @property({ type: String })
  [LINE_ATTRS_LIST.X]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [LINE_ATTRS_LIST.Y]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [LINE_ATTRS_LIST.ANGLE]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [LINE_ATTRS_LIST.RADIUS]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [LINE_ATTRS_LIST.COLOR]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [LINE_ATTRS_LIST.CLOSED]: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  [LINE_ATTRS_LIST.SOURCE]: null | string = null;

  /**
   * §7.2's request path — one subscription per column-bound slot.
   *
   * @returns The bindings this element currently wants.
   */
  public bindings(): readonly Binding[] {
    return markBindings(this, SLOTS);
  }

  /**
   * §5.7's `DatumSource` — the row a hit resolved, over the
   * channels this element binds.
   *
   * @param index - The row index a hit named.
   * @returns The row, or `null`.
   */
  public datumAt(
    index: number,
  ): Readonly<Record<string, unknown>> | null {
    return datumOf(this, SLOTS, index);
  }

  /**
   * @override
   *
   * One stroked `path`, `fill: null`, curved per §6.2, with a
   * `Subpath` boundary at every §4.7 gap.
   *
   * @param ctx - The frame's snapshot.
   * @returns Its group, or `null`.
   */
  public scene(ctx: FrameContext): SceneGroup | null {
    if (paintSuppressed(this)) {
      return null;
    }
    const projection = projectionOf(ctx, this);
    if (projection === null) {
      return null;
    }
    const [first, second] = projection.channels;
    const a = slotValuesOf(this, CHANNEL_SLOTS[first].simple);
    const b = slotValuesOf(this, CHANNEL_SLOTS[second].simple);
    if (a === null || b === null) {
      // §6.1 makes both required; V19 reports the omission at step
      // 22. Painting half a line meanwhile would be the silent
      // wrong chart §1.5 forbids.
      return null;
    }
    const rows = rowCountOf([a, b]);
    const tally = newTally();
    const runs: Point[][] = [];
    const vertices: (Point & { i: number })[] = [];
    let run: Point[] = [];
    for (let i = 0; i < rows; i++) {
      const va = a.at(i);
      const vb = b.at(i);
      const point = projection.point(
        projection.at(first, va),
        projection.at(second, vb),
      );
      if (point === null) {
        tally.dropped++;
        tallyDrop(tally, this, projection, first, va);
        tallyDrop(tally, this, projection, second, vb);
        // THE GAP. The run ends here and the next point starts a
        // new one; nothing joins them, at any later stage.
        if (run.length > 0) {
          runs.push(run);
          run = [];
        }
        continue;
      }
      run.push(point);
      vertices.push({ x: point.x, y: point.y, i });
    }
    if (run.length > 0) {
      runs.push(run);
    }
    reportDrops(this, projection, tally, rows, vertices.length);
    const measured = ctx.measured(this);
    const subpaths = curve(
      runs,
      curveTypeOf(measured),
      curveOptionsOf(measured),
    );
    if (subpaths.length === 0) {
      // Every run was shorter than two points, so there is no
      // stroke to draw. Emitting an empty `path` would put a
      // pen-down that strokes nothing into the scene and would
      // make §3.4.1's `empty` read "not empty" for a chart that
      // shows nothing.
      return markGroup(this, measured, []);
    }
    const node: SceneNode = {
      k: "path",
      // §2.5: a node built from every row has no single source row.
      i: -1,
      subpaths,
      // §6.1 lists `closed` on this element for polar radar loops;
      // step 26 owns it, and until then the attribute is inert.
      closed: false,
      vertices,
      // §6.1's paint resolution. The row is the first SURVIVING
      // one, so a series whose row 0 is a gap still takes its own
      // colour rather than the sheet's.
      ...strokePaint(
        measured,
        channelColor(ctx, this, vertices[0].i),
      ),
    };
    return markGroup(this, measured, [node]);
  }
}
