/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert, fixture, html } from "@open-wc/testing";
import type { Scene, SceneGroup, SceneNode } from "../hdvl/scene";
import type { HdmlViewElement } from "../hdvl/view";
import { NARROW, VIEWPORT } from "./corpus";
import type { Engine } from "./corpus";
import {
  ACCEPTED,
  escapesView,
  gateDiff,
  inkBox,
  keyOf,
  marksEmpty,
  runsOverlap,
} from "./invariants";
import type { Accepted, Observed, Violation } from "./invariants";

// ★ THE NEGATIVE CONTROLS, COMMITTED (017 step 11-3).
//
// Steps 11-1 and 11-2 ran eight negative controls between them —
// each predicate undone from a `cp` snapshot of a corpus page, run,
// and restored. Every one of them proved what it had to prove and
// NOT ONE IS REPRODUCIBLE FROM THE TREE: a control that lives in a
// note is a control nobody runs again. This file is the half of
// that discipline that can be committed.
//
// ★ WHAT IT DELIBERATELY DOES NOT DO is mount a corpus page. Trap
// 9/10: `html/hdvl/` and `html/hdvl-live/` are byte twins that
// `check_dist` compares, and breaking one to prove a predicate
// fires is exactly the move the twins forbid. So the predicates run
// against a STUNT DOUBLE — a real shadow root with a real `<svg>`
// and real `<text>`, laid out by the real engine.
//
// ★ AND WHAT THAT STILL CANNOT COVER, stated rather than
// discovered: the stunt double never installs the recording
// renderer, so it cannot catch TRAP 5a — a predicate run against
// the stub, which draws nothing, passes by asserting over an empty
// `<svg>`. That failure mode makes the whole gate vacuous and is
// invisible here; it is covered by `collectInvariants` calling
// `restoreRenderers()` between its passes, and by the fact that the
// thirteen page gates report 104 violations rather than zero. A
// baseline that emptied itself all at once is the symptom, and
// `docs/development.md` § The geometry invariants says so.
//
// The measurements are INEQUALITIES with px of margin, never
// magnitudes: a run's ink is a font metric and differs on all three
// engines (016 step 33), which is the same reason `ACCEPTED` is
// keyed on identity.

/** The stunt view's box. Wide enough to place runs by hand. */
const VIEW_W = 240;

/** The stunt view's box. */
const VIEW_H = 120;

/** One `<text>` of a stunt group. */
interface StuntRun {
  /** User-space x, which is view-space x here. */
  x: number;
  /** User-space y — the alphabetic baseline. */
  y: number;
  /** The run's content. Empty paints nothing. */
  text: string;
  /** Degrees about the run's own anchor, for `inkBox`. */
  rotate?: number;
}

/** One `<g data-w>` of a stunt view. */
interface StuntGroup {
  /** What `runId` prints as the tag. */
  tag: string;
  /** Its `<text>` children, in order. */
  runs: readonly StuntRun[];
}

/**
 * A view-shaped host with a real `<svg>` in a real shadow root.
 *
 * `runsOf` reads `view.shadowRoot`'s first `<svg>` and every
 * `g[data-w]` under it; `escapesView` reads the host's own border
 * box. A `<div>` satisfies both, and the runs are laid out and
 * measured by the engine exactly as a corpus page's are.
 *
 * @param groups - The groups to paint.
 * @returns The host, typed as the predicates take it.
 */
async function stuntView(
  groups: readonly StuntGroup[],
): Promise<HdmlViewElement> {
  const host = await fixture<HTMLDivElement>(html`<div></div>`);
  host.style.position = "relative";
  host.style.width = `${VIEW_W}px`;
  host.style.height = `${VIEW_H}px`;

  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("width", `${VIEW_W}`);
  svg.setAttribute("height", `${VIEW_H}`);
  svg.setAttribute("viewBox", `0 0 ${VIEW_W} ${VIEW_H}`);
  // A stated font, so a run's ink is predictable enough to place
  // by hand on all three engines. The assertions still never read
  // a magnitude.
  svg.style.font = "11px sans-serif";

  groups.forEach((g) => {
    const node = document.createElementNS(NS, "g");
    node.setAttribute("data-w", "stunt");
    node.setAttribute("data-tag", g.tag);
    g.runs.forEach((r) => {
      const t = document.createElementNS(NS, "text");
      t.setAttribute("x", `${r.x}`);
      t.setAttribute("y", `${r.y}`);
      if (r.rotate !== undefined) {
        t.setAttribute(
          "transform",
          `rotate(${r.rotate} ${r.x} ${r.y})`,
        );
      }
      t.textContent = r.text;
      node.appendChild(t);
    });
    svg.appendChild(node);
  });

  const root = host.attachShadow({ mode: "open" });
  root.appendChild(svg);
  return <HdmlViewElement>(<unknown>host);
}

/** The keys a predicate reported, for a `deepEqual`. */
function keys(found: readonly Violation[]): string[] {
  return found.map(keyOf);
}

/* ---------------------------------------------------------------- */
/* The ink box — the input the whole gate turns on                  */
/* ---------------------------------------------------------------- */

suite("invariants: the ink box", () => {
  // 11-1's Finding 1: the predicates were right and their INPUT was
  // wrong. `getBoundingClientRect()` is inflated by 1 px per side on
  // firefox, which made P2 report 40 pairs there against 10
  // elsewhere. Asserted as an inequality that holds on all three
  // engines rather than as the per-engine numbers, which are exactly
  // the magnitudes a baseline must not carry.
  test("is contained by the client rect everywhere", async () => {
    const view = await stuntView([
      { tag: "hdml-label", runs: [{ x: 40, y: 60, text: "Wgy" }] },
    ]);
    const el = <SVGGraphicsElement>(
      (<unknown>view.shadowRoot?.querySelector("text"))
    );
    const ink = inkBox(el);
    const rect = el.getBoundingClientRect();

    assert.isAtLeast(ink.left, rect.left);
    assert.isAtLeast(ink.top, rect.top);
    assert.isAtMost(ink.right, rect.right);
    assert.isAtMost(ink.bottom, rect.bottom);
    assert.isAbove(ink.right, ink.left, "the run has ink");
  });

  test("is transform-aware, where getBBox is not", async () => {
    // 10-1 paints rotation as a `transform`, and `getBBox()` is in
    // the element's OWN user space, so it reports the unrotated box.
    // Composing with `getScreenCTM()` is what makes a -45deg run's
    // composed extent the 21.91 px that `11-multi-plane`'s baseline
    // arithmetic is built out of.
    const view = await stuntView([
      {
        tag: "hdml-label",
        runs: [{ x: 60, y: 60, text: "September", rotate: -45 }],
      },
    ]);
    const el = <SVGGraphicsElement>(
      (<unknown>view.shadowRoot?.querySelector("text"))
    );
    const bbox = el.getBBox();
    const ink = inkBox(el);

    assert.isAbove(
      ink.bottom - ink.top,
      bbox.height * 2,
      "a rotated wide run is taller than its own user-space box",
    );
    assert.isBelow(
      ink.right - ink.left,
      bbox.width,
      "and narrower than it",
    );
  });
});

/* ---------------------------------------------------------------- */
/* P1 — escapes-view                                                */
/* ---------------------------------------------------------------- */

suite("invariants: P1 escapes-view", () => {
  test("is silent on a run the view contains", async () => {
    const view = await stuntView([
      { tag: "hdml-label", runs: [{ x: 40, y: 60, text: "Jan" }] },
    ]);
    assert.deepEqual(keys(escapesView("stunt", 0, view)), []);
  });

  test("fires on a run past the right edge", async () => {
    const view = await stuntView([
      {
        tag: "hdml-label",
        runs: [{ x: VIEW_W - 6, y: 60, text: "September" }],
      },
    ]);
    assert.deepEqual(keys(escapesView("stunt", 0, view)), [
      "stunt/0/escapes-view/hdml-label[0]#0",
    ]);
  });

  test("fires on a run past the top edge", async () => {
    // The other two inequalities came free with the first pair
    // (10-5's fit tests asserted `bottom` and `left` only), so the
    // control has to reach one of them or they are decoration.
    const view = await stuntView([
      { tag: "hdml-label", runs: [{ x: 40, y: 2, text: "Jan" }] },
    ]);
    assert.deepEqual(keys(escapesView("stunt", 0, view)), [
      "stunt/0/escapes-view/hdml-label[0]#0",
    ]);
  });

  test("ignores a run with no ink, wherever it sits", async () => {
    // A guide emits a `<text>` per tick whether or not the tick has
    // a string; an empty one measures 0 x 0 at the origin and would
    // otherwise report on every view that has one.
    const view = await stuntView([
      { tag: "hdml-label", runs: [{ x: -400, y: -400, text: "" }] },
    ]);
    assert.deepEqual(keys(escapesView("stunt", 0, view)), []);
  });
});

/* ---------------------------------------------------------------- */
/* P2 — runs-overlap                                                */
/* ---------------------------------------------------------------- */

suite("invariants: P2 runs-overlap", () => {
  test("is silent on two runs with room between them", async () => {
    const view = await stuntView([
      {
        tag: "hdml-label",
        runs: [
          { x: 20, y: 30, text: "Jan" },
          { x: 20, y: 100, text: "Feb" },
        ],
      },
    ]);
    assert.deepEqual(keys(runsOverlap("stunt", 0, view)), []);
  });

  test("fires on a pair whose ink crosses", async () => {
    const view = await stuntView([
      {
        tag: "hdml-label",
        runs: [
          { x: 20, y: 60, text: "September" },
          { x: 30, y: 60, text: "September" },
        ],
      },
    ]);
    assert.deepEqual(keys(runsOverlap("stunt", 0, view)), [
      "stunt/0/runs-overlap/" + "hdml-label[0]#0 x hdml-label[0]#1",
    ]);
  });

  test("★ sees across widgets at `view`, not `group`", async () => {
    // P2Scope's whole argument, as a test. `10-radar`'s known live
    // overprint is a RADIUS label against a CATEGORY label — two
    // guides, two widgets — so a group-scoped P2 cannot see the one
    // known live defect in its own class at any effort.
    const view = await stuntView([
      { tag: "hdml-label", runs: [{ x: 20, y: 60, text: "Sept" }] },
      { tag: "hdml-legend", runs: [{ x: 26, y: 60, text: "Sept" }] },
    ]);
    assert.deepEqual(
      keys(runsOverlap("stunt", 0, view, "view")),
      [
        "stunt/0/runs-overlap/" +
          "hdml-label[0]#0 x hdml-legend[1]#0",
      ],
      "the cross-widget pair is reported at `view`",
    );
    assert.deepEqual(
      keys(runsOverlap("stunt", 0, view, "group")),
      [],
      "and invisible at `group`",
    );
  });
});

/* ---------------------------------------------------------------- */
/* P3 — marks-empty                                                 */
/* ---------------------------------------------------------------- */

/** A paint-bearing scene node, for a group that is not empty. */
const NODE: SceneNode = {
  k: "rect",
  i: 0,
  x: 0,
  y: 0,
  w: 1,
  h: 1,
  fill: "#000",
  stroke: null,
  strokeWidth: 0,
  dash: null,
};

/**
 * One scene group.
 *
 * @param role - Mark or guide.
 * @param nodes - How many drawables it painted.
 * @returns The group.
 */
function group(role: "mark" | "guide", nodes: number): SceneGroup {
  return {
    widget: `w-${role}`,
    tag: role === "mark" ? "hdml-bar" : "hdml-axis",
    role,
    box: { x: 0, y: 0, w: VIEW_W, h: VIEW_H },
    opacity: 1,
    filter: "none",
    visibility: "visible",
    clip: false,
    clipPath: null,
    nodes: Array<SceneNode>(nodes).fill(NODE),
  };
}

/**
 * A scene of the given groups.
 *
 * @param groups - Its groups, in paint order.
 * @returns The scene.
 */
function scene(groups: readonly SceneGroup[]): Scene {
  return { width: VIEW_W, height: VIEW_H, groups };
}

suite("invariants: P3 marks-empty", () => {
  test("fires on a view that declares marks and paints none", () => {
    // 09-4's Finding 2: `07-mixed` once rendered with seven painted
    // nodes — two axes and a label set, no data — and the live
    // instrument called it clean.
    assert.deepEqual(
      keys(
        marksEmpty(
          "stunt",
          0,
          scene([group("guide", 7), group("mark", 0)]),
        ),
      ),
      ["stunt/0/marks-empty/"],
    );
  });

  test("is silent on a view whose marks painted", () => {
    assert.deepEqual(
      keys(
        marksEmpty(
          "stunt",
          0,
          scene([group("guide", 7), group("mark", 3)]),
        ),
      ),
      [],
    );
  });

  test("★ is silent on a view that declares no mark at all", () => {
    // The rule is conditional on purpose — a legend-only or
    // guide-only view is not a failure — and a predicate that
    // blanketed every view would report on the corpus's own.
    assert.deepEqual(
      keys(marksEmpty("stunt", 0, scene([group("guide", 7)]))),
      [],
    );
  });
});

/* ---------------------------------------------------------------- */
/* The gate — both halves, which is what makes it a gate            */
/* ---------------------------------------------------------------- */

const ALL: readonly Engine[] = ["chromium", "firefox", "webkit"];

/**
 * One observed violation, at a width.
 *
 * @param width - The layout width it was seen at.
 * @param run - The run's id.
 * @returns The observation.
 */
function seen(width: number, run: string): Observed {
  return {
    page: "stunt",
    view: 0,
    predicate: "escapes-view",
    runs: [run],
    width,
  };
}

/**
 * One baseline entry for the same violation.
 *
 * @param widths - Which widths report it.
 * @param run - The run's id.
 * @param engines - Which engines report it.
 * @returns The entry.
 */
function listed(
  widths: readonly number[],
  run: string,
  engines: readonly Engine[] = ALL,
): Accepted {
  return {
    page: "stunt",
    view: 0,
    predicate: "escapes-view",
    runs: [run],
    engines,
    widths,
    reason: "a fixture",
  };
}

const KEY = "stunt/0/escapes-view/hdml-label[0]#0";
const BOTH: readonly number[] = [VIEWPORT, NARROW];

suite("invariants: the gate", () => {
  test("reports an unlisted violation as unaccepted", () => {
    const [wide] = gateDiff(
      "stunt",
      [seen(VIEWPORT, "hdml-label[0]#0")],
      [],
      "chromium",
      [VIEWPORT],
    );
    assert.deepEqual([...wide.unaccepted], [KEY]);
    assert.deepEqual([...wide.stale], []);
  });

  test("★ reports a listed violation that stopped firing", () => {
    // The half that makes `ACCEPTED` a gate rather than a log: it
    // can only shrink. 11-1's control 4 proved this once, from a
    // snapshot, and left nothing behind.
    const [wide] = gateDiff(
      "stunt",
      [],
      [listed([VIEWPORT], "hdml-label[0]#0")],
      "chromium",
      [VIEWPORT],
    );
    assert.deepEqual([...wide.unaccepted], []);
    assert.deepEqual([...wide.stale], [KEY]);
  });

  test("is silent when a listed violation still fires", () => {
    const [wide] = gateDiff(
      "stunt",
      [seen(VIEWPORT, "hdml-label[0]#0")],
      [listed([VIEWPORT], "hdml-label[0]#0")],
      "chromium",
      [VIEWPORT],
    );
    assert.deepEqual([...wide.unaccepted], []);
    assert.deepEqual([...wide.stale], []);
  });

  test("★ does not credit an entry scoped to another engine", () => {
    // `00-minimal`'s firefox-only escape is the measured case. An
    // entry that covered every engine would red on the two that do
    // not report it; one that is ignored on this engine leaves the
    // violation unaccepted, which is the correct reading.
    const [wide] = gateDiff(
      "stunt",
      [seen(VIEWPORT, "hdml-label[0]#0")],
      [listed([VIEWPORT], "hdml-label[0]#0", ["firefox"])],
      "chromium",
      [VIEWPORT],
    );
    assert.deepEqual([...wide.unaccepted], [KEY]);
    assert.deepEqual(
      [...wide.stale],
      [],
      "and is not demanded here either",
    );
  });

  test("★ compares the two widths independently", () => {
    // 11-2's control 2, committed. An entry claimed at BOTH widths
    // that fires at only one reds at the other, naming the key —
    // and under the union-in-one-pass alternative this run is
    // green, which is the whole argument for the `widths` field.
    const [wide, narrow] = gateDiff(
      "stunt",
      [seen(NARROW, "hdml-label[0]#0")],
      [listed(BOTH, "hdml-label[0]#0")],
      "chromium",
      BOTH,
    );
    assert.equal(wide.width, VIEWPORT);
    assert.deepEqual([...wide.unaccepted], []);
    assert.deepEqual(
      [...wide.stale],
      [KEY],
      "claimed at 800 and absent there",
    );
    assert.equal(narrow.width, NARROW);
    assert.deepEqual([...narrow.unaccepted], []);
    assert.deepEqual(
      [...narrow.stale],
      [],
      "and present at 400, as claimed",
    );
  });

  test("★ a narrow-only entry is not owed at the wide width", () => {
    // The inverse, and the shape 90 of the 104 entries have.
    const [wide, narrow] = gateDiff(
      "stunt",
      [seen(NARROW, "hdml-label[0]#0")],
      [listed([NARROW], "hdml-label[0]#0")],
      "chromium",
      BOTH,
    );
    assert.deepEqual([...wide.unaccepted], []);
    assert.deepEqual([...wide.stale], []);
    assert.deepEqual([...narrow.unaccepted], []);
    assert.deepEqual([...narrow.stale], []);
  });

  test("★ every baseline entry cites a decision", () => {
    // `recorded is not blessed`. Six families were filed by 11-1
    // and 11-2 deferring to step 11-3's triage; 11-3 put them to
    // the founder and every one came back. An entry that still
    // defers to a step that has happened is the mechanism failing,
    // so it is asserted rather than remembered.
    const deferring = ACCEPTED.filter((a) =>
      /triage at 11-3/.test(a.reason),
    );
    assert.deepEqual(
      deferring.map(keyOf),
      [],
      "no entry defers to a step that has happened",
    );
    const unargued = ACCEPTED.filter(
      (a) => !/IGNORE|ROUTED TO|founder|decision/.test(a.reason),
    );
    assert.deepEqual(
      unargued.map(keyOf),
      [],
      "every entry names a decision",
    );
  });
});
