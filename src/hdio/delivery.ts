/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import type { ColumnType } from "./decode";
import type { Domain } from "./reducers";

/**
 * The consumer-facing half of the D8 seam (RFC 016/001 §2.6, D8 §4).
 *
 * This module is deliberately a **leaf with no value imports** —
 * types only. `src/hdvl/` imports it `import type`-only (RFC §2.1)
 * and `scripts/check-dist.mjs` enforces that: a value import of
 * {@link Delivery} would pull the worker, `@hdml/parser` and Arrow
 * into every chart page, and would compile silently. Keeping the
 * union out of `HdmlIo.ts` (which pulls Lit + the endpoint) and out
 * of `onmessage.ts` (which pulls the worker graph) is what makes that
 * type-only import honest rather than merely well-intentioned.
 *
 * @module delivery
 */

/**
 * A transferable view descriptor: a view may cover only part of its
 * buffer, so offset/length ride along. One definition serves both the
 * worker wire (`ColumnResult`) and this seam.
 */
export interface BufferRef {
  buffer: ArrayBuffer;
  byteOffset: number;
  byteLength: number;
}

/**
 * Stable, machine-readable delivery-failure ids (RFC §2.6, delta 8),
 * so a host app branches on the code and never on the prose. Disjoint
 * from the validator's `DiagnosticCode` space (RFC §8.1), and both
 * ride the consumer's outward `hdml-error`.
 */
export type DeliveryCode =
  | "gate-timeout"
  | "query-failed"
  | "absent-column"
  | "transport"
  | "provider-gone";

/**
 * What a subscriber's `deliver` receives — the per-subscription slice
 * of one atomic `(ref, generation)` result, or the ref's failure
 * (D8 §4/§5).
 *
 * `generation` is the supersession stamp: adopt iff `G >= latest`,
 * else discard **wholesale** (D8 §6.1). Note the stamp, not the
 * `kind`, is what governs staleness — which is why the `error` arm's
 * `generation` is optional: a stamped (post-submit) error obeys the
 * ordering rule exactly like data, while an unstamped pre-submit gate
 * timeout is current by ordering and is always adopted (D8 §6.2).
 *
 * `values` / `nulls` are shared **by reference** with every sibling
 * subscriber of the same column: treat a delivery as immutable and
 * non-transferable, and copy if mutation is needed (D8 §6.4).
 *
 * **The `error` arm has no producer yet.** `HdmlIo`'s `#onMessage`
 * still drops worker `error` messages — that is RFC §7.5 delta 4, the
 * next step. The arm lands with the rest of the union because it is
 * one type, and because the staleness rule above is only statable
 * once `error` carries an optional `generation` beside `data`'s
 * required one.
 */
export type Delivery =
  | {
      kind: "data";
      ref: string;
      column: string;
      generation: number;
      rows: number;
      values?: BufferRef | string[];
      nulls?: BufferRef;
      domain: Domain;
      type: ColumnType;
    }
  | {
      /**
       * The generation arrived; this column is not in the result set.
       * The runtime completion of V4 for the static refs the in-page
       * validator cannot check — where the old worker-side `if (col)`
       * skip left a typo'd column spinning forever.
       */
      kind: "absent";
      ref: string;
      column: string;
      generation: number;
      rows: number;
      code: "absent-column";
    }
  | {
      /** A ref-scoped failure, fanned to every subscriber of it. */
      kind: "error";
      ref: string;
      column: string;
      generation?: number;
      message: string;
      code: DeliveryCode;
    };

/**
 * The settled D8 request detail — **no longer provisional**. RFC
 * 014/001 §8 deferred this schema to the co-design with the consumer
 * vocabulary; the D8 Seam Contract §4 is that co-design, and it
 * settled the shape the provisional reading had guessed, with two
 * changes: `deliver` is required, and it takes a {@link Delivery}.
 */
export interface RequestDetail {
  id: string;

  /**
   * The effective source ref (SPEC's inherited `source`). It MUST NOT
   * carry a `&column=` tail: the worker coalesces frames by verbatim
   * ref string, so a tailed ref would split one frame's union into
   * several queries. The tail stays legal for `hdml-frame` documents
   * and raw callers; HDVL consumers never emit it.
   */
  ref: string;

  /** The bound column (a channel attribute, or a scale `values`). */
  column: string;

  /** Default true; false = domain-only (SPEC §4's domain shape). */
  raw?: boolean;

  signal?: AbortSignal;

  /**
   * REQUIRED. It was optional with a silent no-op default, which
   * discarded delivered data outright (RFC §7.5 delta 6).
   */
  deliver: (d: Delivery) => void;
}
