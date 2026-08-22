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
import { mountFakeIo } from "../testing/FakeIo";
import type { Renderer } from "./renderer";
import type { Scene } from "./scene";
import { HdmlViewElement } from "./view";
import { renderers } from "./renderer";
import { elementsOf } from "./resolve";
import { measureView } from "./measure";
import { subscriptionsOf } from "./subscribe";
import { diagnosticsOf } from "./validate";

/** The one source ref the V2 fixtures subscribe to. */
const REF = "?hdml-frame=v2";

/**
 * The validator (§8, R7, R23, R25) — **V1, V13, W2, W5 and W6**.
 *
 * Every message below is **hardcoded**. Importing the constant
 * `validate.ts` builds would assert that the code equals itself and
 * §8.4's messages-are-contract guarantee would evaporate; the
 * literal in the test *is* the contract. The em dash is U+2014.
 *
 * Every negative fixture asserts three things (the plan's
 * negative-fixture rule): the verbatim message, the `:state(error)`
 * **unit** — which for a container child is the container, §3.5 —
 * and that a sibling still renders.
 */

/** Every console line the validator wrote, in order. */
let lines: string[] = [];
/** Every `hdml-error` that reached `document`. */
let errs: CustomEvent<Record<string, unknown>>[] = [];
let realWarn: typeof console.warn;
let realError: typeof console.error;
let create: () => Renderer;
let made: stub.RecordingRenderer[] = [];

const onError = (e: Event): void => {
  errs.push(<CustomEvent<Record<string, unknown>>>e);
};

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

/** The console lines one rule produced. */
function said(rule: string): string[] {
  return lines.filter((l) => l.startsWith(`hdml ${rule} `));
}

/** The message half of a `hdml ... — <message>` line. */
function messageOf(line: string): string {
  const at = line.indexOf(" — ");
  return at < 0 ? line : line.slice(at + 3);
}

async function mount(
  markup: ReturnType<typeof html>,
): Promise<[HTMLElement, HdmlViewElement]> {
  const host = await fixture<HTMLElement>(markup);
  const view = <HdmlViewElement>(
    (host.localName === "hdml-view"
      ? host
      : host.querySelector("hdml-view"))
  );
  await settle(host);
  for (const probe of Array.from(host.querySelectorAll(PROBE_TAG))) {
    (<HdvlProbeElement>probe).emit = true;
  }
  view.markDirty();
  await quiesce(view);
  return [host, view];
}

/** The last scene the stub renderer was handed. */
function sceneOf(): Scene {
  const rec = made[made.length - 1];
  return <Scene>rec.last;
}

function paints(uid: string): boolean {
  return sceneOf().groups.some((g) => g.widget === uid);
}

suite("hdvl/validate — diagnostics", () => {
  setup(() => {
    lines = [];
    errs = [];
    made = [];
    realWarn = console.warn;
    realError = console.error;
    console.warn = (...args: unknown[]): void => {
      lines.push(String(args[0]));
    };
    console.error = (...args: unknown[]): void => {
      lines.push(String(args[0]));
    };
    document.addEventListener("hdml-error", onError);
    create = renderers.create;
    renderers.create = (): Renderer => {
      const rec = stub.createRecordingRenderer();
      made.push(rec);
      return rec;
    };
  });

  teardown(() => {
    console.warn = realWarn;
    console.error = realError;
    document.removeEventListener("hdml-error", onError);
    renderers.create = create;
  });

  test("V1 — no scale for a bound channel", async () => {
    const [, view] = await mount(html`
      <hdml-view aria-label="v1" style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-continuous-scale min="0" max="1" channel="x">
            <hdml-bar x="a" y="b"></hdml-bar>
            <hdvl-probe></hdvl-probe>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const bar = <Element>view.querySelector("hdml-bar");
    const probe = <HdvlProbeElement>view.querySelector(PROBE_TAG);

    assert.lengthOf(said("V1"), 1);
    assert.strictEqual(
      messageOf(said("V1")[0]),
      'no scale for channel "y" in scope',
    );
    // The unit blanks and carries the state; nothing else does.
    assert.isTrue(bar.matches(":state(error)"));
    assert.isFalse(view.matches(":state(error)"));
    assert.isFalse(probe.matches(":state(error)"));
    // …and the sibling still renders.
    assert.isTrue(paints(probe.uid));
    assert.lengthOf(errs, 1);
    assert.strictEqual(errs[0].detail.code, "no-scale-in-scope");
    assert.strictEqual(errs[0].detail.rule, "V1");
    assert.strictEqual(errs[0].target, bar);
  });

  test("V1 — two same-channel scales in one chain", async () => {
    const [, view] = await mount(html`
      <hdml-view aria-label="v1b" style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-ordinal-scale values='["a"]' channel="x">
            <hdml-continuous-scale min="0" max="1" channel="y">
              <hdvl-probe id="ok"></hdvl-probe>
            </hdml-continuous-scale>
            <hdml-continuous-scale min="0" max="1" channel="y">
              <hdml-continuous-scale min="0" max="1" channel="y">
                <hdvl-probe id="bad"></hdvl-probe>
              </hdml-continuous-scale>
            </hdml-continuous-scale>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const ok = <HdvlProbeElement>view.querySelector("#ok");
    const inner = <Element>(
      view.querySelector(
        "hdml-continuous-scale > hdml-continuous-scale",
      )
    );

    assert.lengthOf(said("V1"), 1);
    assert.strictEqual(
      messageOf(said("V1")[0]),
      'two "y" scales in scope — make them siblings',
    );
    assert.isTrue(inner.matches(":state(error)"));
    assert.isTrue(paints(ok.uid));
    assert.lengthOf(errs, 1);
    assert.strictEqual(errs[0].detail.code, "duplicate-scale");
  });

  test("V13 — scales and widgets cannot share a level", async () => {
    const [, view] = await mount(html`
      <hdml-view aria-label="v13" style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-ordinal-scale values='["a"]' channel="x">
            <hdml-continuous-scale min="0" max="1" channel="y">
              <hdvl-probe id="ok"></hdvl-probe>
            </hdml-continuous-scale>
            <hdml-axis channel="x"></hdml-axis>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const axis = <Element>view.querySelector("hdml-axis");
    const ok = <HdvlProbeElement>view.querySelector("#ok");

    assert.lengthOf(said("V13"), 1);
    assert.strictEqual(
      messageOf(said("V13")[0]),
      "scales and widgets cannot share a level — move " +
        '<hdml-axis channel="x"> into one of the y blocks',
    );
    assert.isTrue(axis.matches(":state(error)"));
    assert.isTrue(paints(ok.uid));
    assert.strictEqual(errs[0].detail.rule, "V13");
    assert.strictEqual(errs[0].detail.code, "heterogeneous-children");
  });

  test("the unit is §3.5's, not the violator", async () => {
    const [, view] = await mount(html`
      <hdml-view aria-label="u" style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-ordinal-scale values='["a"]' channel="x">
            <hdml-stack x="m">
              <hdml-bar x="m" y="v"></hdml-bar>
            </hdml-stack>
            <hdvl-probe></hdvl-probe>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const stack = <Element>view.querySelector("hdml-stack");
    const bar = <Element>view.querySelector("hdml-bar");
    const probe = <HdvlProbeElement>view.querySelector(PROBE_TAG);

    assert.strictEqual(
      messageOf(said("V1")[0]),
      'no scale for channel "y" in scope',
    );
    // SPEC §7 is all-or-nothing: a stack missing a layer is a wrong
    // chart, not a degraded one, so the CONTAINER blanks.
    assert.isTrue(stack.matches(":state(error)"));
    assert.isFalse(bar.matches(":state(error)"));
    assert.strictEqual(errs[0].target, stack);
    assert.isTrue(paints(probe.uid));
  });

  test("an unchanged violation reports once", async () => {
    // R25. Validation runs on every structural change, so a resize
    // drag would otherwise re-dispatch this sixty times a second.
    const [, view] = await mount(html`
      <hdml-view aria-label="e" style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-ordinal-scale values='["a"]' channel="x">
            <hdml-continuous-scale min="0" max="1" channel="y">
              <hdml-point x="a" y="b"></hdml-point>
            </hdml-continuous-scale>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    assert.deepEqual(diagnosticsOf(view), []);
    const point = <Element>view.querySelector("hdml-point");

    lines.length = 0;
    errs.length = 0;
    point.setAttribute("color", "c");
    view.reindex();
    await quiesce(view);
    for (let i = 0; i < 5; i++) {
      view.reindex();
      await quiesce(view);
    }

    assert.lengthOf(said("V1"), 1);
    assert.lengthOf(errs, 1);
    assert.strictEqual(
      messageOf(said("V1")[0]),
      'no scale for channel "color" in scope',
    );
    assert.isTrue(point.matches(":state(error)"));
  });

  test("a changed identity reports again", async () => {
    const [, view] = await mount(html`
      <hdml-view aria-label="i" style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-ordinal-scale values='["a"]' channel="x">
            <hdml-continuous-scale min="0" max="1" channel="y">
              <hdml-point x="a" y="b" color="c"></hdml-point>
            </hdml-continuous-scale>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const point = <Element>view.querySelector("hdml-point");
    assert.lengthOf(errs, 1);

    lines.length = 0;
    errs.length = 0;
    point.removeAttribute("color");
    point.setAttribute("size", "s");
    view.reindex();
    await quiesce(view);

    // A → B on the same unit: dispatched once, for B.
    assert.lengthOf(errs, 1);
    assert.lengthOf(said("V1"), 1);
    assert.strictEqual(
      messageOf(said("V1")[0]),
      'no scale for channel "size" in scope',
    );
  });

  test("recovery dispatches nothing", async () => {
    // SPEC §10 defines no resolution event, and inventing one would
    // be a vocabulary addition.
    const [, view] = await mount(html`
      <hdml-view aria-label="r" style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-ordinal-scale values='["a"]' channel="x">
            <hdml-continuous-scale min="0" max="1" channel="y">
              <hdml-point x="a" y="b" color="c"></hdml-point>
            </hdml-continuous-scale>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const point = <Element>view.querySelector("hdml-point");
    assert.isTrue(point.matches(":state(error)"));

    lines.length = 0;
    errs.length = 0;
    point.removeAttribute("color");
    view.reindex();
    await quiesce(view);

    assert.isFalse(point.matches(":state(error)"));
    assert.lengthOf(errs, 0);
    assert.lengthOf(said("V1"), 0);
    assert.deepEqual(diagnosticsOf(view), []);
  });

  test("W5 — a transition shorthand kills detection", async () => {
    const [, view] = await mount(html`
      <hdml-view aria-label="w5" style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-ordinal-scale values='["a"]' channel="x">
            <hdml-continuous-scale min="0" max="1" channel="y">
              <hdml-line
                x="a"
                y="b"
                style="transition: opacity 200ms"
              ></hdml-line>
            </hdml-continuous-scale>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    assert.lengthOf(said("W5"), 1);
    // §5.6: correctness is restored without the author knowing the
    // mechanism exists.
    assert.isTrue(view.observingFallback);

    for (let i = 0; i < 3; i++) {
      view.markDirty();
      await quiesce(view);
    }
    assert.lengthOf(said("W5"), 1);
    assert.lengthOf(errs, 0);
    assert.isFalse(view.matches(":state(error)"));
  });

  test("W6 — a url() form is ignored, and says so", async () => {
    const [, view] = await mount(html`
      <hdml-view aria-label="w6" style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-ordinal-scale values='["a"]' channel="x">
            <hdml-continuous-scale min="0" max="1" channel="y">
              <hdml-bar
                x="a"
                y="b"
                style="clip-path: url(#nope)"
              ></hdml-bar>
              <hdml-line
                x="a"
                y="b"
                style="filter: url(#nope)"
              ></hdml-line>
            </hdml-continuous-scale>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    assert.lengthOf(said("W6"), 2);
    for (let i = 0; i < 3; i++) {
      view.markDirty();
      await quiesce(view);
    }
    assert.lengthOf(said("W6"), 2);

    // …and neither clips nor filters anything (§5.4).
    const snap = measureView(view, elementsOf(view)).measured;
    const bar = snap.get(<never>view.querySelector("hdml-bar"));
    const line = snap.get(<never>view.querySelector("hdml-line"));
    assert.isNull(bar?.clipPath);
    assert.strictEqual(line?.filter, "none");
    assert.isFalse(view.observingFallback);
  });

  test("W2 — a view with no accessible name", async () => {
    const [, view] = await mount(html`
      <hdml-view style="width: 400px; height: 200px">
        <hdml-cartesian-plane></hdml-cartesian-plane>
      </hdml-view>
    `);
    assert.lengthOf(said("W2"), 1);
    assert.strictEqual(
      messageOf(said("W2")[0]),
      "no accessible name — add aria-label or aria-labelledby",
    );
    for (let i = 0; i < 3; i++) {
      view.reindex();
      await quiesce(view);
    }
    assert.lengthOf(said("W2"), 1);
    // A warning never blanks anything (§8.3).
    assert.isFalse(view.matches(":state(error)"));
  });

  // ---------------------------------------------------------------
  // Step 18's six rules. Every message is HARDCODED — the literal
  // here IS the contract (§8.4), and the em dash is U+2014.
  // ---------------------------------------------------------------

  /** A valid sibling chain, so "siblings still render" is real. */
  const SIBLING = html`
    <hdml-continuous-scale channel="y" min="0" max="1">
      <hdvl-probe id="ok"></hdvl-probe>
    </hdml-continuous-scale>
  `;

  function okProbe(view: HdmlViewElement): HdvlProbeElement {
    return <HdvlProbeElement>view.querySelector("#ok");
  }

  test("V8 — no domain source at all", async () => {
    const [, view] = await mount(html`
      <hdml-view aria-label="v8" style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-ordinal-scale channel="x">
            ${SIBLING}
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const bad = <Element>view.querySelector("hdml-ordinal-scale");

    assert.lengthOf(said("V8"), 1);
    assert.strictEqual(
      messageOf(said("V8")[0]),
      'no domain for channel "x" — ' +
        "add min= and max=, or values=",
    );
    assert.isTrue(bad.matches(":state(error)"));
    assert.isFalse(view.matches(":state(error)"));
    assert.isTrue(paints(okProbe(view).uid));
    assert.strictEqual(errs[0].detail.code, "unresolved-domain");
    assert.strictEqual(errs[0].detail.rule, "V8");
    assert.strictEqual(errs[0].detail.channel, "x");
  });

  test("V8 — one endpoint named, the other not", async () => {
    const [, view] = await mount(html`
      <hdml-view aria-label="v8b" style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-continuous-scale channel="x" min="0">
            ${SIBLING}
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    assert.strictEqual(
      messageOf(said("V8")[0]),
      'no domain ceiling for channel "x" — ' + "add max= or values=",
    );
    assert.isTrue(paints(okProbe(view).uid));
  });

  test("V8 — a floor with no ceiling names the floor", async () => {
    const [, view] = await mount(html`
      <hdml-view aria-label="v8c" style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-continuous-scale channel="x" max="9">
            ${SIBLING}
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    assert.strictEqual(
      messageOf(said("V8")[0]),
      'no domain floor for channel "x" — ' + "add min= or values=",
    );
    assert.isTrue(paints(okProbe(view).uid));
  });

  test("V8 — a scale with no channel at all", async () => {
    const [, view] = await mount(html`
      <hdml-view aria-label="v8d" style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-ordinal-scale values='["a"]'>
            ${SIBLING}
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    assert.strictEqual(
      messageOf(said("V8")[0]),
      'every scale declares a channel — add channel="x"',
    );
    assert.isTrue(paints(okProbe(view).uid));
  });

  test("V8 — an unrecognised channel names the six", async () => {
    const [, view] = await mount(html`
      <hdml-view aria-label="v8e" style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-ordinal-scale channel="depth" values='["a"]'>
            ${SIBLING}
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    assert.strictEqual(
      messageOf(said("V8")[0]),
      'no channel "depth" — the channels are ' +
        "x, y, angle, radius, size and color",
    );
    assert.isTrue(paints(okProbe(view).uid));
  });

  // ★ V8 is STRUCTURAL: it reports before any data can arrive.
  test("V8 reports with no provider on the page", async () => {
    const [, view] = await mount(html`
      <hdml-view aria-label="v8f" style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-ordinal-scale channel="x">
            ${SIBLING}
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    // Nothing subscribed, nothing was delivered, and the rule has
    // still fired — which is the half that proves it needs no data.
    assert.lengthOf(subscriptionsOf(view), 0);
    assert.lengthOf(said("V8"), 1);
    // R25: edge-triggered. Re-deriving it changes nothing.
    for (let i = 0; i < 3; i++) {
      view.reindex();
      await quiesce(view);
    }
    assert.lengthOf(said("V8"), 1);
    assert.lengthOf(errs, 1);
  });

  test("V8 clears without an event on recovery", async () => {
    const [, view] = await mount(html`
      <hdml-view aria-label="v8g" style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-ordinal-scale channel="x">
            ${SIBLING}
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const bad = <Element>view.querySelector("hdml-ordinal-scale");
    assert.isTrue(bad.matches(":state(error)"));
    bad.setAttribute("values", '["a", "b"]');
    await quiesce(view);
    assert.isFalse(bad.matches(":state(error)"));
    // SPEC §10 defines no resolution event.
    assert.lengthOf(errs, 1);
  });

  test("V3 — ? and / are forbidden in a channel", async () => {
    const [, view] = await mount(html`
      <hdml-view aria-label="v3" style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-ordinal-scale channel="x" values="a?b">
            ${SIBLING}
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const bad = <Element>view.querySelector("hdml-ordinal-scale");
    assert.strictEqual(
      messageOf(said("V3")[0]),
      'values="a?b" is not a channel binding — ' +
        "? and / are forbidden",
    );
    assert.isTrue(bad.matches(":state(error)"));
    assert.strictEqual(errs[0].detail.code, "bad-binding-grammar");
  });

  test("V3 — a slash is forbidden too", async () => {
    await mount(html`
      <hdml-view aria-label="v3b" style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-ordinal-scale channel="x" values='["a"]'>
            <hdml-continuous-scale channel="y" min="0" max="1">
              <hdml-bar x="a/b" y="v"></hdml-bar>
            </hdml-continuous-scale>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    assert.strictEqual(
      messageOf(said("V3")[0]),
      'x="a/b" is not a channel binding — ' + "? and / are forbidden",
    );
  });

  test("V3 — a [-leading value must parse as JSON", async () => {
    const [, view] = await mount(html`
      <hdml-view aria-label="v3c" style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-ordinal-scale channel="x" values="[1, 2">
            ${SIBLING}
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    assert.strictEqual(
      messageOf(said("V3")[0]),
      'values="[1, 2" is not valid JSON — ' +
        "a value that starts with it must parse",
    );
    assert.isTrue(paints(okProbe(view).uid));
  });

  test("V10 — a full source ref belongs in source", async () => {
    const [, view] = await mount(html`
      <hdml-view aria-label="v10" style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-ordinal-scale channel="x" values="?hdml-frame=f">
            ${SIBLING}
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const bad = <Element>view.querySelector("hdml-ordinal-scale");
    assert.lengthOf(said("V10"), 1);
    assert.lengthOf(said("V3"), 0);
    assert.strictEqual(
      messageOf(said("V10")[0]),
      "a full source ref belongs in source — " +
        'move "?hdml-frame=f" out of values',
    );
    assert.isTrue(bad.matches(":state(error)"));
    assert.strictEqual(errs[0].detail.code, "ref-in-channel");
    assert.isTrue(paints(okProbe(view).uid));
  });

  test("V10 — a document path in a channel is a ref", async () => {
    await mount(html`
      <hdml-view
        aria-label="v10b"
        style="width: 400px; height: 200px"
      >
        <hdml-cartesian-plane>
          <hdml-ordinal-scale channel="x" values='["a"]'>
            <hdml-continuous-scale channel="y" min="0" max="1">
              <hdml-bar x="/docs/a.html" y="v"></hdml-bar>
            </hdml-continuous-scale>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    assert.strictEqual(
      messageOf(said("V10")[0]),
      "a full source ref belongs in source — " +
        'move "/docs/a.html" out of x',
    );
  });

  test("V18 — zero is continuous-only", async () => {
    const [, view] = await mount(html`
      <hdml-view aria-label="v18" style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-datetime-scale
            channel="x"
            min="2025-01-01"
            max="2025-01-02"
            zero
          >
            ${SIBLING}
          </hdml-datetime-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const bad = <Element>view.querySelector("hdml-datetime-scale");
    assert.strictEqual(
      messageOf(said("V18")[0]),
      '"zero" applies to a continuous scale — ' +
        "remove it from hdml-datetime-scale",
    );
    assert.isTrue(bad.matches(":state(error)"));
    assert.strictEqual(errs[0].detail.code, "modifier-kind");
    assert.isTrue(paints(okProbe(view).uid));
  });

  test("V18 — sort is ordinal-only", async () => {
    await mount(html`
      <hdml-view
        aria-label="v18b"
        style="width: 400px; height: 200px"
      >
        <hdml-cartesian-plane>
          <hdml-continuous-scale
            channel="x"
            min="0"
            max="1"
            sort="ascending"
          >
            ${SIBLING}
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    assert.strictEqual(
      messageOf(said("V18")[0]),
      '"sort" applies to a ordinal scale — ' +
        "remove it from hdml-continuous-scale",
    );
  });

  test("V18 — nice is continuous or datetime", async () => {
    await mount(html`
      <hdml-view
        aria-label="v18c"
        style="width: 400px; height: 200px"
      >
        <hdml-cartesian-plane>
          <hdml-ordinal-scale channel="x" values='["a"]' nice>
            ${SIBLING}
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    assert.strictEqual(
      messageOf(said("V18")[0]),
      '"nice" applies to a continuous or datetime scale — ' +
        "remove it from hdml-ordinal-scale",
    );
  });

  // ★ The POSITIVE case is what proves V18 is scoped, not blanket.
  test("V18 — reverse is legal on all three kinds", async () => {
    const [, view] = await mount(html`
      <hdml-view
        aria-label="v18d"
        style="width: 400px; height: 200px"
      >
        <hdml-cartesian-plane>
          <hdml-ordinal-scale channel="x" values='["a"]' reverse>
            <hdml-continuous-scale
              channel="y"
              min="0"
              max="1"
              reverse
              clamp
            >
              <hdml-datetime-scale
                channel="radius"
                min="2025-01-01"
                max="2025-01-02"
                reverse
                clamp
                nice
              >
                <hdvl-probe id="ok"></hdvl-probe>
              </hdml-datetime-scale>
            </hdml-continuous-scale>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    assert.lengthOf(said("V18"), 0);
    assert.deepEqual(diagnosticsOf(view), []);
    assert.isTrue(paints(okProbe(view).uid));
  });

  test("V2 — a string column on a continuous scale", async () => {
    mountFakeIo({
      [REF]: {
        generation: 1,
        rows: 2,
        columns: {
          cat: {
            values: undefined,
            nulls: undefined,
            domain: { kind: "ordinal", value: ["a", "b"] },
            type: { kind: "string" },
          },
        },
      },
    });
    const [, view] = await mount(html`
      <hdml-view
        aria-label="v2"
        source="${REF}"
        style="width: 400px; height: 200px"
      >
        <hdml-cartesian-plane>
          <hdml-continuous-scale channel="x" values="cat">
            ${SIBLING}
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const bad = <Element>view.querySelector("hdml-continuous-scale");
    assert.strictEqual(
      messageOf(said("V2")[0]),
      'column "cat" is text — ' +
        "hdml-continuous-scale takes numbers",
    );
    assert.isTrue(bad.matches(":state(error)"));
    assert.strictEqual(errs[0].detail.code, "kind-mismatch");
    assert.isTrue(paints(okProbe(view).uid));
  });

  test("V2 — a time column on a datetime scale", async () => {
    mountFakeIo({
      [REF]: {
        generation: 1,
        rows: 2,
        columns: {
          clock: {
            values: undefined,
            nulls: undefined,
            domain: { kind: "extent", value: [0, 1000] },
            type: { kind: "time", unit: "ms" },
          },
        },
      },
    });
    const [, view] = await mount(html`
      <hdml-view
        aria-label="v2b"
        source="${REF}"
        style="width: 400px; height: 200px"
      >
        <hdml-cartesian-plane>
          <hdml-datetime-scale channel="x" values="clock">
            ${SIBLING}
          </hdml-datetime-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    assert.strictEqual(
      messageOf(said("V2")[0]),
      'column "clock" is a time of day, not an instant — ' +
        "hdml-datetime-scale takes datetimes",
    );
    assert.isTrue(paints(okProbe(view).uid));
  });

  // ★ Checked AFTER domain resolution — "touching", not only
  // "crossing", which is what a `min="0"` domain is.
  test("V2 — a log domain that touches zero", async () => {
    const [, view] = await mount(html`
      <hdml-view aria-label="v2c" style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-continuous-scale
            channel="x"
            type="log"
            min="0"
            max="100"
          >
            ${SIBLING}
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    assert.strictEqual(
      messageOf(said("V2")[0]),
      "a log domain cannot cross or touch zero — " + "[0, 100] does",
    );
    assert.isTrue(paints(okProbe(view).uid));
  });

  test("V2 — a positive log domain is silent", async () => {
    const [, view] = await mount(html`
      <hdml-view aria-label="v2d" style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-continuous-scale
            channel="x"
            type="log"
            min="1"
            max="100"
          >
            ${SIBLING}
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    assert.lengthOf(said("V2"), 0);
    assert.deepEqual(diagnosticsOf(view), []);
  });

  test("a valid view produces zero diagnostics", async () => {
    // The assertion every corpus gate from step 25 on is built out
    // of.
    const [, view] = await mount(html`
      <hdml-view aria-label="ok" style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-ordinal-scale values='["a"]' channel="x">
            <hdml-continuous-scale min="0" max="1" channel="y">
              <hdml-axis channel="x"></hdml-axis>
              <hdml-bar x="m" y="v"></hdml-bar>
            </hdml-continuous-scale>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    assert.deepEqual(diagnosticsOf(view), []);
    assert.deepEqual(
      lines.filter((l) => l.startsWith("hdml ")),
      [],
    );
    assert.lengthOf(errs, 0);
    assert.isFalse(view.matches(":state(error)"));
  });
});
