/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The v1 renderer — SVG (RFC 016/001 §5.1, §5.3, §5.9, §12).
 *
 * One `<svg>` per view; one `<g data-w="{uid}">` per group, in array
 * order, which **is** paint order. The renderer **diffs**: a group
 * whose widget uid is unchanged patches its existing `<g>`, node *j*
 * patches node *j*, and surplus nodes are removed. Node identity is
 * stable across frames, which is what pointer targets and CSS
 * transitions on the emitted nodes both need — a rebuild-every-frame
 * implementation passes almost every other assertion and then breaks
 * hover two steps later, where it looks like a hover bug.
 *
 * Serializing `Subpath[]` into a `d` string, and an `arc` node into
 * one or two `A` commands, are **renderer-local** details that never
 * appear in the scene.
 *
 * §12 is absolute here: every node is created with
 * `createElementNS` and every author string reaches the DOM through
 * `textContent`. No `innerHTML`, no `insertAdjacentHTML`, no
 * `unsafeHTML` — `textContent` cannot introduce markup by
 * construction.
 *
 * **The renderer never writes to the scene it is handed** (R2). No
 * sorting, no normalising a null fill in place, no caching a
 * serialized `d` on a node.
 *
 * @module hdvl/renderer-svg
 */

import type { Hit, Renderer, TextMetrics2 } from "./renderer";
import type {
  Point,
  Scene,
  SceneFont,
  SceneGroup,
  SceneNode,
  Subpath,
} from "./scene";
import { measureText } from "./measure-text";

const NS = "http://www.w3.org/2000/svg";

/** R10's normative hit radius, CSS px. */
const HIT_RADIUS = 12;

/** `dominant-baseline` values, chosen for engine breadth. */
const BASELINE = {
  top: "hanging",
  middle: "middle",
  bottom: "alphabetic",
};

interface Entry {
  g: SVGGElement;
  /** Painted nodes, positionally aligned with `group.nodes`. */
  els: SVGElement[];
  /** Each element's node kind — an `<ellipse>` cannot become a
   *  `<rect>`, and `<path>` serves both `path` and `arc`. */
  kinds: string[];
  /** The box `<clipPath>`, when `clip` is on. */
  boxClip: SVGClipPathElement | null;
  /** The `clipPath` geometry `<clipPath>`, when one is resolved. */
  shapeClip: SVGClipPathElement | null;
}

/**
 * Builds a renderer bound to no root. Call `mount()` to give it one.
 *
 * @returns A fresh SVG renderer.
 */
export function createSvgRenderer(): Renderer {
  let root: ShadowRoot | null = null;
  let svg: SVGSVGElement | null = null;
  /** Whether `mount()` created the surface, and so owes its
   *  removal. A surface it merely adopted is left in place. */
  let owned = false;
  let defs: SVGDefsElement | null = null;
  let dpr = 1;
  let scene: Scene | null = null;
  const entries = new Map<string, Entry>();

  const mount = (next: ShadowRoot): void => {
    root = next;
    const found = next.querySelector("svg");
    if (found === null) {
      svg = document.createElementNS(NS, "svg");
      next.appendChild(svg);
      owned = true;
    } else {
      svg = found;
      owned = false;
    }
    defs = document.createElementNS(NS, "defs");
    svg.insertBefore(defs, svg.firstChild);
  };

  const resize = (w: number, h: number, ratio: number): void => {
    dpr = ratio;
    // §5.8: under SVG the device-pixel mapping is an identity. The
    // ratio is recorded so a second renderer's signature does not
    // change, and nothing is scaled by it.
    void dpr;
    svg?.setAttribute("viewBox", `0 0 ${w} ${h}`);
  };

  const render = (next: Scene): void => {
    if (svg === null || defs === null) {
      return;
    }
    scene = next;
    const live = new Set<string>();
    for (const group of next.groups) {
      live.add(group.widget);
      paintGroup(group, entries, svg, defs);
    }
    for (const [uid, entry] of Array.from(entries)) {
      if (!live.has(uid)) {
        entry.g.remove();
        entry.boxClip?.remove();
        entry.shapeClip?.remove();
        entries.delete(uid);
      }
    }
    // Reconcile DOM order to array order. `insertBefore` MOVES an
    // existing node, so the diff's element identity survives a
    // reorder — which is the whole point of keying by uid.
    let i = 1; // index 0 is <defs>
    for (const group of next.groups) {
      const g = entries.get(group.widget)?.g;
      if (g === undefined) {
        continue;
      }
      if (svg.childNodes[i] !== g) {
        svg.insertBefore(g, svg.childNodes[i] ?? null);
      }
      i++;
    }
  };

  const resolve = (x: number, y: number): Hit | null => {
    if (scene === null || svg === null || root === null) {
      return null;
    }
    // §5.7: `resolve()` takes VIEW-LOCAL CSS px; `elementFromPoint`
    // takes VIEWPORT coordinates. The surface is the view's content
    // box, so the conversion is one addition — read from a LIVE
    // rect per call, never cached, so scrolling and zoom stay
    // correct.
    const r = svg.getBoundingClientRect();
    const el = root.elementFromPoint(x + r.left, y + r.top);
    if (el !== null) {
      const hit = hitOf(el, entries, scene);
      if (hit !== null) {
        return hit;
      }
    }
    // The geometric answer. It is the fallback rather than the
    // primary because `elementFromPoint` honours paint order and
    // clipping for free — but it needs a laid-out, hit-testable
    // surface, and a detached or covered one must still resolve.
    return contained(scene, x, y) ?? nearestVertex(scene, x, y);
  };

  const unmount = (): void => {
    for (const entry of entries.values()) {
      entry.g.remove();
      entry.boxClip?.remove();
      entry.shapeClip?.remove();
    }
    entries.clear();
    defs?.remove();
    if (owned) {
      svg?.remove();
    }
    root = null;
    svg = null;
    defs = null;
    scene = null;
    owned = false;
  };

  return {
    mount,
    resize,
    render,
    resolve,
    // H10: one implementation, shared with the recording stub. A
    // guide's scene depends on this value, so two implementations
    // would make §5.9's byte-identity check permanently red.
    measureText: (text: string, font: SceneFont): TextMetrics2 =>
      measureText(text, font),
    unmount,
  };
}

// ---------------------------------------------------------------
// Groups
// ---------------------------------------------------------------

function paintGroup(
  group: SceneGroup,
  entries: Map<string, Entry>,
  svg: SVGSVGElement,
  defs: SVGDefsElement,
): void {
  let entry = entries.get(group.widget);
  if (entry === undefined) {
    const g = document.createElementNS(NS, "g");
    g.setAttribute("data-w", group.widget);
    svg.appendChild(g);
    entry = { g, els: [], kinds: [], boxClip: null, shapeClip: null };
    entries.set(group.widget, entry);
  }
  entry.g.setAttribute("data-tag", group.tag);
  entry.g.setAttribute("data-role", group.role);
  entry.g.setAttribute("opacity", String(group.opacity));
  entry.g.setAttribute("visibility", group.visibility);
  if (group.filter === "none" || group.filter === "") {
    entry.g.removeAttribute("filter");
  } else {
    entry.g.setAttribute("filter", group.filter);
  }
  applyClip(group, entry, defs);
  paintNodes(group, entry);
}

/**
 * §5.1's explicit transfer of `overflow` and `clip-path`.
 *
 * When both are present they **intersect** — neither silently wins.
 * SVG unions a `<clipPath>`'s children, so the intersection is
 * expressed by giving the shape clip its own `clip-path` pointing at
 * the box clip, which is exactly what nesting means in SVG.
 */
function applyClip(
  group: SceneGroup,
  entry: Entry,
  defs: SVGDefsElement,
): void {
  const boxId = `hdvl-clip-b-${group.widget}`;
  const shapeId = `hdvl-clip-s-${group.widget}`;

  if (group.clip) {
    if (entry.boxClip === null) {
      entry.boxClip = document.createElementNS(NS, "clipPath");
      entry.boxClip.setAttribute("id", boxId);
      entry.boxClip.appendChild(document.createElementNS(NS, "rect"));
      defs.appendChild(entry.boxClip);
    }
    const rect = <SVGRectElement>entry.boxClip.firstChild;
    rect.setAttribute("x", num(group.box.x));
    rect.setAttribute("y", num(group.box.y));
    rect.setAttribute("width", num(group.box.w));
    rect.setAttribute("height", num(group.box.h));
  } else if (entry.boxClip !== null) {
    entry.boxClip.remove();
    entry.boxClip = null;
  }

  if (group.clipPath !== null) {
    if (entry.shapeClip === null) {
      entry.shapeClip = document.createElementNS(NS, "clipPath");
      entry.shapeClip.setAttribute("id", shapeId);
      entry.shapeClip.appendChild(
        document.createElementNS(NS, "path"),
      );
      defs.appendChild(entry.shapeClip);
    }
    const path = <SVGPathElement>entry.shapeClip.firstChild;
    path.setAttribute("d", subpathsToD(group.clipPath, true));
    if (group.clip) {
      entry.shapeClip.setAttribute("clip-path", `url(#${boxId})`);
    } else {
      entry.shapeClip.removeAttribute("clip-path");
    }
  } else if (entry.shapeClip !== null) {
    entry.shapeClip.remove();
    entry.shapeClip = null;
  }

  const ref =
    group.clipPath !== null ? shapeId : group.clip ? boxId : null;
  if (ref === null) {
    entry.g.removeAttribute("clip-path");
  } else {
    entry.g.setAttribute("clip-path", `url(#${ref})`);
  }
}

// ---------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------

function paintNodes(group: SceneGroup, entry: Entry): void {
  group.nodes.forEach((node, j) => {
    const want = tagOf(node.k);
    let el = entry.els[j];
    if (el === undefined) {
      el = document.createElementNS(NS, want);
      entry.g.appendChild(el);
      entry.els[j] = el;
    } else if (entry.kinds[j] !== node.k) {
      // An <ellipse> cannot become a <rect>: a changed kind is a
      // replacement, not a patch.
      const next = document.createElementNS(NS, want);
      entry.g.replaceChild(next, el);
      el = next;
      entry.els[j] = next;
    }
    entry.kinds[j] = node.k;
    el.setAttribute("data-i", String(node.i));
    applyPaint(el, node);
    applyShape(el, node);
  });
  for (const surplus of entry.els.splice(group.nodes.length)) {
    surplus.remove();
  }
  entry.kinds.splice(group.nodes.length);
}

function tagOf(kind: SceneNode["k"]): string {
  switch (kind) {
    case "rect":
      return "rect";
    case "ellipse":
      return "ellipse";
    case "text":
      return "text";
    default:
      return "path";
  }
}

function applyPaint(el: SVGElement, node: SceneNode): void {
  el.setAttribute("fill", node.fill ?? "none");
  el.setAttribute("stroke", node.stroke ?? "none");
  el.setAttribute("stroke-width", num(node.strokeWidth));
  if (node.dash === null || node.dash.length === 0) {
    el.removeAttribute("stroke-dasharray");
  } else {
    el.setAttribute("stroke-dasharray", node.dash.map(num).join(" "));
  }
}

function applyShape(el: SVGElement, node: SceneNode): void {
  switch (node.k) {
    case "path":
      el.setAttribute("d", subpathsToD(node.subpaths, node.closed));
      break;
    case "rect":
      el.setAttribute("x", num(node.x));
      el.setAttribute("y", num(node.y));
      el.setAttribute("width", num(node.w));
      el.setAttribute("height", num(node.h));
      break;
    case "ellipse":
      el.setAttribute("cx", num(node.cx));
      el.setAttribute("cy", num(node.cy));
      el.setAttribute("rx", num(node.rx));
      el.setAttribute("ry", num(node.ry));
      break;
    case "arc":
      el.setAttribute("d", arcToD(node));
      break;
    case "text":
      applyText(el, node);
      break;
  }
}

function applyText(
  el: SVGElement,
  node: Extract<SceneNode, { k: "text" }>,
): void {
  el.setAttribute("x", num(node.x));
  el.setAttribute("y", num(node.y));
  el.setAttribute("text-anchor", node.anchor);
  el.setAttribute("dominant-baseline", BASELINE[node.baseline]);
  el.setAttribute("font-family", node.font.family);
  el.setAttribute("font-size", `${num(node.font.size)}px`);
  el.setAttribute("font-weight", node.font.weight);
  el.setAttribute("font-style", node.font.style);
  if (node.decorative) {
    el.setAttribute("aria-hidden", "true");
  } else {
    el.removeAttribute("aria-hidden");
  }
  // §12. The ONE place an author string reaches the DOM, and it
  // reaches it as text. Never innerHTML.
  el.textContent = node.text;
}

// ---------------------------------------------------------------
// Serialization — renderer-local, never in the scene
// ---------------------------------------------------------------

/** `-0` and exponent forms would both be valid SVG and neither is
 *  useful in an assertion, so numbers go through one funnel. */
function num(v: number): string {
  return Object.is(v, -0) ? "0" : String(v);
}

function subpathsToD(
  subpaths: readonly Subpath[],
  closed: boolean,
): string {
  const out: string[] = [];
  for (const sub of subpaths) {
    // A new subpath is a GAP (§4.7): it opens with its own `M`, and
    // is never bridged from the previous subpath's last point.
    out.push(`M ${num(sub.start.x)} ${num(sub.start.y)}`);
    for (const seg of sub.segments) {
      if (seg.k === "line") {
        out.push(`L ${num(seg.to.x)} ${num(seg.to.y)}`);
      } else {
        out.push(
          `C ${num(seg.c1.x)} ${num(seg.c1.y)} ` +
            `${num(seg.c2.x)} ${num(seg.c2.y)} ` +
            `${num(seg.to.x)} ${num(seg.to.y)}`,
        );
      }
    }
    if (closed) {
      out.push("Z");
    }
  }
  return out.join(" ");
}

/** §4.6: 0° is 12 o'clock and angles increase clockwise. */
function polar(cx: number, cy: number, r: number, a: number): Point {
  const t = ((a - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) };
}

/**
 * An annulus sector, or a pie slice when `r0` is 0.
 *
 * A 360° sweep **cannot be one `A` command** — start and end
 * coincide, and SVG draws nothing — so a full ring is emitted as two
 * half-arcs per radius. That is the case a scene assertion cannot
 * see and R36 names as its own test.
 */
function arcToD(node: Extract<SceneNode, { k: "arc" }>): string {
  const { cx, cy, r0, r1, a0, a1 } = node;
  const sweep = a1 - a0;
  const full = Math.abs(sweep) >= 360;
  const dir = sweep < 0 ? 0 : 1;
  const large = Math.abs(sweep) > 180 ? 1 : 0;

  const ring = (r: number, from: number, to: number): string[] => {
    if (full) {
      const mid = from + (sweep < 0 ? -180 : 180);
      const pm = polar(cx, cy, r, mid);
      const pe = polar(cx, cy, r, from + (sweep < 0 ? -360 : 360));
      return [
        `A ${num(r)} ${num(r)} 0 1 ${dir} ` +
          `${num(pm.x)} ${num(pm.y)}`,
        `A ${num(r)} ${num(r)} 0 1 ${dir} ` +
          `${num(pe.x)} ${num(pe.y)}`,
      ];
    }
    const pe = polar(cx, cy, r, to);
    return [
      `A ${num(r)} ${num(r)} 0 ${large} ${dir} ` +
        `${num(pe.x)} ${num(pe.y)}`,
    ];
  };

  const outerStart = polar(cx, cy, r1, a0);
  const out: string[] = [
    `M ${num(outerStart.x)} ${num(outerStart.y)}`,
    ...ring(r1, a0, a1),
  ];
  if (r0 === 0) {
    if (!full) {
      out.push(`L ${num(cx)} ${num(cy)}`);
    }
  } else {
    const innerEnd = polar(cx, cy, r0, full ? a0 : a1);
    out.push(`L ${num(innerEnd.x)} ${num(innerEnd.y)}`);
    // The inner ring is walked back the other way.
    const back = (r: number): string[] => {
      const rev = 1 - dir;
      if (full) {
        const mid = a1 - (sweep < 0 ? -180 : 180);
        const pm = polar(cx, cy, r, mid);
        const pe = polar(cx, cy, r, a0);
        return [
          `A ${num(r)} ${num(r)} 0 1 ${rev} ` +
            `${num(pm.x)} ${num(pm.y)}`,
          `A ${num(r)} ${num(r)} 0 1 ${rev} ` +
            `${num(pe.x)} ${num(pe.y)}`,
        ];
      }
      const pe = polar(cx, cy, r, a0);
      return [
        `A ${num(r)} ${num(r)} 0 ${large} ${rev} ` +
          `${num(pe.x)} ${num(pe.y)}`,
      ];
    };
    out.push(...back(r0));
  }
  out.push("Z");
  return out.join(" ");
}

// ---------------------------------------------------------------
// Hit resolution (§5.7, R10)
// ---------------------------------------------------------------

function hitOf(
  el: Element,
  entries: Map<string, Entry>,
  scene: Scene,
): Hit | null {
  const g = el.closest("g[data-w]");
  if (g === null) {
    return null;
  }
  const widget = g.getAttribute("data-w");
  const entry = widget === null ? undefined : entries.get(widget);
  if (widget === null || entry === undefined) {
    return null;
  }
  const j = entry.els.indexOf(<SVGElement>el);
  const group = scene.groups.find((x) => x.widget === widget);
  if (j < 0 || group === undefined) {
    return null;
  }
  // A `path` node answers by nearest vertex, never by which pixel
  // its stroke happens to cover: `isPointInStroke` says WHETHER,
  // never WHICH ROW.
  return group.nodes[j].k === "path"
    ? null
    : { widget, index: group.nodes[j].i };
}

/** Topmost discrete node containing the point, or null. */
function contained(scene: Scene, x: number, y: number): Hit | null {
  for (let gi = scene.groups.length - 1; gi >= 0; gi--) {
    const group = scene.groups[gi];
    if (group.visibility === "hidden") {
      continue;
    }
    for (let j = group.nodes.length - 1; j >= 0; j--) {
      const node = group.nodes[j];
      if (node.k === "rect") {
        if (
          x >= node.x &&
          x <= node.x + node.w &&
          y >= node.y &&
          y <= node.y + node.h
        ) {
          return { widget: group.widget, index: node.i };
        }
      } else if (node.k === "ellipse") {
        const dx = (x - node.cx) / node.rx;
        const dy = (y - node.cy) / node.ry;
        if (dx * dx + dy * dy <= 1) {
          return { widget: group.widget, index: node.i };
        }
      } else if (node.k === "arc") {
        const d = Math.hypot(x - node.cx, y - node.cy);
        if (d >= node.r0 && d <= node.r1) {
          return { widget: group.widget, index: node.i };
        }
      }
    }
  }
  return null;
}

/** R10, normative: nearest vertex within 12 CSS px. */
function nearestVertex(
  scene: Scene,
  x: number,
  y: number,
): Hit | null {
  let best: Hit | null = null;
  let bestD = HIT_RADIUS;
  for (const group of scene.groups) {
    if (group.visibility === "hidden") {
      continue;
    }
    for (const node of group.nodes) {
      if (node.k !== "path") {
        continue;
      }
      for (const v of node.vertices) {
        const d = Math.hypot(x - v.x, y - v.y);
        if (d <= bestD) {
          bestD = d;
          best = { widget: group.widget, index: v.i };
        }
      }
    }
  }
  return best;
}
