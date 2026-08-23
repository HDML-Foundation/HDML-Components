/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import "./index";
import type { HdvlElement } from "./base";
import type { Measured } from "./measure";
import type { Paint } from "./scene";
import { guideGroup, guideLine, tickSpecOf } from "./guide-spec";

/**
 * `guide-spec.ts` — the shared half of §6.5, unit-tested.
 *
 * Everything geometric is asserted end to end by the two widget
 * suites; what is left here is what they cannot show cheaply: how
 * three attributes become a `TickSpec`, what the guide node's `i`
 * and `vertices` carry, and that a guide's group differs from a
 * mark's in exactly one field.
 *
 * Step 24 imports every symbol under test, so a change that broke
 * `hdml-tick`/`hdml-label` breaks this file first.
 */

/** A detached guide — `tickSpecOf` reads attributes and nothing. */
function grid(attrs: Record<string, string>): HdvlElement {
  const el = document.createElement("hdml-grid");
  for (const [name, value] of Object.entries(attrs)) {
    el.setAttribute(name, value);
  }
  return <HdvlElement>(<unknown>el);
}

const PAINT: Paint = {
  fill: null,
  stroke: "rgb(1, 2, 3)",
  strokeWidth: 2,
  dash: [4, 4],
};

function measured(): Measured {
  return {
    box: { x: 1, y: 2, w: 3, h: 4 },
    content: { x: 1, y: 2, w: 3, h: 4 },
    opacity: 0.5,
    filter: "blur(1px)",
    visibility: "hidden",
    clip: true,
    clipPath: null,
    color: "rgb(0, 0, 0)",
    font: { family: "system-ui", size: 11, weight: "400", style: "" },
    props: new Map<string, string>(),
    sentinel: true,
    w6: false,
  };
}

suite("hdvl/guide-spec — the shared tick spec", () => {
  test("no attribute is an empty spec", () => {
    // Which Contract 2 reads as count = 10 — so neither the axis
    // nor a bare grid needs a default of its own (R12).
    assert.deepEqual(tickSpecOf(grid({})), {});
  });

  test("each mode arrives on its own", () => {
    assert.deepEqual(tickSpecOf(grid({ count: "6" })), { count: 6 });
    assert.deepEqual(tickSpecOf(grid({ step: "0.05" })), {
      step: 0.05,
    });
    assert.deepEqual(tickSpecOf(grid({ values: '[0, 1, "a"]' })), {
      values: [0, 1, "a"],
    });
  });

  test("an empty attribute reads as absent", () => {
    assert.deepEqual(
      tickSpecOf(grid({ count: "", step: "  ", values: "" })),
      {},
    );
  });

  test("a spec that cannot be read is absent", () => {
    // A guide paints nothing rather than something wrong, and V16
    // is not the rule that would catch any of these.
    assert.deepEqual(tickSpecOf(grid({ count: "0" })), {});
    assert.deepEqual(tickSpecOf(grid({ count: "-2" })), {});
    assert.deepEqual(tickSpecOf(grid({ count: "many" })), {});
    assert.deepEqual(tickSpecOf(grid({ step: "0" })), {});
    // SPEC §7's `values` is literal JSON, and a tick SET is an
    // array — `mark.ts`'s binding grammar would have read both of
    // these as a scalar broadcast and a column name.
    assert.deepEqual(tickSpecOf(grid({ values: "3" })), {});
    assert.deepEqual(tickSpecOf(grid({ values: "units" })), {});
    assert.deepEqual(tickSpecOf(grid({ values: "[" })), {});
  });

  test("values keeps only numbers and strings", () => {
    assert.deepEqual(
      tickSpecOf(grid({ values: '[1, null, "a", true, 2]' })),
      { values: [1, "a", 2] },
    );
  });

  test("★ two modes forward, and resolve nowhere here", () => {
    // §6.5 makes them mutually exclusive and V16 reports the
    // co-occurrence at step 24 — but the page paints meanwhile, so
    // an answer is owed. It is Contract 2's: `ticksFor` and
    // `thinOrdinal` both test values, then step, then count. A
    // second resolution here would be a second ladder entry point
    // in all but name (R12).
    assert.deepEqual(
      tickSpecOf(grid({ count: "4", step: "0.5", values: "[1, 2]" })),
      { count: 4, step: 0.5, values: [1, 2] },
    );
  });
});

suite("hdvl/guide-spec — the guide's own scene shell", () => {
  test("a guide line carries no row and no vertex", () => {
    // §2.5: `i` is "the SOURCE ROW index the node was built from,
    // or -1", and `vertices` are "projected DATA vertices". A guide
    // is a function of the scale, not of a delivery — it has
    // neither, and inventing either would make `nearestVertex`
    // resolve a hit against a widget with no `datumAt`.
    const node = guideLine({ x: 0, y: 1 }, { x: 2, y: 3 }, PAINT);
    assert.strictEqual(node.k, "path");
    assert.strictEqual(node.i, -1);
    if (node.k !== "path") {
      return;
    }
    assert.lengthOf(<unknown[]>node.vertices, 0);
    assert.isFalse(node.closed);
    assert.lengthOf(node.subpaths, 1);
    assert.deepEqual(node.subpaths[0].start, { x: 0, y: 1 });
    assert.deepEqual(<unknown[]>node.subpaths[0].segments, [
      { k: "line", to: { x: 2, y: 3 } },
    ]);
    assert.strictEqual(node.stroke, PAINT.stroke);
    assert.strictEqual(node.strokeWidth, 2);
  });

  test("the group is a mark's but for its role", () => {
    // §3.4.1 decides `empty` on MARK nodes, which is why this is a
    // sibling of `markGroup` and not a `role` parameter on it — a
    // parameter would let a mark pass "guide".
    const el = grid({});
    const m = measured();
    const node = guideLine({ x: 0, y: 0 }, { x: 1, y: 1 }, PAINT);
    const group = guideGroup(el, m, [node]);
    assert.strictEqual(group.role, "guide");
    assert.strictEqual(group.tag, "hdml-grid");
    assert.strictEqual(group.widget, el.uid);
    assert.deepEqual(group.box, m.box);
    assert.strictEqual(group.opacity, m.opacity);
    assert.strictEqual(group.filter, m.filter);
    assert.strictEqual(group.visibility, m.visibility);
    assert.strictEqual(group.clip, m.clip);
    assert.isNull(group.clipPath);
    // R2/R26: plain, immutable, serializable data.
    assert.deepEqual(structuredClone(<unknown>group), <unknown>group);
  });
});
