/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import "./index";
import { HdvlElement } from "./base";
import { HDVL_FAMILIES, HDVL_TAG_NAMES } from "./vocabulary";

/**
 * The tag surface, asserted whole. Step 09 registers all twenty-one
 * display tags and they never move again, so this file is the
 * standing description of that surface: tag, family and observed
 * attributes, per element.
 *
 * Every list below is **hardcoded**, read off
 * `@hdml/types`' published `*_ATTRS_LIST` enums by hand. Deriving
 * them from the same enum the element imports would assert nothing
 * — it would only prove the element compiled.
 */

interface Observing {
  observedAttributes?: string[];
}

/** tag → the exact attribute set that element must observe. */
const EXPECTED: [string, string, string[]][] = [
  ["hdml-view", "view", ["source"]],
  ["hdml-cartesian-plane", "plane", ["source"]],
  ["hdml-polar-plane", "plane", ["source"]],
  [
    "hdml-continuous-scale",
    "scale",
    [
      "channel",
      "min",
      "max",
      "values",
      "type",
      "base",
      "exponent",
      "constant",
      "nice",
      "zero",
      "clamp",
      "reverse",
      "source",
    ],
  ],
  [
    "hdml-datetime-scale",
    "scale",
    [
      "channel",
      "min",
      "max",
      "values",
      "zone",
      "nice",
      "clamp",
      "reverse",
      "source",
    ],
  ],
  [
    "hdml-ordinal-scale",
    "scale",
    ["channel", "min", "max", "values", "sort", "reverse", "source"],
  ],
  [
    "hdml-line",
    "mark",
    ["x", "y", "angle", "radius", "color", "closed", "source"],
  ],
  [
    "hdml-area",
    "mark",
    [
      "x",
      "x0",
      "x1",
      "y",
      "y0",
      "y1",
      "angle",
      "radius",
      "r0",
      "r1",
      "color",
      "closed",
      "hidden",
      "source",
    ],
  ],
  [
    "hdml-bar",
    "mark",
    ["x", "x0", "x1", "y", "y0", "y1", "color", "hidden", "source"],
  ],
  [
    "hdml-point",
    "mark",
    ["x", "y", "angle", "radius", "color", "size", "source"],
  ],
  [
    "hdml-arc",
    "mark",
    ["a0", "a1", "angle", "radius", "r0", "r1", "color", "source"],
  ],
  ["hdml-rule", "mark", ["x", "y", "source"]],
  ["hdml-pie", "mark", ["angle", "color", "source"]],
  ["hdml-cluster", "container", ["x", "y", "source"]],
  [
    "hdml-stack",
    "container",
    ["x", "y", "offset", "hidden", "source"],
  ],
  ["hdml-axis", "guide", ["channel"]],
  ["hdml-tick", "guide", ["channel", "count", "step", "values"]],
  [
    "hdml-label",
    "guide",
    ["channel", "count", "step", "values", "format"],
  ],
  ["hdml-grid", "guide", ["channel", "count", "step", "values"]],
  [
    "hdml-legend",
    "guide",
    ["channel", "count", "step", "values", "format"],
  ],
  ["hdml-fallback", "fallback", []],
];

/** The five guide tags. None of them may take a `source`. */
const GUIDES = [
  "hdml-axis",
  "hdml-tick",
  "hdml-label",
  "hdml-grid",
  "hdml-legend",
];

function observedOf(tag: string): string[] {
  const ctor = <undefined | Observing>(
    (<unknown>customElements.get(tag))
  );
  return (ctor?.observedAttributes ?? []).slice().sort();
}

suite("hdvl/registry", () => {
  test("all 21 display tags are defined", () => {
    assert.lengthOf(EXPECTED, 21);
    for (const [tag] of EXPECTED) {
      assert.isFunction(customElements.get(tag), tag);
    }
  });

  test("the table is HDVL_TAG_NAMES exactly", () => {
    const tags = Object.values(HDVL_TAG_NAMES).sort();
    assert.deepEqual(EXPECTED.map(([tag]) => tag).sort(), tags);
  });

  test("each element's localName is its tag", () => {
    for (const [tag] of EXPECTED) {
      const el = document.createElement(tag);
      assert.strictEqual(el.localName, tag);
    }
  });

  test("each element reports its own tag", () => {
    for (const [tag] of EXPECTED) {
      if (tag === "hdml-fallback") {
        continue;
      }
      const el = <HdvlElement>document.createElement(tag);
      assert.strictEqual(el.tag, tag, tag);
    }
  });

  test("each element reports its family", () => {
    const map = <Record<string, string>>HDVL_FAMILIES;
    for (const [tag, family] of EXPECTED) {
      if (tag === "hdml-fallback") {
        continue;
      }
      const el = <HdvlElement>document.createElement(tag);
      assert.strictEqual(el.family, family, tag);
      assert.strictEqual(el.family, map[tag], tag);
    }
  });

  test("observed attributes are exactly the enum", () => {
    for (const [tag, , attrs] of EXPECTED) {
      assert.deepEqual(observedOf(tag), attrs.slice().sort(), tag);
    }
  });

  test("no guide takes a source", () => {
    // §2.2: a guide "binds no columns and takes no `source`" — it
    // is a function of the resolved scale, its box and its style.
    for (const tag of GUIDES) {
      assert.notInclude(observedOf(tag), "source", tag);
    }
  });

  test("hdml-fallback observes nothing", () => {
    assert.deepEqual(observedOf("hdml-fallback"), []);
  });

  test("only hdml-fallback is not an HdvlElement", () => {
    for (const [tag] of EXPECTED) {
      const el = document.createElement(tag);
      const isHdvl = el instanceof HdvlElement;
      if (tag === "hdml-fallback") {
        assert.isFalse(isHdvl);
      } else {
        assert.isTrue(isHdvl, tag);
      }
    }
  });
});
