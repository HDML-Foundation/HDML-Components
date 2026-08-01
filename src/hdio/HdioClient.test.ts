/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import { HdioClient, recordStored } from "./HdioClient";

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

  test("setTokens adopts a pair minted elsewhere → authed", () => {
    // The OIDC exchange is main-side now (§3.3); the worker's client
    // adopts the pair via setTokens rather than fetching itself.
    const client = new HdioClient("", "oidc-ok");
    assert.isFalse(client.authed);
    client.setTokens("access-x", "refresh-x");
    assert.isTrue(client.authed);
    client.setTokens(null, null);
    assert.isFalse(client.authed);
    client.close();
  });
});

suite("HdioClient query leg (D2 shape, wtr mock HDIO)", () => {
  const authed = async (tenant: string): Promise<HdioClient> => {
    const client = new HdioClient("", tenant);
    await client.redeemHandoff("h1");
    return client;
  };

  test("submitQuery → {jobId, status}", async () => {
    const client = await authed("q-ok");
    const res = await client.submitQuery({
      docPath: "dynamic:k",
      columns: ["a", "b"],
    });
    assert.equal(res.jobId, "job-1");
    assert.equal(res.status, "completed");
    client.close();
  });

  test("queryStatus: a 202 pending is not an error", async () => {
    const client = await authed("q-pending");
    const res = await client.queryStatus("job-1");
    assert.equal(res.status, "pending");
    client.close();
  });

  test("queryStatus surfaces a failed job's error", async () => {
    const client = await authed("q-fail");
    const res = await client.queryStatus("job-1");
    assert.equal(res.status, "failed");
    assert.equal(res.error, "boom");
    client.close();
  });

  test("queryResult de-frames the stream", async () => {
    const client = await authed("q-ok");
    const batches = await client.queryResult("job-1");
    assert.lengthOf(batches, 2);
    assert.deepEqual(
      Array.from(new Uint8Array(batches[0])),
      [1, 2, 3],
    );
    assert.deepEqual(
      Array.from(new Uint8Array(batches[1])),
      [4, 5, 6, 7],
    );
    client.close();
  });

  test("cancelQuery swallows a 409 (ErrJobTerminal)", async () => {
    const client = await authed("q-cancel");
    let threw = false;
    try {
      await client.cancelQuery("job-1");
    } catch {
      threw = true;
    }
    assert.isFalse(threw);
    client.close();
  });

  test("cancelQuery resolves on a 204", async () => {
    const client = await authed("q-ok");
    let threw = false;
    try {
      await client.cancelQuery("job-1");
    } catch {
      threw = true;
    }
    assert.isFalse(threw);
    client.close();
  });
});
