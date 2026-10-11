/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * ★★ **Cross-page sheet isolation — 019 step 30.**
 *
 * `mountCorpus` injects a page's `<head>` `<style>` blocks into the
 * **shared** `document.head` while mounting its body into a local
 * `<div>`. The injected selectors are global: nothing scopes them
 * to the mounted root, so isolation between two pages rests
 * entirely on `corpus.ts`'s teardown emptying `injected`.
 *
 * That was a cosmetic concern until items 18+19 moved `count` and
 * `format` into CSS. **Six selectors now collide across pages with
 * different values** — `hdml-grid[channel="radius"]` is `4` on
 * `09-polar-area` and `5` on `10-radar`; `hdml-tick[channel="x"]`
 * is `12` on `01-line` and `5` on `12-coverage`;
 * `hdml-label[channel="x"]`, `[channel="y"]`, `[channel="radius"]`
 * and `hdml-grid[channel="x"]` likewise — and a tick count or a
 * skeleton changes the **scene**, not the paint. A surviving sheet
 * would therefore move another page's whole-`Scene` golden, in
 * another page's suite, with nothing pointing back here.
 *
 * ★ **The pair below is the sharpest instance there is.**
 * `09-polar-area` writes a skeleton on
 * `hdml-label[channel="radius"]` and `10-radar` writes only a count
 * on the same selector — so a leak gives `10-radar`'s radius labels
 * a format they never authored, and `10-radar`'s own rule **cannot
 * override it**, because it declares a different property.
 * `validator.test.ts` mounts both pages, in this order.
 *
 * ⓘ Measured at step 30: the teardown does run, `document.head` is
 * empty at every mount, and no page leaks into another. This suite
 * is what keeps that true, beside the `assert` in `mountCorpus`
 * itself — which fires on the state no test creates today, two
 * pages mounted inside one test.
 */

import { assert } from "@open-wc/testing";
import "../index";
import { mountCorpus } from "../../testing/corpus";

suite("corpus sheet isolation", () => {
  const read = (el: Element, prop: string): string =>
    getComputedStyle(el).getPropertyValue(prop).trim();

  const radius = (
    page: Awaited<ReturnType<typeof mountCorpus>>,
  ): [Element, Element] => [
    <Element>(
      page.views[0].querySelector('hdml-label[channel="radius"]')
    ),
    <Element>(
      page.views[0].querySelector('hdml-grid[channel="radius"]')
    ),
  ];

  test("09-polar-area declares 4 and a skeleton", async () => {
    const page = await mountCorpus("09-polar-area");
    assert.strictEqual(page.sheets, 1);
    const [label, grid] = radius(page);
    assert.strictEqual(read(label, "--hdml-tick-count"), "4");
    assert.strictEqual(
      read(label, "--hdml-text-format"),
      "compact-short",
    );
    assert.strictEqual(read(grid, "--hdml-tick-count"), "4");
  });

  test("★★ 10-radar then sees NONE of it", async () => {
    // The head is empty again by now — asserted inside
    // `mountCorpus`, so reaching this line already proves the
    // teardown ran.
    const page = await mountCorpus("10-radar");
    const [label, grid] = radius(page);
    // ★ The load-bearing one: `10-radar` declares no skeleton
    // anywhere, so a non-empty value here could only have come
    // from the previous page.
    assert.strictEqual(read(label, "--hdml-text-format"), "");
    assert.strictEqual(read(label, "--hdml-tick-count"), "5");
    assert.strictEqual(read(grid, "--hdml-tick-count"), "5");
  });
});
