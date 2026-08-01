/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import { nextAuthAction } from "./oidc";

// A fixed page URL + server base shared by every case; each test
// varies only `search` / `mode` / `token` (the decision inputs).
const base = {
  href: "http://app.example/dash",
  host: "http://h",
  tenant: "t",
};

suite("nextAuthAction (pure state machine)", () => {
  test("code+state on the URL → exchange", () => {
    const action = nextAuthAction({
      ...base,
      search: "?code=c&state=s",
      mode: null,
      token: null,
    });
    assert.deepEqual(action, {
      kind: "exchange",
      code: "c",
      state: "s",
    });
  });

  test("a token wins over oidc mode → redeem", () => {
    const action = nextAuthAction({
      ...base,
      search: "",
      mode: "oidc",
      token: "h",
    });
    assert.deepEqual(action, { kind: "redeem" });
  });

  test("oidc mode, no token, no code → navigate", () => {
    const action = nextAuthAction({
      ...base,
      search: "",
      mode: "oidc",
      token: null,
    });
    const enc = encodeURIComponent("http://app.example/dash");
    assert.deepEqual(action, {
      kind: "navigate",
      url: "http://h/t/api/v1/auth/login?redirect_uri=" + enc,
    });
  });

  test("no code, no token, no oidc mode → inert", () => {
    const action = nextAuthAction({
      ...base,
      search: "",
      mode: null,
      token: null,
    });
    assert.deepEqual(action, { kind: "inert" });
  });

  test("silent-auth failure error → navigate interactive", () => {
    const action = nextAuthAction({
      ...base,
      search: "?error=login_required&state=s",
      mode: "oidc",
      token: null,
    });
    const enc = encodeURIComponent("http://app.example/dash");
    assert.deepEqual(action, {
      kind: "navigate",
      url:
        "http://h/t/api/v1/auth/login?redirect_uri=" +
        enc +
        "&interactive=1",
    });
  });

  test("every interaction-required code retries", () => {
    const codes = [
      "login_required",
      "interaction_required",
      "consent_required",
      "account_selection_required",
    ];
    for (const error of codes) {
      const action = nextAuthAction({
        ...base,
        search: `?error=${error}`,
        mode: "oidc",
        token: null,
      });
      assert.equal(action.kind, "navigate", error);
    }
  });

  test("a non-silent error surfaces (no retry)", () => {
    const action = nextAuthAction({
      ...base,
      search: "?error=access_denied&state=s",
      mode: "oidc",
      token: null,
    });
    assert.deepEqual(action, {
      kind: "auth-error",
      error: "access_denied",
    });
  });

  test("code wins over a stray error param → exchange", () => {
    const action = nextAuthAction({
      ...base,
      search: "?code=c&state=s&error=login_required",
      mode: "oidc",
      token: null,
    });
    assert.deepEqual(action, {
      kind: "exchange",
      code: "c",
      state: "s",
    });
  });
});
