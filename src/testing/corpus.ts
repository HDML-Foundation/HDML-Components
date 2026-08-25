/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The corpus gate's shared harness (RFC 016/001 §10.1–§10.4).
 *
 * Steps 25, 28, 30, 32 and 33 all mount pages out of
 * [`html/hdvl/`](../../html/hdvl/) and assert scenes against them, so
 * the five decisions below are taken **once**, here, rather than five
 * times in five suites.
 *
 * **1. A page is fetched, never inlined.** `html/hdvl/*.html` are
 * byte copies of the project folder's originals — `cmp` proves it,
 * and `CLAUDE.md` says a fix must land in both. Inlining a page's
 * markup into a `.test.ts` would make a **third** copy that no `cmp`
 * covers, and the gate would then assert against markup nobody
 * ships. Fetching costs a dependency on the test runner serving
 * `rootDir: "."` statically; that failure mode is loud (a 404 throws
 * here, naming the URL) where a drifted inline copy is silent.
 *
 * **2. The page's own provider element is removed before anything
 * mounts.** Eight of the eleven gated pages declare an `hdml-io`
 * against `hdio.example.com`, a host that does not exist.
 * (`00-minimal`, `02-area` and `12-coverage` are the literal-only
 * conformance class and declare none, which the gate asserts rather
 * than assumes.) Its `connectedCallback` creates an endpoint and
 * immediately posts props + HTML, which redeems the handoff token
 * and uploads the document — so leaving it in place is a network
 * call, a Worker and `@hdml/parser` on every corpus test. Worse, a
 * page's own provider is *also* a D8 provider: `subscribe.ts`
 * de-dupes requests by `id`, not by provider, so it and
 * {@link FakeIo} would **both** receive every
 * request and both call `deliver`, and a transport error racing
 * canned data by generation stamp would blank pages
 * non-deterministically. RFC §10.3 settles it — the pages are driven
 * by `FakeIo`, which replaces the real element outright.
 * {@link mountCorpus} reports how many it removed, so a page that
 * gains or loses one is a test failure rather than a silent change
 * of what the gate proves.
 *
 * **3. The page's `<style>` is adopted, not rewritten.** Each page's
 * head sheet is injected verbatim into `document.head` before the
 * fixture mounts (so the first MEASURE already sees final geometry)
 * and removed at teardown. The selectors are bare tag names by
 * design — they are what SPEC §7 makes placement out of — so they
 * must reach the light-DOM elements exactly as they do on the served
 * page.
 *
 * **4. The layout viewport is pinned, not inherited.** Ten of the
 * eleven pages size their view with `width: 100%` under a `figure`
 * with its own `max-width`, so on the served page the geometry is the
 * window's. The test runner's window is **not** a corpus fact — it
 * is a Playwright default a runner upgrade may change, and every
 * number in every golden would move with it. {@link mountCorpus}
 * therefore lays each page out in a fixed {@link VIEWPORT}-wide box.
 * `800` is chosen so that **every** page's own `max-width` binds
 * (760, 760, 760, 760, 720, 780, 480, 480, 520 and 480) and none is
 * capped by the harness: each page keeps the dimensions its author
 * gave it, which is the opposite of retuning them. The road not
 * taken — inheriting the
 * runner's window — was measured at 800 px here, giving a 736 px
 * figure and silently overriding all five declared max-widths.
 *
 * **5. `text` is scoped, geometry is not.** A rendered `Intl` string
 * is ICU data and differs by engine (plan rule 4), so a whole-scene
 * golden cannot be a three-engine `deepEqual` as written.
 * {@link stripText} blanks every `text` field, leaving the
 * *positions* — which are arithmetic — asserted everywhere, and the
 * string half is asserted on chromium alone behind {@link ENGINE},
 * whose classification is asserted on all three so an
 * engine-detection change cannot make the scoped half silently
 * assert nothing.
 *
 * @module testing/corpus
 */

import { LitElement } from "lit";
import { assert, fixture } from "@open-wc/testing";
import type { Scene, SceneGroup, SceneNode } from "../hdvl/scene";
import type { HdmlViewElement } from "../hdvl/view";
import type { FakeColumn, FakeResult } from "./FakeIo";
import { HDVL_TAG_NAMES } from "../hdvl/vocabulary";
import { diagnosticsOf } from "../hdvl/validate";
import { sceneOf } from "./scene-of";

/** Rule 3's quantization, as the options object every gate uses. */
export const P = { precision: 6 };

/**
 * The width of the box every corpus page is laid out in, CSS px.
 *
 * Wider than every page's own `figure` `max-width`, so each page is
 * sized by its own declaration and never by the harness. See decision
 * 4 above for why it is pinned rather than inherited.
 */
export const VIEWPORT = 800;

/* ---------------------------------------------------------------- */
/* Engine classification — the declared guard, asserted             */
/* ---------------------------------------------------------------- */

/** The three engines the suite runs on, plus the failure value. */
export type Engine =
  | "chromium"
  | "firefox"
  | "webkit"
  | "unclassified";

/**
 * Which engine this run is on.
 *
 * Firefox first, because its UA names neither of the other two;
 * chromium before webkit, because a chromium UA also carries
 * `AppleWebKit`.
 *
 * @param ua - A user-agent string.
 * @returns The engine it names.
 */
export function engineOf(ua: string): Engine {
  if (/Firefox/.test(ua)) return "firefox";
  if (/Chrome|Chromium|Edg\//.test(ua)) return "chromium";
  if (/AppleWebKit/.test(ua)) return "webkit";
  return "unclassified";
}

/** The engine this run is on. */
export const ENGINE: Engine = engineOf(navigator.userAgent);

/* ---------------------------------------------------------------- */
/* Fetching and mounting a committed page                           */
/* ---------------------------------------------------------------- */

/** `page name → source text`, so a page is fetched once per run. */
const sources = new Map<string, string>();

/** The `<style>` elements this module put in the head. */
const injected: HTMLStyleElement[] = [];

/**
 * The committed source of one corpus page, verbatim.
 *
 * @param name - The basename, e.g. `"00-minimal"`.
 * @returns The page's HTML text.
 * @throws If the runner does not serve it — a broken harness rather
 * than a failed assertion, so it must not read as a quiet skip.
 */
export async function pageSource(name: string): Promise<string> {
  const cached = sources.get(name);
  if (cached !== undefined) {
    return cached;
  }
  const url = `/html/hdvl/${name}.html`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `corpus: ${url} is not served (${res.status}) — the gate ` +
        "reads the committed page, it does not inline it",
    );
  }
  const text = await res.text();
  if (text.trim() === "") {
    throw new Error(`corpus: ${url} is empty`);
  }
  sources.set(name, text);
  return text;
}

/** One mounted corpus page. */
export interface CorpusPage {
  /** The page's basename. */
  name: string;
  /** The fixture wrapper the page body was mounted into. */
  root: HTMLElement;
  /** Every `hdml-view` in the page, in document order. */
  views: HdmlViewElement[];
  /** How many `<hdml-io>` elements were removed before mounting. */
  removedIo: number;
  /** How many `<style>` elements the page's head carried. */
  sheets: number;
}

/** Resolves once every Lit element under `root` has updated. */
async function settle(root: Element): Promise<void> {
  const all = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const el of all) {
    if (el instanceof LitElement) {
      await el.updateComplete;
    }
  }
}

/** One animation frame. */
function tick(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

/**
 * Waits until every view on the page has stopped scheduling frames.
 *
 * A corpus page settles later than a reduced fixture: a delivery
 * arrives on a microtask, invalidates, and the next frame re-measures
 * — so the loop watches **all** the page's views and needs three
 * consecutive quiet frames across the set.
 *
 * @param views - The page's views.
 */
export async function quiesce(
  views: readonly HdmlViewElement[],
): Promise<void> {
  let last = "";
  let still = 0;
  for (let i = 0; i < 90 && still < 3; i++) {
    await tick();
    const now = views.map((v) => v.framesRun).join(",");
    const busy = views.some((v) => v.dirty);
    if (now === last && !busy) {
      still++;
    } else {
      still = 0;
      last = now;
    }
  }
}

/**
 * Fetches a committed corpus page, adopts its head sheet, removes its
 * `<hdml-io>`, mounts its body and waits for every view to settle.
 *
 * Mount any {@link FakeIo} **before** calling this: the providers
 * announce ready at mount and a consumer subscribing afterwards is
 * replayed, but announcing into an already-mounted page is the
 * late-join path rather than the handshake the served page takes.
 *
 * @param name - The basename, e.g. `"03-bar"`.
 * @returns The mounted page.
 */
export async function mountCorpus(name: string): Promise<CorpusPage> {
  const text = await pageSource(name);
  const doc = new DOMParser().parseFromString(text, "text/html");

  const ios = Array.from(doc.body.querySelectorAll("hdml-io"));
  ios.forEach((el) => el.remove());

  const styles = Array.from(doc.head.querySelectorAll("style"));
  for (const style of styles) {
    const live = document.createElement("style");
    live.textContent = style.textContent;
    document.head.appendChild(live);
    injected.push(live);
  }

  const root = document.createElement("div");
  root.style.width = `${VIEWPORT}px`;
  await fixture(doc.body.innerHTML, { parentNode: root });
  const views: HdmlViewElement[] = Array.from(
    root.querySelectorAll<HdmlViewElement>(HDVL_TAG_NAMES.VIEW),
  );
  // The gate's own no-network claim, asserted rather than trusted:
  // whatever the page declared, nothing that could reach a server is
  // in the document by the time a frame runs.
  assert.isNull(root.querySelector("hdml-io"));
  await settle(root);
  views.forEach((v) => v.markDirty());
  await quiesce(views);
  return {
    name,
    root,
    views,
    removedIo: ios.length,
    sheets: styles.length,
  };
}

// The page sheets are the harness's own document mutation, so the
// harness removes them. Registered at import, once per test page —
// `mountFakeIo`'s teardown note applies verbatim: a hook added from
// inside a running test attaches to whichever suite is executing.
teardown(() => {
  while (injected.length > 0) {
    injected.pop()?.remove();
  }
});

/* ---------------------------------------------------------------- */
/* Canned columns — RFC §10.3's "no invented documents"             */
/* ---------------------------------------------------------------- */

/**
 * A numeric column carrying **both** halves: a `BufferRef` over a
 * `Float64Array` for the `raw: true` mark bindings and an `extent`
 * domain for the `raw: false` scale ones. One corpus column serves
 * both, exactly as a real frame's does.
 *
 * @param values - The rows.
 * @param kind - `number` (default) or `timestamp`, in epoch ms.
 * @returns The canned column.
 */
export function numberCol(
  values: readonly number[],
  kind: "number" | "timestamp" = "number",
): FakeColumn {
  const cells = Float64Array.from(values);
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return {
    values: {
      buffer: cells.buffer,
      byteOffset: cells.byteOffset,
      byteLength: cells.byteLength,
    },
    nulls: undefined,
    domain: { kind: "extent", value: [lo, hi] },
    type:
      kind === "timestamp"
        ? { kind: "timestamp", unit: "ms" }
        : { kind: "number" },
  };
}

/**
 * A string column — values verbatim, domain the insertion-ordered
 * distinct list, exactly as `domainFor` computes it.
 *
 * @param values - The rows.
 * @returns The canned column.
 */
export function stringCol(values: readonly string[]): FakeColumn {
  const seen: string[] = [];
  for (const v of values) {
    if (!seen.includes(v)) {
      seen.push(v);
    }
  }
  return {
    values: [...values],
    nulls: undefined,
    domain: { kind: "ordinal", value: seen },
    type: { kind: "string" },
  };
}

/**
 * One ref's canned result at generation 1 — the corpus never
 * supersedes, so every gate has exactly one generation to adopt.
 *
 * @param rows - The row count the delivery reports (§8.3's V5 counts
 *   against this, never against a values length).
 * @param columns - The columns, keyed by the name the page binds.
 * @returns The canned result.
 */
export function result(
  rows: number,
  columns: Record<string, FakeColumn>,
): FakeResult {
  return { generation: 1, rows, columns };
}

/* ---------------------------------------------------------------- */
/* The gate                                                         */
/* ---------------------------------------------------------------- */

/**
 * *"A page renders"*, operationalised — the step plan's own
 * definition, verbatim.
 *
 * The four clauses are independent facts and all four are needed:
 * a V-rule error sets `:state(error)` but does **not** suppress
 * `scene()` (blanking is CSS's answer to the state, and the UA
 * sheet declares no such rule), so a page can be in error *and*
 * paint marks.
 *
 * @param view - The view to gate.
 */
export function assertRenders(view: HdmlViewElement): void {
  const scene = sceneOf(view);
  assert.isFalse(view.matches(":state(error)"));
  assert.isFalse(view.matches(":state(loading)"));
  assert.isAbove(
    scene.groups
      .filter((g) => g.role === "mark")
      .reduce((n, g) => n + g.nodes.length, 0),
    0,
  );
  assert.deepEqual(diagnosticsOf(view), []);
}

/** Every node in a scene — R20's W4 budget is counted over this. */
export function nodeCount(scene: Scene): number {
  return scene.groups.reduce((n, g) => n + g.nodes.length, 0);
}

/* ---------------------------------------------------------------- */
/* Goldens                                                          */
/* ---------------------------------------------------------------- */

/**
 * The scene a golden is compared against: quantized to six decimals
 * (rule 3) and with every `widget` blanked.
 *
 * `SceneGroup.widget` is `HdvlElement.uid`, minted per instance, so
 * it cannot appear in a committed literal. Blanking not deleting
 * keeps the field's *presence* asserted — a group that stopped
 * carrying one is still a failure.
 *
 * @param view - The view.
 * @returns The comparable scene.
 */
export function goldenOf(view: HdmlViewElement): Scene {
  const scene = sceneOf(view, P);
  return {
    ...scene,
    groups: scene.groups.map((g) => ({ ...g, widget: "" })),
  };
}

/**
 * A scene with every `text` node's string blanked.
 *
 * Rule 4: a rendered `Intl` string is ICU version and OS data, so
 * the *strings* are chromium-scoped. Their **positions** are
 * arithmetic and are asserted on all three engines, which is what
 * this projection leaves behind.
 *
 * @param scene - Any scene.
 * @returns The same scene with `text` fields emptied.
 */
export function stripText(scene: Scene): Scene {
  return {
    ...scene,
    groups: scene.groups.map((g: SceneGroup) => ({
      ...g,
      nodes: g.nodes.map((n: SceneNode) =>
        n.k === "text" ? { ...n, text: "" } : n,
      ),
    })),
  };
}

/**
 * ★ **The tags a corpus golden defers to a later slice** — C3, as a
 * value rather than as an omission.
 *
 * Four of the thirteen pages are *double-gated*: they carry an
 * element the slice that first renders them has not built. C3
 * settles what such a gate may claim — *"every slice gate is
 * expressed as named scene-`deepEqual` assertions over the groups
 * **that slice owns**; a double-gated page's whole-page render
 * assertion belongs to the **later** slice"* — so `08` A/B/D and
 * `09` A are gated on their marks and non-legend guides at step 28,
 * **all five views of `04` and `12-C` at step 30** — `04` is the one
 * page where *every* view declares a legend — and **step 32 re-runs
 * them whole**, where the legend must perturb nothing.
 *
 * It is a **filter and not a coincidence**, which matters because
 * `hdml-legend` is registered and currently emits no group at all:
 * a golden that simply lacked legend groups would be indistinguish-
 * able from one that had been asserted over them, and would silently
 * become a whole-page golden the moment Slice H landed — freezing
 * whatever the legend first happened to emit. Filtering by name
 * makes the exclusion survive that: at step 32 the constant is
 * emptied and the goldens grow, deliberately.
 *
 * @see withoutDeferred
 */
export const DEFERRED_TO_SLICE_H: readonly string[] = ["hdml-legend"];

/**
 * A scene with every group a later slice owns removed (C3).
 *
 * @param scene - Any scene.
 * @param tags - The deferred tags, e.g. {@link DEFERRED_TO_SLICE_H}.
 * @returns The scene restricted to the groups this slice owns.
 */
export function withoutDeferred(
  scene: Scene,
  tags: readonly string[],
): Scene {
  return {
    ...scene,
    groups: scene.groups.filter((g) => !tags.includes(g.tag)),
  };
}

/**
 * Every path in a scene holding a **negative zero** (plan rule 9).
 *
 * `-0` is `===` zero and neither `Object.is`- nor `deepEqual`-equal
 * to it, so one reaching a scene is a latent cross-engine failure
 * rather than a visible one. Polar pages are where it becomes
 * reachable — `cos(90deg)` is `6.1e-17` and `sin(180deg)` is
 * `-1.2e-16`, and a coordinate multiplied by a zero radius carries
 * the sign through — so the sweep is run over every polar golden
 * rather than assumed.
 *
 * @param scene - Any scene.
 * @returns The dotted paths, empty when the scene is clean.
 */
export function negativeZeros(scene: Scene): string[] {
  const out: string[] = [];
  const walk = (value: unknown, path: string): void => {
    if (typeof value === "number") {
      if (Object.is(value, -0)) {
        out.push(path);
      }
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${path}[${i}]`));
    } else if (value !== null && typeof value === "object") {
      for (const key of Object.keys(value)) {
        walk(
          (value as Record<string, unknown>)[key],
          `${path}.${key}`,
        );
      }
    }
  };
  walk(scene, "scene");
  return out;
}

/**
 * Every `text` string in a scene, in group-then-node order — the
 * chromium-scoped half of a golden, as a flat list.
 *
 * @param scene - Any scene.
 * @returns The strings.
 */
export function textsOf(scene: Scene): string[] {
  const out: string[] = [];
  for (const group of scene.groups) {
    for (const node of group.nodes) {
      if (node.k === "text") {
        out.push(node.text);
      }
    }
  }
  return out;
}
