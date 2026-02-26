/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { bytesToBase64, hashify } from "@hdml/hash";
import { parseHDML } from "@hdml/parser";
import { serialize, fileifize, StructType } from "@hdml/buffer";
import { HDOM } from "@hdml/types";

/**
 * Converts the source of the frame or model to a path.
 *
 * @param source - The source of the frame or model.
 * @returns The path of the frame or model.
 */
function sourceToPath(source: string): string {
  const [pathPart, queryPart] = source.split("?");
  if (!queryPart) {
    throw new Error(`Invalid source: ${source}`);
  }
  const lastSlash = pathPart.lastIndexOf("/");
  const dir = pathPart.slice(0, lastSlash + 1);
  const filename = pathPart.slice(lastSlash + 1);
  const path = `${dir}${queryPart}@${filename}`;
  return path;
}

/**
 * Parses the HTML and returns the names, connections, models, and
 * frames in binary format.
 *
 * @param state - The state to parse.
 * @param html - The HTML to parse.
 * @returns The names, connections, models, and frames in binary
 * format. The names are a map of local index to server path. The
 * connections, models, and frames are in binary format.
 */
export function parse(
  state: {
    data: Uint8Array;
    files: Map<string, string>;
    mapping: Map<string, string>;
  },
  html: string,
): {
  data: Uint8Array;
  files: Map<string, string>;
  mapping: Map<string, string>;
} {
  state.mapping.clear();

  const hdom = parseHDML(html);
  const hdomToSave: HDOM = {
    includes: [],
    connections: [],
    models: [],
    frames: [],
  };

  hdom.connections.forEach((connection) => {
    const name = connection.name;
    const content = serialize(
      connection,
      StructType.ConnectionStruct,
    );
    const base64 = bytesToBase64(content);
    const hash = hashify(base64);
    const localIndex = `?hdml-connection=${name}`;
    const serverPath = `hdml-connection=${name}@${hash}.html`;
    state.mapping.set(localIndex, serverPath);
    if (!state.files.has(serverPath)) {
      hdomToSave.connections.push(connection);
      state.files.set(serverPath, "parsed");
    }
  });
  hdom.models.forEach((model) => {
    const name = model.name;
    const content = serialize(model, StructType.ModelStruct);
    const base64 = bytesToBase64(content);
    const hash = hashify(base64);
    const localIndex = `?hdml-model=${name}`;
    const serverPath = `hdml-model=${name}@${hash}.html`;
    state.mapping.set(localIndex, serverPath);
    if (!state.files.has(serverPath)) {
      hdomToSave.models.push(model);
      state.files.set(serverPath, "parsed");
    }
  });
  hdom.frames.forEach((frame) => {
    const name = frame.name;
    if (frame.source.indexOf("/") === 0) {
      frame.source = sourceToPath(frame.source);
    } else if (frame.source.indexOf("?") === 0) {
      if (!state.mapping.has(frame.source)) {
        console.error(`Invalid source: ${frame.source}`);
      } else {
        frame.source = state.mapping.get(frame.source)!;
      }
    }
    const content = serialize(frame, StructType.FrameStruct);
    const base64 = bytesToBase64(content);
    const hash = hashify(base64);
    const localIndex = `?hdml-frame=${name}`;
    const serverPath = `hdml-frame=${name}@${hash}.html`;
    state.mapping.set(localIndex, serverPath);
    if (!state.files.has(serverPath)) {
      hdomToSave.frames.push(frame);
      state.files.set(serverPath, "parsed");
    }
  });

  state.data = fileifize(hdomToSave);
  return state;
}
