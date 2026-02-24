/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import "whatwg-fetch";

/**
 * The `HdioClient` class.
 */
export class HdioClient {
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
      this.initialize().catch(console.error);
    }
  }

  /**
   * Closes the client, canceling all active requests and downloads.
   */
  public close(): void {
    this.#session = null;
    this.#initialized = false;
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
      this.#initialized = true;
      this.#session = await response.text();
    } catch (error) {
      console.error(error);
    }
  }

  /**
   * Internal implementation of fetching remote resource.
   */
  private async fetch(config: {
    method: "GET" | "POST" | "PUT" | "DELETE";
    api: "sessions";
    path?: string;
    params?: Record<string, string>;
    signal?: AbortSignal;
    body?: Buffer;
  }): Promise<Response> {
    const { method, api, path, params, signal } = config;
    const query = params
      ? `?${new URLSearchParams(params).toString()}`
      : "";
    const url =
      `${this.#host}/public/api/v1/${this.#tenant}` +
      `/${api}${path ? path : ""}${query}`;
    const response = await fetch(url, {
      method,
      mode: "cors",
      redirect: "follow",
      cache: "no-cache",
      headers: {
        Session: this.#session || "",
        "content-type": "application/octet-stream",
      },
      signal,
      // body: body || null,
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
