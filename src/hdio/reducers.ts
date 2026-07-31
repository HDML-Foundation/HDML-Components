/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import type { DecodedColumn } from "./decode";

/**
 * A type-appropriate scale domain for a decoded column (RFC 014/001
 * §5.3, D3): an `extent` `[min, max]` for a continuous
 * (numeric/temporal) scale, or the `ordinal` distinct list for a
 * discrete (string) one. Delivered bundled with the raw values so one
 * `(ref, column)` subscription serves both a mark and its axis —
 * there is no separate min/max/aggregation request.
 */
export type Domain =
  | { kind: "extent"; value: [number, number] }
  | { kind: "ordinal"; value: unknown[] };

/**
 * Chooses the domain shape by the column's D9 kind (§5.3): `string`
 * → `ordinal` (an insertion-order-stable distinct list); everything
 * else (number/bigint/date/time/timestamp) → `extent`. `distinct` is
 * computed **only** for strings, so a continuous column never pays
 * a distinct pass and never hits a distinct-cliff; an ordinal date
 * bucket an author emits as `VARCHAR` (D9) arrives here as a string
 * and is treated ordinally.
 *
 * @param col - The decoded column.
 * @returns Its scale domain.
 */
export function domainFor(col: DecodedColumn): Domain {
  if (col.type.kind === "string") {
    return {
      kind: "ordinal",
      value: [...new Set(col.values as string[])],
    };
  }
  return { kind: "extent", value: extent(col.values) };
}

/**
 * The `[min, max]` extent over a numeric/temporal column, computed in
 * one linear pass — no spread, since the column can be large. A
 * `bigint` column widens to `number` to fit the RFC's `[number,
 * number]` shape; values beyond 2^53 lose integer precision at the
 * extremes, which is acceptable for a scale domain. An empty column
 * yields `[NaN, NaN]`.
 *
 * @param values - The decoded numeric/temporal values.
 * @returns The `[min, max]` extent.
 */
function extent(values: DecodedColumn["values"]): [number, number] {
  if (values.length === 0) {
    return [NaN, NaN];
  }
  let min = Number(values[0]);
  let max = min;
  for (let i = 1; i < values.length; i++) {
    const v = Number(values[i]);
    if (v < min) {
      min = v;
    }
    if (v > max) {
      max = v;
    }
  }
  return [min, max];
}
