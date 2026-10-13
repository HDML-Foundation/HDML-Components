/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert, fixture } from "@open-wc/testing";
import { html } from "lit/static-html.js";
import { LitElement } from "lit";
import "./index";
import type { SceneNode } from "./scene";
import type { SceneGroup } from "./scene";
import {
  installSceneRecorder,
  restoreRenderers,
  sceneOf,
} from "../testing/scene-of";
import { HdmlViewElement } from "./view";
import { HdmlTextElement } from "./mark-text";
import { diagnosticsOf } from "./validate";

/**
 * `hdml-text` — the **seventh mark** and the 22nd display tag
 * (019 item 5, Note 003 §7).
 *
 * Four things here are claims rather than geometry, and each is
 * asserted against the thing that could be wrong rather than
 * against a transcribed number:
 *
 * - ★★★ **V1 does NOT fire for `text`.** This is the structural
 *   claim D9 rests on — `text` is a slot outside the closed
 *   `CHANNEL_ATTRS` table, so it contributes no required channel
 *   and needs no scale (Note 003 §2.2). It had never been executed
 *   before this file, and it is asserted **against the real
 *   validator**, beside a control that proves the same fixture
 *   still raises V1 for a bound `x` with no x scale.
 * - ★ **`text` IS required, under V19's existing code.** A text
 *   mark that prints nothing is a no-op with a box. No 25th
 *   `DiagnosticCode` is minted — row 44 owns that — and the
 *   finding carries **no `channel`**, because `text` is not one.
 * - ★ **`--hdml-text-rotate` and `--hdml-text-anchor` work with no
 *   new code**, which is why 017 R2 named the family for the run
 *   rather than for the label.
 * - ★ **§4.9's coherence is a property of the SET.** A continuous
 *   `text` column takes one shared compact prefix across the whole
 *   mark, never one per row.
 *
 * **Literal-only fixtures, `padding: 0`**, at 400 × 200 with an `x`
 * domain of `[0, 4]` and a `y` domain of `[0, 200]` — so `at(x)` is
 * `x · 100` and `at(y)` is `200 − y`, both exact.
 */

/** Rule 3's precision, in one place. */
const P = { precision: 6 };

let lines: string[] = [];
let realWarn: typeof console.warn;
let realError: typeof console.error;

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

async function mount(
  markup: ReturnType<typeof html>,
): Promise<HdmlViewElement> {
  const view = await fixture<HdmlViewElement>(markup);
  await settle(view);
  view.markDirty();
  await quiesce(view);
  return view;
}

/** The one group a single-mark fixture paints. */
function only(view: HdmlViewElement): SceneGroup {
  const groups = sceneOf(view, P).groups;
  assert.lengthOf(groups, 1, "expected exactly one group");
  return groups[0];
}

type TextNode = Extract<SceneNode, { k: "text" }>;

function runs(view: HdmlViewElement): TextNode[] {
  const out: TextNode[] = [];
  for (const node of only(view).nodes) {
    assert.strictEqual(node.k, "text");
    out.push(<TextNode>node);
  }
  return out;
}

function textOf(view: HdmlViewElement): HdmlTextElement {
  return <HdmlTextElement>view.querySelector("hdml-text");
}

/** A computed `--hdml-*` value, with `currentcolor` resolved. */
function paintProp(el: Element, name: string): string {
  const style = getComputedStyle(el);
  const raw = style.getPropertyValue(name).trim();
  return raw.toLowerCase() === "currentcolor" ? style.color : raw;
}

function said(prefix: string): string[] {
  return lines.filter((l) => l.startsWith(prefix));
}

/** The 400 × 200 cartesian fixture. */
function page(
  x: string,
  y: string,
  text: string,
  style = "",
): ReturnType<typeof html> {
  return html`
    <hdml-view aria-label="tx" style="width: 400px; height: 200px">
      <hdml-cartesian-plane style="padding: 0">
        <hdml-continuous-scale channel="x" min="0" max="4">
          <hdml-continuous-scale channel="y" min="0" max="200">
            <hdml-text
              x="${x}"
              y="${y}"
              text="${text}"
              style="${style}"
            ></hdml-text>
          </hdml-continuous-scale>
        </hdml-continuous-scale>
      </hdml-cartesian-plane>
    </hdml-view>
  `;
}

suite("hdvl/mark-text — the seventh mark", () => {
  setup(() => {
    lines = [];
    realWarn = console.warn;
    realError = console.error;
    console.warn = (...args: unknown[]): void => {
      lines.push(String(args[0]));
    };
    console.error = (...args: unknown[]): void => {
      lines.push(String(args[0]));
    };
    installSceneRecorder();
  });

  teardown(() => {
    console.warn = realWarn;
    console.error = realError;
    restoreRenderers();
  });

  test("★ the tag is registered and is a mark", () => {
    const el = document.createElement("hdml-text");
    assert.instanceOf(el, HdmlTextElement);
    // `instanceOf` narrows, so neither read needs a cast — which
    // is itself the assertion: an unregistered tag upgrades to a
    // plain `HTMLElement` and `instanceOf` is what catches it.
    assert.strictEqual(el.tag, "hdml-text");
    assert.strictEqual(el.family, "mark");
  });

  test("★★★ one run per row, at its own datum", async () => {
    const view = await mount(
      page("[0, 1, 2]", "[50, 100, 150]", '["a", "b", "c"]'),
    );
    const el = textOf(view);
    const fill = paintProp(el, "--hdml-fill-color");
    const nodes = runs(view);
    assert.lengthOf(nodes, 3);
    // The `font` is transferred from the MEASURE snapshot, where
    // the `--hdml-font-*` family already resolved it, so it is read
    // back off the scene rather than transcribed — its value is
    // engine data and `hdml-label`'s suite owns the claim.
    assert.deepEqual(
      nodes,
      [
        { i: 0, x: 0, y: 150, text: "a" },
        { i: 1, x: 100, y: 100, text: "b" },
        { i: 2, x: 200, y: 50, text: "c" },
      ].map(
        (want, k): TextNode => ({
          k: "text",
          ...want,
          anchor: "middle",
          baseline: "middle",
          font: nodes[k].font,
          rotate: 0,
          decorative: false,
          fill,
          stroke: null,
          strokeWidth: 0,
          dash: null,
        }),
      ),
    );
    assert.deepEqual(diagnosticsOf(view), []);
  });

  test("★ its outline is neutralised like every filled mark", () => {
    // 017 R4's list gained a NINTH host at step 42. Without it the
    // registry's `1.5px` would stroke every printed run, which is
    // legal, plausible paint no golden could question.
    const el = document.createElement("hdml-text");
    document.body.appendChild(el);
    try {
      assert.strictEqual(
        getComputedStyle(el)
          .getPropertyValue("--hdml-line-width")
          .trim(),
        "0px",
      );
    } finally {
      el.remove();
    }
  });

  test("★ a missing value drops its row, not the set", async () => {
    const view = await mount(
      page("[0, 1, 2]", "[50, 100, 150]", '["a", null, "c"]'),
    );
    assert.deepEqual(
      runs(view).map((n) => [n.i, n.text]),
      [
        [0, "a"],
        [2, "c"],
      ],
    );
  });

  test("★★★ §4.9 formats the SET, with one prefix", async () => {
    // A per-row formatter would read `900K, 1.2M, 1.5M`, which is
    // the output §4.9 exists to prevent. The mark is the THIRD
    // caller of `hdml-label`'s `textsOf` and shares its set
    // function, so one compact prefix covers every run.
    const view = await mount(
      page(
        "[0, 1, 2]",
        "[50, 100, 150]",
        "[900000, 1200000, 1500000]",
        "--hdml-text-format: compact-short",
      ),
    );
    const texts = runs(view).map((n) => n.text);
    assert.lengthOf(texts, 3);
    for (const t of texts) {
      assert.match(t, /M$/, texts.join(" "));
    }
  });

  test("★ an ordinal column prints verbatim", async () => {
    const view = await mount(
      page(
        "[0, 1]",
        "[50, 100]",
        '["North", "South"]',
        "--hdml-text-format: compact-short",
      ),
    );
    // SPEC §7: an ordinal channel renders its domain strings
    // verbatim, and a skeleton over them is inert by contract.
    assert.deepEqual(
      runs(view).map((n) => n.text),
      ["North", "South"],
    );
  });

  test("★★ R2's two properties, with no new code", async () => {
    const view = await mount(
      page(
        "[0, 1]",
        "[50, 100]",
        '["a", "b"]',
        "--hdml-text-rotate: -45deg; --hdml-text-anchor: end",
      ),
    );
    for (const node of runs(view)) {
      assert.strictEqual(node.rotate, -45);
      assert.strictEqual(node.anchor, "end");
      // The BASELINE is never authored — R2 has a property for one
      // dimension only, exactly as on `hdml-label`.
      assert.strictEqual(node.baseline, "middle");
    }
  });

  test("★★★ CONTROL — no V1 for the `text` slot", async () => {
    // D9's structural claim, executed. `text` names a column with
    // NO scale anywhere in the chain for it, and that must be
    // legal: `checkV1` derives its required channels from the
    // closed `CHANNEL_ATTRS` table, and `text` is not in it.
    const view = await mount(
      page("[0, 1]", "[50, 100]", '["a", "b"]'),
    );
    assert.deepEqual(diagnosticsOf(view), []);
    assert.lengthOf(said("hdml V1 "), 0);
    assert.lengthOf(runs(view), 2);
  });

  test("★★★ CONTROL — a bound `x` with no scale V1s", async () => {
    // The other half, without which the assertion above would be
    // satisfied by a validator that had stopped running. Same
    // element, same fixture shape, one scale removed.
    const view = await mount(html`
      <hdml-view aria-label="v1" style="width: 400px; height: 200px">
        <hdml-cartesian-plane style="padding: 0">
          <hdml-continuous-scale channel="y" min="0" max="200">
            <hdml-text
              x="[0, 1]"
              y="[50, 100]"
              text='["a", "b"]'
            ></hdml-text>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const found = diagnosticsOf(view).filter((d) => d.rule === "V1");
    assert.lengthOf(found, 1);
    assert.strictEqual(found[0].channel, "x");
  });

  test("★★ V19 — `text` is required, and mints no code", async () => {
    const view = await mount(html`
      <hdml-view aria-label="v19" style="width: 400px; height: 200px">
        <hdml-cartesian-plane style="padding: 0">
          <hdml-continuous-scale channel="x" min="0" max="4">
            <hdml-continuous-scale channel="y" min="0" max="200">
              <hdml-text x="[0, 1]" y="[50, 100]"></hdml-text>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const found = diagnosticsOf(view).filter((d) => d.rule === "V19");
    assert.lengthOf(found, 1);
    // ★ V19's EXISTING code. The 25th is row 44's.
    assert.strictEqual(found[0].code, "missing-binding");
    // ★ …and no `channel`, because `text` is not one.
    assert.isUndefined(found[0].channel);
    assert.include(found[0].message, '"text"');
    assert.include(found[0].message, "no column to print");
    // Nothing is painted — a mark with nothing to print paints no
    // box of empty runs.
    assert.lengthOf(sceneOf(view, P).groups, 0);
  });

  test("★ V19 reports the missing `x` first", async () => {
    // The ORDER is a contract: an `hdml-text` with nothing bound
    // gets the positional message every other mark gives.
    const view = await mount(html`
      <hdml-view aria-label="ord" style="width: 400px; height: 200px">
        <hdml-cartesian-plane style="padding: 0">
          <hdml-continuous-scale channel="x" min="0" max="4">
            <hdml-continuous-scale channel="y" min="0" max="200">
              <hdml-text></hdml-text>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const found = diagnosticsOf(view).filter((d) => d.rule === "V19");
    assert.lengthOf(found, 3);
    assert.deepEqual(
      found.map((d) => d.channel),
      ["x", "y", undefined],
    );
  });

  test("★ it paints under a polar plane too", async () => {
    // H7 — the element names no channel, so both plane forms come
    // off `Projection.channels` with no branch here.
    const view = await mount(html`
      <hdml-view aria-label="pol" style="width: 400px; height: 400px">
        <hdml-polar-plane style="padding: 0">
          <hdml-continuous-scale
            channel="angle"
            min="0"
            max="4"
            style="--hdml-angle-start: 0deg; --hdml-angle-end: 360deg"
          >
            <hdml-continuous-scale channel="radius" min="0" max="100">
              <hdml-text
                angle="[0, 1]"
                radius="[0, 100]"
                text='["o", "r"]'
              ></hdml-text>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-polar-plane>
      </hdml-view>
    `);
    const nodes = runs(view);
    assert.lengthOf(nodes, 2);
    // Row 0 is at the pole; row 1 is a quarter turn out at the rim.
    assert.deepEqual(
      [nodes[0].x, nodes[0].y],
      [200, 200],
      "the pole",
    );
    assert.deepEqual(
      nodes.map((n) => n.text),
      ["o", "r"],
    );
    assert.deepEqual(diagnosticsOf(view), []);
  });

  test("★★ D9a — a simple bar's top is reachable", async () => {
    // Note 003 §3.2's first row, as behaviour. A sibling text at
    // the same binding lands exactly ON the bar's high edge.
    const view = await mount(html`
      <hdml-view aria-label="bar" style="width: 400px; height: 200px">
        <hdml-cartesian-plane style="padding: 0">
          <hdml-ordinal-scale channel="x" values='["jan","feb"]'>
            <hdml-continuous-scale channel="y" min="0" max="100">
              <hdml-bar x='["jan", "feb"]' y="[30, 20]"></hdml-bar>
              <hdml-text
                x='["jan", "feb"]'
                y="[30, 20]"
                text="[30, 20]"
              ></hdml-text>
            </hdml-continuous-scale>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const groups = sceneOf(view, P).groups;
    assert.lengthOf(groups, 2);
    const bars = groups[0].nodes;
    const texts = groups[1].nodes;
    assert.strictEqual(groups[1].tag, "hdml-text");
    for (let i = 0; i < 2; i++) {
      assert.strictEqual(bars[i].k, "rect");
      assert.strictEqual(texts[i].k, "text");
      const bar = <Extract<SceneNode, { k: "rect" }>>bars[i];
      const run = <TextNode>texts[i];
      // The bar's TOP edge, and the run pinned on it.
      assert.closeTo(run.y, bar.y, 1e-6);
    }
  });

  test("★★ D9a — a STACKED segment's top is NOT", async () => {
    // Note 003 §3.2's second row, and the LIMIT this documents as
    // behaviour rather than as prose: a container's derived
    // endpoints are internal by design, so a sibling text at the
    // child's own binding lands inside the lower child's box.
    const view = await mount(html`
      <hdml-view aria-label="stk" style="width: 400px; height: 200px">
        <hdml-cartesian-plane style="padding: 0">
          <hdml-ordinal-scale channel="x" values='["jan"]'>
            <hdml-continuous-scale channel="y" min="0" max="100">
              <hdml-stack x='["jan"]'>
                <hdml-bar y="[30]"></hdml-bar>
                <hdml-bar y="[20]"></hdml-bar>
              </hdml-stack>
              <hdml-text
                x='["jan"]'
                y="[20]"
                text='["20"]'
              ></hdml-text>
            </hdml-continuous-scale>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const groups = sceneOf(view, P).groups;
    const text = groups.find((g) => g.tag === "hdml-text");
    const bars = groups.filter((g) => g.tag === "hdml-bar");
    assert.isDefined(text);
    assert.lengthOf(bars, 2);
    const run = <TextNode>text.nodes[0];
    assert.strictEqual(run.k, "text");
    // The second child is drawn from 30 to 50; the run is at 20,
    // which is INSIDE the first child's box, not on either top.
    const tops = bars.map(
      (g) => (<Extract<SceneNode, { k: "rect" }>>g.nodes[0]).y,
    );
    for (const top of tops) {
      assert.isAbove(Math.abs(run.y - top), 1);
    }
    // …and it is where the y scale puts 20, which is the honest
    // reading: the mark did exactly what it was told.
    assert.closeTo(run.y, 200 - 20 * 2, 1e-6);
  });
});
