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
    // ⚠ `count` arrives through `props` and ONLY through `props`
    // as of 019 item 18; `step` and `values` are still attributes.
    assert.deepEqual(tickSpecOf(grid({}), styled("6")), { count: 6 });
    assert.deepEqual(tickSpecOf(grid({ step: "0.05" })), {
      step: 0.05,
    });
    assert.deepEqual(tickSpecOf(grid({ values: '[0, 1, "a"]' })), {
      values: [0, 1, "a"],
    });
  });

  test("an empty source reads as absent", () => {
    assert.deepEqual(
      tickSpecOf(grid({ step: "  ", values: "" }), styled("")),
      {},
    );
  });

  test("a spec that cannot be read is absent", () => {
    // A guide paints nothing rather than something wrong, and V16
    // is not the rule that would catch any of these.
    assert.deepEqual(tickSpecOf(grid({}), styled("0")), {});
    assert.deepEqual(tickSpecOf(grid({}), styled("-2")), {});
    assert.deepEqual(tickSpecOf(grid({}), styled("many")), {});
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
      tickSpecOf(
        grid({ step: "0.5", values: "[1, 2]" }),
        styled("4"),
      ),
      { count: 4, step: 0.5, values: [1, 2] },
    );
  });
});

/**
 * A MEASURE snapshot's harvested properties.
 *
 * ⚠ The LIVE shape always has the key: `measure.ts` harvests every
 * entry of `HDVL_PROPERTIES` from the one computed style it reads,
 * so a real `Measured.props` carries `--hdml-tick-count` at its
 * initial `"auto"` on every element no rule matched. `undefined`
 * here is the DOUBLE's shape — a hand-built map that omits it — and
 * both must read as absence, which is why the four cases below are
 * run twice.
 */
function styled(value?: string): ReadonlyMap<string, string> {
  return new Map<string, string>(
    value === undefined ? [] : [["--hdml-tick-count", value]],
  );
}

suite("hdvl/guide-spec — count's one source (019 item 18)", () => {
  test("★ --hdml-tick-count answers, and count= does not", () => {
    // §6.1's portability rule. The two sources DISAGREE and the
    // property answers — which distinguished a reader that
    // preferred the property from one that merely accepted it
    // while both arms existed, and now pins that only one does.
    assert.deepEqual(tickSpecOf(grid({ count: "5" }), styled("12")), {
      count: 12,
    });
  });

  test("★★ count= serves NOTHING — the arm is gone", () => {
    // ⚠⚠ THE INVERSE of the step-29 control this replaces, and the
    // assertion that makes 019 item 18 non-vacuous: an arm that
    // survived would answer `{count: 5}` to all three of these.
    //
    // ★ `props` stays OPTIONAL and the three shapes differ in
    // what they MODEL — `"auto"` is the live shape on an element
    // no rule matched, the omitted key is a hand-built double's,
    // and no map at all is a DETACHED guide, which has no computed
    // style to have read. All three mean *the author stated no
    // NUMBER here*, and **none of them may resurrect the
    // attribute** — which is this test's claim and is what all
    // three assertions below still pin.
    //
    // ⚠⚠ **They no longer give the same ANSWER, as of 019 item
    // 8.** `"auto"` is forwarded as itself, because resolving it
    // needs the scale's pixel range and `buildScale` is the only
    // holder of one; the other two stay absent, because a guide
    // with no snapshot has no width to derive anything from. The
    // split is load-bearing in both directions: collapsing `auto`
    // to absence makes item 8 unreachable, and promoting absence
    // to `auto` would give `hdml-axis` and `guide-grid`'s bare
    // `ticks({})` a width-aware count they never asked for.
    assert.deepEqual(
      tickSpecOf(grid({ count: "5" }), styled("auto")),
      { count: "auto" },
    );
    assert.deepEqual(tickSpecOf(grid({ count: "5" }), styled()), {});
    assert.deepEqual(tickSpecOf(grid({ count: "5" })), {});
  });

  test("★ the property alone is enough", () => {
    assert.deepEqual(tickSpecOf(grid({}), styled("3")), { count: 3 });
  });

  test("★ neither source leaves a NUMBER in count", () => {
    // Not zero, not a literal default. `Scale.ticks` reads an
    // empty spec as `count = 10` and resolves `"auto"` against the
    // range, and a default here would be a second entry point into
    // §4.8's ladder (R12) — so this function answers with the
    // keyword or with nothing, never with arithmetic.
    //
    // ⚠ Renamed at 019 item 8: *"leaves count ABSENT"* was true of
    // both rows and is now true of the second only.
    assert.deepEqual(tickSpecOf(grid({}), styled("auto")), {
      count: "auto",
    });
    assert.deepEqual(tickSpecOf(grid({}), styled()), {});
  });

  test("a declared-but-unusable property does not fall back", () => {
    // `<integer>` admits `0` and a negative; the three tick MODES
    // do not, so `positive` rejects them. The attribute is not
    // consulted — nothing consults it any more — and these two
    // cases remain worth pinning because `0` and `-2` are states
    // the registered syntax admits and the modes refuse.
    assert.deepEqual(
      tickSpecOf(grid({ count: "5" }), styled("0")),
      {},
    );
    assert.deepEqual(
      tickSpecOf(grid({ count: "5" }), styled("-2")),
      {},
    );
  });

  test("the property does not touch step or values", () => {
    // Item 18 moved ONE of the three modes. `values` and `step`
    // are data-space instructions — `values="0 100 1000"` is only
    // correct for that data — and §6.1 keeps them attributes, so
    // this is also where the reader stays MIXED-SOURCE.
    assert.deepEqual(
      tickSpecOf(
        grid({ step: "0.05", values: "[1, 2]" }),
        styled("12"),
      ),
      { count: 12, step: 0.05, values: [1, 2] },
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
