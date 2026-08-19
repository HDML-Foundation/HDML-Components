/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import { Scene, SceneGroup, SceneNode, emptyScene } from "./scene";
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

function deepFreeze(scene: Scene): Scene {
  for (const g of scene.groups) {
    g.nodes.forEach((n) => Object.freeze(n));
    Object.freeze(g.nodes);
    Object.freeze(g);
  }
  Object.freeze(scene.groups);
  return Object.freeze(scene);
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
    const r = createSvgRenderer();
    r.mount(host());
    r.resize(400, 200, 1);
    r.render(scene);
    r.render(scene);
    assert.isTrue(Object.isFrozen(scene));
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
