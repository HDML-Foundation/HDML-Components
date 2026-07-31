/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { arrow } from "@hdml/common";

/**
 * The faithful, Arrow-schema-derived type tag a decoded column
 * carries (RFC 014/001 §5.7, D9). HDML's three temporal families
 * each keep their **own** kind — never collapsed to one instant — so
 * a consumer's scale can treat a calendar day, a within-day offset,
 * and an absolute instant distinctly. `unit` is always `"ms"`: decode
 * normalizes every temporal family to ms at the edge (Date /
 * Timestamp → epoch-ms, Time → ms-since-midnight). A `Timestamp`'s
 * source timezone rides in `zone` as a display hint and never shifts
 * the instant; a zone-less `Timestamp` omits it (read as UTC).
 */
export type ColumnType =
  | { kind: "string" }
  | { kind: "number" }
  | { kind: "bigint" }
  | { kind: "date"; unit: "ms" }
  | { kind: "time"; unit: "ms" }
  | { kind: "timestamp"; unit: "ms"; zone?: string };

/**
 * One decoded column: its name, its D9 {@link ColumnType} tag, and
 * its values in a render-ready shape. Numeric/temporal values are a
 * typed array (transferable via `.buffer` in Step 07); strings are a
 * `string[]`; 64-bit integers are a `BigInt64Array`. The shape is
 * driven off the self-describing Arrow result schema, never the
 * authored frame `type`.
 */
export interface DecodedColumn {
  name: string;
  type: ColumnType;
  values:
    | Float64Array
    | Int32Array
    | BigInt64Array
    | string[]
    | number[];
}

/**
 * Decodes an Arrow IPC payload (one `Uint8Array`, or an array of them
 * for a chunked/multi-message stream) into one {@link DecodedColumn}
 * per field. Each column's kind is read straight from the Arrow
 * `field.type` — the self-describing result schema — and never the
 * authored frame `type` (§5.7). Every temporal family is normalized
 * to ms here; a zone-less `Timestamp` is read as UTC (the one silent
 * decision, deterministic across clients — no local-offset shift).
 *
 * @param ipc - Arrow IPC bytes (single buffer or message chunks).
 * @returns One decoded column per Arrow field, in schema order.
 */
export function decode(
  ipc: Uint8Array | Uint8Array[],
): DecodedColumn[] {
  const table = arrow.tableFromIPC(ipc);
  const columns: DecodedColumn[] = [];
  for (let c = 0; c < table.numCols; c++) {
    const vector = table.getChildAt(c);
    if (!vector) {
      continue;
    }
    const type = columnType(vector.type as arrow.DataType);
    columns.push({
      name: table.schema.fields[c].name,
      type,
      values: columnValues(vector, type),
    });
  }
  return columns;
}

/**
 * Maps an Arrow `DataType` to its D9 {@link ColumnType} tag (§5.7).
 * The three temporal families each keep their own kind; a
 * `Timestamp`'s `timezone` (absent → zone-less → read as UTC) rides
 * along as a display hint. An unsupported Arrow type degrades to
 * `string` so one odd column never aborts the whole batch.
 *
 * @param type - The Arrow field type from the result schema.
 * @returns The decoded column type tag.
 */
function columnType(type: arrow.DataType): ColumnType {
  switch (type.typeId) {
    case arrow.Type.Utf8:
      return { kind: "string" };
    case arrow.Type.Int:
      return (type as arrow.Int).bitWidth === 64
        ? { kind: "bigint" }
        : { kind: "number" };
    case arrow.Type.Float:
      return { kind: "number" };
    case arrow.Type.Date:
      return { kind: "date", unit: "ms" };
    case arrow.Type.Time:
      return { kind: "time", unit: "ms" };
    case arrow.Type.Timestamp: {
      const zone = (type as arrow.Timestamp).timezone;
      return zone
        ? { kind: "timestamp", unit: "ms", zone }
        : { kind: "timestamp", unit: "ms" };
    }
    default:
      return { kind: "string" };
  }
}

/**
 * Extracts a column's values in the render-ready shape its
 * {@link ColumnType} implies (§5.7). Reads through Arrow's high-level
 * accessors, not raw buffers, so 64-bit layout quirks stay Arrow's
 * concern: the `Date`/`Timestamp` accessors already yield a `Date` /
 * epoch-ms number, while the `Time` accessor yields the raw source
 * unit — so only `time` is scaled to ms here.
 *
 * @param vector - The Arrow column vector.
 * @param type - Its already-decoded {@link ColumnType}.
 * @returns The decoded values.
 */
function columnValues(
  vector: arrow.Vector,
  type: ColumnType,
): DecodedColumn["values"] {
  const n = vector.length;
  switch (type.kind) {
    case "string":
      return vector.toArray() as string[];
    case "number":
      return Float64Array.from(vector.toArray() as ArrayLike<number>);
    case "bigint":
      return BigInt64Array.from(
        vector.toArray() as ArrayLike<bigint>,
      );
    case "date": {
      const out = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const day = vector.get(i) as Date | null;
        out[i] = day ? day.getTime() : NaN;
      }
      return out;
    }
    case "time": {
      const unit = (vector.type as arrow.Time).unit;
      const out = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const raw = vector.get(i) as number | bigint | null;
        out[i] = raw === null ? NaN : timeToMs(Number(raw), unit);
      }
      return out;
    }
    case "timestamp": {
      const out = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const ms = vector.get(i) as number | null;
        out[i] = ms === null ? NaN : ms;
      }
      return out;
    }
  }
}

/**
 * Converts a `Time` value from its Arrow source unit to
 * milliseconds-since-midnight. Dividing (not multiplying by a
 * fractional factor) keeps µs/ns exact for whole-ms inputs.
 *
 * @param raw - The raw time value in `unit`.
 * @param unit - The Arrow `TimeUnit` of the source column.
 * @returns Milliseconds since midnight.
 */
function timeToMs(raw: number, unit: arrow.TimeUnit): number {
  switch (unit) {
    case arrow.TimeUnit.SECOND:
      return raw * 1000;
    case arrow.TimeUnit.MILLISECOND:
      return raw;
    case arrow.TimeUnit.MICROSECOND:
      return raw / 1000;
    case arrow.TimeUnit.NANOSECOND:
      return raw / 1e6;
    default:
      return raw;
  }
}
