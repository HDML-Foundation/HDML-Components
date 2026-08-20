/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import "./index";
import {
  HDVL_TAG_NAMES,
  STACK_ATTRS_LIST,
  VIEW_ATTRS_LIST,
} from "./vocabulary";
import { registerNamespace, supports } from "./supports";

/**
 * `HDML.supports()` (§8.5).
 *
 * It is **registration-based**: it answers what this build
 * registers and which attributes the published enums give that tag.
 * A page that never imports `@hdml/components/hdvl` gets `false`
 * for all twenty-one, which is the question a host app is asking.
 */

/** `globalThis` as a bag, so an unrelated key can be planted. */
function scope(): Record<string, unknown> {
  return <Record<string, unknown>>(<unknown>globalThis);
}

function namespace(): Record<string, unknown> {
  return <Record<string, unknown>>scope().HDML;
}

suite("hdvl/supports — HDML.supports", () => {
  test("it answers for tags and for attributes", () => {
    assert.isTrue(supports(HDVL_TAG_NAMES.STACK));
    assert.isFalse(supports("hdml-nonesuch"));
    // A data tag is not display vocabulary, even though it is a
    // real HDML element registered by the root entry.
    assert.isFalse(supports("hdml-frame"));

    assert.isTrue(
      supports(HDVL_TAG_NAMES.STACK, STACK_ATTRS_LIST.OFFSET),
    );
    assert.isFalse(supports(HDVL_TAG_NAMES.STACK, "nonesuch"));
    // An attribute of another element is not this one's.
    assert.isFalse(
      supports(HDVL_TAG_NAMES.VIEW, STACK_ATTRS_LIST.OFFSET),
    );
    assert.isTrue(
      supports(HDVL_TAG_NAMES.VIEW, VIEW_ATTRS_LIST.SOURCE),
    );
  });

  test("registration is additive", () => {
    const before = scope().HDML;
    const mine = { supports: undefined, mine: 42 };
    scope().HDML = mine;
    try {
      registerNamespace();
      // The object is kept, never replaced — a page may load two
      // builds, or a host app may own the namespace already.
      assert.strictEqual(scope().HDML, mine);
      assert.strictEqual(namespace().mine, 42);
      assert.isFunction(namespace().supports);
    } finally {
      scope().HDML = before;
    }
    assert.isFunction(namespace().supports);
  });

  test("every display tag answers true", () => {
    // It reads the published enums, so it cannot drift from what is
    // registered: all twenty-one, `hdml-fallback` included, which
    // is registered precisely so this answers for it.
    const tags = Object.values(HDVL_TAG_NAMES);
    assert.lengthOf(tags, 21);
    for (const tag of tags) {
      assert.isTrue(supports(tag), tag);
    }
    // `hdml-fallback` has no attributes and its content is exempt
    // from every V-rule (§2.2).
    assert.isFalse(
      supports(HDVL_TAG_NAMES.FALLBACK, VIEW_ATTRS_LIST.SOURCE),
    );
  });
});
