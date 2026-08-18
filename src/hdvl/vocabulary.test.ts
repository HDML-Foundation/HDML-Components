/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import { HDML_TAG_NAMES } from "@hdml/types";
import * as vocabulary from "./vocabulary";
import { HDVL_TAG_NAMES } from "./vocabulary";

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
    const expected = ATTRS_ENUMS.concat(["HDVL_TAG_NAMES"]).sort();
    assert.deepEqual(Object.keys(vocab).sort(), expected);
  });
});
