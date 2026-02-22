/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { HdmlParser } from "./HdmlParser";

const parser = new HdmlParser();

let host: string;
let tenant: string;
let token: string;

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

globalThis.self.onmessage = (message: MessageEvent) => {
  const msg = <HdmlMessage>message.data;
  if (msg.type) {
    switch (msg.type) {
      case "props":
        host = msg.data.host;
        tenant = msg.data.tenant;
        token = msg.data.token;
        console.log(host, tenant, token);
        break;
      case "html":
        parser.parse(msg.data.html);
        // console.log(msg.data.html);
        // console.log(parser.names);
        // console.log(parser.models);
        // console.log(parser.frames);
        break;
    }
  }
};

const _script = "_script";
export default _script;
