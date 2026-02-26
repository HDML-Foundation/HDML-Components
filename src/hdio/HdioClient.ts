/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import "whatwg-fetch";
import { uid } from "@hdml/hash";

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
   * Posts the files to the server.
   */
  public async postFiles(state: {
    data: Uint8Array;
    files: Map<string, string>;
    mapping: Map<string, string>;
  }): Promise<void> {
    if (!this.#initialized) {
      await this.#initialization!;
    }
    const id = `requested-${uid()}`;
    Array.from(state.files.keys()).forEach((key) => {
      if (state.files.get(key) === "parsed") {
        state.files.set(key, id);
      }
    });
    const abort = new AbortController();
    console.log(state);
    await this.fetch({
      method: "POST",
      api: "hdio",
      path: "/files",
      signal: abort.signal,
      body: state.data.slice().buffer,
    });
  }

  /**
   * Internal implementation of fetching remote resource.
   */
  private async fetch(config: {
    method: "GET" | "POST" | "PUT" | "DELETE";
    api: "sessions" | "hdio";
    path?: string;
    params?: Record<string, string>;
    signal?: AbortSignal;
    body?: ArrayBuffer;
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
