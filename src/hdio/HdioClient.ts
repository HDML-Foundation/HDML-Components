/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import "whatwg-fetch";
import type { RegistryEntry } from "./parse";

/**
 * The `{ access_token, refresh_token, expires_in, token_type }`
 * payload returned by both the two-step handoff exchange and the
 * refresh route (server `domain.TokenResponse`). Only the two tokens
 * are held in memory; the expiry / type are informational.
 */
interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

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
 * Builds the stale-`state` marker thrown by
 * {@link HdioClient.exchangeOidcCode} on a callback 401 — the
 * single-use `state` was already spent (a stale-`?code` reload). The
 * worker maps it to `auth {ok:false, reason:"stale"}` so the
 * main-thread state machine re-navigates instead of surfacing a hard
 * error (RFC §3.3, B5).
 *
 * @param response - The 401 callback response.
 * @returns An `Error` flagged `stale`.
 */
function staleError(response: Response): Error {
  const error = new Error(
    response.statusText || `HTTP ${response.status}`,
  );
  (error as { stale?: boolean }).stale = true;
  return error;
}

/**
 * Whether an error is the stale-`state` marker from
 * {@link HdioClient.exchangeOidcCode} (RFC §3.3).
 *
 * @param error - Any caught error.
 * @returns `true` for the stale marker.
 */
export function isStaleAuthError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { stale?: unknown }).stale === true
  );
}

/**
 * The `HdioClient` — the sole HTTP surface to the HDIO server
 * (RFC 014/001 §2.7). It holds the access + refresh tokens **in
 * memory only** (B4, §3.4 — no persistence; re-auth on reload), owns
 * the two-step handoff redemption and silent refresh (B2, §3.2), and
 * posts the dynamic document with a real `Bearer`. Every request is
 * sent to `` `${host}${path}` `` — one base, the `host` attribute.
 * There is **no** `session` bootstrap: the dead `sessions` leg (which
 * left every POST shipping `Bearer null`) is gone (§1.1a).
 */
export class HdioClient {
  #host: string;
  #tenant: string;
  #access: null | string = null;
  #refresh: null | string = null;

  // In-flight redeem / refresh. A document POST that races the auth
  // round-trip (`props` kicks the redeem; an `html` may arrive before
  // it resolves) awaits this. Cleared to `null` once settled so a
  // later POST does not suspend on an already-resolved promise.
  #pending: null | Promise<void> = null;

  // One instance-held controller threaded onto every request and
  // aborted by `close()` (B, §3.5 — the old `close()` aborted a
  // discarded local that reached no `fetch`).
  #controller: AbortController = new AbortController();

  /**
   * @param host - Base URL of the HDIO server (no trailing slash).
   * @param tenant - Tenant identifier (URL path segment).
   */
  public constructor(host = "", tenant = "") {
    this.#host = host;
    this.#tenant = tenant;
  }

  /**
   * Whether a live access token is held.
   */
  public get authed(): boolean {
    return this.#access !== null;
  }

  /**
   * Redeems a single-use handoff code for the {access, refresh} pair
   * (issuance step 2, §3.2): `POST /{tenant}/api/v1/auth/token` with
   * `{ token: code }`. A miss / expiry / reuse is a 401 that
   * **rejects** — the old `initialize()` swallowed it and proceeded
   * with a null session.
   *
   * @param code - The handoff code from the host app's step 1.
   */
  public redeemHandoff(code: string): Promise<void> {
    return this.#authenticate(`/${this.#tenant}/api/v1/auth/token`, {
      token: code,
    });
  }

  /**
   * Silently rotates the token pair on a 401 / expiry:
   * `POST /{tenant}/api/v1/auth/token/refresh` with the held refresh
   * token. Rejects if no refresh token is held.
   */
  public refresh(): Promise<void> {
    const token = this.#refresh;
    if (token === null) {
      return Promise.reject(new Error("no refresh token"));
    }
    return this.#authenticate(
      `/${this.#tenant}/api/v1/auth/token/refresh`,
      { refresh_token: token },
    );
  }

  /**
   * Exchanges the OIDC `?code&state` for the {access, refresh} pair
   * (RFC §3.3): `GET /{tenant}/api/v1/auth/callback?code&state` →
   * `TokenResponse` JSON. The exchange runs **worker-side** so the
   * tokens never touch the main thread (B4). A **401** means the
   * single-use `state` was already spent (a stale-`?code` reload) and
   * rejects with a stale-marked error ({@link isStaleAuthError}) the
   * worker maps to `auth {ok:false, reason:"stale"}`; any other
   * non-2xx rejects normally.
   *
   * @param code - The `code` query param the IdP returned.
   * @param state - The single-use `state` query param.
   */
  public exchangeOidcCode(
    code: string,
    state: string,
  ): Promise<void> {
    const query =
      `?code=${encodeURIComponent(code)}` +
      `&state=${encodeURIComponent(state)}`;
    const path = `/${this.#tenant}/api/v1/auth/callback`;
    return this.#track(
      (async (): Promise<void> => {
        const response = await this.#send({
          method: "GET",
          path: path + query,
        });
        if (response.status === 401) {
          throw staleError(response);
        }
        if (!response.ok) {
          throw await this.#error(response);
        }
        this.#storeTokens((await response.json()) as TokenResponse);
      })(),
    );
  }

  /**
   * Posts the whole `DocumentFilesStruct` to the dynamic-doc save
   * route with a real `Bearer` and returns the parsed 201 body
   * (`{ stored[], ddl[] }`). On a 401 it refreshes once and retries;
   * a second 401 surfaces the error. The whole document is sent every
   * call (no dedup, §8.6); the server idempotent-skips present keys.
   * The caller folds the returned body via {@link recordStored}.
   *
   * @param data - The packed FlatBuffers document bytes.
   * @returns The parsed 201 JSON body.
   */
  public async postDocument(data: Uint8Array): Promise<unknown> {
    if (this.#pending) {
      await this.#pending;
    }
    if (this.#access === null) {
      throw new Error("not authenticated");
    }
    const path = `/${this.#tenant}/api/v1/documents/dynamic`;
    const bytes = data.slice().buffer;
    let response = await this.#send({
      method: "POST",
      path,
      bytes,
      auth: true,
    });
    if (response.status === 401) {
      await this.refresh();
      response = await this.#send({
        method: "POST",
        path,
        bytes,
        auth: true,
      });
    }
    if (!response.ok) {
      throw await this.#error(response);
    }
    return (await response.json()) as unknown;
  }

  /**
   * Aborts any in-flight request and clears both tokens (`authed`
   * becomes `false`). Terminal — the worker discards a closed client
   * and constructs a fresh one on the next `props` (B4).
   */
  public close(): void {
    this.#controller.abort();
    this.#access = null;
    this.#refresh = null;
    this.#pending = null;
  }

  /**
   * Runs a token-minting POST (redeem or refresh), stores the
   * returned pair, and tracks it as `#pending` (via {@link #track})
   * so a racing document POST can await it.
   */
  #authenticate(
    path: string,
    body: Record<string, string>,
  ): Promise<void> {
    return this.#track(
      (async (): Promise<void> => {
        const response = await this.#send({
          method: "POST",
          path,
          json: body,
        });
        if (!response.ok) {
          throw await this.#error(response);
        }
        this.#storeTokens((await response.json()) as TokenResponse);
      })(),
    );
  }

  /**
   * Tracks an in-flight auth task as `#pending` so a racing document
   * POST awaits it, clearing it once settled (the guarded `clear`
   * never clobbers a newer pending auth). Shared by `#authenticate`
   * (redeem / refresh) and {@link exchangeOidcCode}.
   */
  #track(task: Promise<void>): Promise<void> {
    this.#pending = task;
    const clear = (): void => {
      if (this.#pending === task) {
        this.#pending = null;
      }
    };
    void task.then(clear, clear);
    return task;
  }

  /**
   * Stores the `{access, refresh}` pair from a parsed
   * `TokenResponse` (redeem / refresh / OIDC exchange). Either may be
   * absent — a null token clears that slot.
   */
  #storeTokens(tokens: TokenResponse): void {
    this.#access = tokens.access_token ?? null;
    this.#refresh = tokens.refresh_token ?? null;
  }

  /**
   * Issues one request to `` `${host}${path}` `` (one base). Sets a
   * body content-type only when a body is present:
   * `application/json` for the auth POSTs,
   * `application/octet-stream` for the document POST — never on a
   * bodiless GET (B, §3.5). Attaches the `Bearer` only when `auth`
   * is requested and a token is held (never `Bearer null`). Returns
   * the raw `Response`; status handling is the caller's.
   */
  #send(config: {
    method: "GET" | "POST" | "DELETE";
    path: string;
    json?: Record<string, string>;
    bytes?: ArrayBuffer;
    auth?: boolean;
  }): Promise<Response> {
    const headers: Record<string, string> = {};
    if (config.auth && this.#access !== null) {
      headers.Authorization = "Bearer " + this.#access;
    }
    let body: undefined | string | ArrayBuffer;
    if (config.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(config.json);
    } else if (config.bytes !== undefined) {
      headers["content-type"] = "application/octet-stream";
      body = config.bytes;
    }
    return fetch(`${this.#host}${config.path}`, {
      method: config.method,
      mode: "cors",
      redirect: "follow",
      cache: "no-cache",
      headers,
      signal: this.#controller.signal,
      body,
    });
  }

  /**
   * Builds an `Error` from a non-2xx response **without** assuming a
   * JSON body: only a JSON content-type is parsed (server errors are
   * `{ error }`); anything else — a 502 HTML page, an empty 413 —
   * falls back to `statusText` or the status code (B, §3.5 — the old
   * path did an unconditional `response.json()` that masked those
   * statuses).
   */
  async #error(response: Response): Promise<Error> {
    const type = response.headers.get("content-type") ?? "";
    if (type.indexOf("application/json") >= 0) {
      try {
        const body = (await response.json()) as {
          error?: string;
          message?: string;
        };
        const msg = body.error ?? body.message;
        if (msg) {
          return new Error(msg);
        }
      } catch {
        // Malformed JSON body — fall back to the status line.
      }
    }
    return new Error(
      response.statusText || `HTTP ${response.status}`,
    );
  }
}
