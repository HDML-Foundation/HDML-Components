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
 * The tag surface, asserted whole. Step 09 registered twenty-one
 * display tags and 019 step 42 added the twenty-second, `hdml-text`,
 * so this file is the standing description of that surface: tag,
 * family and observed attributes, per element.
 *
 * Every list below is **hardcoded**, read off
 * `@hdml/types`' published `*_ATTRS_LIST` enums by hand. Deriving
 * them from the same enum the element imports would assert nothing
 * — it would only prove the element compiled.
 *
 * ★★ **019 item 3, step 42 — this is the table nothing predicted
 * would move.** The step's payload is fifty `initial-{slot}`
 * `@property` declarations across **ten** elements, and a
 * `@property` is an *observed attribute*: the test below deep-equals
 * each element's `observedAttributes` against its row, so nine rows
 * that have nothing to do with `hdml-text` grew between five and
 * eleven members each. ⚠ **No count catches that** — only the exact
 * key set does, which is the reason this table is hand-written.
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
    [
      "x",
      "y",
      "angle",
      "radius",
      "color",
      "closed",
      "source",
      "initial-x",
      "initial-y",
      "initial-angle",
      "initial-radius",
      "initial-color",
    ],
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
      "initial-x",
      "initial-x0",
      "initial-x1",
      "initial-y",
      "initial-y0",
      "initial-y1",
      "initial-angle",
      "initial-radius",
      "initial-r0",
      "initial-r1",
      "initial-color",
    ],
  ],
  [
    "hdml-bar",
    "mark",
    [
      "x",
      "x0",
      "x1",
      "y",
      "y0",
      "y1",
      "color",
      "hidden",
      "source",
      "initial-x",
      "initial-x0",
      "initial-x1",
      "initial-y",
      "initial-y0",
      "initial-y1",
      "initial-color",
    ],
  ],
  [
    "hdml-point",
    "mark",
    [
      "x",
      "y",
      "angle",
      "radius",
      "color",
      "size",
      "source",
      "initial-x",
      "initial-y",
      "initial-angle",
      "initial-radius",
      "initial-color",
      "initial-size",
    ],
  ],
  [
    "hdml-arc",
    "mark",
    [
      "a0",
      "a1",
      "angle",
      "radius",
      "r0",
      "r1",
      "color",
      "source",
      "initial-a0",
      "initial-a1",
      "initial-angle",
      "initial-radius",
      "initial-r0",
      "initial-r1",
      "initial-color",
    ],
  ],
  [
    "hdml-rule",
    "mark",
    ["x", "y", "source", "initial-x", "initial-y"],
  ],
  // ★ 019 item 5, step 42 — the twenty-second display tag and the
  // seventh mark. Thirteen members, read off `TEXT_ATTRS_LIST` by
  // hand: the six slots, `source`, and one `initial-` per slot.
  // ⚠ `size` is deliberately absent and `text` is deliberately
  // present — step 14's control 2b measured that the COUNT alone
  // does not catch a wrong key set, so the set is what is written.
  [
    "hdml-text",
    "mark",
    [
      "x",
      "y",
      "angle",
      "radius",
      "color",
      "text",
      "source",
      "initial-x",
      "initial-y",
      "initial-angle",
      "initial-radius",
      "initial-color",
      "initial-text",
    ],
  ],
  [
    "hdml-pie",
    "mark",
    ["angle", "color", "source", "initial-angle", "initial-color"],
  ],
  [
    "hdml-cluster",
    "container",
    ["x", "y", "source", "initial-x", "initial-y"],
  ],
  [
    "hdml-stack",
    "container",
    [
      "x",
      "y",
      "offset",
      "hidden",
      "source",
      "initial-x",
      "initial-y",
    ],
  ],
  ["hdml-axis", "guide", ["channel"]],
  // ★ 019 items 18+19 — `count` and `format` are NOT on these four
  // any more. `@hdml/types@0.0.2-alpha.27` dropped `COUNT` from all
  // four guide enums and `FORMAT` from the two text-bearing ones,
  // and step 41 deleted the matching `@property` declarations. The
  // values live on the registered `--hdml-tick-count` and
  // `--hdml-text-format` properties instead. ⚠ This table is
  // hardcoded on purpose (see the module docblock), so it is the
  // one place the removal has to be re-read off the published enum
  // by hand — which is why it RED on the bump rather than following
  // it silently.
  ["hdml-tick", "guide", ["channel", "step", "values"]],
  ["hdml-label", "guide", ["channel", "step", "values"]],
  ["hdml-grid", "guide", ["channel", "step", "values"]],
  ["hdml-legend", "guide", ["channel", "step", "values"]],
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
  test("all 22 display tags are defined", () => {
    assert.lengthOf(EXPECTED, 22);
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
