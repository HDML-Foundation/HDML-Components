/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import {
  Paint,
  PaintStates,
  Scene,
  SceneGroup,
  SceneNode,
  emptyScene,
} from "./scene";
import { createSvgRenderer } from "./renderer-svg";

/**
 * R2 — a scene is **immutable, serializable data**, and the renderer
 * owns all drawing.
 *
 * `structuredClone` is the operational definition of serializable,
 * and the fixture below is H9's proof: it names every node kind and
 * every group field, so a Contract 3 that grew field-by-field would
 * not compile against it.
 */

const FONT = {
  family: "system-ui",
  size: 11,
  weight: "400",
  style: "normal",
};

/** Every node kind, once. */
function everyKind(): SceneNode[] {
  return [
    {
      k: "path",
      i: 0,
      fill: null,
      stroke: "#123456",
      strokeWidth: 2,
      dash: [4, 2],
      // ★ 019 R1 — the one OPTIONAL field on `Paint`. It is on a
      // STROKED node on purpose: a stroked host's channel colour is
      // its stroke, and `prop` is what keeps that honest.
      states: { prop: "stroke", colors: { hover: "#abcdef" } },
      closed: false,
      subpaths: [
        {
          start: { x: 0, y: 0 },
          segments: [
            { k: "line", to: { x: 10, y: 10 } },
            {
              k: "cubic",
              c1: { x: 12, y: 8 },
              c2: { x: 18, y: 4 },
              to: { x: 20, y: 0 },
            },
          ],
        },
        {
          start: { x: 30, y: 0 },
          segments: [{ k: "line", to: { x: 40, y: 10 } }],
        },
      ],
      vertices: [
        { x: 0, y: 0, i: 0 },
        { x: 20, y: 0, i: 1 },
        { x: 40, y: 10, i: 3 },
      ],
    },
    {
      k: "rect",
      i: 1,
      fill: "#abcdef",
      stroke: null,
      strokeWidth: 0,
      dash: null,
      x: 5,
      y: 6,
      w: 20,
      h: 30,
    },
    {
      k: "ellipse",
      i: 2,
      fill: "#ff0000",
      stroke: "#000000",
      strokeWidth: 1,
      dash: null,
      cx: 50,
      cy: 60,
      rx: 7,
      ry: 9,
    },
    {
      k: "arc",
      i: 3,
      fill: "#00ff00",
      stroke: null,
      strokeWidth: 0,
      dash: null,
      cx: 100,
      cy: 100,
      r0: 20,
      r1: 40,
      a0: 0,
      a1: 90,
    },
    {
      k: "text",
      i: -1,
      fill: "#333333",
      stroke: null,
      strokeWidth: 0,
      dash: null,
      x: 12,
      y: 14,
      text: "North",
      anchor: "middle",
      baseline: "top",
      font: FONT,
      rotate: 0,
      decorative: true,
    },
  ];
}

/** Every group field, set to a non-default value. */
function kitchenSink(): Scene {
  const group: SceneGroup = {
    widget: "w-kitchen",
    tag: "hdml-line",
    role: "mark",
    box: { x: 1, y: 2, w: 300, h: 150 },
    opacity: 0.5,
    filter: "blur(2px)",
    visibility: "visible",
    clip: true,
    clipPath: [
      {
        start: { x: 0, y: 0 },
        segments: [
          { k: "line", to: { x: 10, y: 0 } },
          { k: "line", to: { x: 10, y: 10 } },
          { k: "line", to: { x: 0, y: 0 } },
        ],
      },
    ],
    nodes: everyKind(),
  };
  const guide: SceneGroup = {
    widget: "w-guide",
    tag: "hdml-axis",
    role: "guide",
    box: { x: 0, y: 0, w: 400, h: 200 },
    opacity: 1,
    filter: "none",
    visibility: "hidden",
    clip: false,
    clipPath: null,
    nodes: [],
  };
  return { width: 400, height: 200, groups: [group, guide] };
}

/**
 * ★ **Corrected at step 37 (019 R1) — it was NOT deep.**
 *
 * It froze exactly three levels — the group, its `nodes` array and
 * each node — and nothing a node points *at*. `dash` is an array
 * and `subpaths`/`vertices` are arrays of objects, so *"a frozen
 * scene renders twice"* has never constrained a renderer that wrote
 * into one of them. The hole was harmless while every such
 * reference was geometry the renderer only reads.
 *
 * R1 is what makes it matter: {@link Paint.states} is the first
 * field whose value is a nested MUTABLE object a renderer is
 * expected to *look up a key in* — row 38's `applyPaint` reads
 * `node.states.colors[state]` — and a one-character slip from a
 * read to a write would have passed this test. Freezing
 * transitively is what turns R2 from a claim about the top three
 * levels into one about the whole value.
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  Object.values(<Record<string, unknown>>value).forEach(deepFreeze);
  return Object.freeze(value);
}

function host(): ShadowRoot {
  const el = document.createElement("div");
  el.style.cssText = "position:relative;width:400px;height:200px";
  document.body.appendChild(el);
  planted.push(el);
  return el.attachShadow({ mode: "open" });
}

let planted: HTMLElement[] = [];

suite("hdvl/scene — the scene is data", () => {
  teardown(() => {
    planted.forEach((el) => el.remove());
    planted = [];
  });

  test("structuredClone round-trips a whole scene", () => {
    const scene = kitchenSink();
    const clone = structuredClone(scene);
    assert.deepEqual(clone, scene);
    assert.notStrictEqual(clone, scene);
    // Every node kind is present, or the claim is narrower than it
    // reads.
    const kinds = scene.groups[0].nodes.map((n) => n.k);
    assert.deepEqual(kinds, [
      "path",
      "rect",
      "ellipse",
      "arc",
      "text",
    ]);
  });

  test("render does not mutate the scene", () => {
    const scene = kitchenSink();
    const before = structuredClone(scene);
    const r = createSvgRenderer();
    r.mount(host());
    r.resize(400, 200, 1);
    r.render(scene);
    assert.deepEqual(scene, before);
    r.unmount();
  });

  test("a frozen scene renders twice", () => {
    const scene = deepFreeze(kitchenSink());
    // ★ Step 37: the freeze now reaches what a node POINTS AT, so
    // this is a constraint on the renderer rather than on three
    // levels of wrapper. `states` is the field that made it
    // necessary; `dash` is the one that had the hole all along.
    const first = scene.groups[0].nodes[0];
    assert.isTrue(Object.isFrozen(first.dash));
    assert.isTrue(Object.isFrozen(first.states));
    assert.isTrue(Object.isFrozen(first.states?.colors));
    const r = createSvgRenderer();
    r.mount(host());
    r.resize(400, 200, 1);
    r.render(scene);
    r.render(scene);
    assert.isTrue(Object.isFrozen(scene));
    r.unmount();
  });

  test("★ R1 — Paint.states is the one optional field", () => {
    // ★★ 019 R1, step 37. `NodeBase extends Paint` and five
    // `SceneNode` variants spread `NodeBase`, so a field that were
    // ALWAYS present would land on every node of every group — and
    // measured at this step, that re-baselines **all 29** corpus
    // goldens (every one of the 17 golden suites reds). The four
    // required fields are therefore asserted present and `states`
    // asserted ABSENT on a node nobody authored a state for.
    const bare: Paint = {
      fill: "#000000",
      stroke: null,
      strokeWidth: 0,
      dash: null,
    };
    assert.deepStrictEqual(Object.keys(bare), [
      "fill",
      "stroke",
      "strokeWidth",
      "dash",
    ]);
    assert.isFalse("states" in bare);
  });

  test("★ R1 — absent is NOT undefined", () => {
    // ★★★ The distinction this whole step turns on, as an
    // executable statement rather than a warning. MEASURED at step
    // 37, in all three engines:
    //
    //   • chai's `deepEqual` DOES separate the two, so the 29
    //     committed golden literals witness a present-but-undefined
    //     field — which is why an always-present field reds the
    //     corpus rather than passing it.
    //   • `structuredClone` KEEPS an undefined-valued key, so the
    //     14 clone round-trip assertions witness NEITHER.
    //   • `assert.isUndefined` passes for both and so can witness
    //     nothing at all.
    //
    // The first bullet is the half the step-37 prompt recorded as
    // unmeasured, and it is the reassuring half.
    const absent: Record<string, unknown> = { fill: "#000000" };
    const undef: Record<string, unknown> = {
      fill: "#000000",
      states: undefined,
    };
    assert.isFalse("states" in absent);
    assert.isTrue("states" in undef);
    assert.deepEqual(Object.keys(undef), ["fill", "states"]);
    // `structuredClone` keeps it — the clone gate is blind here.
    assert.deepEqual(Object.keys(structuredClone(undef)), [
      "fill",
      "states",
    ]);
    // `deepEqual` does not — the golden gate is not blind.
    assert.throws(() => assert.deepEqual(undef, absent));
    // And the check that cannot tell them apart, named so nobody
    // reaches for it again.
    assert.isUndefined(absent.states);
    assert.isUndefined(undef.states);
  });

  test("★ R1 — a states-carrying node clones and renders", () => {
    const states: PaintStates = {
      prop: "fill",
      colors: { hover: "#ff0000", active: "#00ff00" },
    };
    const node = <SceneNode>{
      k: "rect",
      i: 3,
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      fill: "#123456",
      stroke: null,
      strokeWidth: 0,
      dash: null,
      states,
    };
    const scene: Scene = {
      width: 100,
      height: 100,
      groups: [
        {
          widget: "w",
          tag: "hdml-bar",
          role: "mark",
          box: { x: 0, y: 0, w: 100, h: 100 },
          opacity: 1,
          filter: "none",
          visibility: "visible",
          clip: false,
          clipPath: null,
          nodes: [node],
        },
      ],
    };
    assert.deepEqual(structuredClone(scene), scene);
    // The renderer ignores it at this step — row 38 is where it
    // reaches the DOM — and must not mutate the scene reading it.
    const before = structuredClone(scene);
    const r = createSvgRenderer();
    r.mount(host());
    r.resize(100, 100, 1);
    r.render(scene);
    assert.deepEqual(scene, before);
    r.unmount();
  });

  test("emptyScene has the size and no groups", () => {
    const s = emptyScene(640, 480);
    assert.strictEqual(s.width, 640);
    assert.strictEqual(s.height, 480);
    assert.lengthOf(s.groups, 0);
    assert.deepEqual(structuredClone(s), s);
  });
});
