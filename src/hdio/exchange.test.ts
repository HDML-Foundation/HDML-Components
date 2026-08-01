/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import { exchangeCode } from "./exchange";

// Drives the real `fetch` against the wtr mock HDIO (`.testrc.js`):
// `host` is "" (same-origin, so the request lands on the dev server),
// and the `tenant` picks the scenario — `stale-state` → 401, anything
// else → 200 with the `{access, refresh}` pair.
suite("exchangeCode (main-thread OIDC exchange)", () => {
  test("a 200 returns the token pair", async () => {
    const r = await exchangeCode("", "oidc-ok", "c", "s");
    assert.deepEqual(r, {
      status: "ok",
      access: "access-oidc-ok",
      refresh: "refresh-oidc-ok",
    });
  });

  test("a 401 is a stale state (re-navigate)", async () => {
    const r = await exchangeCode("", "stale-state", "c", "s");
    assert.deepEqual(r, { status: "stale" });
  });

  test("a network failure is caught as an error", async () => {
    // Port 0 never connects → fetch rejects → caught as `error`.
    const r = await exchangeCode(
      "http://localhost:0",
      "oidc-ok",
      "c",
      "s",
    );
    assert.equal(r.status, "error");
  });
});
