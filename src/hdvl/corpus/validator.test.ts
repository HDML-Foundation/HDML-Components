/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import "../index";
import type { Diagnostic, RuleId } from "../validate";
import type { HdmlViewElement } from "../view";
import { mountCorpus, pageSource } from "../../testing/corpus";
import { diagnosticsOf } from "../validate";

/**
 * ★ **SPEC §11's twenty rules, over the whole acceptance corpus**
 * (RFC §10.2, step 34 — the step designed to *discover* work).
 *
 * Thirteen pages, twenty-nine views, every rule named. Three
 * decisions are taken here rather than thirteen times in thirteen
 * suites, and each is a claim this file has to defend.
 *
 * **1. One file, not thirteen sets of per-page assertions.** *"Zero
 * violations across the corpus"* is one readable claim, and the
 * per-rule **ledger** below — an exhaustive `Record<RuleId, …>`,
 * so a rule added to the union without a verdict fails
 * `compile_tst` — cannot be written thirteen times without
 * becoming thirteen partial ledgers that agree by luck. The cost
 * is that a page's fixture is not beside its rules; the answer is
 * that this gate needs no fixture (decision 2).
 *
 * **2. No data provider is mounted, deliberately.** §8.2 splits
 * the validator in two, and the split is exactly the split this
 * gate wants. The **structural** pass runs inside `reindex()` off
 * attributes and the DOM — V1, V3, V4's local half, V6, V7's order
 * clause, V8, V9, V10, V13, V14, V16, V17, V18, V19, V20 and W2,
 * *sixteen* of the twenty rules — and is data-independent by
 * construction. The **binding** pass's column-derived half (V2's
 * kind clause, V4's `absent` clause, V5, V7's row clauses) is
 * already asserted zero on **all twenty-nine views** by the
 * thirteen `page-NN.test.ts` suites, each through
 * `assertRenders`'s `diagnosticsOf(view)` deep-equal — with that
 * page's own canned columns. Re-mounting a fourteenth copy of
 * those thirteen fixtures would assert the same claim against the
 * same data and add a second copy of every fixture, which is
 * exactly what `corpus.ts`'s decision 1 forbids for markup.
 *
 * What the no-provider mount is **not** is a structure-only pass:
 * every check that depends on an **authored** domain still runs
 * live here, because a literal `min`/`max`/`values` resolves with
 * no delivery at all. `checkPalette` (SPEC §9's exhaustion) and
 * V2's `log`-domain clause are both real coverage in this file.
 *
 * **3. The console is captured, and silence is the assertion.**
 * `validate.ts` is the only module under `src/hdvl/` that writes
 * to the console, so one capture covers everything
 * `diagnosticsOf` cannot see: **W4** (R20's node budget, which
 * `validateNodeBudget` warns and never memoises into a pass),
 * **W5** and **W6** (MEASURE's two), and §4.7's per-value ordinal
 * **notice**, which R25's 2026-08-23 amendment makes a console
 * notice and *not* a `Diagnostic`. Asserting both halves — nothing
 * in `diagnosticsOf`, nothing on the console — is the only way to
 * state that a page raises neither.
 *
 * ★ **Two `WarningCode`s have no caller**, and this file records
 * both rather than the one the tree claimed. `colorless-series`
 * (W3) was flagged at step 31 for this pass to decide; auditing
 * for it found **`unknown-construct` (W1) in the same state**. See
 * {@link LEDGER}.
 *
 * @module hdvl/corpus/validator
 */

/** The thirteen pages and their view counts (RFC §10.1). */
const PAGES: readonly (readonly [string, number])[] = [
  ["00-minimal", 1],
  ["01-line", 1],
  ["02-area", 2],
  ["03-bar", 3],
  ["04-grouped-stacked", 5],
  ["05-scatter", 2],
  ["06-bubble", 1],
  ["07-mixed", 1],
  ["08-pie-doughnut", 4],
  ["09-polar-area", 2],
  ["10-radar", 1],
  ["11-multi-plane", 2],
  ["12-coverage", 4],
];

/**
 * ★ **The per-rule ledger — SPEC §11's checklist, as a value.**
 *
 * Exhaustive over {@link RuleId}, so a twenty-seventh rule cannot
 * be added to the union without a verdict here, and a rule that
 * starts firing on the corpus fails the ledger test rather than
 * quietly changing what the gate proves.
 *
 * - `structural` — runs in `reindex()`, exercised by every one of
 *   the thirteen mounts below, silent on all of them.
 * - `authored` — runs in the binding pass but off an **authored**
 *   domain, so it is live in this file with no provider.
 * - `delivered` — runs in the binding pass off delivered columns;
 *   silent across the corpus, asserted by the thirteen
 *   `page-NN.test.ts` suites with each page's own fixture.
 * - `source` — **not runtime-applicable** (R23). Enforced over
 *   page source by `scripts/check-dist.mjs`.
 * - `behaviour` — asserted as a behaviour, never reported.
 * - `uncalled` — in the code union with no caller in the tree.
 */
const LEDGER: Readonly<
  Record<
    RuleId,
    | "structural"
    | "authored"
    | "delivered"
    | "source"
    | "behaviour"
    | "uncalled"
  >
> = {
  V1: "structural",
  // V2 is two clauses in one rule: the kind check needs a
  // delivered column, the log-domain check needs only the
  // resolved domain, which a literal `min`/`max` supplies here.
  V2: "authored",
  V3: "structural",
  V4: "structural",
  V5: "delivered",
  V6: "structural",
  V7: "structural",
  V8: "structural",
  V9: "structural",
  V10: "structural",
  V11: "source",
  V12: "source",
  V13: "structural",
  V14: "structural",
  // §11: "nice on a fully authored domain is a no-op, not an
  // error" — there is nothing to report, so nothing reports it.
  V15: "behaviour",
  V16: "structural",
  V17: "structural",
  V18: "structural",
  V19: "structural",
  V20: "structural",
  // ★ W1 — an unknown `hdml-*` element or an unrecognised
  // attribute. `unknown-construct` is in the union and nothing
  // raises it. Found by this pass; the tree claimed one uncalled
  // code and has two.
  W1: "uncalled",
  W2: "structural",
  // ★ W3 — "a colourless container child or pie (legal,
  // legend-less)". `colorless-series` is in the union and nothing
  // raises it. Flagged at step 31 for this pass.
  W3: "uncalled",
  // Console-only: `validateNodeBudget` warns and memoises, and
  // never enters `diagnosticsOf`. Asserted two ways — the capture
  // below, and `assertRenders`'s per-view budget check over the
  // real scenes the thirteen suites paint.
  W4: "structural",
  W5: "structural",
  W6: "structural",
};

/** One diagnostic, as the note enumerates it. */
function line(d: Diagnostic): string {
  const ch = d.channel === undefined ? "" : ` (${d.channel})`;
  return (
    `${d.rule} ${d.code} <${d.element.localName}>${ch} — ` + d.message
  );
}

/** Every diagnostic a page's views report, flattened. */
function report(views: readonly HdmlViewElement[]): string[] {
  const out: string[] = [];
  for (const view of views) {
    for (const d of diagnosticsOf(view)) {
      out.push(line(d));
    }
  }
  return out;
}

/* ---------------------------------------------------------------- */
/* The console capture — decision 3                                 */
/* ---------------------------------------------------------------- */

let said: string[] = [];
let realWarn: typeof console.warn;
let realError: typeof console.error;

function captureConsole(): void {
  said = [];
  realWarn = console.warn;
  realError = console.error;
  console.warn = (...args: unknown[]): void => {
    said.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]): void => {
    said.push(args.map(String).join(" "));
  };
}

function releaseConsole(): void {
  console.warn = realWarn;
  console.error = realError;
}

/** Only the validator's own lines (§8.1's `hdml ` prefix). */
function hdmlLines(): string[] {
  return said.filter((s) => s.startsWith("hdml "));
}

/* ---------------------------------------------------------------- */
/* The liveness probes — why an empty list is not a vacuous one     */
/* ---------------------------------------------------------------- */

/**
 * ★ **An empty diagnostics list proves nothing on its own**
 * (step 28's T2, generalised): `diagnosticsOf` answers `[]` for a
 * view it has never seen, so a gate that only asserts emptiness
 * passes identically whether the pass ran or never started.
 *
 * Every page therefore takes **two** mutations that SPEC says are
 * violations, one at each level the pass has:
 *
 * - {@link probeView} strips a view's accessible name — the
 *   view-level check `validateStructure` makes before its element
 *   loop, so it proves the pass *ran* for this view.
 * - {@link probeElements} puts a guide directly under a plane —
 *   a finding produced **inside** the element loop, so it proves
 *   the loop walked the tree the index built.
 *
 * Both restore and re-assert clean, which is R25's recovery half:
 * the finding clears and nothing is dispatched for the clearing.
 */
const W2_LINE =
  "W2 missing-accessible-name <hdml-view> — no accessible name" +
  " — add aria-label or aria-labelledby";

/** SPEC §4's V13 message for a widget at the plane level. */
const V13_LINE = "a plane holds scales — move <hdml-axis> into a";

function probeView(view: HdmlViewElement): void {
  const label = view.getAttribute("aria-label");
  const by = view.getAttribute("aria-labelledby");
  view.removeAttribute("aria-label");
  view.removeAttribute("aria-labelledby");
  view.reindex();
  assert.deepEqual(report([view]), [W2_LINE]);
  if (label !== null) {
    view.setAttribute("aria-label", label);
  }
  if (by !== null) {
    view.setAttribute("aria-labelledby", by);
  }
  view.reindex();
  assert.deepEqual(report([view]), []);
}

function probeElements(view: HdmlViewElement): void {
  const plane = view.querySelector(
    "hdml-cartesian-plane, hdml-polar-plane",
  );
  assert.isNotNull(plane, "every view has a plane");
  // No `channel`, so V1 and V20 have nothing to say and the one
  // finding under test is V13's.
  const stray = document.createElement("hdml-axis");
  plane?.appendChild(stray);
  view.reindex();
  assert.include(report([view]).join("\n"), V13_LINE);
  stray.remove();
  view.reindex();
  assert.deepEqual(report([view]), []);
}

/* ---------------------------------------------------------------- */
/* 1. The clean pass — every page, every view, every rule           */
/* ---------------------------------------------------------------- */

suite("corpus validator gate (the clean pass)", () => {
  setup(() => {
    captureConsole();
  });

  teardown(() => {
    releaseConsole();
  });

  for (const [name, views] of PAGES) {
    test(`★ ${name} reports no diagnostic`, async () => {
      const page = await mountCorpus(name);
      assert.lengthOf(page.views, views);
      // The whole list, not a count: a failure enumerates itself
      // in the form the note records.
      assert.deepEqual(report(page.views), []);
      // W4, W5, W6 and §4.7's ordinal notice are invisible to
      // `diagnosticsOf` by design, so the second half of the
      // claim is that the validator wrote nothing at all.
      assert.deepEqual(hdmlLines(), []);
      // …and the third half is that the silence is a result. Both
      // probes go red and recover, per view.
      for (const view of page.views) {
        probeView(view);
        probeElements(view);
      }
    });
  }
});

/* ---------------------------------------------------------------- */
/* 2. The absences that are claims                                  */
/* ---------------------------------------------------------------- */

suite("corpus validator gate (the claims)", () => {
  test("★ twenty-nine views over thirteen pages", () => {
    assert.lengthOf(PAGES, 13);
    assert.strictEqual(
      PAGES.reduce((n, [, v]) => n + v, 0),
      29,
    );
  });

  test("★ W2 — every view has an accessible name", async () => {
    // Finding 17's claim — *"all 29 views across 00–12 have
    // resolvable accessible names with no duplicate ids"* — as a
    // test, and read off the **document** rather than off the
    // validator, so it holds even if `hasAccessibleName` changed.
    // The validator's half is the clean pass above: W2 is a
    // `Finding` and so is in `diagnosticsOf`.
    let seen = 0;
    for (const [name, count] of PAGES) {
      const doc = new DOMParser().parseFromString(
        await pageSource(name),
        "text/html",
      );
      const ids = [...doc.querySelectorAll("[id]")].map(
        (el) => el.id,
      );
      assert.strictEqual(
        new Set(ids).size,
        ids.length,
        `${name} has a duplicate id`,
      );
      const views = [...doc.querySelectorAll("hdml-view")];
      assert.lengthOf(views, count);
      for (const view of views) {
        const label = view.getAttribute("aria-label");
        const by = view.getAttribute("aria-labelledby");
        if (label !== null) {
          assert.isNotEmpty(label.trim(), `${name}: empty label`);
        } else {
          assert.isNotNull(by, `${name}: a view has no name`);
          const target = doc.getElementById(by);
          assert.isNotNull(target, `${name}: ${by} resolves to no`);
          assert.isNotEmpty(
            (target?.textContent ?? "").trim(),
            `${name}: ${by} names an empty element`,
          );
        }
        seen++;
      }
    }
    assert.strictEqual(seen, 29);
  });

  test("★ every rule has a verdict", () => {
    // Exhaustive over `RuleId` by construction (a missing key
    // fails `compile_tst`), so this asserts the *shape* of the
    // ledger and the two facts a reader would otherwise take on
    // trust: the corpus exercises no rule at runtime that is
    // enforced at source, and exactly two codes are uncalled.
    const rules = Object.keys(LEDGER);
    assert.lengthOf(rules, 26);
    assert.deepEqual(
      rules.filter((r) => LEDGER[<RuleId>r] === "source"),
      ["V11", "V12"],
    );
    assert.deepEqual(
      rules.filter((r) => LEDGER[<RuleId>r] === "uncalled"),
      ["W1", "W3"],
    );
    assert.deepEqual(
      rules.filter((r) => LEDGER[<RuleId>r] === "behaviour"),
      ["V15"],
    );
  });
});

/* ---------------------------------------------------------------- */
/* 3. The five candidates the plan names                            */
/* ---------------------------------------------------------------- */

suite("corpus validator gate (the named candidates)", () => {
  setup(() => {
    captureConsole();
  });

  teardown(() => {
    releaseConsole();
  });

  test("★ 04-E — V6 is transitive, V17's only nesting", async () => {
    const page = await mountCorpus("04-grouped-stacked");
    const view = page.views[4];
    const cluster = view.querySelector("hdml-cluster");
    assert.isNotNull(cluster);
    // V6: the shared channel is the OUTERMOST container's, and
    // everything inside it is forbidden to bind one. The two
    // inner stacks bind nothing at all, which is what makes the
    // hoist transitive rather than one level deep.
    assert.strictEqual(cluster?.getAttribute("x"), "month");
    const stacks = [...view.querySelectorAll("hdml-stack")];
    assert.lengthOf(stacks, 2);
    for (const stack of stacks) {
      assert.isFalse(stack.hasAttribute("x"));
      // V17: one tag per stack, and a cluster's children are bars
      // or stacks — so this page is the only legal nesting.
      const tags = new Set(
        [...stack.children].map((k) => k.localName),
      );
      assert.deepEqual([...tags], ["hdml-bar"]);
      assert.strictEqual(stack.parentElement, cluster);
    }
    assert.deepEqual(report([view]), []);
  });

  test("★ 09-A — V13's tip holds every widget", async () => {
    const page = await mountCorpus("09-polar-area");
    const view = page.views[0];
    // ordinal[angle] → continuous[radius] → continuous[color] →
    // {grid, label, arc, legend}. V13: a scale's children are
    // scales OR widgets, never both — so no guide may sit at a
    // link level, and the tip holds all four.
    const scales = [
      ...view.querySelectorAll(
        "hdml-ordinal-scale, hdml-continuous-scale",
      ),
    ];
    assert.lengthOf(scales, 3);
    const tip = scales[2];
    for (const link of scales.slice(0, 2)) {
      const kids = [...link.children].map((k) => k.localName);
      assert.deepEqual(new Set(kids).size, 1);
      assert.match(kids[0], /-scale$/);
    }
    assert.deepEqual(
      [...tip.children].map((k) => k.localName),
      ["hdml-grid", "hdml-label", "hdml-arc", "hdml-legend"],
    );
    assert.deepEqual(report([view]), []);
  });

  test("★ 07 — two sibling y scales, one y per chain", async () => {
    const page = await mountCorpus("07-mixed");
    const view = page.views[0];
    const x = view.querySelector("hdml-ordinal-scale");
    assert.isNotNull(x);
    // V1 forbids two NESTED same-channel scales in one chain and
    // says nothing about siblings. The dual axis is siblings: two
    // y blocks under one x, so every chain sees exactly one y.
    const ys = [...(x?.children ?? [])].filter(
      (k) => k.localName === "hdml-continuous-scale",
    );
    assert.lengthOf(ys, 2);
    for (const y of ys) {
      assert.strictEqual(y.getAttribute("channel"), "y");
      // V13 per block: each y block holds widgets only.
      for (const kid of [...y.children]) {
        assert.notMatch(kid.localName, /-scale$/);
      }
    }
    assert.deepEqual(report([view]), []);
  });

  test("★ 10 — V16 takes none, V7 sees two sources", async () => {
    const page = await mountCorpus("10-radar");
    const view = page.views[0];
    const grid = view.querySelector('hdml-grid[channel="angle"]');
    assert.isNotNull(grid);
    // V16 is mutual exclusion, not a requirement: none of the
    // three is legal on any guide, `hdml-axis` included.
    for (const attr of ["count", "step", "values"]) {
      assert.isFalse(<boolean>grid?.hasAttribute(attr));
    }
    // V7's order clause is about the FRAME, and the two bound
    // widgets carry their own `source` while the plane has none —
    // the locality V4 and V7 share.
    const sourced = [...view.querySelectorAll("[source]")];
    assert.lengthOf(sourced, 2);
    assert.deepEqual(
      sourced.map((el) => el.localName),
      ["hdml-area", "hdml-line"],
    );
    assert.isFalse(
      <boolean>(
        view.querySelector("hdml-polar-plane")?.hasAttribute("source")
      ),
    );
    assert.deepEqual(report([view]), []);
  });

  test("★ 08-D — V13 over two sibling planes", async () => {
    const page = await mountCorpus("08-pie-doughnut");
    const view = page.views[3];
    // A view's children are planes plus at most one fallback,
    // and two sibling planes are the case that makes the rule
    // say something: each owns its own chain, and the `source`
    // sits on the view above both.
    assert.deepEqual(
      [...view.children].map((k) => k.localName),
      ["hdml-polar-plane", "hdml-polar-plane"],
    );
    assert.strictEqual(
      view.getAttribute("source"),
      "?hdml-frame=region_share",
    );
    for (const plane of [...view.children]) {
      assert.isFalse(plane.hasAttribute("source"));
    }
    assert.deepEqual(report([view]), []);
  });
});

/* ---------------------------------------------------------------- */
/* 4. The negative control — the gate proves it can go red          */
/* ---------------------------------------------------------------- */

suite("corpus validator gate (the negative control)", () => {
  setup(() => {
    captureConsole();
  });

  teardown(() => {
    releaseConsole();
  });

  /**
   * A mutation is applied and `reindex()` is called by hand
   * rather than relied upon: `attributeChangedCallback` only
   * fires for an element's **observed** attributes (step 24's
   * T2), so a rule reached by an unpublished attribute would
   * silently never re-run and the control would pass for the
   * wrong reason.
   */
  function reindexed(view: HdmlViewElement): string[] {
    view.reindex();
    return report([view]);
  }

  test("★ V4 — a bare identifier with no source", async () => {
    const page = await mountCorpus("07-mixed");
    const view = page.views[0];
    const plane = view.querySelector("hdml-cartesian-plane");
    assert.deepEqual(report([view]), []);
    plane?.removeAttribute("source");
    const found = reindexed(view);
    assert.isNotEmpty(found);
    assert.include(
      found.join("\n"),
      'y="revenue" names a field, but no source is in scope — ' +
        "add source= here or on an ancestor",
    );
  });

  test("★ V13 — a guide moved off the tip", async () => {
    const page = await mountCorpus("00-minimal");
    const view = page.views[0];
    const outer = view.querySelector("hdml-ordinal-scale");
    const axis = view.querySelector('hdml-axis[channel="x"]');
    assert.isNotNull(outer);
    assert.isNotNull(axis);
    assert.deepEqual(report([view]), []);
    // The x axis moves up one level, beside the y scale — a
    // level that now holds a scale AND a widget.
    outer?.appendChild(<Node>axis);
    const found = reindexed(view);
    assert.include(
      found.join("\n"),
      "scales and widgets cannot share a level — move " +
        '<hdml-axis channel="x"> into one of the y blocks',
    );
  });

  test("★ V16 — a count beside a step", async () => {
    const page = await mountCorpus("00-minimal");
    const view = page.views[0];
    const label = view.querySelector('hdml-label[channel="y"]');
    assert.isNotNull(label);
    assert.deepEqual(report([view]), []);
    label?.setAttribute("step", "100");
    const found = reindexed(view);
    assert.include(
      found.join("\n"),
      // The list names the attributes actually written, not the
      // three the rule is about — `attrList` is given the found
      // set, so a page with two of them reads "count and step".
      "count and step are mutually exclusive — keep one " +
        'on <hdml-label channel="y">',
    );
  });

  test("★ V7 — a path widget over an unpinned frame", async () => {
    // ★ Step 34's own widening, and the page that measures both
    // halves of it at once. `01-line` draws TWO lines over bound
    // columns: one through the plane's in-page `?hdml-frame=`
    // ref, one through its own **static** ref. Unpinning the
    // in-page frame must warn about exactly one of them — the
    // widened clause fires, and the locality that keeps a static
    // document silent is proved by the line that stays quiet
    // rather than by reading the regex.
    const page = await mountCorpus("01-line");
    const view = page.views[0];
    assert.deepEqual(report([view]), []);
    const frame = document.querySelector(
      'hdml-frame[name="revenue_m"]',
    );
    const sort = frame?.querySelector("hdml-sort-by") ?? null;
    assert.isNotNull(sort);
    sort?.remove();
    const v7 = reindexed(view).filter((l) => l.startsWith("V7 "));
    assert.deepEqual(v7, [
      "V7 unpinned-row-order <hdml-line> — row order is slice " +
        'order — pin it with <hdml-sort-by> in "revenue_m"',
    ]);
    frame?.appendChild(<Node>sort);
    view.reindex();
    assert.deepEqual(report([view]), []);
  });

  test("★ V20 — a positional guide on color", async () => {
    const page = await mountCorpus("00-minimal");
    const view = page.views[0];
    const axis = view.querySelector('hdml-axis[channel="y"]');
    assert.isNotNull(axis);
    assert.deepEqual(report([view]), []);
    axis?.setAttribute("channel", "color");
    const found = reindexed(view);
    assert.include(
      found.join("\n"),
      "the color channel has no positions — use hdml-legend",
    );
  });
});
