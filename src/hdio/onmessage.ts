/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { parse } from "./parse";
import type { HdioState } from "./parse";
import { HdioClient } from "./HdioClient";

let client: null | HdioClient = null;

type HdmlMessage =
  | {
      type: "props";
      data: {
        host: string;
        tenant: string;
        token: string;
      };
    }
  | {
      type: "html";
      data: {
        html: string;
      };
    };

let host: string;
let tenant: string;
let token: string;

/**
 * Cross-call worker state: the last packed document bytes plus the
 * ref→key→stored registry retained for the post→confirm→query
 * handshake (RFC 004 Slice E §8.6, E-L).
 */
let state: HdioState = {
  data: new Uint8Array(),
  registry: new Map(),
};

/**
 * Handles messages from the main thread.
 *
 * @param message - The message from the main thread.
 */
export function onmessage(message: MessageEvent): void {
  const msg = <HdmlMessage>message.data;
  if (msg.type) {
    switch (msg.type) {
      case "props":
        host = msg.data.host;
        tenant = msg.data.tenant;
        token = msg.data.token;
        if (client) {
          client.close();
        }
        client = new HdioClient(host, tenant, token);
        break;
      case "html":
        state = parse(state, msg.data.html);
        client?.postFiles(state).catch((error: Error) => {
          console.error(error.message);
        });
        break;
    }
  }
}
