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
import { ENGINE, NARROW, VIEWPORT, mountCorpus } from "./corpus";
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

/**
 * ★ **The two layout box widths the gate runs at** (017 O7, step
 * 11-2).
 *
 * `VIEWPORT` is the width every page is sized by its own
 * `max-width` at; `NARROW` is the width none of them is — see
 * {@link NARROW} for the derivation. O7's point is that a gate
 * running at one width never exercises responsive behaviour at all,
 * and narrowing is the half of O7 017 takes.
 *
 * Wide first, so a failure message reads in the order a reader
 * expects and the wide half — the one every golden shares — reds
 * before the new one.
 */
export const WIDTHS: readonly number[] = [VIEWPORT, NARROW];

/** Both widths, for an entry that fires at either. */
const ALL_WIDTHS: readonly number[] = WIDTHS;

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
   * ★ **Which layout widths report it — and why the key does not
   * carry the width instead** (step 11-2).
   *
   * {@link keyOf} is `page/view/predicate/runs` and carries no
   * width, so a violation firing at both widths is **one** entry and
   * a violation firing at only one is **still one entry the other
   * width does not produce** — which the *stale* half of
   * {@link assertInvariants} would red at that other width. Two
   * answers were open: widen the key, or collect the union across
   * widths in a single pass.
   *
   * **The union was rejected.** It makes a violation that stops
   * firing at one width invisible — a defect fixed at 400 and still
   * live at 800 would leave the entry firing, so the gate would stay
   * green on a half-fix. That is precisely the rot the stale half
   * exists to prevent, so the union buys brevity by disabling the
   * mechanism.
   *
   * This field is the same move {@link Accepted.engines} makes, at
   * the same seam and for the same reason: **where** a violation is
   * reported is a declared property of the entry, argued once, not a
   * silent property of the gate.
   */
  widths: readonly number[];
  /**
   * Why it is accepted, naming the decision — a founder `IGNORE`
   * from `001. Requirements.md` § *Findings triaged 2026-09-26*, or
   * a finding filed to a later step. An entry with no reason is the
   * mechanism failing.
   */
  reason: string;
}

/** The narrow width alone — a violation the harness box creates. */
const NARROW_ONLY: readonly number[] = [NARROW];

/**
 * The adjacent index pairs of one ladder, `except` those whose lower
 * index is listed.
 *
 * A crowded ladder's violations are *every consecutive pair*, so
 * spelling 20 of them out is transcription rather than argument. The
 * derivation is safe because the **stale** half of
 * {@link assertInvariants} verifies it: a pair generated here that
 * does not actually fire reds the page.
 *
 * @param first - The first run's index.
 * @param last - The last run's index.
 * @param except - Lower indices to omit.
 * @returns `[first, first + 1] … [last - 1, last]`.
 */
function adjacent(
  first: number,
  last: number,
  except: readonly number[] = [],
): [number, number][] {
  const out: [number, number][] = [];
  for (let i = first; i < last; i++) {
    if (!except.includes(i)) {
      out.push([i, i + 1]);
    }
  }
  return out;
}

/**
 * ★ **One `runs-overlap` entry per pair of a crowded ladder.**
 *
 * The narrow width's baseline is **90 entries where the wide one
 * needed 14**, and all but one of them belong to four families of a
 * single ladder each. Copying one argument 20 times — which is what
 * the wide baseline's seven symlog entries already do — would bury
 * it, so each family states its mechanism **once** and enumerates
 * its pairs. The entries produced are ordinary {@link Accepted}
 * records: nothing about the gate changes.
 *
 * @param page - The page's basename.
 * @param view - The view's index.
 * @param group - The group, as {@link runId} prints it without `#`.
 * @param pairs - The colliding run indices.
 * @param engines - Which engines report them.
 * @param widths - Which widths report them.
 * @param reason - The family's argument.
 * @returns One entry per pair.
 */
function ladder(
  page: string,
  view: number,
  group: string,
  pairs: readonly (readonly [number, number])[],
  engines: readonly Engine[],
  widths: readonly number[],
  reason: string,
): Accepted[] {
  return pairs.map(([a, b]) => ({
    page,
    view,
    predicate: <Predicate>"runs-overlap",
    runs: [`${group}#${a}`, `${group}#${b}`],
    engines,
    widths,
    reason,
  }));
}

/** 02-area A — an axis that never thins. */
const R02 =
  "★ 11-2 — THE LADDER DOES NOT THIN WITH THE WIDTH. 02-area A's " +
  "x axis declares no count, and the datetime scale emits the same " +
  "21 runs at 400 px as at 800: the ink stays 17.98 px while the " +
  "pitch falls 30.78 -> 14.09, so every adjacent pair collides. " +
  "Filed at 11-2 for triage at 11-3.";

/** 04-grouped-stacked — 184 of 400 px spent on chrome. */
const R04 =
  "★ 11-2 — 04 SPENDS 184 OF ITS 400 px ON CHROME. The plane's " +
  "padding is 16px 120px 40px 64px (the 120 reserves the legend's " +
  "left:100% column), leaving a 216 px plot for 12 month bands: " +
  "pitch 46.04 -> 15.40 against a 17.98 px run, so every adjacent " +
  "pair but Jun x Jul collides. Filed at 11-2 for triage at 11-3.";

/** 04-grouped-stacked E — the same ladder, 1.07 px wider. */
const R04E =
  "★ 11-2 — the same crowding as 04's other four views, at a " +
  "16.47 px pitch rather than 15.40 because this view's plot is " +
  "5.9 px wider. That 1.07 px is exactly what lets Jun x Jul clear " +
  "here on all three engines. Filed at 11-2 for triage at 11-3.";

/** 04-grouped-stacked — the pair that sits on the boundary. */
const R04J =
  "★ 11-2 — Jun x Jul, THE PAIR ON THE BOUNDARY. At a 15.40 px " +
  "pitch the two narrowest month runs clear on firefox and webkit " +
  "and cross on chromium — 016 step 33's font-metric class, and " +
  "the second measured use of `engines` after 00-minimal's. Filed " +
  "at 11-2 for triage at 11-3.";

/** 11-multi-plane A — a third of 400 px is 133. */
const R11 =
  "★ 11-2 — A 33.333% PANEL AT 400 px IS 133 px WIDE, and 56 of " +
  "them are the panel's own padding. Six -45deg month runs whose " +
  "composed ink box is 21.91 px sit at a 12.26 px pitch (34.10 at " +
  "800), so every adjacent pair collides and no next-but-one does " +
  "(2 x 12.26 > 21.91). All three panels, identically. Filed at " +
  "11-2 for triage at 11-3.";

/** 10-radar — a category run that does not shrink with its ring. */
const R10 =
  "★ 11-2 — A POLAR CATEGORY RUN DOES NOT SHRINK WITH ITS RING. " +
  "The view narrows 520 -> 400 so the ring's right edge moves 60 " +
  "px left, but the 43.62 px category run beside it keeps its ink " +
  "and now inks past the view's right edge. The escape half of the " +
  "class the overprint above is the overlap half of. Filed at 11-2 " +
  "for triage at 11-3.";

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
 * ★ **Step 11-2 added {@link NARROW}, and the baseline went 14 →
 * 104.** All fourteen of the above survive the narrowing unchanged
 * (`widths: ALL_WIDTHS`) — every one of them is anchored to a plot
 * edge or runs vertically, and neither moves when the box does. The
 * **ninety** new ones are narrow-only, and they are **four crowded
 * ladders plus one escape**, not ninety findings:
 *
 * | family | n | what it is |
 * |---|---|---|
 * | `02-area` A | 20 | 21 runs at both widths — no `count` |
 * | `04-grouped-stacked` ×5 | 54 | 184 px of 400 is chrome |
 * | `11-multi-plane` A | 15 | a 33.333 % panel is 133 px wide |
 * | `10-radar` | 1 | a run that does not shrink with its ring |
 *
 * ★ **They are responsive defects in the PAGES, and the runtime is
 * not implicated in any of them** — which is what the second
 * viewport was added to find out. Whether a chart *should* thin its
 * own ladder when the room runs out is a runtime question the
 * corpus cannot answer, and it is filed for 11-3's triage with the
 * other three.
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
    widths: ALL_WIDTHS,
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
    widths: ALL_WIDTHS,
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
    widths: ALL_WIDTHS,
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
    widths: ALL_WIDTHS,
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
    widths: ALL_WIDTHS,
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
    widths: ALL_WIDTHS,
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
    widths: ALL_WIDTHS,
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
    widths: ALL_WIDTHS,
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
    widths: ALL_WIDTHS,
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
    widths: ALL_WIDTHS,
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
    widths: ALL_WIDTHS,
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
    widths: ALL_WIDTHS,
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
    widths: ALL_WIDTHS,
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
    widths: ALL_WIDTHS,
    reason:
      "★ F4 — the symlog ladder emits DUPLICATE runs at the origin." +
      "12-coverage D's y axis prints -0.001K twice and 0.001K " +
      "twice, 4.12 px apart in 13 px-tall runs. Not recorded " +
      "anywhere before 11-1. Filed at 11-1 for triage at 11-3.",
  },

  /* ---- NARROW-only, step 11-2 — 90 entries, five families ---- */

  ...ladder(
    "02-area",
    0,
    "hdml-label[2]",
    adjacent(0, 20),
    ALL_ENGINES,
    NARROW_ONLY,
    R02,
  ),
  ...[0, 1, 2, 4].flatMap((view) =>
    ladder(
      "04-grouped-stacked",
      view,
      "hdml-label[2]",
      adjacent(0, 11, [5]),
      ALL_ENGINES,
      NARROW_ONLY,
      R04,
    ),
  ),
  ...[0, 1, 2, 4].flatMap((view) =>
    ladder(
      "04-grouped-stacked",
      view,
      "hdml-label[2]",
      [[5, 6]],
      ["chromium"],
      NARROW_ONLY,
      R04J,
    ),
  ),
  ...ladder(
    "04-grouped-stacked",
    3,
    "hdml-label[2]",
    adjacent(0, 11, [5]),
    ALL_ENGINES,
    NARROW_ONLY,
    R04E,
  ),
  ...[2, 6, 9].flatMap((group) =>
    ladder(
      "11-multi-plane",
      0,
      `hdml-label[${group}]`,
      adjacent(0, 5),
      ALL_ENGINES,
      NARROW_ONLY,
      R11,
    ),
  ),
  {
    page: "10-radar",
    view: 0,
    predicate: "escapes-view",
    runs: ["hdml-label[2]#1"],
    engines: ALL_ENGINES,
    widths: NARROW_ONLY,
    reason: R10,
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
 * A violation, plus **the layout width it was observed at**.
 *
 * The width is deliberately not part of {@link keyOf} — see
 * {@link Accepted.widths}. It travels beside the key so
 * {@link assertInvariants} can compare per width without a second
 * identity scheme.
 */
export interface Observed extends Violation {
  /** The layout box width, in CSS px. */
  width: number;
}

/**
 * Runs all three predicates over every view of one corpus page, at
 * every width in {@link WIDTHS}.
 *
 * Two passes, because the predicates read two different things:
 * the **scene** pass needs the recorder the caller's `setup()`
 * installed, and the **rendered** pass needs the real renderer, so
 * `restoreRenderers()` runs between them (trap 5a).
 *
 * ★ **The widths loop is inside each pass, not around them** — and
 * that is forced, not stylistic. `restoreRenderers()` is **one-way**
 * within a test: it drops every recorder, so a second whole-gate
 * call would throw *"sceneOf: no recorder"* on its scene pass. This
 * is trap 5a's third bite (it took the kernel at 11-1 and the
 * instrumentation right after), so the order is: **every** scene
 * mount, then the restore, then **every** rendered mount.
 *
 * ★ **Every mount is left attached, deliberately.**
 * `fixture()` appends its `parentNode` to `document.body` and
 * `fixtureCleanup` removes it again with `removeChild`, so
 * detaching a root by hand makes **teardown** throw `NotFoundError`
 * on every page — measured at 11-1, 13 of 13. The roots are stacked
 * block boxes of explicit width and neither predicate ever compares
 * across views, so the extra layout is inert; at two widths there
 * are four of them rather than two.
 *
 * @param page - The page's basename, e.g. `"03-bar"`.
 * @param scope - {@link P2Scope}, or the other one to compare.
 * @param widths - {@link WIDTHS}, or a subset to measure one.
 * @returns Every violation, width-tagged, in width-then-page order.
 */
export async function collectInvariants(
  page: string,
  scope: Scope = P2Scope,
  widths: readonly number[] = WIDTHS,
): Promise<Observed[]> {
  const out: Observed[] = [];
  const at =
    (width: number) =>
    (v: Violation): Observed => ({ ...v, width });

  for (const width of widths) {
    const recorded = await mountCorpus(page, width);
    recorded.views.forEach((view, i) => {
      out.push(...marksEmpty(page, i, sceneOf(view)).map(at(width)));
    });
  }
  restoreRenderers();
  for (const width of widths) {
    const drawn = await mountCorpus(page, width);
    drawn.views.forEach((view, i) => {
      out.push(...escapesView(page, i, view).map(at(width)));
      out.push(...runsOverlap(page, i, view, scope).map(at(width)));
    });
  }

  return out;
}

/**
 * The gate: **at each width independently**, every violation on a
 * page is either listed in {@link ACCEPTED} for that width or red,
 * **and** every listed one still fires there.
 *
 * The stale half is what stops the baseline rotting shut. A list
 * that only ever suppresses grows monotonically and stops meaning
 * anything; this one can only shrink, because fixing a defect makes
 * its entry fail until the entry is deleted — and per width, so
 * fixing it at one width and not the other is reported rather than
 * absorbed.
 *
 * @param page - The page's basename, e.g. `"03-bar"`.
 */
export async function assertInvariants(page: string): Promise<void> {
  const found = await collectInvariants(page);

  for (const width of WIDTHS) {
    const listed = ACCEPTED.filter(
      (a) =>
        a.page === page &&
        a.engines.includes(ENGINE) &&
        a.widths.includes(width),
    ).map(keyOf);
    const keys = found
      .filter((v) => v.width === width)
      .map((v) => keyOf(v));

    // An unlisted violation is a regression.
    assert.deepEqual(
      keys.filter((k) => !listed.includes(k)),
      [],
      `${page} @${width}px: unaccepted geometry violation`,
    );
    // A listed one that stopped firing is a regression too.
    assert.deepEqual(
      listed.filter((k) => !keys.includes(k)),
      [],
      `${page} @${width}px: stale ACCEPTED entry — delete it`,
    );
  }
}
