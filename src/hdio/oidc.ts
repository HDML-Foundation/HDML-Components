/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The next auth step the main-thread state machine should take,
 * computed purely from the URL + attributes (RFC 018/002 §7.2).
 * A thin effect layer in `HdmlIo` turns each into a side effect:
 * `redeem` forwards a handoff code to the worker — the single auth
 * leg, reached either from the `token` attribute (Path 1) or from
 * `?handoff` on the URL after the callback's 302 (Path 2, D4) —
 * `navigate` is a full-page redirect to `/auth/login`, `auth-error`
 * strips the forwarded IdP error off the URL and logs it (no retry),
 * `inert` does nothing.
 */
export type AuthAction =
  | { kind: "redeem"; code: string; fromUrl: boolean }
  | { kind: "navigate"; url: string }
  | { kind: "auth-error"; error: string }
  | { kind: "inert" };

/**
 * The query parameters this component owns on the embedding page's
 * URL, and the only ones `stripAuthParams` removes (RFC 018/002
 * §7.6). `handoff` is D4's carrier; `error` (+ its optional
 * description) is what the callback forwards on a terminal IdP
 * failure (§5.5).
 */
export const AUTH_PARAMS = [
  "handoff",
  "error",
  "error_description",
] as const;

/**
 * The page's URL with every {@link AUTH_PARAMS} entry removed and
 * **everything else preserved** — the page's own query params,
 * their order, and the fragment. Returns the input unchanged (by
 * value) when no auth param is present, so the caller can skip a
 * pointless `replaceState` (RFC 018/002 §7.6).
 *
 * @param href - A full URL (`location.href`).
 * @returns The URL without its auth params.
 */
export function stripAuthParams(href: string): string {
  const url = new URL(href);
  let hit = false;
  for (const key of AUTH_PARAMS) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      hit = true;
    }
  }
  if (!hit) {
    return href;
  }
  const query = url.searchParams.toString();
  return (
    url.origin + url.pathname + (query ? `?${query}` : "") + url.hash
  );
}

/**
 * The `host`-based `/auth/login` URL (RFC 018/002 §7.5). The login
 * target is `host` like every other call; the **origin** parameter is
 * the app's own `location.origin` — no path, no query — which the
 * server validates against the tenant's stored allowlist (D6) before
 * it enters the state blob. `return_to` carries the page's own
 * `pathname + search` so a deep link survives the round trip; it is
 * path-only by construction here and re-validated server-side (§6.3).
 *
 * `login_hint` is appended only when the page supplied one. It names
 * WHICH account this login is for, which an IdP holding several
 * signed-in sessions cannot otherwise work out — so it answers
 * `account_selection_required` and shows its account chooser, on
 * every reload, because tokens are held in memory only. A multi-user
 * app knows its own signed-in user and passes it per login; the
 * tenant's stored config carries a default for the single-account
 * case. It is a hint, never an access decision: the IdP still
 * authenticates and the server still verifies the `id_token`.
 *
 * @param host - The `host` attribute (server base, no slash).
 * @param tenant - The `tenant` attribute.
 * @param href - The app's current `location.href`.
 * @param loginHint - The `login-hint` attribute, or nullish for
 * none.
 * @returns The full `/auth/login?origin=…&return_to=…` URL.
 */
export function loginUrl(
  host: string,
  tenant: string,
  href: string,
  loginHint?: null | string,
): string {
  const url = new URL(href);
  const origin = encodeURIComponent(url.origin);
  const returnTo = encodeURIComponent(url.pathname + url.search);
  const hint = loginHint
    ? `&login_hint=${encodeURIComponent(loginHint)}`
    : "";
  return (
    `${host}/${tenant}/api/v1/auth/login` +
    `?origin=${origin}&return_to=${returnTo}${hint}`
  );
}

/**
 * Pure decision for the auth auto-trigger state machine (RFC 018/002
 * §7.2). Ordered: a non-empty `?handoff` on the URL wins, because a
 * live single-use credential has just arrived from the callback and
 * `mode` is still `"oidc"` on the way back, so it must beat the
 * navigate or the page loops (redeem, then strip); else an `?error`
 * the callback forwarded is terminal for this page load, since the
 * server already retried the interaction-required codes (strip and
 * log, no retry); else a `token` attribute, which may be older than
 * a URL credential but is still a concrete credential beating a flow
 * that would fetch one (redeem, no strip); else `mode === "oidc"`
 * navigates to `/auth/login`, the cold start; else inert, because
 * auth is opt-in. Reads no globals and performs no effect, so it is
 * unit-testable without navigating.
 *
 * @param i - The URL + attribute snapshot.
 * @returns The action the effect layer should apply.
 */
export function nextAuthAction(i: {
  href: string;
  search: string;
  host: string;
  tenant: string;
  mode: string | null;
  token: string | null;
  loginHint?: null | string;
}): AuthAction {
  const params = new URLSearchParams(i.search);
  // An empty `?handoff=` is not a credential and falls through.
  const handoff = params.get("handoff");
  if (handoff) {
    return { kind: "redeem", code: handoff, fromUrl: true };
  }
  const error = params.get("error");
  if (error !== null) {
    return { kind: "auth-error", error };
  }
  if (i.token) {
    return { kind: "redeem", code: i.token, fromUrl: false };
  }
  if (i.mode === "oidc") {
    return {
      kind: "navigate",
      url: loginUrl(i.host, i.tenant, i.href, i.loginHint),
    };
  }
  return { kind: "inert" };
}
