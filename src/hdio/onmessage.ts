/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { throdeb } from "@hdml/common";
import { parse } from "./parse";
import type { HdioState } from "./parse";
import { resolveQueryTarget } from "./artifact";
import { decode } from "./decode";
import type { ColumnType, DecodedColumn } from "./decode";
import type { BufferRef } from "./delivery";
import { domainFor } from "./reducers";
import type { Domain } from "./reducers";
import { HdioClient, recordStored } from "./HdioClient";

/**
 * The outbound sink (A3, RFC §2.4): posts one worker→main message,
 * optionally with an A4 transfer list. The two wirings forward it as
 * `postMessage(msg, transfer ?? [])` — the universally-supported
 * transfer-list form, never the ES2024 `ArrayBuffer.prototype`
 * `.transfer()`.
 */
export type Post = (
  msg: OutboundMessage,
  transfer?: Transferable[],
) => void;

/**
 * Main → worker messages (RFC §2.5). The `{ type, data }` envelope is
 * the one `HdmlIo.ts` posts. `subscribe`/`unsubscribe` drive the D
 * query engine (Step 07); `props.config` carries the D8
 * `HDML_CONFIG` read main-side (a worker has no `window`) — today
 * only `queryReadyTimeout` (the D4 gate backstop). `oidc-tokens`
 * hands over the pair the **main-thread** OIDC exchange minted (§3.3)
 * — the worker cannot fetch the callback itself (its `blob:` origin
 * is CORS-rejected), so it only adopts the tokens for authed calls.
 */
export type InboundMessage =
  | {
      type: "props";
      data: {
        host: string;
        tenant: string;
        mode?: string;
        token?: string;
        config?: unknown;
      };
    }
  | {
      type: "html";
      data: { html: string };
    }
  | {
      type: "oidc-tokens";
      data: { access: null | string; refresh: null | string };
    }
  | {
      type: "subscribe";
      data: {
        id: string;
        ref: string;
        column: string;
        raw?: boolean;
      };
    }
  | {
      type: "unsubscribe";
      data: { id: string };
    };

/**
 * One decoded column inside an atomic `result` (D8 §1/§3): the
 * type-appropriate `domain` and the D9 `type` tag always, plus the
 * raw `values` only when some subscriber of that column wants them.
 * Numeric/temporal `values` cross as a transferable
 * {@link BufferRef} (A4, on the message's one transfer list); a
 * `string[]` column has no buffer, so it rides the structured clone
 * as-is. `nulls` — present only when the column has nulls and
 * `values` are pulled — is the row-null bitmask (1 bit/row, bit set =
 * null), transferred zero-copy alongside; it is the sole faithful
 * null carrier for a typed-array column.
 */
export interface ColumnResult {
  values?: BufferRef | string[];
  nulls?: BufferRef;
  domain: Domain;
  type: ColumnType;
}

/**
 * Worker → main messages (RFC §2.5, D8 §1). A `result` is **one
 * atomic snapshot per `(ref, generation)`** carrying every subscribed
 * column, with all transferable buffers on one transfer list — not
 * one message per column. Per-ref atomicity is *sufficient*: SPEC
 * §4.7 and V7 mean every render unit zips its columns from one ref,
 * and `hdml-io` fans a `result` out synchronously within the
 * receiving task, so a stack can never observe child *k* at
 * generation G+1 beside child *k+1* at G. The per-column split it
 * replaces was a message-layer tear.
 *
 * (The OIDC exchange is main-side now, so there is no `auth` reply.)
 */
export type OutboundMessage =
  | {
      type: "result";
      data: {
        ref: string;
        /** >= 1; strictly monotonic per ref per endpoint session. */
        generation: number;
        /** Arrow `table.numRows`. `0` is a real empty result. */
        rows: number;
        /**
         * Every **subscribed** column present in the result set,
         * keyed by column name. A subscribed column absent from the
         * result set is simply absent here — the main thread
         * synthesizes the explicit `absent` delivery from the
         * difference against its own subscriptions (D8 §1).
         */
        columns: Record<string, ColumnResult>;
      };
    }
  | {
      type: "error";
      data: {
        ref?: string;
        /**
         * Present when the failure belongs to a submitted generation;
         * absent for the pre-submit D4 gate timeout. Nothing produces
         * it yet — `#onMessage` still drops errors (RFC §7.5 delta 4,
         * the next step) — but it lands with the type so the wire is
         * edited once.
         */
        generation?: number;
        message: string;
      };
    };

// Poll cadence (D6, §5.6): short-first, doubling to a ceiling, with
// a wall-clock cap past which the job is declared timed out.
const POLL_MIN_MS = 200;
const POLL_MAX_MS = 2000;
const POLL_CAP_MS = 30000;

// The union is debounced before the first submit so a mount burst
// (many `subscribe`s in one tick) coalesces into one query (D1/D5).
const SUBMIT_DEBOUNCE_MS = 10;

// D4 stored-gate backstop when a covering POST neither resolves nor
// rejects; overridden by `props.config.queryReadyTimeout`.
const DEFAULT_READY_TIMEOUT_MS = 10000;

// The terminal job states (server `domain.JobStatus`): polling stops
// on any of these.
const TERMINAL_STATUS = new Set(["completed", "failed", "cancelled"]);

/**
 * One live subscription (D7): a `(ref, column)` binding and its
 * `raw` flag (`raw:false` = domain-only, no values pulled).
 */
interface Sub {
  id: string;
  ref: string;
  column: string;
  raw: boolean;
}

/**
 * Per-frame coalescing state, keyed by the source ref (D1/D5). One
 * query serves every subscriber of a frame; `columns` is the union
 * last submitted, `generation` the supersession marker (a late
 * completion whose generation is stale is discarded), and `gateTimer`
 * the armed D4 backstop while the target is not-yet-ready.
 */
interface Frame {
  ref: string;
  subs: Set<string>;
  columns: string[];
  generation: number;
  gateTimer: null | ReturnType<typeof setTimeout>;
  evaluate: throdeb.debounce<() => void>;
}

/**
 * Sleeps `ms` milliseconds (the poll back-off wait).
 *
 * @param ms - Delay in milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Whether two already-sorted column unions are equal — the "nothing
 * changed, do not resubmit" guard.
 *
 * @param a - One sorted column union.
 * @param b - The other sorted column union.
 * @returns `true` when identical.
 */
function sameColumns(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((c, i) => c === b[i]);
}

/**
 * Reads the D4 `queryReadyTimeout` from the `props.config` payload
 * (main-side `window.HDML_CONFIG`, §5.4), falling back to the
 * {@link DEFAULT_READY_TIMEOUT_MS} default when absent/invalid
 * (Step 08 populates it; this step lands first).
 *
 * @param config - The `props.config` payload (opaque here).
 * @returns The gate backstop in milliseconds.
 */
function readReadyTimeout(config: unknown): number {
  if (config && typeof config === "object") {
    const raw = (config as { queryReadyTimeout?: unknown })
      .queryReadyTimeout;
    if (typeof raw === "number" && raw > 0) {
      return raw;
    }
  }
  return DEFAULT_READY_TIMEOUT_MS;
}

/**
 * Best-effort cancel of a still-`pending` superseded job (D5): a
 * running job is never cancelled (server `Cancel` does not abort a
 * live Trino query), and the client swallows the 409 if the job
 * finished first. Fire-and-forget — a cancel failure is never fatal.
 *
 * @param client - The authed client.
 * @param jobId - The superseded job id.
 * @param status - Its last-seen status (only `pending` is cancelled).
 */
function maybeCancel(
  client: HdioClient,
  jobId: string,
  status: string,
): void {
  if (status === "pending") {
    void client.cancelQuery(jobId).catch(() => undefined);
  }
}

/**
 * Polls one job to a terminal state (D6, §5.6): a `submitQuery`
 * status already terminal (a cache hit) returns at once; otherwise
 * `queryStatus` is polled short-first, doubling to a ceiling, until
 * terminal or the wall-clock cap (→ synthesized `failed`). The poll
 * bails early — returning `done:false` — the moment the frame is
 * superseded, cancelling the job first if it is still `pending`.
 *
 * @param client - The authed client.
 * @param jobId - The job to poll.
 * @param initialStatus - The `submitQuery` 202 status.
 * @param superseded - Predicate: has a newer job taken this frame?
 * @returns `done:false` if superseded; else the terminal status.
 */
async function pollToCompletion(
  client: HdioClient,
  jobId: string,
  initialStatus: string,
  superseded: () => boolean,
): Promise<{ done: boolean; status: string; error?: string }> {
  let status = initialStatus;
  let error: undefined | string;
  let delay = POLL_MIN_MS;
  const deadline = Date.now() + POLL_CAP_MS;
  while (!TERMINAL_STATUS.has(status)) {
    if (superseded()) {
      maybeCancel(client, jobId, status);
      return { done: false, status };
    }
    if (Date.now() >= deadline) {
      return {
        done: true,
        status: "failed",
        error: "query timed out",
      };
    }
    await sleep(delay);
    delay = Math.min(delay * 2, POLL_MAX_MS);
    const polled = await client.queryStatus(jobId);
    status = polled.status;
    error = polled.error;
  }
  return { done: true, status, error };
}

/**
 * Builds the worker message handler. `client`, `state`, and the D
 * query engine's `subscriptions` / `frames` live in the closure —
 * one endpoint, one client (A3, RFC §2.4). `post` is the outbound
 * sink (worker→main).
 *
 * @param post - The outbound sink (worker→main).
 * @returns The `MessageEvent` listener to wire onto the endpoint.
 */
export function createHandler(
  post: Post,
): (ev: MessageEvent) => void {
  let client: null | HdioClient = null;

  // The last handoff code redeemed, retained across `props` so a
  // debounced re-`props` carrying the same single-use code does not
  // redeem it twice (B2, §3.2). Reset only when the connection
  // identity changes (a fresh client redeems its own handoff).
  let redeemed: null | string = null;

  // The `host\ntenant` identity of the live `client`. A repeat
  // `props` — the debounced attribute flurry, the token-mode auth
  // nudge (§3.3) — carries the same identity and must **reuse** the
  // client: reconstructing it would `close()` (abort) the in-flight
  // redeem and discard the held tokens, and the `redeemed` guard
  // would then block re-auth on the replacement — leaving every POST
  // unauthenticated. Only a genuine host/tenant change rebuilds (and
  // re-redeems).
  let identity: null | string = null;

  // The OIDC pair the main thread minted (§3.3) and handed over via
  // `oidc-tokens`, stashed so a client (re)built by a racing `props`
  // still adopts it (the exchange fetch and `props` are unordered).
  // Cleared on a genuine identity change — a new connection's tokens
  // are its own.
  let injectedTokens: null | {
    access: null | string;
    refresh: null | string;
  } = null;

  // Cross-call worker state: the last packed document bytes plus the
  // ref→key→stored registry retained for the post→confirm→query
  // handshake (RFC 004 Slice E §8.6, E-L). Doubles as the C6
  // query-target map `resolveQueryTarget` reads.
  let state: HdioState = {
    data: new Uint8Array(),
    registry: new Map(),
  };

  // D query engine (§5.2–§5.6): subId→subscription and the per-frame
  // coalescing state keyed by source ref. `readyTimeout` is the D4
  // gate backstop, refreshed from each `props.config`.
  const subscriptions = new Map<string, Sub>();
  const frames = new Map<string, Frame>();
  let readyTimeout = DEFAULT_READY_TIMEOUT_MS;

  // The union of every subscriber's column for one frame, sorted so
  // the union is order-independent (D1) and comparable (D5).
  function unionColumns(frame: Frame): string[] {
    const cols = new Set<string>();
    frame.subs.forEach((id) => {
      const sub = subscriptions.get(id);
      if (sub) {
        cols.add(sub.column);
      }
    });
    return [...cols].sort();
  }

  // Get-or-create a frame; its debounced `evaluate` collapses a
  // burst of sub/unsub/gate-release calls into one submit decision.
  function getFrame(ref: string): Frame {
    const existing = frames.get(ref);
    if (existing) {
      return existing;
    }
    const frame: Frame = {
      ref,
      subs: new Set(),
      columns: [],
      generation: 0,
      gateTimer: null,
      evaluate: throdeb.debounce(SUBMIT_DEBOUNCE_MS, () => {
        evaluateFrame(frame);
      }),
    };
    frames.set(ref, frame);
    return frame;
  }

  // Arm the D4 backstop once per gate episode (idempotent — a
  // re-eval while gated must not reset the window, or it never
  // fires). On expiry the consumer gets an `error`, not a spinner.
  function armGate(frame: Frame): void {
    if (frame.gateTimer !== null) {
      return;
    }
    frame.gateTimer = setTimeout(() => {
      frame.gateTimer = null;
      post({
        type: "error",
        data: {
          ref: frame.ref,
          message: "query target not ready before timeout",
        },
      });
    }, readyTimeout);
  }

  function disarmGate(frame: Frame): void {
    if (frame.gateTimer !== null) {
      clearTimeout(frame.gateTimer);
      frame.gateTimer = null;
    }
  }

  // The submit decision for one frame (D1/D4/D5): resolve the
  // target, hold behind the gate until ready, and submit one query
  // per changed union — bumping the generation so a superseded run
  // discards its late completion.
  function evaluateFrame(frame: Frame): void {
    if (client === null || frame.subs.size === 0) {
      return;
    }
    const union = unionColumns(frame);
    if (union.length === 0) {
      return;
    }
    let target: { docPath: string; stored: boolean };
    try {
      target = resolveQueryTarget(frame.ref, state.registry);
    } catch {
      // Unknown ref (subscribe-before-parse) → not-ready-yet inside
      // the D4 window, not a failure (§5.4).
      armGate(frame);
      return;
    }
    if (!target.stored) {
      // A local target holds until a 201 confirms it stored (D4).
      armGate(frame);
      return;
    }
    disarmGate(frame);
    if (frame.generation > 0 && sameColumns(union, frame.columns)) {
      return;
    }
    frame.columns = union;
    frame.generation += 1;
    void runQuery(
      frame,
      target.docPath,
      union,
      frame.generation,
      client,
    );
  }

  // Submit → poll → fetch → decode → deliver for one generation of
  // one frame. Every stage re-checks supersession and drops silently
  // when stale (D5); a real failure surfaces as one `error`.
  async function runQuery(
    frame: Frame,
    docPath: string,
    columns: string[],
    generation: number,
    c: HdioClient,
  ): Promise<void> {
    const superseded = (): boolean => frame.generation !== generation;
    try {
      const submitted = await c.submitQuery({ docPath, columns });
      if (superseded()) {
        maybeCancel(c, submitted.jobId, submitted.status);
        return;
      }
      const final = await pollToCompletion(
        c,
        submitted.jobId,
        submitted.status,
        superseded,
      );
      if (!final.done || superseded()) {
        return;
      }
      if (final.status === "failed") {
        post({
          type: "error",
          data: {
            ref: frame.ref,
            message: final.error || "query failed",
          },
        });
        return;
      }
      if (final.status !== "completed") {
        return;
      }
      const buffers = await c.queryResult(submitted.jobId);
      if (superseded()) {
        return;
      }
      deliver(frame, buffers);
    } catch (error) {
      if (superseded()) {
        return;
      }
      post({
        type: "error",
        data: {
          ref: frame.ref,
          message: (error as Error).message,
        },
      });
    }
  }

  // Decode the result once, then post ONE atomic `result` for this
  // (ref, generation) carrying every subscribed column (D8 §1). A
  // column wanted raw by any subscriber carries `values`; a
  // subscribed column absent from the result set is omitted, and the
  // main thread turns that omission into an explicit `absent`
  // delivery (where the old per-column `if (col)` skip was silent).
  function deliver(frame: Frame, buffers: ArrayBuffer[]): void {
    const table = decode(buffers.map((b) => new Uint8Array(b)));
    const byName = new Map(table.columns.map((c) => [c.name, c]));
    const wantRaw = new Map<string, boolean>();
    frame.subs.forEach((id) => {
      const sub = subscriptions.get(id);
      if (sub) {
        const prior = wantRaw.get(sub.column) ?? false;
        wantRaw.set(sub.column, prior || sub.raw);
      }
    });
    // One shared transfer list for the whole message. A Set, not an
    // array: with per-column messages a duplicated buffer detached
    // one message, but one list that names the same `ArrayBuffer`
    // twice throws `DataCloneError` and loses the entire generation.
    const transfer = new Set<Transferable>();
    const columns: Record<string, ColumnResult> = {};
    wantRaw.forEach((raw, column) => {
      const col = byName.get(column);
      if (col) {
        columns[column] = columnResult(col, raw, transfer);
      }
    });
    post(
      {
        type: "result",
        data: {
          ref: frame.ref,
          generation: frame.generation,
          rows: table.rows,
          columns,
        },
      },
      [...transfer],
    );
  }

  // One column's slot in the atomic result: `domain` + `type` always;
  // `values` only when raw is wanted, transferred zero-copy for a
  // typed array (A4) or cloned for a `string[]` (no buffer to
  // transfer). When the column has nulls, the row-null bitmask rides
  // along, transferred zero-copy too (D9 null fidelity) — the only
  // faithful null carrier for a typed-array column. Buffers are added
  // to the caller's one shared transfer list.
  function columnResult(
    col: DecodedColumn,
    raw: boolean,
    transfer: Set<Transferable>,
  ): ColumnResult {
    const domain = domainFor(col);
    const type = col.type;
    if (!raw) {
      return { domain, type };
    }
    // The optional null mask transfers alongside the values (present
    // only when the column has any null).
    let nulls: undefined | BufferRef;
    if (col.nulls) {
      const m = col.nulls;
      nulls = {
        buffer: m.buffer,
        byteOffset: m.byteOffset,
        byteLength: m.byteLength,
      };
      transfer.add(m.buffer);
    }
    if (col.type.kind === "string") {
      // Ordinal string column: no values buffer to transfer — the
      // values ride the structured clone as-is (D7); only the mask
      // (if any) transfers.
      return {
        values: col.values as string[],
        nulls,
        domain,
        type,
      };
    }
    // Numeric/temporal: a transferable typed array (A4). A plain
    // `number[]` (the union admits it; decode never emits one) is
    // packed to Float64 so it, too, transfers zero-copy.
    const src = col.values;
    const view = ArrayBuffer.isView(src)
      ? src
      : Float64Array.from(src as number[]);
    const buffer = view.buffer as ArrayBuffer;
    transfer.add(buffer);
    return {
      values: {
        buffer,
        byteOffset: view.byteOffset,
        byteLength: view.byteLength,
      },
      nulls,
      domain,
      type,
    };
  }

  // Re-evaluate every gated frame (event-driven release, D4): a fold
  // may have flipped a ref `stored`, or a parse may have registered
  // a previously-unknown ref.
  function releaseGatedFrames(): void {
    frames.forEach((frame) => {
      if (frame.gateTimer !== null) {
        frame.evaluate();
      }
    });
  }

  // Fail every gated frame at once (D4): a whole-document POST
  // rejection means nothing pending will ever become stored.
  function failGatedFrames(message: string): void {
    frames.forEach((frame) => {
      if (frame.gateTimer !== null) {
        disarmGate(frame);
        post({ type: "error", data: { ref: frame.ref, message } });
      }
    });
  }

  function teardownFrame(frame: Frame): void {
    frame.evaluate.cancel();
    disarmGate(frame);
    frames.delete(frame.ref);
  }

  // POST the whole document and fold the 201 into the registry
  // (004 Slice E §8.6). Shared by the `html` path and `oidc-tokens`:
  // in OIDC mode the minted pair arrives asynchronously, after the
  // load-time hdom-changed→postDocument has already failed with
  // `#access` null ("not authenticated"), so adopting the tokens must
  // re-drive the POST — else the ref never becomes `stored` and every
  // query stays gated until it times out. A no-op until a document is
  // parsed and a client exists; a re-POST is harmless (the server
  // idempotent-skips present keys, §8.6).
  function postAndFold(): void {
    if (client === null || state.data.length === 0) {
      return;
    }
    client
      .postDocument(state.data)
      .then((body) => {
        recordStored(state.registry, body);
        // A 201 may flip a gated ref `stored` → release it (D4).
        releaseGatedFrames();
      })
      .catch((error: Error) => {
        console.error(error.message);
        // One rejection fails every gated ref at once (D4).
        failGatedFrames(error.message);
      });
  }

  return function handle(ev: MessageEvent): void {
    const msg = <InboundMessage>ev.data;
    if (!msg || !msg.type) {
      return;
    }
    switch (msg.type) {
      case "props": {
        readyTimeout = readReadyTimeout(msg.data.config);
        const next = `${msg.data.host}\n${msg.data.tenant}`;
        if (client === null || identity !== next) {
          if (client) {
            client.close();
          }
          if (identity !== null) {
            // A genuine host/tenant change: the prior connection's
            // OIDC tokens no longer apply to the new one.
            injectedTokens = null;
          }
          client = new HdioClient(msg.data.host, msg.data.tenant);
          identity = next;
          redeemed = null;
          // Re-adopt an OIDC pair that arrived before this `props`
          // built the client (the exchange fetch races `props`).
          if (injectedTokens) {
            client.setTokens(
              injectedTokens.access,
              injectedTokens.refresh,
            );
          }
        }
        // Token mode (B2): the `token` attribute carries the handoff
        // code; redeem it once per distinct code, silently. OIDC mode
        // carries no token — the main thread runs the exchange and
        // hands the pair over via `oidc-tokens` below.
        const token = msg.data.token;
        if (token && token !== redeemed) {
          redeemed = token;
          client.redeemHandoff(token).catch((error: Error) => {
            console.error(error.message);
          });
        }
        break;
      }
      case "html":
        state = parse(state, msg.data.html);
        postAndFold();
        break;
      case "oidc-tokens":
        // The OIDC exchange ran on the main thread (§3.3) — the
        // worker's `blob:` origin is CORS-rejected by a cross-origin
        // HDIO server, so it cannot fetch `/auth/callback` itself. It
        // just adopts the minted pair for the authed document/query
        // requests, stashing it so a client rebuilt by a racing
        // `props` re-adopts it.
        injectedTokens = msg.data;
        client?.setTokens(msg.data.access, msg.data.refresh);
        // The load-time hdom-changed→postDocument raced ahead of
        // these tokens and threw "not authenticated" (no `#access`
        // yet), and nothing else re-POSTs. Re-drive it now that the
        // client is authed so the ref stores and gated queries can
        // run. (Token mode never hits this: its redeem sets
        // `#pending`, which the POST awaits.)
        postAndFold();
        break;
      case "subscribe": {
        const { id, ref, column, raw } = msg.data;
        subscriptions.set(id, {
          id,
          ref,
          column,
          raw: raw !== false,
        });
        const frame = getFrame(ref);
        frame.subs.add(id);
        frame.evaluate();
        break;
      }
      case "unsubscribe": {
        const sub = subscriptions.get(msg.data.id);
        if (!sub) {
          break;
        }
        subscriptions.delete(sub.id);
        const frame = frames.get(sub.ref);
        if (!frame) {
          break;
        }
        frame.subs.delete(sub.id);
        if (frame.subs.size === 0) {
          teardownFrame(frame);
        } else {
          frame.evaluate();
        }
        break;
      }
      default:
        break;
    }
  };
}
