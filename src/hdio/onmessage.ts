/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { parse } from "./parse";
import type { HdioState } from "./parse";
import { HdioClient } from "./HdioClient";

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
  void post;
  let client: null | HdioClient = null;

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
      case "props":
        if (client) {
          client.close();
        }
        client = new HdioClient(
          msg.data.host,
          msg.data.tenant,
          msg.data.token,
        );
        break;
      case "html":
        state = parse(state, msg.data.html);
        client?.postFiles(state).catch((error: Error) => {
          console.error(error.message);
        });
        break;
      default:
        break;
    }
  };
}
