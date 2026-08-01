/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import "whatwg-fetch";

/**
 * The token pair the OIDC callback exchange returns (server
 * `domain.TokenResponse`). Only the two tokens are read; the
 * expiry/type are informational.
 */
interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
}

/**
 * The outcome of the main-thread OIDC code→token exchange (§3.3):
 * `ok` carries the pair to hand to the worker, `stale` means the
 * single-use `state` was already spent (re-navigate to the IdP), and
 * `error` is any other failure (surfaced once).
 */
export type ExchangeResult =
  | { status: "ok"; access: null | string; refresh: null | string }
  | { status: "stale" }
  | { status: "error"; detail: string };

/**
 * Exchanges the OIDC `?code&state` for the {access, refresh} pair on
 * the **main thread** (§3.3): `GET {host}/{tenant}/api/v1/auth/
 * callback?code&state`. It runs main-side — **not** in the worker —
 * so the request carries the document's real origin and passes the
 * HDIO server's CORS allow-list: a worker inlined from a `blob:` URL
 * (the IIFE build) issues fetches with `Origin: null`, which a
 * cross-origin server rejects, so a worker-side exchange never
 * completes. A **401** means the single-use `state` was spent (a
 * stale-`?code` reload) → `stale`; any other non-2xx → `error`; a
 * network failure is caught as `error` too.
 *
 * @param host - The `host` attribute (server base, no slash).
 * @param tenant - The `tenant` attribute.
 * @param code - The `code` query param the IdP returned.
 * @param state - The single-use `state` query param.
 * @returns The exchange outcome the effect layer applies.
 */
export async function exchangeCode(
  host: string,
  tenant: string,
  code: string,
  state: string,
): Promise<ExchangeResult> {
  const query =
    `?code=${encodeURIComponent(code)}` +
    `&state=${encodeURIComponent(state)}`;
  const url = `${host}/${tenant}/api/v1/auth/callback` + query;
  try {
    const response = await fetch(url, {
      method: "GET",
      mode: "cors",
      redirect: "follow",
      cache: "no-cache",
    });
    if (response.status === 401) {
      return { status: "stale" };
    }
    if (!response.ok) {
      return {
        status: "error",
        detail: response.statusText || `HTTP ${response.status}`,
      };
    }
    const body = (await response.json()) as TokenResponse;
    return {
      status: "ok",
      access: body.access_token ?? null,
      refresh: body.refresh_token ?? null,
    };
  } catch (error) {
    return { status: "error", detail: (error as Error).message };
  }
}
