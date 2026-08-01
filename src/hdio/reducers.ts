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
      value: distinct(col.values as (string | null)[], col.nulls),
    };
  }
  return { kind: "extent", value: extent(col.values, col.nulls) };
}

/**
 * Whether row `i` is null per the column's optional {@link
 * DecodedColumn.nulls} bitmask (bit `i` set = null, LSB-first). No
 * mask = no nulls.
 *
 * @param nulls - The optional row-null bitmask.
 * @param i - The row index.
 * @returns `true` when row `i` is null.
 */
function isNull(nulls: Uint8Array | undefined, i: number): boolean {
  return (
    nulls !== undefined && (nulls[i >> 3] & (1 << (i & 7))) !== 0
  );
}

/**
 * The insertion-order-stable distinct list for an ordinal column,
 * skipping null rows (a null is not an axis category) — the mask is
 * authoritative, and an inline `null`/`undefined` value is dropped
 * too.
 *
 * @param values - The string values (may hold inline null).
 * @param nulls - The optional row-null bitmask.
 * @returns The distinct non-null values, first-seen order.
 */
function distinct(
  values: (string | null)[],
  nulls: Uint8Array | undefined,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = 0; i < values.length; i++) {
    if (isNull(nulls, i)) {
      continue;
    }
    const v = values[i];
    if (v === null || v === undefined || seen.has(v)) {
      continue;
    }
    seen.add(v);
    out.push(v);
  }
  return out;
}

/**
 * The `[min, max]` extent over a numeric/temporal column, computed in
 * one linear pass — no spread, since the column can be large. A
 * `bigint` column widens to `number` to fit the RFC's `[number,
 * number]` shape; values beyond 2^53 lose integer precision at the
 * extremes, which is acceptable for a scale domain.
 *
 * Null rows are skipped via the {@link DecodedColumn.nulls} mask, so
 * a null's zero-fill (`0` / `0n`) or temporal `NaN` fill never drags
 * the extent — the exact `[0, …]` corruption a full-outer join
 * produced before the mask existed. An empty or all-null column
 * yields `[NaN, NaN]`.
 *
 * @param values - The decoded numeric/temporal values.
 * @param nulls - The optional row-null bitmask.
 * @returns The `[min, max]` extent over the non-null values.
 */
function extent(
  values: DecodedColumn["values"],
  nulls: Uint8Array | undefined,
): [number, number] {
  let min = NaN;
  let max = NaN;
  for (let i = 0; i < values.length; i++) {
    if (isNull(nulls, i)) {
      continue;
    }
    const v = Number(values[i]);
    if (Number.isNaN(min)) {
      min = v;
      max = v;
    } else {
      if (v < min) {
        min = v;
      }
      if (v > max) {
        max = v;
      }
    }
  }
  return [min, max];
}
