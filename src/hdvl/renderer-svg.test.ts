/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import {
  Scene,
  SceneFont,
  SceneGroup,
  SceneNode,
  Subpath,
} from "./scene";
import { Renderer, renderers } from "./renderer";
import { createSvgRenderer } from "./renderer-svg";

/**
 * R36 — the ten things a scene assertion cannot reach.
 *
 * Every test here builds a `Scene` **by hand** and reads the DOM
 * back: no element, no scheduler, no CSS and no DOM lifecycle is in
 * the picture, which is what makes step 10 the cleanest green point
 * in Slice B.
 */

const FONT: SceneFont = {
  family: "system-ui",
  size: 11,
  weight: "400",
  style: "normal",
};

const NO_PAINT = {
  fill: null,
  stroke: null,
  strokeWidth: 0,
  dash: null,
};

let planted: HTMLElement[] = [];
let live: Renderer[] = [];

function host(): ShadowRoot {
  const el = document.createElement("div");
  el.style.cssText = "position:relative;width:400px;height:200px";
  document.body.appendChild(el);
  planted.push(el);
  return el.attachShadow({ mode: "open" });
}

function mounted(): { r: Renderer; root: ShadowRoot } {
  const root = host();
  const r = createSvgRenderer();
  r.mount(root);
  r.resize(400, 200, 1);
  live.push(r);
  return { r, root };
}

function group(over: Partial<SceneGroup> = {}): SceneGroup {
  return {
    widget: "w1",
    tag: "hdml-line",
    role: "mark",
    box: { x: 0, y: 0, w: 400, h: 200 },
    opacity: 1,
    filter: "none",
    visibility: "visible",
    clip: false,
    clipPath: null,
    nodes: [],
    ...over,
  };
}

function scene(groups: SceneGroup[]): Scene {
  return { width: 400, height: 200, groups };
}

function rect(i: number, x: number, y: number): SceneNode {
  return { ...NO_PAINT, k: "rect", i, x, y, w: 20, h: 10 };
}

function surface(root: ShadowRoot): SVGSVGElement {
  return <SVGSVGElement>root.querySelector("svg");
}

function gOf(root: ShadowRoot, uid: string): SVGGElement {
  return <SVGGElement>root.querySelector(`g[data-w="${uid}"]`);
}

function dOf(root: ShadowRoot, uid: string): string {
  const path = <SVGPathElement>gOf(root, uid).querySelector("path");
  return <string>path.getAttribute("d");
}

/** The `<clipPath>` in `<defs>` whose only child is `tag`. */
function clipWith(root: ShadowRoot, tag: string): SVGElement {
  const all = Array.from(surface(root).querySelectorAll("clipPath"));
  const hit = all.find(
    (c) => (<Element>c.firstChild).tagName.toLowerCase() === tag,
  );
  assert.isDefined(hit, `no clipPath holding a <${tag}>`);
  return <SVGElement>hit;
}

suite("hdvl/renderer-svg — the renderer contract", () => {
  teardown(() => {
    live.forEach((r) => r.unmount());
    live = [];
    planted.forEach((el) => el.remove());
    planted = [];
  });

  // ── R36 #1 ────────────────────────────────────────────────────
  test("segments serialize to M, L and C", () => {
    const { r, root } = mounted();
    const subpaths: Subpath[] = [
      {
        start: { x: 0, y: 0 },
        segments: [
          { k: "line", to: { x: 10, y: 0 } },
          {
            k: "cubic",
            c1: { x: 12, y: 2 },
            c2: { x: 18, y: 8 },
            to: { x: 20, y: 10 },
          },
        ],
      },
      {
        start: { x: 40, y: 0 },
        segments: [{ k: "line", to: { x: 50, y: 5 } }],
      },
    ];
    r.render(
      scene([
        group({
          nodes: [
            {
              ...NO_PAINT,
              k: "path",
              i: 0,
              closed: false,
              subpaths,
              vertices: [],
            },
          ],
        }),
      ]),
    );
    const path = <SVGPathElement>gOf(root, "w1").firstChild;
    // The second subpath opens with its OWN M: a gap, never a
    // bridge (§4.7).
    assert.strictEqual(
      path.getAttribute("d"),
      "M 0 0 L 10 0 C 12 2 18 8 20 10 M 40 0 L 50 5",
    );
  });

  // ── R36 #2 ────────────────────────────────────────────────────
  test("a full sweep emits two arc commands", () => {
    const { r, root } = mounted();
    const arc = (a0: number, a1: number): SceneNode => ({
      ...NO_PAINT,
      k: "arc",
      i: 0,
      cx: 100,
      cy: 100,
      r0: 0,
      r1: 40,
      a0,
      a1,
    });
    r.render(scene([group({ nodes: [arc(0, 360)] })]));
    const d1 = dOf(root, "w1");
    assert.strictEqual((d1.match(/A /g) ?? []).length, 2);

    r.render(scene([group({ nodes: [arc(0, 90)] })]));
    const d2 = dOf(root, "w1");
    assert.strictEqual((d2.match(/A /g) ?? []).length, 1);
    // §4.6: 0deg is 12 o'clock, so a 90deg sweep ends at 3 o'clock.
    assert.include(d2, "M 100 60");
    assert.include(d2, "L 100 100");
  });

  // ── R36 #3 ────────────────────────────────────────────────────
  test("surplus nodes are removed", () => {
    const { r, root } = mounted();
    const three = [rect(0, 0, 0), rect(1, 30, 0), rect(2, 60, 0)];
    r.render(scene([group({ nodes: three })]));
    assert.lengthOf(gOf(root, "w1").children, 3);
    r.render(scene([group({ nodes: [three[0]] })]));
    assert.lengthOf(gOf(root, "w1").children, 1);
    r.render(scene([group({ nodes: three })]));
    assert.lengthOf(gOf(root, "w1").children, 3);
  });

  test("a changed kind replaces, never patches", () => {
    const { r, root } = mounted();
    r.render(scene([group({ nodes: [rect(0, 0, 0)] })]));
    assert.strictEqual(
      gOf(root, "w1").children[0].tagName.toLowerCase(),
      "rect",
    );
    r.render(
      scene([
        group({
          nodes: [
            {
              ...NO_PAINT,
              k: "ellipse",
              i: 0,
              cx: 5,
              cy: 5,
              rx: 2,
              ry: 2,
            },
          ],
        }),
      ]),
    );
    assert.strictEqual(
      gOf(root, "w1").children[0].tagName.toLowerCase(),
      "ellipse",
    );
  });

  // ── R36 #4 ────────────────────────────────────────────────────
  test("groups paint in array order", () => {
    const { r, root } = mounted();
    const a = group({ widget: "a" });
    const b = group({ widget: "b" });
    const c = group({ widget: "c" });
    r.render(scene([a, b, c]));
    const order = (): string[] =>
      Array.from(surface(root).querySelectorAll("g[data-w]")).map(
        (g) => <string>g.getAttribute("data-w"),
      );
    assert.deepEqual(order(), ["a", "b", "c"]);
    r.render(scene([c, b, a]));
    assert.deepEqual(order(), ["c", "b", "a"]);
    r.render(scene([b]));
    assert.deepEqual(order(), ["b"]);
  });

  // ── R36 #5 ────────────────────────────────────────────────────
  test("clip produces a clipPath over the box", () => {
    const { r, root } = mounted();
    r.render(
      scene([
        group({ clip: true, box: { x: 5, y: 6, w: 20, h: 30 } }),
      ]),
    );
    const clip = <SVGClipPathElement>(
      surface(root).querySelector("clipPath")
    );
    const box = <SVGRectElement>clip.firstChild;
    assert.strictEqual(box.tagName.toLowerCase(), "rect");
    assert.strictEqual(box.getAttribute("x"), "5");
    assert.strictEqual(box.getAttribute("y"), "6");
    assert.strictEqual(box.getAttribute("width"), "20");
    assert.strictEqual(box.getAttribute("height"), "30");
    assert.strictEqual(
      gOf(root, "w1").getAttribute("clip-path"),
      `url(#${<string>clip.getAttribute("id")})`,
    );
    r.render(scene([group({ clip: false })]));
    assert.isNull(surface(root).querySelector("clipPath"));
    assert.isNull(gOf(root, "w1").getAttribute("clip-path"));
  });

  // ── R36 #6 ────────────────────────────────────────────────────
  test("clipPath geometry intersects the box", () => {
    const { r, root } = mounted();
    const shape: Subpath[] = [
      {
        start: { x: 0, y: 0 },
        segments: [
          { k: "line", to: { x: 10, y: 0 } },
          { k: "line", to: { x: 10, y: 10 } },
          { k: "line", to: { x: 0, y: 0 } },
        ],
      },
    ];
    r.render(scene([group({ clip: false, clipPath: shape })]));
    let clips = surface(root).querySelectorAll("clipPath");
    assert.lengthOf(clips, 1);
    assert.strictEqual(
      (<Element>clips[0].firstChild).tagName.toLowerCase(),
      "path",
    );
    assert.strictEqual(
      (<Element>clips[0].firstChild).getAttribute("d"),
      "M 0 0 L 10 0 L 10 10 L 0 0 Z",
    );

    // With BOTH, SVG unions a clipPath's children, so the
    // intersection is expressed by nesting — the shape clip carries
    // its own clip-path pointing at the box clip. Neither wins
    // silently.
    r.render(scene([group({ clip: true, clipPath: shape })]));
    clips = surface(root).querySelectorAll("clipPath");
    assert.lengthOf(clips, 2);
    const boxClip = clipWith(root, "rect");
    const shapeClip = clipWith(root, "path");
    assert.strictEqual(
      shapeClip.getAttribute("clip-path"),
      `url(#${<string>boxClip.getAttribute("id")})`,
    );
    assert.strictEqual(
      gOf(root, "w1").getAttribute("clip-path"),
      `url(#${<string>shapeClip.getAttribute("id")})`,
    );
  });

  // ── R36 #7 ────────────────────────────────────────────────────
  test("filter lands on the group, none does not", () => {
    const { r, root } = mounted();
    r.render(scene([group({ filter: "blur(2px)" })]));
    assert.strictEqual(
      gOf(root, "w1").getAttribute("filter"),
      "blur(2px)",
    );
    r.render(scene([group({ filter: "none" })]));
    assert.isNull(gOf(root, "w1").getAttribute("filter"));
    // The other two box-level properties travel the same way.
    r.render(scene([group({ opacity: 0.25, visibility: "hidden" })]));
    assert.strictEqual(
      gOf(root, "w1").getAttribute("opacity"),
      "0.25",
    );
    assert.strictEqual(
      gOf(root, "w1").getAttribute("visibility"),
      "hidden",
    );
  });

  // ── R36 #8 ────────────────────────────────────────────────────
  test("text maps anchor, baseline and font", () => {
    const { r, root } = mounted();
    const text = (
      over: Partial<Extract<SceneNode, { k: "text" }>>,
    ): SceneNode => ({
      ...NO_PAINT,
      k: "text",
      i: 4,
      x: 12,
      y: 14,
      text: "North",
      anchor: "middle",
      baseline: "top",
      font: FONT,
      decorative: false,
      ...over,
    });
    r.render(scene([group({ nodes: [text({})] })]));
    const el = <SVGTextElement>gOf(root, "w1").firstChild;
    assert.strictEqual(el.getAttribute("text-anchor"), "middle");
    assert.strictEqual(
      el.getAttribute("dominant-baseline"),
      "hanging",
    );
    assert.strictEqual(el.getAttribute("font-family"), "system-ui");
    assert.strictEqual(el.getAttribute("font-size"), "11px");
    assert.strictEqual(el.getAttribute("font-weight"), "400");
    assert.strictEqual(el.getAttribute("font-style"), "normal");
    assert.strictEqual(el.textContent, "North");
    assert.isNull(el.getAttribute("aria-hidden"));

    r.render(
      scene([
        group({
          nodes: [
            text({
              anchor: "end",
              baseline: "bottom",
              decorative: true,
            }),
          ],
        }),
      ]),
    );
    assert.strictEqual(el.getAttribute("text-anchor"), "end");
    assert.strictEqual(
      el.getAttribute("dominant-baseline"),
      "alphabetic",
    );
    assert.strictEqual(el.getAttribute("aria-hidden"), "true");
  });

  test("an author string never becomes markup", () => {
    // §12 is a security contract and the corpus is author-supplied
    // HTML: textContent cannot introduce markup by construction.
    const { r, root } = mounted();
    const payload = "<script>alert(1)</" + "script>";
    r.render(
      scene([
        group({
          nodes: [
            {
              ...NO_PAINT,
              k: "text",
              i: 0,
              x: 0,
              y: 0,
              text: payload,
              anchor: "start",
              baseline: "top",
              font: FONT,
              decorative: false,
            },
          ],
        }),
      ]),
    );
    const g = gOf(root, "w1");
    assert.lengthOf(g.querySelectorAll("script"), 0);
    assert.lengthOf(g.children, 1);
    assert.strictEqual(
      (<SVGTextElement>g.firstChild).textContent,
      payload,
    );
  });

  // ── R36 #9 ────────────────────────────────────────────────────
  test("resolve answers at 12px but not at 13", () => {
    const { r } = mounted();
    r.render(
      scene([
        group({
          nodes: [
            {
              ...NO_PAINT,
              k: "path",
              i: -1,
              closed: false,
              subpaths: [
                {
                  start: { x: 100, y: 100 },
                  segments: [{ k: "line", to: { x: 200, y: 100 } }],
                },
              ],
              vertices: [
                { x: 100, y: 100, i: 7 },
                { x: 200, y: 100, i: 9 },
              ],
            },
          ],
        }),
      ]),
    );
    // R10 is normative at 12 CSS px, so both sides are asserted.
    assert.deepEqual(r.resolve(112, 100), { widget: "w1", index: 7 });
    assert.isNull(r.resolve(113, 100));
    assert.deepEqual(r.resolve(200, 100), { widget: "w1", index: 9 });
  });

  test("a rect resolves by containment", () => {
    const { r } = mounted();
    r.render(
      scene([
        group({
          nodes: [
            {
              ...NO_PAINT,
              k: "rect",
              i: 5,
              x: 10,
              y: 10,
              w: 40,
              h: 20,
            },
          ],
        }),
      ]),
    );
    assert.deepEqual(r.resolve(30, 20), { widget: "w1", index: 5 });
    assert.isNull(r.resolve(300, 180));
  });

  // ── R36 #10 ───────────────────────────────────────────────────
  test("a second render patches the same nodes", () => {
    // THE load-bearing test. Every other assertion in this suite
    // passes against a rebuild-every-frame implementation, and a
    // rebuild breaks pointer targets and CSS transitions at step 12
    // and beyond — where it looks like a hover bug, not a renderer
    // bug.
    const { r, root } = mounted();
    r.render(
      scene([group({ nodes: [rect(0, 0, 0), rect(1, 30, 0)] })]),
    );
    const g = gOf(root, "w1");
    const first = g.children[0];
    const second = g.children[1];

    r.render(
      scene([group({ nodes: [rect(0, 5, 5), rect(1, 35, 5)] })]),
    );
    assert.strictEqual(gOf(root, "w1"), g);
    assert.strictEqual(g.children[0], first);
    assert.strictEqual(g.children[1], second);
    assert.strictEqual(first.getAttribute("x"), "5");

    // And identity survives a reorder, because insertBefore MOVES.
    r.render(
      scene([
        group({ widget: "w0" }),
        group({ nodes: [rect(0, 5, 5), rect(1, 35, 5)] }),
      ]),
    );
    assert.strictEqual(gOf(root, "w1"), g);
    assert.strictEqual(g.children[0], first);
  });
});

suite("hdvl/renderer-svg — mount, resize, unmount", () => {
  teardown(() => {
    live.forEach((r) => r.unmount());
    live = [];
    planted.forEach((el) => el.remove());
    planted = [];
  });

  test("the renderers.create seam is swappable", () => {
    const original = renderers.create;
    try {
      assert.isFunction(renderers.create().render);
      const fake = <Renderer>{};
      renderers.create = (): Renderer => fake;
      assert.strictEqual(renderers.create(), fake);
    } finally {
      renderers.create = original;
    }
    assert.strictEqual(renderers.create, original);
  });

  test("mount reuses an svg the root already has", () => {
    const root = host();
    const existing = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    root.appendChild(existing);
    const r = createSvgRenderer();
    live.push(r);
    r.mount(root);
    assert.lengthOf(root.querySelectorAll("svg"), 1);
    assert.strictEqual(surface(root), existing);
  });

  test("mount adds one svg to an empty root", () => {
    const root = host();
    const r = createSvgRenderer();
    live.push(r);
    r.mount(root);
    assert.lengthOf(root.querySelectorAll("svg"), 1);
    assert.strictEqual(
      surface(root).namespaceURI,
      "http://www.w3.org/2000/svg",
    );
  });

  test("resize sets the viewBox and records dpr", () => {
    const root = host();
    const r = createSvgRenderer();
    live.push(r);
    r.mount(root);
    r.resize(400, 200, 2);
    const svg = surface(root);
    assert.strictEqual(svg.getAttribute("viewBox"), "0 0 400 200");
    // §5.8: the device-pixel mapping is an identity under SVG, so
    // the dpr is recorded and NOTHING is scaled by it.
    assert.isNull(svg.getAttribute("width"));
    assert.isNull(svg.getAttribute("height"));
    assert.isNull(svg.getAttribute("transform"));
  });

  test("unmount leaves the root as it found it", () => {
    const owned = host();
    const r1 = createSvgRenderer();
    r1.mount(owned);
    r1.render(scene([group({ clip: true, nodes: [rect(0, 0, 0)] })]));
    r1.unmount();
    assert.lengthOf(owned.childNodes, 0);
    assert.isNull(r1.resolve(0, 0));

    const adopted = host();
    const existing = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    adopted.appendChild(existing);
    const r2 = createSvgRenderer();
    r2.mount(adopted);
    r2.render(scene([group({ nodes: [rect(0, 0, 0)] })]));
    r2.unmount();
    assert.strictEqual(surface(adopted), existing);
    assert.lengthOf(existing.childNodes, 0);
  });
});
