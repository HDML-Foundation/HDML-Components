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
});
