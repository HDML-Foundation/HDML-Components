/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import { HDML_TAG_NAMES } from "@hdml/types";
import * as vocabulary from "./vocabulary";
import {
  HDVL_FAMILIES,
  HDVL_TAG_NAMES,
  familyOf,
} from "./vocabulary";

// The twenty attribute enums the display half publishes — every
// display element except `hdml-fallback`, which has no attributes by
// design (RFC 016/001 §9.6, S3). Hardcoded, never derived from the
// module under test: a list that imports its own answer asserts
// nothing.
const ATTRS_ENUMS = [
  "VIEW_ATTRS_LIST",
  "CARTESIAN_PLANE_ATTRS_LIST",
  "POLAR_PLANE_ATTRS_LIST",
  "CONTINUOUS_SCALE_ATTRS_LIST",
  "DATETIME_SCALE_ATTRS_LIST",
  "ORDINAL_SCALE_ATTRS_LIST",
  "LINE_ATTRS_LIST",
  "AREA_ATTRS_LIST",
  "BAR_ATTRS_LIST",
  "POINT_ATTRS_LIST",
  "ARC_ATTRS_LIST",
  "RULE_ATTRS_LIST",
  "PIE_ATTRS_LIST",
  "CLUSTER_ATTRS_LIST",
  "STACK_ATTRS_LIST",
  "AXIS_ATTRS_LIST",
  "TICK_ATTRS_LIST",
  "LABEL_ATTRS_LIST",
  "GRID_ATTRS_LIST",
  "LEGEND_ATTRS_LIST",
];

// The eight data attribute enums `src/hdql/` imports directly. They
// must NOT reach an element through this module.
const DATA_ATTRS_ENUMS = [
  "CONN_ATTRS_LIST",
  "CONNECTIVE_ATTRS_LIST",
  "FIELD_ATTRS_LIST",
  "FILTER_ATTRS_LIST",
  "FRAME_ATTRS_LIST",
  "JOIN_ATTRS_LIST",
  "MODEL_ATTRS_LIST",
  "TABLE_ATTRS_LIST",
];

// The twelve data tags, which HDVL_TAG_NAMES must not carry.
const DATA_TAG_KEYS = [
  "CONNECTION",
  "FRAME",
  "MODEL",
  "TABLE",
  "JOIN",
  "CONNECTIVE",
  "FILTER_BY",
  "FILTER",
  "GROUP_BY",
  "SPLIT_BY",
  "SORT_BY",
  "FIELD",
];

// S3's taxonomy, hardcoded off RFC 016/001 §2.2 rather than read
// back out of the module under test. Two assignments are load
// bearing and are asserted by name below: `hdml-pie` is a MARK (it
// paints, and §3.4.1 decides `empty` over mark-producing widgets),
// and `hdml-view` / `hdml-fallback` are families of one (V13 has to
// tell them apart).
const FAMILY_TABLE: [string, string][] = [
  ["hdml-view", "view"],
  ["hdml-cartesian-plane", "plane"],
  ["hdml-polar-plane", "plane"],
  ["hdml-continuous-scale", "scale"],
  ["hdml-datetime-scale", "scale"],
  ["hdml-ordinal-scale", "scale"],
  ["hdml-line", "mark"],
  ["hdml-area", "mark"],
  ["hdml-bar", "mark"],
  ["hdml-point", "mark"],
  ["hdml-arc", "mark"],
  ["hdml-rule", "mark"],
  ["hdml-pie", "mark"],
  ["hdml-cluster", "container"],
  ["hdml-stack", "container"],
  ["hdml-axis", "guide"],
  ["hdml-tick", "guide"],
  ["hdml-label", "guide"],
  ["hdml-grid", "guide"],
  ["hdml-legend", "guide"],
  ["hdml-fallback", "fallback"],
];

const vocab = <Record<string, unknown>>(<unknown>vocabulary);
const tags = <Record<string, string>>HDVL_TAG_NAMES;
const allTags = <Record<string, string>>(<unknown>HDML_TAG_NAMES);

suite("hdvl/vocabulary", () => {
  test("HDVL_TAG_NAMES has exactly 21 members", () => {
    assert.lengthOf(Object.keys(tags), 21);
  });

  test("every tag is the @hdml/types member of that name", () => {
    for (const key of Object.keys(tags)) {
      assert.isString(allTags[key], `HDML_TAG_NAMES.${key}`);
      assert.strictEqual(tags[key], allTags[key], key);
    }
  });

  test("no tag value repeats", () => {
    const values = Object.values(tags);
    assert.lengthOf(new Set(values), values.length);
  });

  test("no data tag leaks into the display vocabulary", () => {
    for (const key of DATA_TAG_KEYS) {
      assert.isUndefined(tags[key], key);
    }
  });

  test("21 display + 12 data = the published 33", () => {
    assert.lengthOf(Object.keys(allTags), 33);
    assert.lengthOf(
      Object.keys(allTags).filter((k) => k in tags),
      21,
    );
  });

  test("all 20 display attribute enums are exported", () => {
    for (const name of ATTRS_ENUMS) {
      assert.isObject(vocab[name], name);
    }
  });

  test("no data attribute enum is re-exported", () => {
    for (const name of DATA_ATTRS_ENUMS) {
      assert.isUndefined(vocab[name], name);
    }
  });

  test("the module exports nothing else", () => {
    // ★ `HDQL_SORT_BY_TAG` is the ONE data tag on this list, added
    // at step 27 because SPEC §11's V7 names `hdml-sort-by` as the
    // element that discharges the row-order duty — a check the
    // validator cannot spell without it. It is here rather than in
    // `validate.ts` so this fence keeps counting it: a second data
    // tag leaking down would fail this assertion, which is the
    // whole point of the list being exhaustive.
    const expected = ATTRS_ENUMS.concat([
      "HDVL_TAG_NAMES",
      "HDVL_FAMILIES",
      "HDQL_SORT_BY_TAG",
      "familyOf",
    ]).sort();
    assert.deepEqual(Object.keys(vocab).sort(), expected);
  });

  test("★ the one data tag it names is hdml-sort-by", () => {
    assert.strictEqual(
      vocab.HDQL_SORT_BY_TAG,
      allTags.SORT_BY,
      "V7's element must come from the published enum (R8)",
    );
    assert.strictEqual(vocab.HDQL_SORT_BY_TAG, "hdml-sort-by");
  });

  test("HDVL_FAMILIES covers every tag, once", () => {
    const keys = Object.keys(HDVL_FAMILIES).sort();
    const expected = FAMILY_TABLE.map(([tag]) => tag).sort();
    assert.deepEqual(keys, expected);
    assert.lengthOf(keys, 21);
  });

  test("every tag has its RFC §2.2 family", () => {
    const map = <Record<string, string>>HDVL_FAMILIES;
    for (const [tag, family] of FAMILY_TABLE) {
      assert.strictEqual(map[tag], family, tag);
    }
  });

  test("the taxonomy has exactly seven families", () => {
    const families = new Set(Object.values(HDVL_FAMILIES));
    assert.deepEqual([...families].sort(), [
      "container",
      "fallback",
      "guide",
      "mark",
      "plane",
      "scale",
      "view",
    ]);
  });

  test("hdml-pie is a mark, not a container", () => {
    // §2.2 calls it a layout *widget* — it paints — while a layout
    // *container* "is not a painter". A `container` here would make
    // SceneGroup.role wrong and exclude a four-zero-row pie from
    // §3.4.1's `empty` question instead of answering it.
    const map = <Record<string, string>>HDVL_FAMILIES;
    assert.strictEqual(map["hdml-pie"], "mark");
    assert.strictEqual(map["hdml-cluster"], "container");
    assert.strictEqual(map["hdml-stack"], "container");
  });

  test("familyOf answers for every display tag", () => {
    for (const [tag, family] of FAMILY_TABLE) {
      assert.strictEqual(familyOf(tag), family, tag);
    }
  });

  test("familyOf is null off the vocabulary", () => {
    assert.isNull(familyOf("hdml-frame"));
    assert.isNull(familyOf("hdml-model"));
    assert.isNull(familyOf("hdml-io"));
    assert.isNull(familyOf("div"));
    assert.isNull(familyOf(""));
  });

  test("familyOf does not answer from Object", () => {
    // The argument is an author-supplied `localName` and the map is
    // a plain object literal, so an own-property guard is the
    // difference between `null` and a Function.
    assert.isNull(familyOf("constructor"));
    assert.isNull(familyOf("toString"));
    assert.isNull(familyOf("hasOwnProperty"));
    assert.isNull(familyOf("__proto__"));
  });
});
