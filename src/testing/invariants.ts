/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * 017's **visual gate** — geometry invariants over the mock corpus
 * (project 017 R-gate, step 11-1).
 *
 * The corpus asserts whole-`Scene` goldens, which are *computed*
 * geometry: a tree of correct numbers can still paint a broken
 * picture, and overflow, clipping and font-metric drift are
 * invisible to it by construction (§ O1). This module is the answer,
 * and it is **not** a pixel comparator — step 10-5 measured two full
 * live renders minutes apart with byte-identical inputs and got six
 * non-identical views where three had changed, so `cmp` over PNGs
 * would have been red on arrival. What it asserts instead are three
 * universal predicates that hold on every correct chart.
 *
 * **1. The rendered / scene split is explicit.** {@link escapesView}
 * and {@link runsOverlap} read `getBoundingClientRect`, so they need
 * the **real** renderer — the corpus harness installs a recording
 * stub that draws nothing, and a predicate run against it would pass
 * by asserting over an empty `<svg>`. {@link marksEmpty} reads the
 * `Scene` and needs the recorder. {@link assertInvariants} therefore
 * runs two passes, scene first, and calls `restoreRenderers()`
 * between them.
 *
 * **2. Containment is four inequalities, never a delta.** A rendered
 * text extent differs per engine — 016 step 33 measured one used
 * width at 1/64 px on one engine and 1/60 px on another. An
 * inequality survives that; a tolerance or a magnitude does not,
 * which is also why {@link ACCEPTED} is keyed on **identity**.
 *
 * **3. A violation is reported, not thrown.** The three known live
 * defects were triaged `IGNORE` by the project's owner, and a gate
 * that reds on an appearance its owner has accepted is a gate that
 * gets re-recorded. {@link ACCEPTED} is what makes *"reports, never
 * reds"* a gate rather than a log: a listed violation is visible
 * with its reason, an unlisted one is red — **and a listed one that
 * stops firing is red too**, so the baseline empties itself as
 * defects are fixed rather than rotting shut.
 *
 * @module testing/invariants
 */

import { assert } from "@open-wc/testing";
import type { Scene } from "../hdvl/scene";
import type { HdmlViewElement } from "../hdvl/view";
import { ENGINE, mountCorpus } from "./corpus";
import type { Engine } from "./corpus";
import { restoreRenderers, sceneOf } from "./scene-of";

/* ---------------------------------------------------------------- */
/* Violations                                                       */
/* ---------------------------------------------------------------- */

/** The three predicates, by name. */
export type Predicate =
  /** P1 — a text run is not contained by its view. */
  | "escapes-view"
  /** P2 — two text runs intersect. */
  | "runs-overlap"
  /** P3 — a view declares mark groups and paints no mark node. */
  | "marks-empty";

/**
 * One violation, **keyed on identity and never on magnitude**.
 *
 * A baseline holding pixel numbers is a golden by another name and
 * would flake across three sets of font metrics — which is the whole
 * reason `stripText` exists. What is recorded is *that these runs
 * overlap*, not *by how much*.
 */
export interface Violation {
  /** The corpus page's basename, e.g. `"10-radar"`. */
  page: string;
  /** The view's index in document order. */
  view: number;
  /** Which predicate reported it. */
  predicate: Predicate;
  /**
   * The offending runs, as {@link runId} prints them. One for
   * `escapes-view`, two for `runs-overlap`, none for `marks-empty`.
   */
  runs: readonly string[];
}

/**
 * A violation's stable key.
 *
 * @param v - The violation.
 * @returns `page/view/predicate/runs`.
 */
export function keyOf(v: Violation): string {
  return [v.page, v.view, v.predicate, v.runs.join(" x ")].join("/");
}

/**
 * ★ **A run's identity, and why it is not its text.**
 *
 * A rendered `Intl` string is ICU version and OS data (corpus rule
 * 4) — the reason `stripText` exists — so keying a baseline on the
 * text would make it engine-dependent in exactly the way the rest of
 * the harness works to avoid. The **indices** are arithmetic: group
 * order is document order and node order is the guide's ladder.
 *
 * @param tag - The group's `data-tag`.
 * @param group - The group's index in the view's `<svg>`.
 * @param run - The run's index among that group's `<text>` children.
 * @returns `tag[group]#run`.
 */
export function runId(
  tag: string,
  group: number,
  run: number,
): string {
  return `${tag}[${group}]#${run}`;
}

/* ---------------------------------------------------------------- */
/* The accepted-violations baseline                                 */
/* ---------------------------------------------------------------- */

/** The three engines an entry can be reported on. */
const ALL_ENGINES: readonly Engine[] = [
  "chromium",
  "firefox",
  "webkit",
];

/** A violation this project has looked at and accepted. */
export interface Accepted extends Violation {
  /**
   * ★ **Which engines report it — and why an entry needs this.**
   *
   * A run's ink extent is a font metric, so a violation that sits
   * within a pixel of a boundary can be true on one engine and false
   * on another. `00-minimal`'s top y run is the measured case: it
   * clears the view by 1 px on chromium and webkit and crosses it by
   * 0.25 px on firefox. Without this field the **stale** half of
   * {@link assertInvariants} would red on the two engines that do not
   * report it, and the only escapes would be to drop the stale check
   * (a baseline that rots) or to scope the whole gate to one engine
   * (a gate that asserts nothing on two engines out of three). It is
   * the same move `stripText` makes for ICU strings, at the same
   * seam.
   */
  engines: readonly Engine[];
  /**
   * Why it is accepted, naming the decision — a founder `IGNORE`
   * from `001. Requirements.md` § *Findings triaged 2026-09-26*, or
   * a finding filed to a later step. An entry with no reason is the
   * mechanism failing.
   */
  reason: string;
}

/**
 * ★ **The accepted-violations baseline — and it is NOT empty.**
 *
 * Step 11-1 predicted that none of the three known live defects would
 * reproduce on the mock twins, and that the gate would therefore have
 * **no calibration set**. Measured over 13 pages and 29 views, that
 * prediction is **refuted**: **two of the three reproduce**, and the
 * predicates found **three more defect families nobody had
 * recorded**.
 *
 * | family | what it is |
 * |---|---|
 * | `10-radar` | ★ the known live overprint, verbatim |
 * | `12-coverage` A | ★ the known live ramp legend, colliding |
 * | `12-coverage` C | the same default, escaping the view by 25 px |
 * | `12-coverage` D | a symlog ladder's duplicate runs at zero |
 * | `05-scatter` B | the origin corner 10-3 cleared elsewhere |
 * | `00-minimal` | a 1 px clearance one font metric crosses |
 *
 * **Fourteen entries over five pages**, every one argued in its
 * `reason`. None is red: step 11's decision is *"the gate only
 * reports, never reds; the three are its calibration set rather than
 * its acceptance test"*, and a gate red on an appearance its owner
 * has accepted is a gate that gets re-recorded. What is **not**
 * settled here is the triage of the three new families — that is
 * 11-3's, and until it happens they are recorded, not blessed.
 *
 * @see DEFERRED_TO_SLICE_H
 */
export const ACCEPTED: readonly Accepted[] = [
  {
    page: "00-minimal",
    view: 0,
    predicate: "escapes-view",
    runs: ["hdml-label[3]#5"],
    engines: ["firefox"],
    reason:
      "F1 — the zero-CSS floor's top y run clears the view by 1 px " +
      "on chromium and webkit and inks 1 px taller on firefox, so " +
      "only firefox crosses it, by 0.25 px. A font metric (016 step" +
      "33's class), not a document defect; the clearance is ua.ts's" +
      "and moving it moves 00-minimal's golden. Filed at 11-1 for " +
      "triage at 11-3.",
  },
  {
    page: "05-scatter",
    view: 1,
    predicate: "runs-overlap",
    runs: ["hdml-label[3]#0", "hdml-label[4]#0"],
    engines: ALL_ENGINES,
    reason:
      "F2 — the origin corner. 05-scatter B's widest y run " +
      "($10.00K)" +
      "and its first x run (0) ink across each other by 3.63 x 1 px" +
      "at the plot's bottom-left. The collision class 10-3 cleared " +
      "on 11-multi-plane (0B vs 2013), surviving here because this " +
      "page's y runs are currency-formatted and wide. Filed at 11-1" +
      "for triage at 11-3.",
  },
  {
    page: "10-radar",
    view: 0,
    predicate: "runs-overlap",
    runs: ["hdml-label[2]#0", "hdml-label[3]#4"],
    engines: ALL_ENGINES,
    reason:
      "★ THE KNOWN LIVE 10-radar OVERPRINT, REPRODUCING ON THE MOCK" +
      "TWIN. 001. Requirements.md names it as the radial 10 " +
      "printing" +
      "on the top category label; here the top category is comfort " +
      "and it is the same two widgets, the same outermost radius " +
      "run and the same cause. Reported, never red — the founder's " +
      "decision at step 11.",
  },
  {
    page: "12-coverage",
    view: 0,
    predicate: "runs-overlap",
    runs: ["hdml-label[2]#5", "hdml-legend[6]#4"],
    engines: ALL_ENGINES,
    reason:
      "★ The 12-coverage A ramp legend — colliding rather than " +
      "truncating. The page declares NO legend gutter and §3's UA " +
      "default overlays the legend on the plot's top-right corner, " +
      "so the bottom ramp entry (40) meets the x axis's last tick " +
      "(100). Same widget and same cause as the live 2,0 defect " +
      "001. Requirements.md § Findings triaged 2026-09-26 IGNOREs.",
  },
  {
    page: "12-coverage",
    view: 2,
    predicate: "escapes-view",
    runs: ["hdml-legend[6]#0"],
    engines: ALL_ENGINES,
    reason:
      "★ F3 — the same UA legend default, ESCAPING. 12-coverage C's" +
      "category runs (Alpha/Beta/Gamma) are 25-43 px wide and start" +
      "18 px from the view's right edge, so all three ink past it, " +
      "by up to 25 px. This is the live 12-coverage truncation " +
      "class reproducing on the mock twin, on a different view. " +
      "Filed at 11-1 for triage at 11-3.",
  },
  {
    page: "12-coverage",
    view: 2,
    predicate: "escapes-view",
    runs: ["hdml-legend[6]#1"],
    engines: ALL_ENGINES,
    reason:
      "★ F3 — the same UA legend default, ESCAPING. 12-coverage C's" +
      "category runs (Alpha/Beta/Gamma) are 25-43 px wide and start" +
      "18 px from the view's right edge, so all three ink past it, " +
      "by up to 25 px. This is the live 12-coverage truncation " +
      "class reproducing on the mock twin, on a different view. " +
      "Filed at 11-1 for triage at 11-3.",
  },
  {
    page: "12-coverage",
    view: 2,
    predicate: "escapes-view",
    runs: ["hdml-legend[6]#2"],
    engines: ALL_ENGINES,
    reason:
      "★ F3 — the same UA legend default, ESCAPING. 12-coverage C's" +
      "category runs (Alpha/Beta/Gamma) are 25-43 px wide and start" +
      "18 px from the view's right edge, so all three ink past it, " +
      "by up to 25 px. This is the live 12-coverage truncation " +
      "class reproducing on the mock twin, on a different view. " +
      "Filed at 11-1 for triage at 11-3.",
  },
  {
    page: "12-coverage",
    view: 3,
    predicate: "runs-overlap",
    runs: ["hdml-label[4]#4", "hdml-label[4]#5"],
    engines: ALL_ENGINES,
    reason:
      "★ F4 — the symlog ladder emits DUPLICATE runs at the origin." +
      "12-coverage D's y axis prints -0.001K twice and 0.001K " +
      "twice, 4.12 px apart in 13 px-tall runs. Not recorded " +
      "anywhere before 11-1. Filed at 11-1 for triage at 11-3.",
  },
  {
    page: "12-coverage",
    view: 3,
    predicate: "runs-overlap",
    runs: ["hdml-label[4]#4", "hdml-label[4]#6"],
    engines: ALL_ENGINES,
    reason:
      "★ F4 — the symlog ladder emits DUPLICATE runs at the origin." +
      "12-coverage D's y axis prints -0.001K twice and 0.001K " +
      "twice, 4.12 px apart in 13 px-tall runs. Not recorded " +
      "anywhere before 11-1. Filed at 11-1 for triage at 11-3.",
  },
  {
    page: "12-coverage",
    view: 3,
    predicate: "runs-overlap",
    runs: ["hdml-label[4]#5", "hdml-label[4]#6"],
    engines: ALL_ENGINES,
    reason:
      "★ F4 — the symlog ladder emits DUPLICATE runs at the origin." +
      "12-coverage D's y axis prints -0.001K twice and 0.001K " +
      "twice, 4.12 px apart in 13 px-tall runs. Not recorded " +
      "anywhere before 11-1. Filed at 11-1 for triage at 11-3.",
  },
  {
    page: "12-coverage",
    view: 3,
    predicate: "runs-overlap",
    runs: ["hdml-label[4]#5", "hdml-label[4]#7"],
    engines: ALL_ENGINES,
    reason:
      "★ F4 — the symlog ladder emits DUPLICATE runs at the origin." +
      "12-coverage D's y axis prints -0.001K twice and 0.001K " +
      "twice, 4.12 px apart in 13 px-tall runs. Not recorded " +
      "anywhere before 11-1. Filed at 11-1 for triage at 11-3.",
  },
  {
    page: "12-coverage",
    view: 3,
    predicate: "runs-overlap",
    runs: ["hdml-label[4]#6", "hdml-label[4]#7"],
    engines: ALL_ENGINES,
    reason:
      "★ F4 — the symlog ladder emits DUPLICATE runs at the origin." +
      "12-coverage D's y axis prints -0.001K twice and 0.001K " +
      "twice, 4.12 px apart in 13 px-tall runs. Not recorded " +
      "anywhere before 11-1. Filed at 11-1 for triage at 11-3.",
  },
  {
    page: "12-coverage",
    view: 3,
    predicate: "runs-overlap",
    runs: ["hdml-label[4]#6", "hdml-label[4]#8"],
    engines: ALL_ENGINES,
    reason:
      "★ F4 — the symlog ladder emits DUPLICATE runs at the origin." +
      "12-coverage D's y axis prints -0.001K twice and 0.001K " +
      "twice, 4.12 px apart in 13 px-tall runs. Not recorded " +
      "anywhere before 11-1. Filed at 11-1 for triage at 11-3.",
  },
  {
    page: "12-coverage",
    view: 3,
    predicate: "runs-overlap",
    runs: ["hdml-label[4]#7", "hdml-label[4]#8"],
    engines: ALL_ENGINES,
    reason:
      "★ F4 — the symlog ladder emits DUPLICATE runs at the origin." +
      "12-coverage D's y axis prints -0.001K twice and 0.001K " +
      "twice, 4.12 px apart in 13 px-tall runs. Not recorded " +
      "anywhere before 11-1. Filed at 11-1 for triage at 11-3.",
  },
];

/* ---------------------------------------------------------------- */
/* The three predicates                                             */
/* ---------------------------------------------------------------- */

/** An axis-aligned extent in client coordinates. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** One rendered text run. */
interface Run {
  /** {@link runId}. */
  id: string;
  /** Its index among the view's `<g data-w>` groups. */
  group: number;
  /** Its rendered extent, as {@link inkBox} measures it. */
  rect: Box;
}

/** An extent nothing was painted into. */
function empty(r: Box): boolean {
  return r.right === r.left && r.bottom === r.top;
}

/**
 * ★ **A text run's extent, and why it is NOT
 * `getBoundingClientRect()`.**
 *
 * Step 11-1 measured all three engines on `08-pie-doughnut`'s
 * four-row legend, whose rows are pitched **14 px** apart at an
 * 11 px font:
 *
 * | engine | `getBoundingClientRect` | `getBBox` × CTM |
 * |---|---|---|
 * | chromium | 69 → 82 (13 px) | identical |
 * | webkit | 69 → 82 (13 px) | identical |
 * | firefox | 66.75 → 82.75 (**16 px**) | 67.75 → 81.75 (14 px) |
 *
 * Firefox inflates a text element's **client rect** by 1 px on
 * every side — 16 px tall where the ink is 14 — so four rows
 * pitched 14 apart overlap by 2 px there and by nothing on the
 * other two. Run against client rects, P2 reported **10 pairs on
 * chromium and webkit and 40 on firefox**, and the extra 30 were
 * entirely this inflation — every legend in the corpus
 * (`04` ×5 views, `06`, `08` ×4 views, `12` C). The ink box drops
 * the spread to **10 pairs on all three**, leaving one containment
 * that only firefox reports. A whole baseline scoped per engine is
 * a baseline that asserts almost nothing on two engines out of
 * three; one entry scoped per engine is a measured fact.
 *
 * `getBBox()` is the spec's *tight* geometry box and carries no
 * such inflation. It is returned in the element's **own user
 * space**, so it ignores the element's own `transform` — and
 * 10-1 paints rotation as exactly that — so it is composed with
 * `getScreenCTM()`, which includes it. Measured on
 * `11-multi-plane`'s 18 rotated runs: chromium's composed box is
 * **bit-identical** to its client rect, and firefox's is inset by
 * the same 1 px inflation rotated (≈ 1.41 px on each axis).
 *
 * What is left is the genuine three-engine fact: a font metric.
 * The same 11 px run inks 13 px tall on chromium and webkit and
 * 14 on firefox — 016 step 33's class of difference, which an
 * inequality absorbs and a tolerance would hide.
 *
 * @param el - An SVG `<text>`.
 * @returns Its ink extent in client coordinates.
 */
export function inkBox(el: SVGGraphicsElement): Box {
  const b = el.getBBox();
  const m = el.getScreenCTM();
  if (m === null) {
    return {
      left: b.x,
      top: b.y,
      right: b.x + b.width,
      bottom: b.y + b.height,
    };
  }
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of [
    [b.x, b.y],
    [b.x + b.width, b.y],
    [b.x, b.y + b.height],
    [b.x + b.width, b.y + b.height],
  ]) {
    xs.push(m.a * x + m.c * y + m.e);
    ys.push(m.b * x + m.d * y + m.f);
  }
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

/**
 * Every rendered text run in a view, in group-then-node order.
 *
 * The real renderer must be in place: the recording stub keeps a
 * `Scene` and paints nothing, so this returns `[]` against it — a
 * silent pass, which is what trap 5a is about.
 *
 * @param view - A mounted view.
 * @returns The runs.
 */
export function runsOf(view: HdmlViewElement): Run[] {
  const svg = view.shadowRoot?.querySelector("svg") ?? null;
  if (svg === null) {
    return [];
  }
  const out: Run[] = [];
  Array.from(svg.querySelectorAll("g[data-w]")).forEach((g, gi) => {
    const tag = g.getAttribute("data-tag") ?? "?";
    Array.from(g.querySelectorAll("text")).forEach((t, ti) => {
      out.push({
        id: runId(tag, gi, ti),
        group: gi,
        rect: inkBox(<SVGGraphicsElement>(<unknown>t)),
      });
    });
  });
  return out;
}

/**
 * **P1 — no text run escapes its view.**
 *
 * Asserted as four inequalities against the view's own border box,
 * generalising step 10-5's two fit tests from *the rotated runs on
 * two pages* to *every run on every view*. The two they asserted
 * (`bottom`, `left`) are the two a negative angle with an `end`
 * anchor throws a run past; the other two are free here.
 *
 * @param page - The page's basename.
 * @param index - The view's index.
 * @param view - The mounted view, with the real renderer in place.
 * @returns The violations, empty when every run fits.
 */
export function escapesView(
  page: string,
  index: number,
  view: HdmlViewElement,
): Violation[] {
  const box = view.getBoundingClientRect();
  return runsOf(view)
    .filter(
      (run) =>
        !empty(run.rect) &&
        (run.rect.left < box.left ||
          run.rect.right > box.right ||
          run.rect.top < box.top ||
          run.rect.bottom > box.bottom),
    )
    .map((run) => ({
      page,
      view: index,
      predicate: <Predicate>"escapes-view",
      runs: [run.id],
    }));
}

/** How widely {@link runsOverlap} looks for a pair. */
export type Scope =
  /** Within one `g[data-w]` — one guide's own ladder. */
  | "group"
  /** Across the whole view — two guides, or two widgets. */
  | "view";

/**
 * ★ **P2's scope, decided by counting at both** (step 11-1).
 *
 * Scoped to a group the predicate is true-by-intent — a crowded axis
 * is one guide's ladder overprinting itself. But `10-radar`'s known
 * live overprint is a **radius** label against a **category** label:
 * two guides, two widgets, so a group-scoped P2 cannot see it by
 * construction.
 *
 * **Both scopes were run over all 13 pages and 29 views and counted**
 * (step 11-1, all three engines):
 *
 * | scope | overlapping pairs |
 * |---|---|
 * | `group` | **7** — all `12-coverage` D's one `hdml-label` |
 * | `view` | **10** — those 7, plus 3 cross-widget |
 *
 * `view` wins on three counts. The three extra pairs are
 * `05-scatter` B's origin corner, `12-coverage` A's ramp legend
 * against its x axis, and `10-radar`'s overprint — so **the one
 * known live defect in this predicate's class is among them**, and
 * `group` cannot see it at any effort. On inspection **all three
 * are real defects**, which refutes the worry this choice was put
 * under: the wider scope's extra reach is signal, not noise. And it
 * grows the baseline from 7 entries to 10, still individually
 * argued — a scope whose baseline needed dozens would be the wrong
 * scope, and this one is nowhere near that.
 */
export const P2Scope: Scope = "view";

/** Rectangles intersect — touching edges do not count. */
function intersects(a: Box, b: Box): boolean {
  return (
    a.left < b.right &&
    b.left < a.right &&
    a.top < b.bottom &&
    b.top < a.bottom
  );
}

/**
 * **P2 — no two text runs overlap.**
 *
 * @param page - The page's basename.
 * @param index - The view's index.
 * @param view - The mounted view, with the real renderer in place.
 * @param scope - {@link P2Scope}, or the other one to compare.
 * @returns One violation per intersecting pair.
 */
export function runsOverlap(
  page: string,
  index: number,
  view: HdmlViewElement,
  scope: Scope = P2Scope,
): Violation[] {
  const runs = runsOf(view).filter((run) => !empty(run.rect));
  const out: Violation[] = [];
  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      if (scope === "group" && runs[i].group !== runs[j].group) {
        continue;
      }
      if (intersects(runs[i].rect, runs[j].rect)) {
        out.push({
          page,
          view: index,
          predicate: "runs-overlap",
          runs: [runs[i].id, runs[j].id],
        });
      }
    }
  }
  return out;
}

/**
 * **P3 — a view that declares marks paints marks.**
 *
 * 09-4's Finding 2 as a predicate: `07-mixed` once rendered with
 * **seven** painted nodes — two axes and a label set, no data — and
 * `render-live.mjs` called it clean, because its predicate was *the
 * view has at least one painted node*. `SceneGroup.role` makes the
 * distinction assertable without inferring it.
 *
 * The rule is conditional on purpose: a view may legitimately
 * declare no mark at all (a legend-only or guide-only view), and
 * such a view is not a failure here.
 *
 * @param page - The page's basename.
 * @param index - The view's index.
 * @param scene - The view's scene.
 * @returns One violation, or none.
 */
export function marksEmpty(
  page: string,
  index: number,
  scene: Scene,
): Violation[] {
  const marks = scene.groups.filter((g) => g.role === "mark");
  const painted = marks.reduce((n, g) => n + g.nodes.length, 0);
  return marks.length > 0 && painted === 0
    ? [{ page, view: index, predicate: "marks-empty", runs: [] }]
    : [];
}

/* ---------------------------------------------------------------- */
/* The gate                                                         */
/* ---------------------------------------------------------------- */

/**
 * Runs all three predicates over every view of one corpus page.
 *
 * Two passes, because the predicates read two different things:
 * the **scene** pass needs the recorder the caller's `setup()`
 * installed, and the **rendered** pass needs the real renderer, so
 * `restoreRenderers()` runs between them (trap 5a).
 *
 * ★ **The first page is left mounted, deliberately.**
 * `fixture()` appends its `parentNode` to `document.body` and
 * `fixtureCleanup` removes it again with `removeChild`, so
 * detaching the first root by hand makes **teardown** throw
 * `NotFoundError` on every page — measured, 13 of 13. The two
 * roots are stacked block boxes 800 px wide and neither predicate
 * ever compares across views, so the extra layout is inert.
 *
 * @param page - The page's basename, e.g. `"03-bar"`.
 * @param scope - {@link P2Scope}, or the other one to compare.
 * @returns Every violation, in page order.
 */
export async function collectInvariants(
  page: string,
  scope: Scope = P2Scope,
): Promise<Violation[]> {
  const out: Violation[] = [];

  const recorded = await mountCorpus(page);
  recorded.views.forEach((view, i) => {
    out.push(...marksEmpty(page, i, sceneOf(view)));
  });
  restoreRenderers();
  const drawn = await mountCorpus(page);
  drawn.views.forEach((view, i) => {
    out.push(...escapesView(page, i, view));
    out.push(...runsOverlap(page, i, view, scope));
  });

  return out;
}

/**
 * The gate: every violation on a page is either listed in
 * {@link ACCEPTED} or red, **and** every listed one still fires.
 *
 * The stale half is what stops the baseline rotting shut. A list
 * that only ever suppresses grows monotonically and stops meaning
 * anything; this one can only shrink, because fixing a defect makes
 * its entry fail until the entry is deleted.
 *
 * @param page - The page's basename, e.g. `"03-bar"`.
 */
export async function assertInvariants(page: string): Promise<void> {
  const found = await collectInvariants(page);
  const listed = ACCEPTED.filter(
    (a) => a.page === page && a.engines.includes(ENGINE),
  ).map(keyOf);
  const keys = found.map(keyOf);

  // An unlisted violation is a regression.
  assert.deepEqual(
    keys.filter((k) => !listed.includes(k)),
    [],
    `${page}: unaccepted geometry violation`,
  );
  // A listed one that stopped firing is a regression too.
  assert.deepEqual(
    listed.filter((k) => !keys.includes(k)),
    [],
    `${page}: stale ACCEPTED entry — delete it`,
  );
}
