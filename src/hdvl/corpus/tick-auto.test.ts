/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import "../index";
import {
  mountCorpus,
  quiesce,
  ENGINE,
  NARROW,
} from "../../testing/corpus";
import {
  installSceneRecorder,
  restoreRenderers,
} from "../../testing/scene-of";
import {
  ACCEPTED,
  collectInvariants,
  gateDiff,
  runsOf,
  WIDTHS,
} from "../../testing/invariants";
import type { Accepted, Predicate } from "../../testing/invariants";
import type { Engine } from "../../testing/corpus";
import { scaleOf } from "../scale";
import { tickSpecOf } from "../guide-spec";
import type { HdvlElement } from "../base";

/** 02-area view 0's x label runs, at one layout width. */
async function xRuns(width: number): Promise<string[]> {
  restoreRenderers();
  const page = await mountCorpus("02-area", width);
  const svg = page.views[0].shadowRoot?.querySelector("svg");
  const g = Array.from(svg?.querySelectorAll("g[data-w]") ?? [])[2];
  return Array.from(g.querySelectorAll("text")).map(
    (t) => t.textContent ?? "",
  );
}

/**
 * ★★ **`--hdml-tick-count: auto` is width-aware** — 019 item 8,
 * RFC 019/001 §6.6, Note 005 §§3–4, **A13**.
 *
 * This file is the fix's **calibration gate**, and it is separate
 * from `page-02.test.ts` on purpose: that suite asserts one
 * whole-`Scene` golden at one layout width, and item 8's whole
 * subject is what happens at the **other** one. A golden recorded
 * at 800 px cannot see a thinning that only fires at 400, which is
 * why the defect survived 1 264 passing tests and had to be found
 * by 017's second viewport instead.
 *
 * **`02-area` view 0's x label is the corpus's ONE `auto` target**,
 * and that is measured rather than assumed: it is the only guide
 * that calls `scale.ticks`, computes `auto`, resolves a non-ordinal
 * scale on a pixel channel, and declares neither `step` nor
 * `values`. (`05-scatter` view 0's y grid and y label meet the
 * first three and carry `step="0.05"`, which wins — Note 005 §4.1
 * enumerated labels only and so did not list them.)
 *
 * Every test here is a **negative control**: each one is written to
 * fail if the fix is something other than what it claims to be.
 */
suite("corpus — auto resolves from the width (019 item 8)", () => {
  setup(() => {
    installSceneRecorder();
  });

  teardown(() => {
    restoreRenderers();
  });

  test("C1 — an explicit count restores today's", async () => {
    restoreRenderers();
    const page = await mountCorpus("02-area", NARROW);
    const v0 = page.views[0];
    const svg = v0.shadowRoot?.querySelector("svg");
    const g = () =>
      Array.from(svg?.querySelectorAll("g[data-w]") ?? [])[2];
    const texts = () =>
      Array.from(g().querySelectorAll("text")).map(
        (t) => t.textContent ?? "",
      );
    const thinned = texts();
    const label = <HTMLElement>v0.querySelectorAll("hdml-label")[0];
    // 10 is the literal `tickValues` used before item 8, so this
    // asks for exactly the pre-fix request.
    label.style.setProperty("--hdml-tick-count", "10");
    v0.markDirty();
    await quiesce([v0]);
    const pinned = texts();
    label.style.removeProperty("--hdml-tick-count");
    v0.markDirty();
    await quiesce([v0]);
    console.log(
      `C1 ${ENGINE} thinned=${thinned.length} ` +
        `pinned=${pinned.length} restored=${texts().length} ` +
        `pinnedSet=${JSON.stringify(pinned)}`,
    );
    assert.lengthOf(pinned, 21, "an explicit 10 renders 21 again");
    assert.isBelow(thinned.length, pinned.length);
    assert.deepEqual(texts(), thinned, "and auto comes back");
  });

  test("C2 — the width is the input, over four of them", async () => {
    const widths = [800, 500, 400, 300];
    const counts: number[] = [];
    for (const w of widths) {
      counts.push((await xRuns(w)).length);
    }
    console.log(
      `C2 ${ENGINE} ${JSON.stringify(
        widths.map((w, i) => [w, counts[i]]),
      )}`,
    );
    for (let i = 1; i < counts.length; i++) {
      assert.isAtMost(
        counts[i],
        counts[i - 1],
        `width ${widths[i]} must not exceed ${widths[i - 1]}`,
      );
    }
    assert.isAtLeast(
      new Set(counts).size,
      3,
      "three distinct counts rule out a coincidence",
    );
    for (const n of counts) {
      assert.isAtLeast(n, 2, "the clamp holds");
    }
  });

  test("C3 — the twenty deleted are the stale twenty", async () => {
    // R02's entries, reconstructed INDEPENDENTLY of the generator
    // that used to produce them.
    const r02: Accepted[] = [];
    for (let i = 0; i < 20; i++) {
      r02.push({
        page: "02-area",
        view: 0,
        predicate: <Predicate>"runs-overlap",
        runs: [`hdml-label[2]#${i}`, `hdml-label[2]#${i + 1}`],
        engines: <Engine[]>["chromium", "firefox", "webkit"],
        widths: [NARROW],
        reason: "control",
      });
    }
    const found = await collectInvariants("02-area");
    const re = gateDiff("02-area", found, [...ACCEPTED, ...r02]);
    const narrow = re.filter((d) => d.width === NARROW)[0];
    console.log(
      `C3 ${ENGINE} stale=${narrow.stale.length} ` +
        `unaccepted=${narrow.unaccepted.length} ` +
        `first=${JSON.stringify(narrow.stale.slice(0, 2))}`,
    );
    assert.lengthOf(
      narrow.stale,
      20,
      "re-listing all twenty reds the gate on all twenty",
    );
    assert.deepEqual([...narrow.unaccepted], []);
    // …and 19 of 20 reds on 19, so the deletion was enforced
    // entry by entry rather than as a block.
    const nineteen = gateDiff("02-area", found, [
      ...ACCEPTED,
      ...r02.slice(0, 19),
    ]).filter((d) => d.width === NARROW)[0];
    assert.lengthOf(nineteen.stale, 19);
    // And the baseline as committed is clean at both widths.
    for (const d of gateDiff("02-area", found)) {
      assert.deepEqual([...d.stale], [], `stale @${d.width}`);
      assert.deepEqual([...d.unaccepted], [], `new @${d.width}`);
    }
  });

  test("C3b — the baseline is 77, and 04's 54 are untouched", () => {
    const by = new Map<string, number>();
    for (const a of ACCEPTED) {
      by.set(a.page, (by.get(a.page) ?? 0) + 1);
    }
    console.log(
      `C3b ACCEPTED.length=${ACCEPTED.length} ` +
        JSON.stringify([...by.entries()].sort()),
    );
    // ⚠ **84 -> 77 at 019 step 35**, which also took
    // `12-coverage` from 11 to 4: item 7's fix retired F4's
    // seven `ALL_WIDTHS` entries, leaving A's one and C's three.
    // `02-area`'s absence is step 31's twenty; `04` and `11` are
    // narrow-only families neither step touched.
    assert.lengthOf(ACCEPTED, 77);
    assert.strictEqual(by.get("02-area"), undefined);
    assert.strictEqual(by.get("04-grouped-stacked"), 54);
    assert.strictEqual(by.get("11-multi-plane"), 15);
    assert.strictEqual(by.get("12-coverage"), 4);
  });

  test("C4 — a snapshot-less guide still resolves to absent", () => {
    // ★ The 14 detached `tickSpecOf` calls in
    // `guide-spec.test.ts` assert `{}` and still do: `props`
    // stays optional, and a guide with no computed style has no
    // declaration to read and no width to derive one from.
    //
    // ⚠ What CHANGED is the live shape. A real `Measured.props`
    // always carries `--hdml-tick-count` at its `auto` initial, so
    // an attached guide no rule matched now forwards the keyword,
    // and only the detached case is absent. The two used to be the
    // same answer; collapsing them again makes item 8 unreachable.
    // Pinned here as well as in `guide-spec.test.ts` because this
    // is the file that says why it matters.
    const bare = <HdvlElement>(
      (<unknown>document.createElement("div"))
    );
    assert.deepEqual(tickSpecOf(bare), {});
    assert.deepEqual(
      tickSpecOf(bare, new Map([["--hdml-tick-count", "auto"]])),
      { count: "auto" },
    );
  });

  test("C5a — the DOMAIN stays width-invariant", async () => {
    // ★ The one page whose tick set is now a function of layout
    // must still have a layout-independent domain: §4.2's
    // *"a resize would silently move the data"*.
    const seen: string[] = [];
    for (const w of [...WIDTHS, 300]) {
      restoreRenderers();
      const page = await mountCorpus("02-area", w);
      const doms: unknown[] = [];
      page.views[0].querySelectorAll("*").forEach((e) => {
        if (e.tagName.toLowerCase().includes("scale")) {
          doms.push(scaleOf(<HdvlElement>e)?.domain() ?? null);
        }
      });
      seen.push(JSON.stringify(doms));
    }
    console.log(`C5a ${ENGINE} distinct=${new Set(seen).size}`);
    assert.strictEqual(
      new Set(seen).size,
      1,
      "the domain must not move with the width",
    );
  });

  test("C5b — the SIGNATURE does not cover ticks()", async () => {
    // ★★★ The control nobody asked for. `auto` makes the tick set
    // depend on the pixel range AND on `--hdml-font-size`, while
    // `hdml-scale-change` is edge-triggered on `(domain, range)`
    // alone (§5.11). A font-size change therefore moves the ticks
    // while the signature is byte-identical.
    restoreRenderers();
    const page = await mountCorpus("02-area", NARROW);
    const v0 = page.views[0];
    const scaleEl = <HTMLElement>(
      v0.querySelector('hdml-datetime-scale[channel="x"]')
    );
    const sig = (): string =>
      JSON.stringify([
        scaleOf(<HdvlElement>(<unknown>scaleEl))?.domain(),
        scaleOf(<HdvlElement>(<unknown>scaleEl))?.range(),
      ]);
    const runs = () => runsOf(v0).filter((r) => r.group === 2).length;
    let fired = 0;
    v0.addEventListener("hdml-scale-change", () => {
      fired++;
    });
    const before = { sig: sig(), runs: runs() };
    scaleEl.style.setProperty("--hdml-font-size", "4px");
    v0.markDirty();
    await quiesce([v0]);
    const after = { sig: sig(), runs: runs() };
    scaleEl.style.removeProperty("--hdml-font-size");
    v0.markDirty();
    await quiesce([v0]);
    console.log(
      `C5b ${ENGINE} runs ${before.runs} -> ${after.runs}; ` +
        `signature identical=${before.sig === after.sig}; ` +
        `hdml-scale-change fired=${fired}; restored=${runs()}`,
    );
    assert.notStrictEqual(
      before.runs,
      after.runs,
      "a smaller font must admit more ticks",
    );
    assert.strictEqual(
      before.sig,
      after.sig,
      "…while (domain, range) is unchanged",
    );
    assert.strictEqual(runs(), before.runs, "and it restores");
  });
});
