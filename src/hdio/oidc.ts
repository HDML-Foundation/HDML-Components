/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The next auth step the main-thread state machine should take,
 * computed purely from the URL + attributes (RFC 014/001 §3.3, B5).
 * A thin effect layer in `HdmlIo` turns each into a side effect:
 * `exchange` posts `oidc-callback` to the worker, `redeem` lets the
 * `props` path forward the handoff (token mode, Step 02), `navigate`
 * is a full-page redirect to `/auth/login`, `inert` does nothing.
 */
export type AuthAction =
  | { kind: "exchange"; code: string; state: string }
  | { kind: "redeem" }
  | { kind: "navigate"; url: string }
  | { kind: "inert" };

/**
 * The app's own page URL with any query/hash stripped —
 * `location.origin + location.pathname`. This is the `redirect_uri`
 * the IdP must land the browser on, and the target `replaceState`
 * uses to strip `?code&state` after a successful exchange (§3.3).
 *
 * @param href - A full URL (`location.href`).
 * @returns `origin + pathname`, no query, no hash.
 */
export function originPathname(href: string): string {
  const url = new URL(href);
  return url.origin + url.pathname;
}

/**
 * The `host`-based `/auth/login` URL (RFC §3.3): the login target is
 * `host` like every other call; only the `redirect_uri` **value** is
 * the app's own `origin + pathname` (URL-encoded, no query). That
 * exact URL must be pre-registered in the tenant's SSO config or the
 * server answers 403 `ErrRedirectURINotAllowed`.
 *
 * @param host - The `host` attribute (server base, no slash).
 * @param tenant - The `tenant` attribute.
 * @param href - The app's current `location.href`.
 * @returns The full `/auth/login?redirect_uri=…` URL to navigate to.
 */
export function loginUrl(
  host: string,
  tenant: string,
  href: string,
): string {
  const redirect = encodeURIComponent(originPathname(href));
  return (
    `${host}/${tenant}/api/v1/auth/login` +
    `?redirect_uri=${redirect}`
  );
}

/**
 * Pure decision for the OIDC auto-trigger state machine (RFC §3.3
 * mermaid, B5). Ordered: a `?code&state` on the URL wins (exchange
 * the code); else a `token` attribute wins over `mode` (redeem the
 * handoff — token mode, Step 02); else `mode === "oidc"` navigates to
 * the IdP; else inert. Reads no globals and performs no effect, so it
 * is unit-testable without navigating.
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
}): AuthAction {
  const params = new URLSearchParams(i.search);
  const code = params.get("code");
  const state = params.get("state");
  if (code !== null && state !== null) {
    return { kind: "exchange", code, state };
  }
  if (i.token) {
    return { kind: "redeem" };
  }
  if (i.mode === "oidc") {
    return {
      kind: "navigate",
      url: loginUrl(i.host, i.tenant, i.href),
    };
  }
  return { kind: "inert" };
}
