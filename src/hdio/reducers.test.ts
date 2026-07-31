/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import { domainFor } from "./reducers";
import type { DecodedColumn } from "./decode";

suite("domainFor (type-driven scale domain)", () => {
  test("numeric column → extent [min, max]", () => {
    const col: DecodedColumn = {
      name: "n",
      type: { kind: "number" },
      values: Float64Array.from([3, 1, 2]),
    };
    assert.deepEqual(domainFor(col), {
      kind: "extent",
      value: [1, 3],
    });
  });

  test("temporal column → extent over epoch-ms", () => {
    const col: DecodedColumn = {
      name: "ts",
      type: { kind: "timestamp", unit: "ms" },
      values: Float64Array.from([100, 50, 200]),
    };
    assert.deepEqual(domainFor(col), {
      kind: "extent",
      value: [50, 200],
    });
  });

  test("bigint column → numeric extent", () => {
    const col: DecodedColumn = {
      name: "b",
      type: { kind: "bigint" },
      values: BigInt64Array.from([5n, 1n, 9n]),
    };
    assert.deepEqual(domainFor(col), {
      kind: "extent",
      value: [1, 9],
    });
  });

  test("string column → ordinal distinct list", () => {
    const col: DecodedColumn = {
      name: "s",
      type: { kind: "string" },
      values: ["a", "b", "a", "c", "b"],
    };
    assert.deepEqual(domainFor(col), {
      kind: "ordinal",
      value: ["a", "b", "c"],
    });
  });

  test("string distinct is insertion-order-stable", () => {
    const col: DecodedColumn = {
      name: "s",
      type: { kind: "string" },
      values: ["b", "a", "a", "b"],
    };
    assert.deepEqual(domainFor(col), {
      kind: "ordinal",
      value: ["b", "a"],
    });
  });
});
