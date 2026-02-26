/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { parse } from "./parse";
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
let state: {
  data: Uint8Array;
  files: Map<string, string>;
  mapping: Map<string, string>;
} = {
  data: new Uint8Array(),
  files: new Map(),
  mapping: new Map(),
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
        console.log(state);
        client?.postFiles(state).catch((error: Error) => {
          console.error(error.message);
        });
        break;
    }
  }
}
