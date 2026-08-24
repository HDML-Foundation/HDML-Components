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
import type { DiagnosticCode, WarningCode } from "./validate";
import type { HdvlElement } from "./base";

/** The one source ref the V2 fixtures subscribe to. */
const REF = "?hdml-frame=v2";

/**
 * §8.1's whole error-code space, spelled out.
 *
 * The annotation is what makes it an assertion rather than a list:
 * a `Record<DiagnosticCode, …>` literal must name **every** member
 * and may name no other, so a twenty-third code is a `compile_tst`
 * failure in this file and a deleted one is too. Step 12 landed all
 * twenty-one at once for H5's reason; step 21 added the
 * twenty-second as a §8 amendment; **step 22 added four rules and
 * no code at all.**
 */
const CODES: Readonly<Record<DiagnosticCode, true>> = {
  "no-scale-in-scope": true,
  "duplicate-scale": true,
  "kind-mismatch": true,
  "bad-binding-grammar": true,
  "unknown-field": true,
  "length-mismatch": true,
  "container-binding": true,
  "container-source": true,
  "unresolved-domain": true,
  "wrong-plane-channel": true,
  "ref-in-channel": true,
  "heterogeneous-children": true,
  "bad-format-skeleton": true,
  "exclusive-guide-attrs": true,
  "container-composition": true,
  "modifier-kind": true,
  "missing-binding": true,
  "channel-guide-fit": true,
  "palette-exhausted": true,
  "all-rows-dropped": true,
  "negative-pie-value": true,
  "varying-path-color": true,
};

/**
 * §8.1's whole **warning**-code space, spelled the same way and for
 * the same reason.
 *
 * Six of the seven are W-rules' — W1 through W6, one each. The
 * seventh is **V7's**, added at step 27 as a §8 amendment: SPEC
 * §11 makes the row-order clause a *warning* ("the validator warns
 * where it can see"), and a warning carries a `WarningCode` by
 * §8.1's own disjointness rule, so a V-rule that warns needs one.
 * The 1:1 code↔rule mapping the six had was a property of there
 * being no such rule yet, not a contract.
 */
const WARNINGS: Readonly<Record<WarningCode, true>> = {
  "unknown-construct": true,
  "missing-accessible-name": true,
  "colorless-series": true,
  "node-budget": true,
  "detection-disabled": true,
  "unsupported-url-reference": true,
  "unpinned-row-order": true,
};

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
      <hdml-view
        aria-label="u"
        source="${REF}"
        style="width: 400px; height: 200px"
      >
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
      <hdml-view
        aria-label="e"
        source="${REF}"
        style="width: 400px; height: 200px"
      >
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
      <hdml-view
        aria-label="i"
        source="${REF}"
        style="width: 400px; height: 200px"
      >
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
      <hdml-view
        aria-label="r"
        source="${REF}"
        style="width: 400px; height: 200px"
      >
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
      <hdml-view
        aria-label="w5"
        source="${REF}"
        style="width: 400px; height: 200px"
      >
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

  // ---------------------------------------------------------------
  // Step 22's four rules — V4 · V5 · V9 · V19. Every message is
  // HARDCODED, for the reason §8.4 gives.
  // ---------------------------------------------------------------

  /**
   * A cartesian `x`/`y` chain with a rendering probe beside it, so
   * "a sibling still renders" is real on every fixture below.
   */
  const CHAIN = (
    widget: ReturnType<typeof html>,
  ): ReturnType<typeof html> => html`
    <hdml-cartesian-plane>
      <hdml-continuous-scale channel="x" min="0" max="1">
        <hdml-continuous-scale channel="y" min="0" max="1">
          ${widget}
        </hdml-continuous-scale>
        ${SIBLING}
      </hdml-continuous-scale>
    </hdml-cartesian-plane>
  `;

  /** One numeric column, for the two delivery-driven fixtures. */
  const COLUMN = {
    values: undefined,
    nulls: undefined,
    domain: <const>{
      kind: "extent",
      value: <[number, number]>[0, 1],
    },
    type: <const>{ kind: "number" },
  };

  test("V4 — a bare identifier with no source", async () => {
    const [, view] = await mount(html`
      <hdml-view aria-label="v4a" style="width: 400px; height: 200px">
        ${CHAIN(html`<hdml-point x="units" y="[0]"></hdml-point>`)}
      </hdml-view>
    `);
    const point = <Element>view.querySelector("hdml-point");
    assert.strictEqual(
      messageOf(said("V4")[0]),
      'x="units" names a field, but no source is in scope — ' +
        "add source= here or on an ancestor",
    );
    assert.lengthOf(said("V4"), 1);
    assert.isTrue(point.matches(":state(error)"));
    assert.strictEqual(errs[0].detail.code, "unknown-field");
    assert.isTrue(paints(okProbe(view).uid));
  });

  test("V4 — a local ref that has no such field", async () => {
    // §8.3: "an in-page ?hdml-frame= ref is checkable locally".
    const [, view] = await mount(html`
      <div>
        <hdml-frame name="f">
          <hdml-field name="units"></hdml-field>
          <hdml-group-by>
            <hdml-field name="units"></hdml-field>
          </hdml-group-by>
        </hdml-frame>
        <hdml-view
          aria-label="v4b"
          source="?hdml-frame=f"
          style="width: 400px; height: 200px"
        >
          ${CHAIN(html`<hdml-point x="unit" y="[0]"></hdml-point>`)}
        </hdml-view>
      </div>
    `);
    assert.strictEqual(
      messageOf(said("V4")[0]),
      'no field "unit" in ?hdml-frame=f — check the field names',
    );
    assert.isTrue(paints(okProbe(view).uid));
  });

  test("V4 — the same ref, spelled right, is silent", async () => {
    const [, view] = await mount(html`
      <div>
        <hdml-frame name="f">
          <hdml-field name="units"></hdml-field>
        </hdml-frame>
        <hdml-view
          aria-label="v4c"
          source="?hdml-frame=f"
          style="width: 400px; height: 200px"
        >
          ${CHAIN(html`<hdml-point x="units" y="[0]"></hdml-point>`)}
        </hdml-view>
      </div>
    `);
    assert.lengthOf(said("V4"), 0);
    assert.deepEqual(diagnosticsOf(view), []);
  });

  test("V4 — the runtime half, on an absent delivery", async () => {
    // The static-ref completion §8.3 defers to the binding pass:
    // the generation arrived and the column is not in it.
    mountFakeIo({
      [REF]: { generation: 1, rows: 2, columns: { good: COLUMN } },
    });
    const [, view] = await mount(html`
      <hdml-view
        aria-label="v4d"
        source="${REF}"
        style="width: 400px; height: 200px"
      >
        ${CHAIN(html`<hdml-point x="typo" y="[0, 1]"></hdml-point>`)}
      </hdml-view>
    `);
    const point = <Element>view.querySelector("hdml-point");
    assert.strictEqual(
      messageOf(said("V4")[0]),
      '?hdml-frame=v2 delivered no field "typo" — ' +
        "check the column name",
    );
    assert.isTrue(point.matches(":state(error)"));
    assert.isTrue(paints(okProbe(view).uid));
  });

  test("★ V5 — two literal arrays of unequal length", async () => {
    const [, view] = await mount(html`
      <hdml-view aria-label="v5a" style="width: 400px; height: 200px">
        ${CHAIN(
          html`<hdml-point x="[0, 0.5, 1]" y="[0, 1]"></hdml-point>`,
        )}
      </hdml-view>
    `);
    const point = <Element>view.querySelector("hdml-point");
    assert.strictEqual(
      messageOf(said("V5")[0]),
      "x has 3 rows and y has 2 — a widget's bindings must " +
        "agree in length; scalars broadcast",
    );
    assert.lengthOf(said("V5"), 1);
    assert.isTrue(point.matches(":state(error)"));
    assert.strictEqual(errs[0].detail.code, "length-mismatch");
    assert.isTrue(paints(okProbe(view).uid));
  });

  test("★ V5 — a column disagrees with a literal", async () => {
    // §8.3 says "against `rows`", and this is that: the count comes
    // from the delivery, never from a values buffer.
    mountFakeIo({
      [REF]: { generation: 1, rows: 2, columns: { col: COLUMN } },
    });
    const [, view] = await mount(html`
      <hdml-view
        aria-label="v5b"
        source="${REF}"
        style="width: 400px; height: 200px"
      >
        ${CHAIN(
          html`<hdml-point x="col" y="[0, 0.5, 1]"></hdml-point>`,
        )}
      </hdml-view>
    `);
    assert.strictEqual(
      messageOf(said("V5")[0]),
      "x has 2 rows and y has 3 — a widget's bindings must " +
        "agree in length; scalars broadcast",
    );
    assert.isTrue(paints(okProbe(view).uid));
  });

  test("★ V5 — scalars broadcast and are not counted", async () => {
    const [, view] = await mount(html`
      <hdml-view aria-label="v5c" style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-continuous-scale channel="x" min="0" max="1">
            <hdml-continuous-scale channel="y" min="0" max="1">
              <hdml-ordinal-scale channel="color" values='["N"]'>
                <hdml-point
                  x="[0, 0.5, 1]"
                  y="[0, 0.5, 1]"
                  color='"N"'
                ></hdml-point>
              </hdml-ordinal-scale>
            </hdml-continuous-scale>
            ${SIBLING}
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    assert.lengthOf(said("V5"), 0);
    assert.deepEqual(diagnosticsOf(view), []);
  });

  test("★ V9 — a polar channel under a cartesian plane", async () => {
    const [, view] = await mount(html`
      <hdml-view aria-label="v9a" style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-continuous-scale channel="angle" min="0" max="1">
            <hdml-continuous-scale channel="radius" min="0" max="1">
              <hdml-point angle="[0, 1]" radius="[0, 1]"></hdml-point>
            </hdml-continuous-scale>
            ${SIBLING}
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const point = <Element>view.querySelector("hdml-point");
    assert.strictEqual(
      messageOf(said("V9")[0]),
      'channel "angle" is not this plane\'s — ' +
        "it anchors x and y",
    );
    assert.lengthOf(said("V9"), 1);
    // V9 runs BEFORE V19, so the page that says "wrong plane" does
    // not also say "missing x" — one unit, one diagnostic, and the
    // one that fixes the page.
    assert.lengthOf(said("V19"), 0);
    assert.isTrue(point.matches(":state(error)"));
    assert.strictEqual(errs[0].detail.code, "wrong-plane-channel");
    assert.isTrue(paints(okProbe(view).uid));
  });

  test("★ V9 — a cartesian channel under a polar plane", async () => {
    const [, view] = await mount(html`
      <hdml-view aria-label="v9b" style="width: 400px; height: 200px">
        <hdml-polar-plane>
          <hdml-continuous-scale channel="x" min="0" max="1">
            <hdml-continuous-scale channel="y" min="0" max="1">
              <hdml-point x="[0, 1]" y="[0, 1]"></hdml-point>
            </hdml-continuous-scale>
            ${SIBLING}
          </hdml-continuous-scale>
        </hdml-polar-plane>
      </hdml-view>
    `);
    assert.strictEqual(
      messageOf(said("V9")[0]),
      'channel "x" is not this plane\'s — ' +
        "it anchors angle and radius",
    );
    assert.isTrue(paints(okProbe(view).uid));
  });

  test("V9 — x and y under a cartesian plane pass", async () => {
    const [, view] = await mount(html`
      <hdml-view aria-label="v9c" style="width: 400px; height: 200px">
        ${CHAIN(
          html`<hdml-point x="[0, 1]" y="[0, 1]"></hdml-point>`,
        )}
      </hdml-view>
    `);
    assert.lengthOf(said("V9"), 0);
    assert.deepEqual(diagnosticsOf(view), []);
  });

  test("★ V19 — a missing channel, never implied", async () => {
    // The clause that forbids the obvious convenience: a point with
    // only `y` must ERROR, not fall back to the row number.
    const [, view] = await mount(html`
      <hdml-view
        aria-label="v19a"
        style="width: 400px; height: 200px"
      >
        ${CHAIN(html`<hdml-point y="[0, 1]"></hdml-point>`)}
      </hdml-view>
    `);
    const point = <Element>view.querySelector("hdml-point");
    assert.strictEqual(
      messageOf(said("V19")[0]),
      'no binding for channel "x" — hdml-point needs x',
    );
    assert.lengthOf(said("V19"), 1);
    assert.isTrue(point.matches(":state(error)"));
    assert.strictEqual(errs[0].detail.code, "missing-binding");
    assert.strictEqual(errs[0].detail.channel, "x");
    // Nothing was invented: the widget paints no group at all.
    assert.isFalse(paints((<HdvlElement>(<unknown>point)).uid));
    assert.isTrue(paints(okProbe(view).uid));
  });

  test("★ V19 — the ranged spelling satisfies it", async () => {
    const [, view] = await mount(html`
      <hdml-view
        aria-label="v19b"
        style="width: 400px; height: 200px"
      >
        <hdml-cartesian-plane>
          <hdml-ordinal-scale channel="x" values='["a", "b"]'>
            <hdml-continuous-scale channel="y" min="0" max="1">
              <hdml-bar
                x='["a", "b"]'
                y0="[0, 0]"
                y1="[1, 1]"
              ></hdml-bar>
            </hdml-continuous-scale>
            ${SIBLING}
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    assert.lengthOf(said("V19"), 0);
    assert.deepEqual(diagnosticsOf(view), []);
  });

  test("★ V19 — a bar with neither y spelling", async () => {
    const [, view] = await mount(html`
      <hdml-view
        aria-label="v19c"
        style="width: 400px; height: 200px"
      >
        <hdml-cartesian-plane>
          <hdml-ordinal-scale channel="x" values='["a", "b"]'>
            <hdml-continuous-scale channel="y" min="0" max="1">
              <hdml-bar x='["a", "b"]' y1="[1, 1]"></hdml-bar>
            </hdml-continuous-scale>
            ${SIBLING}
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    // Half a ranged pair is not a range: §6.1's grammar is
    // (y | y0,y1), both or neither.
    assert.strictEqual(
      messageOf(said("V19")[0]),
      'no binding for channel "y" — hdml-bar needs y, or y0 and y1',
    );
    assert.isTrue(paints(okProbe(view).uid));
  });

  test("★ V19 — hdml-rule needs exactly one of x/y", async () => {
    const [, view] = await mount(html`
      <hdml-view
        aria-label="v19d"
        style="width: 400px; height: 200px"
      >
        ${CHAIN(html`<hdml-rule></hdml-rule>`)}
      </hdml-view>
    `);
    assert.strictEqual(
      messageOf(said("V19")[0]),
      'no binding for channel "x" — hdml-rule needs x, or y',
    );
    assert.isTrue(paints(okProbe(view).uid));
  });

  test("★ V19 — the arc's a0/a1 form satisfies it", async () => {
    const [, view] = await mount(html`
      <hdml-view
        aria-label="v19e"
        style="width: 200px; height: 200px"
      >
        <hdml-polar-plane>
          <hdml-continuous-scale channel="angle" min="0" max="1">
            <hdml-continuous-scale channel="radius" min="0" max="1">
              <hdml-arc a0="[0]" a1="[1]"></hdml-arc>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-polar-plane>
      </hdml-view>
    `);
    assert.lengthOf(said("V19"), 0);
    assert.deepEqual(diagnosticsOf(view), []);
  });

  test("★ V19 — an arc binding no angle at all", async () => {
    await mount(html`
      <hdml-view
        aria-label="v19f"
        style="width: 200px; height: 200px"
      >
        <hdml-polar-plane>
          <hdml-continuous-scale channel="angle" min="0" max="1">
            <hdml-continuous-scale channel="radius" min="0" max="1">
              <hdml-arc radius="[1]"></hdml-arc>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-polar-plane>
      </hdml-view>
    `);
    assert.strictEqual(
      messageOf(said("V19")[0]),
      'no binding for channel "angle" — ' +
        "hdml-arc needs a0 and a1, or angle",
    );
  });

  test("★ the four rules edge-trigger like every other", async () => {
    // R25, on the newest rules: an unchanged violation re-derived
    // every frame reports exactly once.
    const [, view] = await mount(html`
      <hdml-view aria-label="v22" style="width: 400px; height: 200px">
        ${CHAIN(html`<hdml-point y="[0, 1]"></hdml-point>`)}
      </hdml-view>
    `);
    for (let i = 0; i < 5; i++) {
      view.reindex();
      await quiesce(view);
    }
    assert.lengthOf(said("V19"), 1);
    assert.lengthOf(errs, 1);
    // And recovery clears it, dispatching nothing (§10).
    const point = <Element>view.querySelector("hdml-point");
    lines.length = 0;
    errs.length = 0;
    point.setAttribute("x", "[0, 1]");
    view.reindex();
    await quiesce(view);
    assert.isFalse(point.matches(":state(error)"));
    assert.lengthOf(errs, 0);
    assert.deepEqual(diagnosticsOf(view), []);
  });

  // ---------------------------------------------------------------
  // Step 24's rules — V20(a) · V16 · V14's ordinal clause. Every
  // message is HARDCODED, for the reason §8.4 gives.
  // ---------------------------------------------------------------

  /** A guide beside a rendering probe, so "a sibling still renders"
   *  is real on every fixture below. */
  const GUIDES = (
    widget: ReturnType<typeof html>,
  ): ReturnType<typeof html> => html`
    <hdml-cartesian-plane>
      <hdml-ordinal-scale channel="x" values='["a","b"]'>
        <hdml-continuous-scale channel="y" min="0" max="1">
          ${widget}
          <hdvl-probe id="ok"></hdvl-probe>
        </hdml-continuous-scale>
      </hdml-ordinal-scale>
    </hdml-cartesian-plane>
  `;

  test("★ V16 — two of count, step and values", async () => {
    const [, view] = await mount(html`
      <hdml-view
        aria-label="v16a"
        style="width: 400px; height: 200px"
      >
        ${GUIDES(html`
          <hdml-tick
            channel="y"
            count="3"
            values="[0, 1]"
          ></hdml-tick>
        `)}
      </hdml-view>
    `);
    const bad = <Element>view.querySelector("hdml-tick");
    assert.lengthOf(said("V16"), 1);
    assert.strictEqual(
      messageOf(said("V16")[0]),
      "count and values are mutually exclusive — " +
        'keep one on <hdml-tick channel="y">',
    );
    assert.isTrue(bad.matches(":state(error)"));
    assert.isFalse(view.matches(":state(error)"));
    assert.strictEqual(errs[0].detail.code, "exclusive-guide-attrs");
    assert.strictEqual(errs[0].detail.rule, "V16");
    // …and the sibling still renders.
    assert.isTrue(paints(okProbe(view).uid));
  });

  test("V16 — all three names the three", async () => {
    const [, view] = await mount(html`
      <hdml-view
        aria-label="v16b"
        style="width: 400px; height: 200px"
      >
        ${GUIDES(html`
          <hdml-label
            channel="y"
            count="3"
            step="0.5"
            values="[0, 1]"
          ></hdml-label>
        `)}
      </hdml-view>
    `);
    assert.strictEqual(
      messageOf(said("V16")[0]),
      "count, step and values are mutually exclusive — " +
        'keep one on <hdml-label channel="y">',
    );
    assert.isTrue(paints(okProbe(view).uid));
  });

  test("V16 — one of the three is fine", async () => {
    const [, view] = await mount(html`
      <hdml-view
        aria-label="v16c"
        style="width: 400px; height: 200px"
      >
        ${GUIDES(html`
          <hdml-grid channel="y" count="3"></hdml-grid>
          <hdml-tick channel="y" step="0.5"></hdml-tick>
          <hdml-label channel="y" values="[0, 1]"></hdml-label>
        `)}
      </hdml-view>
    `);
    assert.lengthOf(said("V16"), 0);
    assert.isTrue(paints(okProbe(view).uid));
  });

  test("★ V16 — hdml-axis takes none of them", async () => {
    const [, view] = await mount(html`
      <hdml-view
        aria-label="v16d"
        style="width: 400px; height: 200px"
      >
        ${GUIDES(html`
          <hdml-axis channel="y" count="3" step="0.5"></hdml-axis>
        `)}
      </hdml-view>
    `);
    const bad = <Element>view.querySelector("hdml-axis");
    assert.lengthOf(said("V16"), 1);
    assert.strictEqual(
      messageOf(said("V16")[0]),
      "hdml-axis takes no count, step or values — it spans the " +
        "whole range; remove count and step",
    );
    assert.isTrue(bad.matches(":state(error)"));
    assert.strictEqual(errs[0].detail.code, "exclusive-guide-attrs");
    // ★ §8.3: a rule REPORTS, it does not stop the paint. The axis
    // still paints its group beside the probe.
    assert.isTrue(paints((<HdvlElement>(<unknown>bad)).uid));
    assert.isTrue(paints(okProbe(view).uid));
  });

  test("V16 — an empty attribute reads as absent", async () => {
    const [, view] = await mount(html`
      <hdml-view
        aria-label="v16e"
        style="width: 400px; height: 200px"
      >
        ${GUIDES(html`
          <hdml-tick channel="y" count="3" step=""></hdml-tick>
        `)}
      </hdml-view>
    `);
    assert.lengthOf(said("V16"), 0);
    assert.isTrue(paints(okProbe(view).uid));
  });

  test("★ V20 — a guide on the color channel", async () => {
    const [, view] = await mount(html`
      <hdml-view
        aria-label="v20a"
        style="width: 400px; height: 200px"
      >
        ${GUIDES(html` <hdml-axis channel="color"></hdml-axis> `)}
      </hdml-view>
    `);
    const bad = <Element>view.querySelector("hdml-axis");
    assert.lengthOf(said("V20"), 1);
    // SPEC §7's own words, verbatim.
    assert.strictEqual(
      messageOf(said("V20")[0]),
      "the color channel has no positions — use hdml-legend",
    );
    assert.isTrue(bad.matches(":state(error)"));
    assert.strictEqual(errs[0].detail.code, "channel-guide-fit");
    assert.strictEqual(errs[0].detail.rule, "V20");
    assert.strictEqual(errs[0].detail.channel, "color");
    // ★ V20 beats V1: "add a color scale" is a fix leading
    // nowhere, and there is no color scale in this chain.
    assert.lengthOf(said("V1"), 0);
    assert.isTrue(paints(okProbe(view).uid));
  });

  test("V20 — the size channel names the four instead", async () => {
    const [, view] = await mount(html`
      <hdml-view
        aria-label="v20b"
        style="width: 400px; height: 200px"
      >
        ${GUIDES(html` <hdml-label channel="size"></hdml-label> `)}
      </hdml-view>
    `);
    assert.strictEqual(
      messageOf(said("V20")[0]),
      "the size channel has no positions — a guide binds " +
        "x, y, angle or radius",
    );
    assert.isTrue(paints(okProbe(view).uid));
  });

  test("★ V20 beats V16 on an element doing both", async () => {
    // Stated order: a guide that cannot address its channel at all
    // gets the message that fixes it, not the one about its spec.
    const [, view] = await mount(html`
      <hdml-view
        aria-label="v20c"
        style="width: 400px; height: 200px"
      >
        ${GUIDES(html`
          <hdml-tick channel="color" count="3" step="0.5"></hdml-tick>
        `)}
      </hdml-view>
    `);
    assert.lengthOf(said("V20"), 1);
    assert.lengthOf(said("V16"), 0);
    assert.strictEqual(errs[0].detail.code, "channel-guide-fit");
    assert.isTrue(paints(okProbe(view).uid));
  });

  test("★ V14 — format on an ordinal-resolved label", async () => {
    // The plan's scheduled D1 escalation for step 24, decided with
    // the user on 2026-08-23: `format` where SPEC §7 renders the
    // domain strings verbatim is an error, symmetric with the one
    // V20 already files on an ordinal legend.
    const [, view] = await mount(html`
      <hdml-view
        aria-label="v14a"
        style="width: 400px; height: 200px"
      >
        ${GUIDES(html`
          <hdml-label channel="x" format="MMM"></hdml-label>
        `)}
      </hdml-view>
    `);
    const bad = <Element>view.querySelector("hdml-label");
    assert.lengthOf(said("V14"), 1);
    assert.strictEqual(
      messageOf(said("V14")[0]),
      "format applies to a continuous or datetime channel — " +
        "an ordinal channel renders its domain strings verbatim",
    );
    assert.isTrue(bad.matches(":state(error)"));
    assert.strictEqual(errs[0].detail.code, "bad-format-skeleton");
    assert.strictEqual(errs[0].detail.rule, "V14");
    assert.strictEqual(errs[0].detail.channel, "x");
    // §8.3 again: it reports, and the label still paints.
    assert.isTrue(paints((<HdvlElement>(<unknown>bad)).uid));
    assert.isTrue(paints(okProbe(view).uid));
  });

  test("V14 — format on a continuous channel is fine", async () => {
    const [, view] = await mount(html`
      <hdml-view
        aria-label="v14b"
        style="width: 400px; height: 200px"
      >
        ${GUIDES(html`
          <hdml-label channel="y" format="compact-short"></hdml-label>
        `)}
      </hdml-view>
    `);
    assert.lengthOf(said("V14"), 0);
    assert.isTrue(paints(okProbe(view).uid));
  });

  test("★ V16 beats V14 on an element doing both", async () => {
    const [, view] = await mount(html`
      <hdml-view
        aria-label="v14c"
        style="width: 400px; height: 200px"
      >
        ${GUIDES(html`
          <hdml-label
            channel="x"
            count="3"
            values='["a"]'
            format="MMM"
          ></hdml-label>
        `)}
      </hdml-view>
    `);
    assert.lengthOf(said("V16"), 1);
    assert.lengthOf(said("V14"), 0);
    assert.isTrue(paints(okProbe(view).uid));
  });

  test("★ R25 — the guide rules are edge-triggered", async () => {
    const [, view] = await mount(html`
      <hdml-view
        aria-label="v16f"
        style="width: 400px; height: 200px"
      >
        ${GUIDES(html`
          <hdml-tick channel="y" count="3" step="0.5"></hdml-tick>
        `)}
      </hdml-view>
    `);
    const bad = <Element>view.querySelector("hdml-tick");
    assert.lengthOf(said("V16"), 1);
    assert.lengthOf(errs, 1);

    // Re-validating the SAME violation reports nothing more — the
    // identity is `(rule, code, channel, message)`, and the message
    // names the attributes, not their values.
    bad.setAttribute("count", "4");
    view.markDirty();
    await quiesce(view);
    assert.lengthOf(said("V16"), 1);
    assert.lengthOf(errs, 1);

    // …and RECOVERY dispatches nothing at all (§10 defines no
    // resolution event): the state goes and the queue stays put.
    bad.removeAttribute("step");
    view.markDirty();
    await quiesce(view);
    assert.isFalse(bad.matches(":state(error)"));
    assert.lengthOf(said("V16"), 1);
    assert.lengthOf(errs, 1);
  });

  test("★ the code space is still twenty-two", () => {
    // A `Record<DiagnosticCode, …>` literal is exhaustive AND
    // closed, so a twenty-third code fails `compile_tst` — before
    // any browser starts — and a deleted one fails here. Step 22
    // added four rules and no code: all four were already in the
    // union step 12 landed whole (H5).
    assert.lengthOf(Object.keys(CODES), 22);
    // …and the warning space, whose seventh member is V7's rather
    // than a W-rule's (step 27).
    assert.lengthOf(Object.keys(WARNINGS), 7);
    assert.property(WARNINGS, "unpinned-row-order");
    for (const code of [
      "unknown-field",
      "length-mismatch",
      "wrong-plane-channel",
      "missing-binding",
    ]) {
      assert.property(CODES, code);
    }
  });

  test("V7 — a local frame pinning no row order warns", async () => {
    // SPEC §11: "row order is slice order"; the duty attaches to
    // the FRAME, and the fix lives where the frame lives. It is a
    // WARNING — the page is not wrong, it is unstable between
    // refreshes — so nothing blanks and the pie still paints.
    const [host, view] = await mount(html`
      <div>
        <hdml-frame name="unpinned" source="/w/s.html?hdml-model=m">
          <hdml-field name="v" type="float-64"></hdml-field>
        </hdml-frame>
        <hdml-view
          aria-label="v7"
          source="?hdml-frame=unpinned"
          style="width: 200px; height: 200px"
        >
          <hdml-polar-plane>
            <hdml-continuous-scale channel="angle" min="0" max="1">
              <hdml-continuous-scale channel="radius" min="0" max="9">
                <hdml-pie angle="v"></hdml-pie>
              </hdml-continuous-scale>
            </hdml-continuous-scale>
          </hdml-polar-plane>
        </hdml-view>
      </div>
    `);
    const pie = <Element>host.querySelector("hdml-pie");
    assert.lengthOf(said("V7"), 1);
    assert.strictEqual(
      messageOf(said("V7")[0]),
      "row order is slice order — pin it with <hdml-sort-by> " +
        'in "unpinned"',
    );
    // §8.3: a warning never blanks and never sets `:state(error)`.
    assert.isFalse(pie.matches(":state(error)"));
    assert.isFalse(view.matches(":state(error)"));
    // Console-only — a warning dispatches no `hdml-error`.
    assert.lengthOf(errs, 0);
    const found = diagnosticsOf(view).filter((d) => d.rule === "V7");
    assert.lengthOf(found, 1);
    assert.strictEqual(found[0].severity, "warning");
    assert.strictEqual(found[0].code, "unpinned-row-order");
  });

  test("V7 — a pinned local frame is silent", async () => {
    const [, view] = await mount(html`
      <div>
        <hdml-frame name="pinned" source="/w/s.html?hdml-model=m">
          <hdml-field name="v" type="float-64"></hdml-field>
          <hdml-sort-by>
            <hdml-field name="v" order="asc"></hdml-field>
          </hdml-sort-by>
        </hdml-frame>
        <hdml-view
          aria-label="v7b"
          source="?hdml-frame=pinned"
          style="width: 200px; height: 200px"
        >
          <hdml-polar-plane>
            <hdml-continuous-scale channel="angle" min="0" max="1">
              <hdml-continuous-scale channel="radius" min="0" max="9">
                <hdml-pie angle="v"></hdml-pie>
              </hdml-continuous-scale>
            </hdml-continuous-scale>
          </hdml-polar-plane>
        </hdml-view>
      </div>
    `);
    assert.lengthOf(said("V7"), 0);
    assert.deepEqual(
      diagnosticsOf(view).filter((d) => d.rule === "V7"),
      [],
    );
  });

  test("★ V7's LOCALITY — a static ref stays silent", async () => {
    // SPEC §11 scopes the warning to "local `?` refs — V4's
    // locality". A ref carrying a path names another document, so
    // the page cannot know whether that frame pins order, and
    // "add a sort to a frame I have never seen" is a claim §1.5
    // would rather not make. The pie below has NO in-page frame at
    // all and the validator says nothing about its order.
    const [, view] = await mount(html`
      <hdml-view
        aria-label="v7c"
        source="/warehouse/sales.html?hdml-frame=remote"
        style="width: 200px; height: 200px"
      >
        <hdml-polar-plane>
          <hdml-continuous-scale channel="angle" min="0" max="1">
            <hdml-continuous-scale channel="radius" min="0" max="9">
              <hdml-pie angle="v"></hdml-pie>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-polar-plane>
      </hdml-view>
    `);
    assert.lengthOf(said("V7"), 0);
    // …and a literal pie, which has no frame at all, likewise: the
    // author wrote the order themselves, in the document.
    const [, other] = await mount(html`
      <hdml-view aria-label="v7d" style="width: 200px; height: 200px">
        <hdml-polar-plane>
          <hdml-continuous-scale channel="angle" min="0" max="1">
            <hdml-continuous-scale channel="radius" min="0" max="9">
              <hdml-pie angle="[1, 2, 3]"></hdml-pie>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-polar-plane>
      </hdml-view>
    `);
    assert.lengthOf(said("V7"), 0);
    assert.deepEqual(
      diagnosticsOf(other).filter((d) => d.rule === "V7"),
      [],
    );
    void view;
  });

  test("a valid view produces zero diagnostics", async () => {
    // The assertion every corpus gate from step 25 on is built out
    // of.
    const [, view] = await mount(html`
      <hdml-view
        aria-label="ok"
        source="${REF}"
        style="width: 400px; height: 200px"
      >
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
