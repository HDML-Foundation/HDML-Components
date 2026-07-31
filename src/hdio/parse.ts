/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { bytesToBase64, hashify } from "@hdml/hash";
import { parseHDML, sortFrames } from "@hdml/parser";
import { serialize, fileifize, StructType } from "@hdml/buffer";
import type { DocumentFileBlobs } from "@hdml/buffer";

/**
 * A cross-call registry entry: the canonical key an authored local
 * ref currently resolves to, and whether the server has confirmed the
 * element present (queryable) via a POST 201. This is the value type
 * of the unified **query-target map** (RFC 014/001 §2.8, C6) that
 * `resolveQueryTarget` (see `./artifact`) reads to bridge a local
 * `?hdml-{kind}={name}` ref to its `dynamic:{key}` query `doc_path`,
 * gated on `stored`.
 */
export interface RegistryEntry {
  key: string;
  stored: boolean;
}

/**
 * The `hdio` worker's cross-call state: the last packed
 * `DocumentFilesStruct` bytes plus the ref→key→stored registry (keyed
 * by the local ref `hdml-{type}={name}`). The registry is the
 * substrate for the post→confirm→query handshake; only the old dedup
 * gate was dropped (RFC 004 Slice E §8.6, E-L). It doubles as the
 * unified query-target map `resolveQueryTarget` reads (RFC 014/001
 * §2.8, C6 — see `./artifact`).
 */
export interface HdioState {
  data: Uint8Array;
  registry: Map<string, RegistryEntry>;
}

/**
 * A parse result: the updated {@link HdioState} plus the pre-pack
 * `{ name, content }` blobs. The worker only reads `data`; the blobs
 * are exposed for inspection/tests.
 */
export interface ParseResult extends HdioState {
  blobs: DocumentFileBlobs;
}

/**
 * The registry ref key for an element: `hdml-{type}={name}` (no
 * leading `?`). An authored local sibling `source` is the same string
 * with a `?` prefix.
 *
 * @param type - The element type (`connection`/`model`/`frame`).
 * @param name - The element's authored name.
 * @returns The registry ref key.
 */
function refKey(type: string, name: string): string {
  return `hdml-${type}=${name}`;
}

/**
 * Records an element's canonical key against its local ref. A new
 * ref, or a ref whose key changed (the element's content changed),
 * (re)sets `stored` to `false` — cleared until the next 201; an
 * unchanged key keeps its flag (RFC 004 Slice E E-L).
 *
 * @param registry - The ref→key→stored registry to update.
 * @param ref - The local ref key (`hdml-{type}={name}`).
 * @param key - The freshly computed canonical key.
 */
function recordRef(
  registry: Map<string, RegistryEntry>,
  ref: string,
  key: string,
): void {
  const existing = registry.get(ref);
  if (existing && existing.key === key) {
    return;
  }
  registry.set(ref, { key, stored: false });
}

/**
 * Parses an HDML document and packs the whole `DocumentFilesStruct`
 * to POST, naming every element bottom-up as a Merkle tree.
 *
 * Order (E-I): models first (roots, no `source`), then frames in
 * `sortFrames` order (dependencies before dependents, to arbitrary
 * depth). Per frame the authored `source` is rewritten first — a
 * local `?hdml-{type}={name}` sibling ref becomes that sibling's
 * canonical `hdml-{type}={name}@{hash}.hdml` key; a `/`-prefixed
 * static ref is left verbatim (E-J / §8.5). The element is then
 * serialized exactly once, hashed, and keyed. Connections carry no
 * `source` and no hash: `FileStruct.name` is `{conn}.hdml`, where
 * `{conn}` already carries the `{tenant}_` prefix by convention — the
 * FE only appends `.hdml` (E-A). The full document is (re)packed and
 * posted every call (§8.6); the registry records each ref→key.
 *
 * @param state - The cross-call {@link HdioState} to update.
 * @param html - The HDML document markup.
 * @returns The updated state plus the pre-pack blobs.
 */
export function parse(state: HdioState, html: string): ParseResult {
  const hdom = parseHDML(html);
  const frames = sortFrames(hdom.frames);
  const blobs: DocumentFileBlobs = {
    connections: [],
    models: [],
    frames: [],
  };

  hdom.connections.forEach((connection) => {
    const content = serialize(
      connection,
      StructType.ConnectionStruct,
    );
    const key = `${connection.name}.hdml`;
    recordRef(
      state.registry,
      refKey("connection", connection.name),
      key,
    );
    blobs.connections.push({ name: key, content });
  });

  hdom.models.forEach((model) => {
    const content = serialize(model, StructType.ModelStruct);
    const hash = hashify(bytesToBase64(content));
    const key = `hdml-model=${model.name}@${hash}.hdml`;
    recordRef(state.registry, refKey("model", model.name), key);
    blobs.models.push({ name: key, content });
  });

  frames.forEach((frame) => {
    if (frame.source.indexOf("?") === 0) {
      const entry = state.registry.get(frame.source.slice(1));
      if (entry) {
        frame.source = entry.key;
      } else {
        console.error(`Unknown local source: ${frame.source}`);
      }
    }
    const content = serialize(frame, StructType.FrameStruct);
    const hash = hashify(bytesToBase64(content));
    const key = `hdml-frame=${frame.name}@${hash}.hdml`;
    recordRef(state.registry, refKey("frame", frame.name), key);
    blobs.frames.push({ name: key, content });
  });

  state.data = fileifize(blobs);
  return { data: state.data, registry: state.registry, blobs };
}
