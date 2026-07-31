/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import {
  HdioClient,
  isStaleAuthError,
  recordStored,
} from "./HdioClient";

// The `parse.RegistryEntry` shape, inlined so this suite pulls no
// `@hdml/parser`: it never parses — it drives the real `fetch` path
// against the wtr mock HDIO server (`.testrc.js`), picking scenarios
// by the `tenant` arg. `host` is "" (same-origin), so requests land
// on the dev-server where the mock middleware answers them.
type Entry = { key: string; stored: boolean };

const bytes = (): Uint8Array => new Uint8Array([1, 2, 3, 4]);

suite("HdioClient (token mode, wtr mock HDIO)", () => {
  test("redeem auths; postDocument sends real Bearer", async () => {
    const client = new HdioClient("", "ok");
    assert.isFalse(client.authed);
    await client.redeemHandoff("h1");
    assert.isTrue(client.authed);

    const registry = new Map<string, Entry>();
    registry.set("hdml-model=m", {
      key: "hdml-model=m@abc.hdml",
      stored: false,
    });
    const body = await client.postDocument(bytes());
    recordStored(registry, body);

    const seen = (body as { seen_auth?: string }).seen_auth;
    assert.equal(seen, "Bearer access-ok");
    assert.notEqual(seen, "Bearer null");
    assert.isTrue(registry.get("hdml-model=m")?.stored);
    client.close();
  });

  test("a 401 handoff rejects; client stays inert", async () => {
    const client = new HdioClient("", "stale-handoff");
    let message: null | string = null;
    try {
      await client.redeemHandoff("h1");
    } catch (error) {
      message = (error as Error).message;
    }
    assert.isNotNull(message);
    assert.isNotEmpty(message ?? "");
    assert.isFalse(client.authed);
    client.close();
  });

  test("a 401 doc POST refreshes then retries once", async () => {
    const client = new HdioClient("", "expired-access");
    await client.redeemHandoff("h1");
    const body = await client.postDocument(bytes());
    const seen = (body as { seen_auth?: string }).seen_auth;
    assert.equal(seen, "Bearer fresh-access");
    client.close();
  });

  test("a persistent 401 rejects after one retry", async () => {
    const client = new HdioClient("", "always-401");
    await client.redeemHandoff("h1");
    let rejected = false;
    try {
      await client.postDocument(bytes());
    } catch {
      rejected = true;
    }
    assert.isTrue(rejected);
    client.close();
  });

  test("close() aborts an in-flight document POST", async () => {
    const client = new HdioClient("", "slow");
    await client.redeemHandoff("h1");
    let rejected = false;
    const done = client.postDocument(bytes()).catch(() => {
      rejected = true;
    });
    client.close();
    await done;
    assert.isTrue(rejected);
    assert.isFalse(client.authed);
  });

  test("a non-JSON 5xx carries statusText", async () => {
    const client = new HdioClient("", "err-html");
    await client.redeemHandoff("h1");
    let message = "";
    try {
      await client.postDocument(bytes());
    } catch (error) {
      message = (error as Error).message;
    }
    assert.isNotEmpty(message);
    assert.notInclude(message, "JSON");
    assert.notInclude(message.toLowerCase(), "unexpected");
    client.close();
  });

  test("oidc exchange stores the token pair", async () => {
    const client = new HdioClient("", "oidc-ok");
    assert.isFalse(client.authed);
    await client.exchangeOidcCode("c", "s");
    assert.isTrue(client.authed);
    client.close();
  });

  test("a stale state rejects, stale-marked, inert", async () => {
    const client = new HdioClient("", "stale-state");
    let error: unknown = null;
    try {
      await client.exchangeOidcCode("c", "s");
    } catch (e) {
      error = e;
    }
    assert.isTrue(isStaleAuthError(error));
    assert.isFalse(client.authed);
    client.close();
  });
});
