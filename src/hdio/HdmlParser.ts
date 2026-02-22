/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { bytesToBase64, hashify } from "@hdml/hash";
import { parseHDML } from "@hdml/parser";
import { serialize, fileifize, StructType } from "@hdml/buffer";
import { HDOM, Connection, Model, Frame } from "@hdml/types";

export class HdmlParser {
  public connections: Map<string, Connection> = new Map();
  public models: Map<string, Model> = new Map();
  public frames: Map<string, Frame> = new Map();
  public names: Map<string, string> = new Map();

  #sortFrames(frames: Frame[]): Frame[] {
    const sorted: Frame[] = [];
    const map = new Map(
      frames.map((frame) => [`?hdml-frame=${frame.name}`, frame]),
    );
    const visited = new Set<string>();
    const visit = (frame: Frame) => {
      if (visited.has(frame.name)) return;
      visited.add(frame.name);
      if (
        frame.source.indexOf("?hdml-frame") === 0 &&
        map.has(frame.source)
      ) {
        visit(map.get(frame.source)!);
      }
      sorted.push(frame);
    };
    frames.forEach((item) => visit(item));
    return sorted;
  }

  #sourceToPath(source: string): string {
    const [pathPart, queryPart] = source.split("?");

    if (!queryPart) throw new Error(`Invalid source: ${source}`);

    const lastSlash = pathPart.lastIndexOf("/");
    const dir = pathPart.slice(0, lastSlash + 1);
    const filename = pathPart.slice(lastSlash + 1);
    const path = `${dir}${queryPart}@${filename}`;

    return path;
  }

  public parse(html: string): void {
    this.connections.clear();
    this.models.clear();
    this.frames.clear();
    this.names.clear();

    const hdom = parseHDML(html);

    const connectionsHdom: HDOM = {
      includes: [],
      connections: [],
      models: [],
      frames: [],
    };
    hdom.connections.forEach((connection) => {
      connectionsHdom.connections.push(connection);
    });
    console.log("ConnectionsFiles", fileifize(connectionsHdom));

    const modelsHdom: HDOM = {
      includes: [],
      connections: [],
      models: [],
      frames: [],
    };
    hdom.models.forEach((model) => {
      const name = model.name;
      const content = serialize(model, StructType.ModelStruct);
      const base64 = bytesToBase64(content);
      const hash = hashify(base64);
      const localIndex = `?hdml-model=${name}`;
      const serverPath = `hdml-model=${name}@${hash}.html`;
      this.names.set(localIndex, serverPath);
      modelsHdom.models.push(model);
    });
    console.log("ModelsFiles", fileifize(modelsHdom));

    const framesHdom: HDOM = {
      includes: [],
      connections: [],
      models: [],
      frames: [],
    };
    hdom.frames.forEach((frame) => {
      const name = frame.name;
      if (frame.source.indexOf("/") === 0) {
        frame.source = this.#sourceToPath(frame.source);
        const content = serialize(frame, StructType.FrameStruct);
        const base64 = bytesToBase64(content);
        const hash = hashify(base64);
        const localIndex = `?hdml-frame=${name}`;
        const serverPath = `hdml-frame=${name}@${hash}.html`;
        this.names.set(localIndex, serverPath);
        framesHdom.frames.push(frame);
      } else if (frame.source.indexOf("?") === 0) {
        frame.source = this.names.get(frame.source)!;
        const content = serialize(frame, StructType.FrameStruct);
        const base64 = bytesToBase64(content);
        const hash = hashify(base64);
        const localIndex = `?hdml-frame=${name}`;
        const serverPath = `hdml-frame=${name}@${hash}.html`;
        this.names.set(localIndex, serverPath);
        framesHdom.frames.push(frame);
      }
      console.log("frame", frame);
    });
    console.log("FramesFiles", fileifize(framesHdom));

    // hdom.frames.forEach((f) => {
    //   if (f.source.indexOf("?hdml-model") === 0) {
    //     if (this.names.has(f.source)) {
    //       f.source = this.names.get(f.source)!;
    //       h = hashify(JSON.stringify(f));
    //       s = `/${h}.html?hdml-frame=${f.name}`;
    //       this.names.set(`?hdml-frame=${f.name}`, s);
    //       this.frames.set(s, f);
    //     }
    //   }
    // });

    // this.#sortFrames(hdom.frames).forEach((f) => {
    //   if (f.source.indexOf("?hdml-frame") === 0) {
    //     if (this.names.has(f.source)) {
    //       f.source = this.names.get(f.source)!;
    //       h = hashify(JSON.stringify(f));
    //       s = `/${h}.html?hdml-frame=${f.name}`;
    //       this.names.set(`?hdml-frame=${f.name}`, s);
    //       this.frames.set(s, f);
    //     }
    //   }
    // });

    // hdom.frames.forEach((f) => {
    //   if (f.source.indexOf("/") === 0) {
    //     h = hashify(JSON.stringify(f));
    //     s = `/${h}.html?hdml-frame=${f.name}`;
    //     this.names.set(`?hdml-frame=${f.name}`, s);
    //     this.frames.set(s, f);
    //   }
    // });
  }
}
