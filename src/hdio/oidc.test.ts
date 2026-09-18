/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import { nextAuthAction, stripAuthParams } from "./oidc";

// A fixed page URL + server base shared by every case; each test
// varies only `search` / `mode` / `token` (the decision inputs).
const base = {
  href: "http://app.example/dash",
  host: "http://h",
  tenant: "t",
};

const enc = encodeURIComponent;

suite("nextAuthAction (pure state machine)", () => {
  test("handoff alone → redeem from the URL", () => {
    const action = nextAuthAction({
      ...base,
      search: "?handoff=abc",
      mode: null,
      token: null,
    });
    assert.deepEqual(action, {
      kind: "redeem",
      code: "abc",
      fromUrl: true,
    });
  });

  test("handoff beats oidc mode → redeem, not a loop", () => {
    // `mode` is still "oidc" on the way back from the callback; a
    // navigate here is the infinite redirect.
    const action = nextAuthAction({
      ...base,
      search: "?handoff=abc",
      mode: "oidc",
      token: null,
    });
    assert.deepEqual(action, {
      kind: "redeem",
      code: "abc",
      fromUrl: true,
    });
  });

  test("handoff beats a token attribute → the URL wins", () => {
    const action = nextAuthAction({
      ...base,
      search: "?handoff=abc",
      mode: null,
      token: "xyz",
    });
    assert.deepEqual(action, {
      kind: "redeem",
      code: "abc",
      fromUrl: true,
    });
  });

  test("handoff beats a stray error → redeem", () => {
    const action = nextAuthAction({
      ...base,
      search: "?handoff=abc&error=access_denied",
      mode: null,
      token: null,
    });
    assert.deepEqual(action, {
      kind: "redeem",
      code: "abc",
      fromUrl: true,
    });
  });

  test("an empty handoff is not a credential → inert", () => {
    const action = nextAuthAction({
      ...base,
      search: "?handoff=",
      mode: null,
      token: null,
    });
    assert.deepEqual(action, { kind: "inert" });
  });

  test("error alone → auth-error", () => {
    const action = nextAuthAction({
      ...base,
      search: "?error=access_denied",
      mode: null,
      token: null,
    });
    assert.deepEqual(action, {
      kind: "auth-error",
      error: "access_denied",
    });
  });

  test("login_required is terminal → auth-error, no retry", () => {
    // The server owns the prompt=none retry; a page that sees one of
    // the interaction-required codes must not navigate again.
    const action = nextAuthAction({
      ...base,
      search: "?error=login_required",
      mode: "oidc",
      token: null,
    });
    assert.deepEqual(action, {
      kind: "auth-error",
      error: "login_required",
    });
  });

  test("token alone → redeem, not from the URL", () => {
    const action = nextAuthAction({
      ...base,
      search: "",
      mode: null,
      token: "xyz",
    });
    assert.deepEqual(action, {
      kind: "redeem",
      code: "xyz",
      fromUrl: false,
    });
  });

  test("oidc mode alone → navigate with origin+return_to", () => {
    const action = nextAuthAction({
      ...base,
      search: "",
      mode: "oidc",
      token: null,
    });
    assert.deepEqual(action, {
      kind: "navigate",
      url:
        "http://h/t/api/v1/auth/login?origin=" +
        enc("http://app.example") +
        "&return_to=" +
        enc("/dash"),
    });
  });

  test("a deep link's query rides return_to", () => {
    const action = nextAuthAction({
      ...base,
      href: "http://app.example/reports?id=42",
      search: "?id=42",
      mode: "oidc",
      token: null,
    });
    assert.equal(action.kind, "navigate");
    const url = (action as { url: string }).url;
    assert.equal(
      new URL(url).searchParams.get("return_to"),
      "/reports?id=42",
    );
  });

  test("nothing → inert", () => {
    const action = nextAuthAction({
      ...base,
      search: "",
      mode: null,
      token: null,
    });
    assert.deepEqual(action, { kind: "inert" });
  });

  test("code+state has no branch → inert, or navigate", () => {
    const search = "?code=c&state=s";
    assert.deepEqual(
      nextAuthAction({ ...base, search, mode: null, token: null }),
      { kind: "inert" },
    );
    assert.deepEqual(
      nextAuthAction({ ...base, search, mode: "oidc", token: null }),
      {
        kind: "navigate",
        url:
          "http://h/t/api/v1/auth/login?origin=" +
          enc("http://app.example") +
          "&return_to=" +
          enc("/dash"),
      },
    );
  });
});

suite("stripAuthParams (pure)", () => {
  test("a page param survives the handoff strip", () => {
    assert.equal(
      stripAuthParams("http://a/p?id=42&handoff=abc"),
      "http://a/p?id=42",
    );
  });

  test("the last param leaves no bare ?", () => {
    assert.equal(
      stripAuthParams("http://a/p?handoff=abc"),
      "http://a/p",
    );
  });

  test("the page params keep their order", () => {
    assert.equal(
      stripAuthParams("http://a/p?id=42&handoff=abc&tab=x"),
      "http://a/p?id=42&tab=x",
    );
  });

  test("no auth param → the input, identical", () => {
    const href = "http://a/p?id=42#sec";
    assert.strictEqual(stripAuthParams(href), href);
  });

  test("the fragment survives", () => {
    assert.equal(
      stripAuthParams("http://a/p?handoff=abc#sec"),
      "http://a/p#sec",
    );
  });

  test("error and error_description are both stripped", () => {
    assert.equal(
      stripAuthParams(
        "http://a/p?error=access_denied&error_description=x&id=1",
      ),
      "http://a/p?id=1",
    );
  });

  test("re-serialization normalizes %20 to + (accepted)", () => {
    // Documents RFC 018/002 §7.6's accepted normalization; it does
    // not assert a byte-identical result.
    assert.equal(
      stripAuthParams("http://a/p?id=a%20b&handoff=c"),
      "http://a/p?id=a+b",
    );
  });
});
