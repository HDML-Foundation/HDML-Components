/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import "whatwg-fetch";
import type { HdioState, RegistryEntry } from "./parse";

/**
 * Extracts the confirmed canonical keys from a POST 201 body
 * (`{ stored: [{ key, type, stored }], ddl: [...] }`, RFC 004 Slice E
 * §7.2). Both `stored:true` (freshly written) and `stored:false`
 * (idempotent-skip, already present) mean present/queryable, so only
 * the `key` is read here. Narrows `unknown` defensively.
 *
 * @param body - The parsed 201 JSON body.
 * @returns The list of confirmed canonical keys.
 */
function readStoredKeys(body: unknown): string[] {
  const keys: string[] = [];
  if (typeof body !== "object" || body === null) {
    return keys;
  }
  const stored = (body as { stored?: unknown }).stored;
  if (!Array.isArray(stored)) {
    return keys;
  }
  for (const item of stored) {
    if (typeof item === "object" && item !== null) {
      const key = (item as { key?: unknown }).key;
      if (typeof key === "string") {
        keys.push(key);
      }
    }
  }
  return keys;
}

/**
 * Folds a POST 201 body into the ref→key→stored registry: every
 * registry entry whose `key` the server confirmed is marked
 * `stored: true` (present/queryable — RFC 004 Slice E E-L).
 *
 * @param registry - The ref→key→stored registry to update.
 * @param body - The parsed 201 JSON body.
 */
export function recordStored(
  registry: Map<string, RegistryEntry>,
  body: unknown,
): void {
  const confirmed = new Set(readStoredKeys(body));
  registry.forEach((entry) => {
    if (confirmed.has(entry.key)) {
      entry.stored = true;
    }
  });
}

/**
 * The `HdioClient` class.
 */
export class HdioClient {
  #initialization: null | Promise<void> = null;
  #initialized = false;
  #session: null | string = null;
  #host: null | string = null;
  #tenant: null | string = null;
  #token: null | string = null;

  /**
   * Class constructor.
   */
  public constructor(host = "", tenant = "", token = "") {
    if (
      host &&
      host.length &&
      tenant &&
      tenant.length &&
      token &&
      token.length
    ) {
      this.#host = host;
      this.#tenant = tenant;
      this.#token = token;
      this.#initialization = this.initialize();
      this.#initialization.catch(console.error);
    }
  }

  /**
   * Initializes a session.
   */
  private async initialize(): Promise<void> {
    try {
      const response = await this.fetch({
        method: "GET",
        api: "sessions",
        params: { tenant: this.#tenant!, token: this.#token! },
      });
      this.#session = await response.text();
      this.#initialized = true;
    } catch (error) {
      console.error(error);
    }
  }

  /**
   * Closes the client, canceling all active requests and downloads.
   */
  public close(): void {
    this.#session = null;
    this.#initialized = false;
    this.#initialization = null;
  }

  /**
   * Posts the full document to the dynamic-doc save route and folds
   * the 201 `stored[]` response into the registry.
   *
   * The whole `DocumentFilesStruct` is sent every call (no dedup —
   * §8.6); the server idempotent-skips already-present keys. The
   * request-id relabelling is gone: the correlation is now "which
   * keys the server confirmed stored" (E-L).
   */
  public async postFiles(state: HdioState): Promise<void> {
    if (!this.#initialized) {
      await this.#initialization!;
    }
    const abort = new AbortController();
    const response = await this.fetch({
      method: "POST",
      api: "documents",
      path: "/dynamic",
      signal: abort.signal,
      body: state.data.slice().buffer,
    });
    recordStored(state.registry, await response.json());
  }

  /**
   * Internal implementation of fetching remote resource.
   */
  private async fetch(config: {
    method: "GET" | "POST" | "PUT" | "DELETE";
    api: "sessions" | "documents";
    path?: string;
    params?: Record<string, string>;
    signal?: AbortSignal;
    body?: ArrayBuffer;
  }): Promise<Response> {
    const { method, api, path, params, signal } = config;
    const query = params
      ? `?${new URLSearchParams(params).toString()}`
      : "";
    // E-B: the dynamic-doc save route is `/{tenant}/api/v1/...`
    // on the live router (handlers.go:115/122). The session
    // bootstrap leg is auth's concern (project 006), left on its
    // legacy prefix here.
    // TODO(confirm: reconcile the `sessions` leg's base path — the
    // current router exposes no `sessions` route.)
    const base =
      api === "documents"
        ? `${this.#host}/${this.#tenant}/api/v1`
        : `${this.#host}/public/api/v1/${this.#tenant}`;
    const url = `${base}/${api}${path ? path : ""}${query}`;
    const response = await fetch(url, {
      method,
      mode: "cors",
      redirect: "follow",
      cache: "no-cache",
      headers: {
        Authorization: `Bearer ${this.#session}` || "",
        "content-type": "application/octet-stream",
      },
      signal,
      body: config.body,
    });
    if (!response.ok) {
      const message = <{ statusCode?: number; message?: string }>(
        await response.json()
      );
      throw new Error(message.message || response.statusText);
    } else {
      return response;
    }
  }
}
