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
import type { Hit, Renderer } from "./renderer";
import { HdmlViewElement } from "./view";
import { renderers } from "./renderer";
import { currentPhase } from "./schedule";
import {
  HDML_RENDER,
  HdmlPointerEvent,
  POINTER_TYPES,
} from "./events";

/**
 * Interaction (§5.7, R10, R31, R37) and the after-PAINT outward
 * queue (§5.11).
 *
 * Every event here is script-dispatched, which is exactly why
 * `e.isTrusted` was rejected as the proxy fence: a synthetic
 * `PointerEvent` is untrusted, so an `isTrusted` fence would make
 * this whole file pass while testing nothing.
 */

/**
 * Where the unfenced replica gives up.
 *
 * Chosen **below every engine's own ceiling**, so the number the
 * assertion reads is the guard and not an engine artefact.
 * Measured with the guard at 5000, one native `pointermove`:
 * chromium re-enters **44** times and then silently stops (which is
 * where the RFC's "43 re-entries before an artificial depth guard"
 * came from — Blink caps nested synchronous dispatch), firefox
 * **448**, and webkit recurses until `RangeError: Maximum call
 * stack size exceeded` — an unfenced listener does not merely
 * misbehave there, it takes the page down.
 */
const GUARD = 40;

let create: () => Renderer;
let made: stub.RecordingRenderer[] = [];

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

/** A valid view whose one widget is an emitting probe. */
async function mount(): Promise<{
  host: HTMLElement;
  view: HdmlViewElement;
  probe: HdvlProbeElement;
}> {
  const host = await fixture<HTMLElement>(html`
    <div style="padding: 23px 0 0 37px">
      <hdml-view
        aria-label="probe"
        style="width: 400px; height: 200px"
      >
        <hdml-cartesian-plane>
          <hdml-continuous-scale channel="y">
            <hdvl-probe></hdvl-probe>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    </div>
  `);
  const view = <HdmlViewElement>host.querySelector("hdml-view");
  const probe = <HdvlProbeElement>host.querySelector(PROBE_TAG);
  await settle(host);
  probe.emit = true;
  probe.rows = [
    { x: "a", y: 1 },
    { x: "b", y: 2 },
  ];
  view.markDirty();
  await quiesce(view);
  return { host, view, probe };
}

/** A point known to be inside the probe's painted rect. */
function inside(view: HdmlViewElement): [number, number] {
  const r = view.getBoundingClientRect();
  return [r.left + 200, r.top + 100];
}

function move(target: Element, x: number, y: number): PointerEvent {
  const e = new PointerEvent("pointermove", {
    bubbles: true,
    composed: true,
    clientX: x,
    clientY: y,
    pointerId: 7,
    pointerType: "mouse",
  });
  target.dispatchEvent(e);
  return e;
}

/** Every pointer event that reached `document`, in order. */
function record(seen: PointerEvent[]): () => void {
  const on = (e: Event): void => {
    seen.push(<PointerEvent>e);
  };
  for (const type of POINTER_TYPES) {
    document.addEventListener(type, on);
  }
  return (): void => {
    for (const type of POINTER_TYPES) {
      document.removeEventListener(type, on);
    }
  };
}

function proxied(seen: readonly PointerEvent[]): HdmlPointerEvent[] {
  return seen.filter(
    (e): e is HdmlPointerEvent => e instanceof HdmlPointerEvent,
  );
}

suite("hdvl/events — interaction and the outward queue", () => {
  setup(() => {
    made = [];
    create = renderers.create;
  });

  teardown(() => {
    renderers.create = create;
  });

  test("one pointermove makes exactly one proxy", async () => {
    // §5.7's own named test, and R37's whole justification.
    const { view, probe } = await mount();
    const seen: PointerEvent[] = [];
    const stopRecording = record(seen);
    try {
      const [x, y] = inside(view);
      move(probe, x, y);
    } finally {
      stopRecording();
    }

    assert.lengthOf(proxied(seen), 1);
    assert.isTrue(probe.matches(":state(hover)"));
    assert.strictEqual(view.hovered, probe);
  });

  test("the fence is what stops the re-entry", async () => {
    // Assert the BEHAVIOUR, never the source: a proxied event
    // dispatched at the view must not make the listener produce a
    // second one. Then measure what the fence is worth, with an
    // unfenced replica of the same listener.
    const { view, probe } = await mount();
    const seen: PointerEvent[] = [];
    const stopRecording = record(seen);
    const [x, y] = inside(view);
    try {
      probe.dispatchEvent(
        new HdmlPointerEvent("pointermove", {
          bubbles: true,
          composed: true,
          clientX: x,
          clientY: y,
          index: 0,
        }),
      );
    } finally {
      stopRecording();
    }
    // Ours, and nothing the listener added to it.
    assert.lengthOf(proxied(seen), 1);

    // The unfenced replica: the same listener without its first
    // line. It re-enters until something stops it — see GUARD for
    // what each engine does when nothing does.
    let depth = 0;
    const unfenced = (e: Event): void => {
      if (depth >= GUARD) {
        return;
      }
      depth++;
      probe.dispatchEvent(
        new HdmlPointerEvent(e.type, {
          bubbles: true,
          composed: true,
          index: 0,
        }),
      );
    };
    view.addEventListener("pointermove", unfenced);
    try {
      move(probe, x, y);
    } finally {
      view.removeEventListener("pointermove", unfenced);
    }
    assert.strictEqual(depth, GUARD);
  });

  test("UIEvent.detail coerces an object to 0", async () => {
    // R31, measured. This is the entire reason HdmlPointerEvent
    // exists; a later reader will otherwise try to "simplify"
    // index/datum back into `detail`.
    await mount();
    const init = <PointerEventInit>(<unknown>{
      detail: { index: 3 },
    });
    const e = new PointerEvent("pointerdown", init);
    assert.strictEqual(e.detail, 0);
    assert.notTypeOf(e.detail, "object");
  });

  test("index and datum survive, and so does the rest", async () => {
    const { view, probe } = await mount();
    const seen: PointerEvent[] = [];
    const stopRecording = record(seen);
    try {
      const [x, y] = inside(view);
      move(probe, x, y);
    } finally {
      stopRecording();
    }
    const [e] = proxied(seen);
    assert.isTrue(e instanceof PointerEvent);
    assert.strictEqual(e.index, 0);
    assert.deepEqual(e.datum, { x: "a", y: 1 });
    const [x] = inside(view);
    assert.strictEqual(e.clientX, x);
    assert.strictEqual(e.pointerId, 7);
    assert.strictEqual(e.pointerType, "mouse");
  });

  test("it is dispatched from the widget and escapes", async () => {
    // R10: the view owns the ONE listener and dispatches from the
    // widget, so the series identity is the event target — which is
    // why SPEC §10 has no `series` field.
    const { host, view, probe } = await mount();
    let outside: HdmlPointerEvent | null = null;
    const on = (e: Event): void => {
      if (e instanceof HdmlPointerEvent) {
        outside = e;
      }
    };
    host.addEventListener("pointermove", on);
    try {
      const [x, y] = inside(view);
      move(probe, x, y);
    } finally {
      host.removeEventListener("pointermove", on);
    }
    const e = <HdmlPointerEvent | null>outside;
    assert.isNotNull(e);
    assert.strictEqual(e?.target, probe);
    assert.isTrue(e?.bubbles);
    assert.isTrue(e?.composed);
  });

  test("the native event is not stopped", async () => {
    const { view, probe } = await mount();
    const seen: PointerEvent[] = [];
    const stopRecording = record(seen);
    let native: PointerEvent;
    try {
      const [x, y] = inside(view);
      native = move(probe, x, y);
    } finally {
      stopRecording();
    }
    assert.lengthOf(seen, 2);
    assert.lengthOf(proxied(seen), 1);
    // A host app sees both and tells them apart by class.
    assert.isTrue(seen.includes(native));
  });

  test("resolve is handed view-local CSS px", async () => {
    // R31 / §2.7. The view sits at a non-zero page offset, so a
    // stub that recorded viewport coordinates would show it.
    const asked: [number, number][] = [];
    renderers.create = (): Renderer => {
      const rec = stub.createRecordingRenderer();
      rec.resolve = (x: number, y: number): Hit | null => {
        asked.push([x, y]);
        return null;
      };
      made.push(rec);
      return rec;
    };
    const { view, probe } = await mount();
    assert.isAtLeast(made.length, 1);
    const r = view.getBoundingClientRect();
    assert.isAbove(r.left, 0);
    assert.isAbove(r.top, 0);

    move(probe, r.left + 120, r.top + 45);
    assert.deepEqual(asked, [[120, 45]]);
  });

  test("hdml-render fires once per painted frame", async () => {
    const log: string[] = [];
    renderers.create = (): Renderer => {
      const rec = stub.createRecordingRenderer();
      const inner = rec.render.bind(rec);
      rec.render = (scene): void => {
        inner(scene);
        log.push("render");
      };
      made.push(rec);
      return rec;
    };
    const { view } = await mount();
    const on = (): void => {
      log.push(HDML_RENDER);
    };
    document.addEventListener(HDML_RENDER, on);
    try {
      log.length = 0;
      view.markDirty();
      await quiesce(view);
    } finally {
      document.removeEventListener(HDML_RENDER, on);
    }
    // Once per frame, and AFTER render() returned.
    assert.deepEqual(log, ["render", HDML_RENDER]);
  });

  test("outward events are dispatched after PAINT", async () => {
    // §5.11: never inside MEASURE or COMPUTE. A listener is
    // entitled to mutate the DOM, and a mutation mid-phase would
    // corrupt the pass in flight.
    const { view } = await mount();
    const phases: (string | null)[] = [];
    const on = (): void => {
      phases.push(currentPhase());
    };
    document.addEventListener(HDML_RENDER, on);
    try {
      view.markDirty();
      await quiesce(view);
    } finally {
      document.removeEventListener(HDML_RENDER, on);
    }
    assert.isAtLeast(phases.length, 1);
    for (const phase of phases) {
      assert.isNull(phase);
    }
  });
});
