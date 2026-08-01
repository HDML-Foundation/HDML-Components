/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The next auth step the main-thread state machine should take,
 * computed purely from the URL + attributes (RFC 014/001 §3.3, B5).
 * A thin effect layer in `HdmlIo` turns each into a side effect:
 * `exchange` runs the code→token exchange on the main thread (§3.3),
 * `redeem` lets the `props` path forward the handoff (token mode,
 * Step 02), `navigate` is a full-page redirect to `/auth/login`,
 * `auth-error` strips the IdP error off the URL and logs it (no
 * retry), `inert` does nothing.
 */
export type AuthAction =
  | { kind: "exchange"; code: string; state: string }
  | { kind: "redeem" }
  | { kind: "navigate"; url: string }
  | { kind: "auth-error"; error: string }
  | { kind: "inert" };

/**
 * The four OIDC-standard "interaction required" error codes an IdP
 * returns to a `prompt=none` silent-auth attempt it cannot satisfy
 * without UI (OIDC Core 1.0 §3.1.2.6). Each is recoverable by a
 * single interactive retry; every other `error` (e.g.
 * `access_denied`) is a genuine failure and is surfaced instead.
 */
const SILENT_AUTH_FAILURES = new Set([
  "login_required",
  "interaction_required",
  "consent_required",
  "account_selection_required",
]);

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
 * When `interactive` is set, `&interactive=1` is appended so the
 * server suppresses the tenant's configured `prompt` (e.g.
 * `prompt=none`): the fallback after a silent-auth failure, forcing
 * the IdP's interactive flow so it cannot loop (§3.3).
 *
 * @param host - The `host` attribute (server base, no slash).
 * @param tenant - The `tenant` attribute.
 * @param href - The app's current `location.href`.
 * @param interactive - Force interactive (suppress the prompt).
 * @returns The full `/auth/login?redirect_uri=…` URL to navigate to.
 */
export function loginUrl(
  host: string,
  tenant: string,
  href: string,
  interactive = false,
): string {
  const redirect = encodeURIComponent(originPathname(href));
  const url =
    `${host}/${tenant}/api/v1/auth/login` +
    `?redirect_uri=${redirect}`;
  return interactive ? `${url}&interactive=1` : url;
}

/**
 * Pure decision for the OIDC auto-trigger state machine (RFC §3.3
 * mermaid, B5). Ordered: a `?code&state` on the URL wins (exchange
 * the code); else an `?error` from the IdP is handled (a silent-auth
 * failure retries interactively, any other error surfaces); else a
 * `token` attribute wins over `mode` (redeem the handoff — token
 * mode, Step 02); else `mode === "oidc"` navigates to the IdP; else
 * inert. Reads no globals and performs no effect, so it is
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
}): AuthAction {
  const params = new URLSearchParams(i.search);
  const code = params.get("code");
  const state = params.get("state");
  if (code !== null && state !== null) {
    return { kind: "exchange", code, state };
  }
  // The IdP bounced back an error instead of a code. A `prompt=none`
  // silent attempt that needs interaction fails with one of the
  // OIDC-standard codes → retry once interactively (the retry omits
  // prompt via `interactive=1`, so it cannot loop). Any other error
  // (e.g. `access_denied`) is a real failure and is surfaced.
  const error = params.get("error");
  if (error !== null) {
    if (SILENT_AUTH_FAILURES.has(error)) {
      return {
        kind: "navigate",
        url: loginUrl(i.host, i.tenant, i.href, true),
      };
    }
    return { kind: "auth-error", error };
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
