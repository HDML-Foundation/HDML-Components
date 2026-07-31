/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import { HdmlIo, nav } from "./HdmlIo";

// The app's own page URL (origin + pathname); `?code&state` is added
// per-case. The exchange/stale tests run against the wtr mock HDIO
// (`.testrc.js`) so `host` is "" (same-origin); the tenant selects
// the scenario ("oidc-ok" → 200, "stale-state" → 401).
const HREF = "http://app.example/dash";

// A 20 ms macrotask yield. Bare `await`ing a promise resolved by a
// MessagePort message flakes on WebKit (it can schedule the port's
// `message` a macrotask later than a `setTimeout(0)`, and an idle
// page never pumps it — see endpoint.test.ts), and a fixed wait
// flakes under full-suite load; polling on a real timer covers both.
const tick = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// Polls `pred` every 20 ms up to `cap` iterations (~4 s), so the
// worker round-trip (two port hops + one fetch) is awaited without a
// brittle fixed delay.
async function until(pred: () => boolean, cap = 200): Promise<void> {
  for (let i = 0; i < cap && !pred(); i++) {
    await tick(20);
  }
}

suite("HdmlIo auth state machine", () => {
  let mounted: HdmlIo[] = [];
  const saved = { ...nav };
  // Per-test recording seams; each test points nav's methods here.
  let navCalls: string[] = [];
  let stripCalls: string[] = [];
  let search = "";

  setup(() => {
    navCalls = [];
    stripCalls = [];
    search = "";
    // The element reads this **module-level** seam, so overriding it
    // here (before any element mounts) sidesteps the per-instance
    // upgrade-timing race entirely — no real navigation ever fires.
    nav.href = () => HREF + search;
    nav.search = () => search;
    nav.navigate = (u) => navCalls.push(u);
    nav.strip = (u) => stripCalls.push(u);
  });

  teardown(() => {
    Object.assign(nav, saved);
    mounted.forEach((el) => el.remove());
    mounted = [];
  });

  function mount(attrs: Record<string, string>): HdmlIo {
    const el = document.createElement("hdml-io") as HdmlIo;
    for (const [k, v] of Object.entries(attrs)) {
      el.setAttribute(k, v);
    }
    document.body.appendChild(el);
    mounted.push(el);
    return el;
  }

  test("code+state → exchange → strip params", async () => {
    search = "?code=c&state=s";
    mount({ host: "", tenant: "oidc-ok" });
    await until(() => stripCalls.length > 0);
    assert.deepEqual(stripCalls, [HREF]);
    assert.deepEqual(navCalls, []);
  });

  test("a stale 401 re-navigates, not a hard error", async () => {
    search = "?code=c&state=s";
    mount({ host: "", tenant: "stale-state" });
    await until(() => navCalls.length > 0);
    assert.equal(navCalls.length, 1);
    assert.include(navCalls[0], "/stale-state/api/v1/auth/login");
    assert.include(navCalls[0], "redirect_uri=");
  });

  test("interleaved changes navigate at most once", async () => {
    const el = mount({ host: "", tenant: "t", mode: "oidc" });
    await until(() => navCalls.length > 0);
    assert.equal(navCalls.length, 1);
    assert.include(navCalls[0], "/t/api/v1/auth/login");
    // A later mode/token flurry cannot commit a second navigation.
    el.setAttribute("token", "x");
    el.removeAttribute("token");
    el.setAttribute("mode", "oidc");
    await tick(60);
    assert.equal(navCalls.length, 1);
  });
});
