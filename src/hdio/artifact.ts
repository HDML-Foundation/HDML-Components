/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import type { RegistryEntry } from "./parse";

/**
 * The doc-element kinds that get their own
 * `hdml-{kind}={name}@{source}.hdml` artifact: `model` and `frame`
 * only. A connection is not queryable — it has no such artifact and
 * the server's `parseArtifactKind` rejects it — so the source-ref
 * grammar admits these two kinds alone (RFC 014/001 §2.9, C2).
 */
type ArtifactKind = "model" | "frame";

/**
 * Rejects an element name the server would reject, so a bad name
 * fails **locally** instead of at query time. Mirrors the Go
 * `validateElementName` (empty / `/` / `\` / `..`) at
 * [artifact_naming.go:43-50] (RFC §4.4, C4).
 *
 * @param name - The `{name}` from an `hdml-{kind}={name}` ref.
 * @throws If the name is empty or contains `/`, `\`, or `..`.
 */
export function validateElementName(name: string): void {
  if (
    name === "" ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("..")
  ) {
    throw new Error(`invalid element name "${name}"`);
  }
}

/**
 * Maps a doc-element type token to its {@link ArtifactKind},
 * rejecting anything else. Mirrors the Go `parseArtifactKind`; a
 * connection token throws here (RFC §2.9, C2).
 *
 * @param typ - The token between `hdml-` and `=`.
 * @returns The narrowed kind.
 * @throws If the token is neither `model` nor `frame`.
 */
function parseArtifactKind(typ: string): ArtifactKind {
  if (typ === "model" || typ === "frame") {
    return typ;
  }
  throw new Error(`unknown artifact kind "${typ}"`);
}

/**
 * Parses the `hdml-{kind}={name}` query fragment of a source ref
 * into its kind and name, dropping any `&column={col}` selector tail
 * (the FE-only per-subscriber column, not part of the target).
 * Mirrors the Go `parseHDMLQuery` (RFC §4.3).
 *
 * @param query - The part of the ref after `?`.
 * @returns The referenced element's kind and name.
 * @throws If the fragment is malformed or names a bad kind/name.
 */
function parseHdmlQuery(query: string): {
  kind: ArtifactKind;
  name: string;
} {
  const amp = query.indexOf("&");
  const q = amp === -1 ? query : query.slice(0, amp);
  const eq = q.indexOf("=");
  if (eq === -1) {
    throw new Error(`invalid hdml query "${query}"`);
  }
  const key = q.slice(0, eq);
  const name = q.slice(eq + 1);
  if (!key.startsWith("hdml-")) {
    throw new Error(`invalid hdml query "${query}": no hdml- prefix`);
  }
  const kind = parseArtifactKind(key.slice("hdml-".length));
  validateElementName(name);
  return { kind, name };
}

/**
 * Splits an HTML path (leading `/` already stripped) into its
 * directory and basename-minus-last-extension, mirroring the Go
 * `deriveSource`: `filepath.Ext` strips only the **final**
 * extension, so `a.b.html` → source `a.b`, and `maang` (no dot) →
 * `maang` (RFC §4.4, C4).
 *
 * @param rel - The path part of the ref, without a leading `/`.
 * @returns `dir` (`.` when top-level) and the `source` basename.
 */
function deriveSource(rel: string): {
  dir: string;
  source: string;
} {
  const slash = rel.lastIndexOf("/");
  const dir = slash === -1 ? "." : rel.slice(0, slash);
  const base = slash === -1 ? rel : rel.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  const source = dot === -1 ? base : base.slice(0, dot);
  return { dir, source };
}

/**
 * The precomputable static-ref transform (C3): converts an HTML-form
 * source ref to the artifact-form `doc_path` the server's `walkChain`
 * expects, with **zero** content and **zero** server round-trip — a
 * static `@{source}` is the source-doc basename, not a content hash.
 * Mirrors the Go `parseHTMLSourceRef` + `deriveSource` +
 * `docArtifactPath` (RFC §4.3):
 *
 * ```
 * HTML-form:     /{dir}/{file}.html?hdml-{kind}={name}[&column=…]
 * artifact-form: /{dir}/hdml-{kind}={name}@{file}.hdml
 * ```
 *
 * The result is **always** `/`-prefixed (the `/` marks a static
 * target); the directory segment is omitted for a top-level source
 * (`dir === "."`).
 *
 * @param ref - A `/`-prefixed HTML-form source ref.
 * @returns The `/`-prefixed artifact-form `doc_path`.
 * @throws If the ref has no `?` query or a bad kind/name.
 */
export function staticRefToDocPath(ref: string): string {
  const q = ref.indexOf("?");
  if (q === -1) {
    throw new Error(`invalid source ref "${ref}": no query`);
  }
  const htmlPath = ref.slice(0, q);
  const { kind, name } = parseHdmlQuery(ref.slice(q + 1));
  const rel = htmlPath.replace(/^\//, "");
  const { dir, source } = deriveSource(rel);
  const file = `hdml-${kind}=${name}@${source}.hdml`;
  if (dir === "" || dir === ".") {
    return `/${file}`;
  }
  return `/${dir}/${file}`;
}

/**
 * The one query-target resolver (C2) — turns a source ref into the
 * `{docPath, stored}` a query submits against, with two branches
 * classified on the first character (RFC §2.9, §4.2):
 *
 * - **local (`?`)** — strips any `&column=` tail, looks the
 *   `hdml-{kind}={name}` key up in the unified query-target registry
 *   ({@link RegistryEntry}), and returns `dynamic:{entry.key}` with
 *   the entry's `stored` flag (the post→confirm→query gate). An
 *   **unknown** ref throws — the query leg reads the throw as
 *   *not-ready-yet* inside the D4 window (Step 07), so the resolver
 *   itself stays a pure function that errors on an unknown ref.
 * - **static (`/`)** — the pure {@link staticRefToDocPath}
 *   transform: already server-side, so no map, no gate,
 *   `stored: true`.
 *
 * Both kinds (`frame`/`model`) resolve uniformly; whether a
 * bare-model query is meaningful is the server's `walkChain`
 * concern, so a model is never rejected (C2). The `&column=` tail is
 * the per-subscriber selector consumed by Step 07 — it is not part
 * of the `doc_path`.
 *
 * @param ref - A local (`?…`) or static (`/…`) source ref.
 * @param registry - The worker-side query-target map (C6).
 * @returns The query `doc_path` and whether it is confirmed stored.
 * @throws On an unknown local ref, or a malformed static ref.
 */
export function resolveQueryTarget(
  ref: string,
  registry: Map<string, RegistryEntry>,
): { docPath: string; stored: boolean } {
  if (ref.startsWith("/")) {
    return { docPath: staticRefToDocPath(ref), stored: true };
  }
  const body = ref.startsWith("?") ? ref.slice(1) : ref;
  const amp = body.indexOf("&");
  const key = amp === -1 ? body : body.slice(0, amp);
  const entry = registry.get(key);
  if (!entry) {
    throw new Error(`unknown local query ref "${ref}"`);
  }
  return { docPath: `dynamic:${entry.key}`, stored: entry.stored };
}
