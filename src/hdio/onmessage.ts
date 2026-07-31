/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { parse } from "./parse";
import type { HdioState } from "./parse";
import {
  HdioClient,
  isStaleAuthError,
  recordStored,
} from "./HdioClient";

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
 * the one `HdmlIo.ts` posts. Only `props` / `html` are routed after
 * Slice A; `oidc-callback` is wired by Step 03 and
 * `subscribe`/`unsubscribe` by Step 07 — declared here so the union
 * is stable for downstream slices.
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
      type: "oidc-callback";
      data: { code: string; state: string };
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
 * Worker → main messages (RFC §2.5). Loosely typed scaffold here:
 * Step 06 introduces `ColumnType`/`Domain`, Step 07 tightens the
 * `result` payload.
 */
export type OutboundMessage =
  | {
      type: "auth";
      data: {
        ok: boolean;
        reason?: "stale" | "error";
        detail?: unknown;
      };
    }
  | {
      type: "result";
      data: {
        ref: string;
        column: string;
        values?: unknown;
        domain: unknown;
        type: unknown;
      };
    }
  | {
      type: "error";
      data: { ref?: string; message: string };
    };

/**
 * Builds the worker message handler. `client` and `state` live in the
 * closure — one endpoint, one client (A3, RFC §2.4) — replacing the
 * module-global state of the pre-Slice-A router. `post` is the
 * outbound sink; the `props`/`html` scaffold never calls it (neither
 * replies today), but B/D bind to it.
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
  // redeem it twice (B2, §3.2). Distinct from the client, which is
  // reconstructed every `props`.
  let redeemed: null | string = null;

  // Cross-call worker state: the last packed document bytes plus the
  // ref→key→stored registry retained for the post→confirm→query
  // handshake (RFC 004 Slice E §8.6, E-L).
  let state: HdioState = {
    data: new Uint8Array(),
    registry: new Map(),
  };

  return function handle(ev: MessageEvent): void {
    const msg = <InboundMessage>ev.data;
    if (!msg || !msg.type) {
      return;
    }
    switch (msg.type) {
      case "props": {
        if (client) {
          client.close();
        }
        client = new HdioClient(msg.data.host, msg.data.tenant);
        // Token mode (B2): the `token` attribute carries the handoff
        // code; redeem it once per distinct code, silently. OIDC mode
        // carries no token — it drives `oidc-callback` below.
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
        client
          ?.postDocument(state.data)
          .then((body) => {
            recordStored(state.registry, body);
          })
          .catch((error: Error) => {
            console.error(error.message);
          });
        break;
      case "oidc-callback":
        // OIDC exchange is worker-side (RFC §3.3, §10.1): the main
        // thread read `?code&state` off the URL; the worker fetches
        // `/auth/callback`, holds the pair, and reports back so the
        // main-thread state machine can strip the params (`ok`) or
        // re-navigate on a spent `state` (`stale`).
        client
          ?.exchangeOidcCode(msg.data.code, msg.data.state)
          .then(() => {
            post({ type: "auth", data: { ok: true } });
          })
          .catch((error: unknown) => {
            if (isStaleAuthError(error)) {
              post({
                type: "auth",
                data: { ok: false, reason: "stale" },
              });
            } else {
              post({
                type: "auth",
                data: {
                  ok: false,
                  reason: "error",
                  detail: (error as Error).message,
                },
              });
            }
          });
        break;
      default:
        break;
    }
  };
}
