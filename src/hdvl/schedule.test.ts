/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert, fixture } from "@open-wc/testing";
import { html } from "lit/static-html.js";
import { LitElement } from "lit";
import "./index";
import { HdvlProbeElement, PROBE_TAG } from "../testing/probe";
import * as stub from "../testing/recording-renderer";
import type { Renderer } from "./renderer";
import type { Scene } from "./scene";
import { HdmlViewElement } from "./view";
import { renderers } from "./renderer";
import { FramePhase, currentPhase, frameTrace } from "./schedule";

/**
 * The frame (§5.6, R5): **one rAF per view, three phases, no
 * interleaving.**
 *
 * Every claim here is about *frames*, not pixels. Every real
 * `scene()` returns `null` today — §2.3 calls that a
 * contract-complete answer — so PAINT hands the renderer a real,
 * empty `Scene`, and the whole loop is assertable before a single
 * number of widget geometry exists. The one thing that does emit is
 * the test probe, which is what proves a non-null group survives the
 * trip.
 *
 * §5.6's clause 1.3 — "paint is a whole frame after `deliver`" — is
 * satisfied **structurally** by this loop, and is asserted from
 * inside `deliver` itself in `subscribe.test.ts`
 * (*"clause 1.3 — deliver never paints"*, step 13), where the trace
 * seam reports `currentPhase() === null` and an unchanged
 * `framesRun` while the view is merely dirty.
 */

/** Every renderer the seam has handed out, in order. */
let made: stub.RecordingRenderer[] = [];
/** The phase each `render()` call saw. */
let painted: (FramePhase | null)[] = [];
/** Whether the view was still dirty when `render()` ran. */
let dirtyAtPaint: boolean[] = [];
let watched: HdmlViewElement | null = null;
let create: () => Renderer;

async function settle(root: Element): Promise<void> {
  const all = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const el of all) {
    if (el instanceof LitElement) {
      await el.updateComplete;
    }
  }
}

function tick(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

/** Waits until no frame has run for three consecutive rAFs. */
async function quiesce(view: HdmlViewElement): Promise<void> {
  let last = -1;
  let still = 0;
  for (let i = 0; i < 60 && still < 3; i++) {
    await tick();
    if (view.framesRun === last && !view.dirty) {
      still++;
    } else {
      still = 0;
      last = view.framesRun;
    }
  }
}

/** Quiesces, runs `act`, and returns how many frames it caused. */
async function frames(
  view: HdmlViewElement,
  act: () => void,
): Promise<number> {
  await quiesce(view);
  const before = view.framesRun;
  act();
  await quiesce(view);
  return view.framesRun - before;
}

async function mount(
  markup: ReturnType<typeof html>,
): Promise<[HdmlViewElement, stub.RecordingRenderer]> {
  const view = await fixture<HdmlViewElement>(markup);
  await settle(view);
  watched = view;
  await quiesce(view);
  assert.isAtLeast(made.length, 1);
  return [view, made[made.length - 1]];
}

suite("hdvl/schedule — the frame", () => {
  setup(() => {
    made = [];
    painted = [];
    dirtyAtPaint = [];
    watched = null;
    create = renderers.create;
    // The renderer seam is a MODULE singleton (step 10), never a
    // per-instance field: the legacy polyfill upgrades on connect
    // and clobbers per-instance injection.
    renderers.create = (): Renderer => {
      const rec = stub.createRecordingRenderer();
      const inner = rec.render.bind(rec);
      rec.render = (scene: Scene): void => {
        painted.push(currentPhase());
        dirtyAtPaint.push(watched?.dirty ?? false);
        inner(scene);
      };
      made.push(rec);
      return rec;
    };
  });

  teardown(() => {
    renderers.create = create;
    frameTrace.record = null;
  });

  test("n invalidations produce one frame", async () => {
    const [view, rec] = await mount(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-bar x="a" y="b"></hdml-bar>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const scenes = rec.scenes.length;
    const before = view.framesRun;

    for (let i = 0; i < 5; i++) {
      view.markDirty();
    }
    assert.isTrue(view.dirty);
    assert.strictEqual(view.framesRun, before);

    await tick();
    assert.strictEqual(view.framesRun, before + 1);
    assert.strictEqual(rec.scenes.length, scenes + 1);
  });

  test("the phases run in order, once each", async () => {
    const [view, rec] = await mount(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdvl-probe x="a" y="b"></hdvl-probe>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const probe = <HdvlProbeElement>view.querySelector(PROBE_TAG);
    probe.calls.length = 0;
    painted.length = 0;
    const seen: FramePhase[] = [];
    frameTrace.record = (p): void => {
      seen.push(p);
    };
    const scenes = rec.scenes.length;

    view.markDirty();
    await tick();

    assert.deepEqual(seen, ["measure", "compute", "paint"]);
    assert.strictEqual(rec.scenes.length, scenes + 1);
    // A widget's scene() is called in COMPUTE and nowhere else, and
    // the renderer is handed the scene in PAINT and nowhere else.
    assert.strictEqual(probe.calls.length, 1);
    assert.strictEqual(probe.last?.phase, "compute");
    assert.deepEqual(painted, ["paint"]);
    // Outside a frame there is no phase at all.
    assert.isNull(currentPhase());
  });

  test("PAINT renders the view's content box", async () => {
    const [view, rec] = await mount(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-bar x="a" y="b"></hdml-bar>
          <hdml-axis channel="y"></hdml-axis>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    view.markDirty();
    await tick();
    const scene = rec.last;
    assert.isNotNull(scene);
    assert.strictEqual(scene?.width, 400);
    assert.strictEqual(scene?.height, 200);
    // §2.3: every real scene() returns null today, and that is a
    // contract-complete answer — the frame is green with no groups.
    assert.strictEqual(scene?.groups.length, 0);
  });

  test("an emitting widget reaches the renderer", async () => {
    const [view, rec] = await mount(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdvl-probe id="one"></hdvl-probe>
          <hdvl-probe id="two"></hdvl-probe>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const one = <HdvlProbeElement>view.querySelector("#one");
    const two = <HdvlProbeElement>view.querySelector("#two");
    one.emit = true;
    two.emit = true;

    view.markDirty();
    await tick();
    const scene = <Scene>rec.last;
    assert.lengthOf(scene.groups, 2);
    // Paint order IS document order, owned by the view (§2.5).
    assert.strictEqual(scene.groups[0].widget, one.uid);
    assert.strictEqual(scene.groups[1].widget, two.uid);
    assert.strictEqual(scene.groups[0].role, "mark");
    assert.deepEqual(scene.groups[0].box, {
      x: 40,
      y: 8,
      w: 352,
      h: 168,
    });
  });

  test("clearDirty is the frame's last act", async () => {
    const [view] = await mount(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane></hdml-cartesian-plane>
      </hdml-view>
    `);
    dirtyAtPaint.length = 0;
    view.markDirty();
    assert.isTrue(view.dirty);
    await tick();
    // Still dirty while painting, clean once the frame is over.
    assert.deepEqual(dirtyAtPaint, [true]);
    assert.isFalse(view.dirty);
  });

  test("empty is reachable, and never also loading", async () => {
    // §3.4.1: `empty` is decided on emitted MARK nodes at end of
    // frame, and §3.4's first clause is what keeps the two states
    // from colliding.
    //
    // Step 13 made `loading` §3.4's real quantifier — "≥ 1
    // currently-required subscription has no terminal delivery" —
    // so this view, which has no subscriptions at all, leaves it
    // on its first frame. That is not a relaxation: it is what
    // makes `empty` reachable, which step 11 recorded it was not.
    // A genuinely loading view is asserted in `subscribe.test.ts`.
    const [view] = await mount(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-bar x="a" y="b"></hdml-bar>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    view.markDirty();
    await tick();
    assert.isFalse(view.matches(":state(loading)"));
    assert.isTrue(view.matches(":state(empty)"));
  });

  test("a disconnected view leaks nothing", async () => {
    const [view, rec] = await mount(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-bar x="a" y="b"></hdml-bar>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const before = view.framesRun;
    const dirties = view.dirtyCount;
    view.remove();

    assert.strictEqual(rec.unmounts, 1);
    view.markDirty();
    assert.strictEqual(view.dirtyCount, dirties);
    for (let i = 0; i < 4; i++) {
      await tick();
    }
    assert.strictEqual(view.framesRun, before);
  });

  test("the observer covers a plane, not the view", async () => {
    // R27: a plane can resize independently of the view — through
    // `@container`, a percentage width, a flex parent or its own
    // box. Observing only the view would miss every one of those.
    const [view] = await mount(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane></hdml-cartesian-plane>
      </hdml-view>
    `);
    const plane = <HTMLElement>(
      view.querySelector("hdml-cartesian-plane")
    );
    const ran = await frames(view, () => {
      // A border, not padding or width: those are on the sentinel's
      // list, and this test must be about the OBSERVER.
      plane.style.borderTop = "20px solid transparent";
    });
    assert.strictEqual(ran, 1);
    // The view itself did not move.
    assert.strictEqual(view.getBoundingClientRect().width, 400);
    assert.strictEqual(view.getBoundingClientRect().height, 200);
  });

  test("reindex maintains the observed set", async () => {
    const observe = ResizeObserver.prototype.observe;
    const unobserve = ResizeObserver.prototype.unobserve;
    const seen: [string, Element][] = [];
    ResizeObserver.prototype.observe = function (
      this: ResizeObserver,
      target: Element,
      options?: ResizeObserverOptions,
    ): void {
      seen.push(["observe", target]);
      observe.call(this, target, options);
    };
    ResizeObserver.prototype.unobserve = function (
      this: ResizeObserver,
      target: Element,
    ): void {
      seen.push(["unobserve", target]);
      unobserve.call(this, target);
    };
    try {
      const [view] = await mount(html`
        <hdml-view style="width: 400px; height: 200px">
          <hdml-cartesian-plane></hdml-cartesian-plane>
        </hdml-view>
      `);
      const plane = <HTMLElement>(
        view.querySelector("hdml-cartesian-plane")
      );
      const saw = (kind: string, el: Element): boolean =>
        seen.some(([k, t]) => k === kind && t === el);
      assert.isTrue(saw("observe", view));
      assert.isTrue(saw("observe", plane));

      seen.length = 0;
      const bar = document.createElement("hdml-bar");
      plane.appendChild(bar);
      assert.isTrue(saw("observe", bar));
      assert.isFalse(saw("unobserve", bar));

      seen.length = 0;
      bar.remove();
      assert.isTrue(saw("unobserve", bar));
      assert.isFalse(saw("observe", bar));
    } finally {
      ResizeObserver.prototype.observe = observe;
      ResizeObserver.prototype.unobserve = unobserve;
    }
  });

  test("transitionrun catches three kinds of change", async () => {
    // §5.6: the 1 ms UA transition is what retires the PoC's
    // document-wide MutationObserver. Step 08's probe proved the
    // platform half; this proves the wiring, through a capturing
    // listener on the view.
    const [view] = await mount(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-bar class="probe-t" x="a" y="b"></hdml-bar>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const plane = <HTMLElement>(
      view.querySelector("hdml-cartesian-plane")
    );
    const bar = <HTMLElement>view.querySelector("hdml-bar");

    const inline = await frames(view, () => {
      bar.style.setProperty("--hdml-fill-color", "rgb(9, 9, 9)");
    });
    assert.strictEqual(inline, 1);

    // Inherited: an ancestor declares it, the descendant's computed
    // value changes, and the descendant's own sentinel fires.
    //
    // MEASURED, and an engine split worth stating rather than
    // hiding behind a loose bound. Three transitionrun events
    // arrive for this one change on chromium and webkit — plane
    // and bar in the events step of frame N, then the bar AGAIN in
    // frame N+1, because the plane's own 1 ms transition is still
    // producing a changing inherited value — and two on firefox.
    // They coalesce to 2 frames and 1 frame respectively. What is
    // asserted is the coalescing that matters: never one frame per
    // element, and never zero.
    const inherited = await frames(view, () => {
      plane.style.setProperty("--hdml-line-color", "rgb(8, 8, 8)");
    });
    assert.isAtLeast(inherited, 1);
    assert.isAtMost(inherited, 2);

    const sheet = new CSSStyleSheet();
    sheet.replaceSync(".probe-t { --hdml-line-width: 3px }");
    const sheeted = await frames(view, () => {
      document.adoptedStyleSheets = [
        ...document.adoptedStyleSheets,
        sheet,
      ];
    });
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
      (s) => s !== sheet,
    );
    assert.strictEqual(sheeted, 1);
  });
});
