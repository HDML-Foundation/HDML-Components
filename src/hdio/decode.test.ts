/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import { arrow } from "@hdml/common";
import { decode } from "./decode";
import type { DecodedColumn } from "./decode";

// The decode input is real Arrow IPC, so every fixture is a typed
// Arrow table serialized with `tableToIPC` (§5.7). Temporal columns
// are built from natural JS values (Date / seconds); Arrow encodes
// them to its own units, and decode must read them back normalized.
function ipcOf(cols: Record<string, arrow.Vector>): Uint8Array {
  return arrow.tableToIPC(new arrow.Table(cols));
}

function pick(cols: DecodedColumn[], name: string): DecodedColumn {
  const found = cols.find((c) => c.name === name);
  assert.isDefined(found, `missing column ${name}`);
  return found;
}

// 2000-01-01T00:00:00Z — an exact UTC-midnight day.
const Y2K = 946684800000;

suite("decode (Arrow IPC → typed columns)", () => {
  test("each Arrow field → its D9 kind + values", () => {
    const cols = decode(
      ipcOf({
        s: arrow.vectorFromArray(["x", "y", "x"], new arrow.Utf8()),
        i: arrow.vectorFromArray([1, 2, 3], new arrow.Int32()),
        f: arrow.vectorFromArray(
          [1.5, 2.5, 3.5],
          new arrow.Float64(),
        ),
        d: arrow.vectorFromArray(
          [new Date(0), new Date(86400000), new Date(Y2K)],
          new arrow.DateDay(),
        ),
        t: arrow.vectorFromArray(
          [0, 3600, 86399],
          new arrow.TimeSecond(),
        ),
        ts: arrow.vectorFromArray(
          [new Date(0), new Date(86400000), new Date(Y2K)],
          new arrow.TimestampMillisecond(),
        ),
      }),
    );

    const s = pick(cols, "s");
    assert.deepEqual(s.type, { kind: "string" });
    assert.deepEqual(s.values, ["x", "y", "x"]);

    const i = pick(cols, "i");
    assert.deepEqual(i.type, { kind: "number" });
    assert.instanceOf(i.values, Float64Array);
    assert.deepEqual(Array.from(i.values), [1, 2, 3]);

    const f = pick(cols, "f");
    assert.deepEqual(f.type, { kind: "number" });
    assert.deepEqual(
      Array.from(f.values as Float64Array),
      [1.5, 2.5, 3.5],
    );

    // Date32 → epoch-ms at UTC midnight (a calendar day).
    const d = pick(cols, "d");
    assert.deepEqual(d.type, { kind: "date", unit: "ms" });
    assert.deepEqual(Array.from(d.values as Float64Array), [
      0,
      86400000,
      Y2K,
    ]);

    // Time32(s) → ms since midnight, NOT an instant.
    const t = pick(cols, "t");
    assert.deepEqual(t.type, { kind: "time", unit: "ms" });
    assert.deepEqual(
      Array.from(t.values as Float64Array),
      [0, 3600000, 86399000],
    );

    // Timestamp → epoch-ms instant.
    const ts = pick(cols, "ts");
    assert.deepEqual(ts.type, { kind: "timestamp", unit: "ms" });
    assert.deepEqual(Array.from(ts.values as Float64Array), [
      0,
      86400000,
      Y2K,
    ]);
  });

  test("zone-less Timestamp → UTC, no zone key", () => {
    const [col] = decode(
      ipcOf({
        ts: arrow.vectorFromArray(
          [new Date(0), new Date(Y2K)],
          new arrow.TimestampMillisecond(),
        ),
      }),
    );
    assert.deepEqual(col.type, { kind: "timestamp", unit: "ms" });
    assert.deepEqual(Array.from(col.values as Float64Array), [
      0,
      Y2K,
    ]);
  });

  test("zoned Timestamp → zone set, instant unchanged", () => {
    const [col] = decode(
      ipcOf({
        ts: arrow.vectorFromArray(
          [new Date(0), new Date(Y2K)],
          new arrow.TimestampMillisecond("America/New_York"),
        ),
      }),
    );
    assert.deepEqual(col.type, {
      kind: "timestamp",
      unit: "ms",
      zone: "America/New_York",
    });
    // The zone is a display hint — the instant is NOT shifted.
    assert.deepEqual(Array.from(col.values as Float64Array), [
      0,
      Y2K,
    ]);
  });

  test("64-bit integer → bigint kind with bigint values", () => {
    const [col] = decode(
      ipcOf({
        b: arrow.vectorFromArray([10n, 20n, 30n], new arrow.Int64()),
      }),
    );
    assert.deepEqual(col.type, { kind: "bigint" });
    assert.instanceOf(col.values, BigInt64Array);
    assert.deepEqual(Array.from(col.values), [10n, 20n, 30n]);
  });

  test("nulls → mask; valid rows decode; clean col omits it", () => {
    const cols = decode(
      ipcOf({
        f: arrow.vectorFromArray(
          [1.5, null, 3.5],
          new arrow.Float64(),
        ),
        s: arrow.vectorFromArray(["a", null, "c"], new arrow.Utf8()),
        clean: arrow.vectorFromArray([1, 2, 3], new arrow.Int32()),
      }),
    );

    // Row 1 null → bit 1 set in byte 0 (0b010); rows 0/2 valid.
    const f = pick(cols, "f");
    assert.instanceOf(f.nulls, Uint8Array);
    assert.equal(f.nulls[0], 0b010);
    // The null slot reads back as its zero-fill; valid rows decode.
    assert.equal((f.values as Float64Array)[0], 1.5);
    assert.equal((f.values as Float64Array)[2], 3.5);

    // A string column carries the mask too (kind-uniform).
    const s = pick(cols, "s");
    assert.instanceOf(s.nulls, Uint8Array);
    assert.equal(s.nulls[0], 0b010);

    // A fully-valid column omits the mask entirely.
    assert.isUndefined(pick(cols, "clean").nulls);
  });
});
