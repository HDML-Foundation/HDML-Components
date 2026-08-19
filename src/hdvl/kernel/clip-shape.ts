/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * `clip-path` → explicit geometry (RFC 016/001 §5.4).
 *
 * SPEC §9 promises `clip-path` reaches a widget's marks, so it
 * cannot simply be dropped — but it also cannot be passed through as
 * a CSS string: the emitted `<g>` has no CSS box, so a percentage or
 * a `border-box` keyword would resolve against a different reference
 * than the author wrote. The runtime therefore converts the basic
 * shapes against the widget's **measured** box into `Subpath[]` in
 * view coordinates, which every renderer can apply and a scene
 * assertion can read.
 *
 * **This module is pure.** No DOM, no `getComputedStyle`, no import
 * side effect — the caller (step 11's MEASURE) reads the computed
 * value; this only parses it. `src/hdvl/kernel/` carries that rule
 * as a directory-wide invariant, asserted by grep.
 *
 * @module hdvl/kernel/clip-shape
 */

import type { Point, Rect, Segment, Subpath } from "../scene";

/**
 * The circular-arc Bézier constant, `4/3 · (√2 − 1)`.
 *
 * Stated with its derivation because a later reader will otherwise
 * "correct" the literal. It is the control-point offset, as a
 * fraction of the radius, that makes a cubic approximate a 90° arc
 * to within ~0.02 % of the radius.
 */
const KAPPA = (4 / 3) * (Math.sqrt(2) - 1);

/** What {@link clipShape} answers with. */
export interface ClipShape {
  /** The geometry in view coordinates, or null. */
  subpaths: readonly Subpath[] | null;
  /**
   * true when the value used a `url()` form. **W6's trigger** —
   * `clipShape` does not emit the warning, because no diagnostics
   * sink exists until step 12; it reports, and the caller warns.
   */
  w6: boolean;
}

/**
 * true when a computed `filter` or `clip-path` value contains a
 * `url()` form.
 *
 * §5.4 gives `filter` the same rule as `clip-path` — named filter
 * functions pass through, `url()` does not — so the predicate is
 * exported rather than the regex duplicated at the two call sites.
 *
 * @param value - A computed CSS value.
 * @returns Whether it references an external definition.
 */
export function hasUrlForm(value: string): boolean {
  return /\burl\s*\(/i.test(value);
}

/**
 * Resolves a computed `clip-path` against a measured box.
 *
 * Supports the four basic shapes — `inset()`, `circle()`,
 * `ellipse()`, `polygon()`. Anything else, including a rounded
 * `inset(… round …)`, returns `null` and the widget paints
 * **unclipped**: SPEC §1.5 makes a wrong chart worse than an
 * unstyled one, so an approximate clip is never the answer.
 *
 * The `url(#id)` form is **not supported**: the reference would have
 * to resolve from inside the view's shadow tree to a definition in
 * the author's light DOM, which SVG reference scoping does not
 * guarantee. It is ignored and reported, never half-applied.
 *
 * @param value - The computed `clip-path` value.
 * @param box - The widget's measured box, in view coordinates.
 * @returns The geometry, or null; and whether W6 must be raised.
 */
export function clipShape(value: string, box: Rect): ClipShape {
  const v = value.trim();
  if (hasUrlForm(v)) {
    return { subpaths: null, w6: true };
  }
  if (v === "" || v.toLowerCase() === "none") {
    return { subpaths: null, w6: false };
  }
  const call = parseCall(v);
  if (call === null) {
    return { subpaths: null, w6: false };
  }
  const [fn, args] = call;
  let out: readonly Subpath[] | null = null;
  switch (fn) {
    case "inset":
      out = inset(args, box);
      break;
    case "circle":
      out = circle(args, box);
      break;
    case "ellipse":
      out = ellipse(args, box);
      break;
    case "polygon":
      out = polygon(args, box);
      break;
    default:
      out = null;
  }
  return { subpaths: out, w6: false };
}

/**
 * Splits `name(args)` into its two halves, tolerating a reference
 * box after the shape (`circle(50%) border-box`), which is dropped:
 * §2.7 fixes the reference to the widget's own measured box.
 */
function parseCall(v: string): [string, string] | null {
  const open = v.indexOf("(");
  const close = v.lastIndexOf(")");
  if (open <= 0 || close < open) {
    return null;
  }
  const name = v.slice(0, open).trim().toLowerCase();
  if (!/^[a-z-]+$/.test(name)) {
    return null;
  }
  return [name, v.slice(open + 1, close)];
}

/** Splits on top-level commas. */
function commas(args: string): string[] {
  return args.split(",").map((s) => s.trim());
}

/** Splits on runs of whitespace. */
function words(args: string): string[] {
  const t = args.trim();
  return t === "" ? [] : t.split(/\s+/);
}

/**
 * A CSS length-percentage against one axis of the box. Only px and
 * `%` are resolvable here: an `em` or a `vw` would need the
 * element's font or the viewport, neither of which crosses into a
 * pure module — MEASURE hands over a computed value, where CSS has
 * already reduced them to `px`.
 */
function len(token: string, basis: number): number | null {
  const t = token.trim();
  if (/^[+-]?(\d+\.?\d*|\.\d+)%$/.test(t)) {
    return (parseFloat(t) / 100) * basis;
  }
  if (/^[+-]?(\d+\.?\d*|\.\d+)(px)?$/.test(t)) {
    return parseFloat(t);
  }
  return null;
}

/** A closed rectangle, as four `line` segments. */
function rectPath(x0: number, y0: number, x1: number, y1: number) {
  const segments: Segment[] = [
    { k: "line", to: { x: x1, y: y0 } },
    { k: "line", to: { x: x1, y: y1 } },
    { k: "line", to: { x: x0, y: y1 } },
    { k: "line", to: { x: x0, y: y0 } },
  ];
  return [{ start: { x: x0, y: y0 }, segments }];
}

/**
 * `inset(<lp>{1,4})`, in the CSS edge order top / right / bottom /
 * left, insetting from the box's own edges.
 */
function inset(args: string, box: Rect): readonly Subpath[] | null {
  const w = words(args);
  // A rounded inset is not approximated — see the module note.
  if (w.length === 0 || w.length > 4 || w.includes("round")) {
    return null;
  }
  // CSS 1–4 value expansion, in edge order T R B L.
  const t = w[0];
  const r = w.length > 1 ? w[1] : t;
  const b = w.length > 2 ? w[2] : t;
  const l = w.length > 3 ? w[3] : r;
  const basis = [box.h, box.w, box.h, box.w];
  const edges: number[] = [];
  for (const [i, token] of [t, r, b, l].entries()) {
    const n = len(token, basis[i]);
    if (n === null) {
      return null;
    }
    edges.push(n);
  }
  const [top, right, bottom, left] = edges;
  const x0 = box.x + left;
  const y0 = box.y + top;
  const x1 = box.x + box.w - right;
  const y1 = box.y + box.h - bottom;
  return rectPath(x0, y0, Math.max(x0, x1), Math.max(y0, y1));
}

/**
 * The `at <position>` tail, defaulting to the box centre. Accepts
 * lengths, percentages and the six edge keywords.
 */
function position(w: string[], box: Rect): Point | null {
  if (w.length === 0) {
    return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  }
  if (w.length > 2) {
    return null;
  }
  const kx: Record<string, number> = {
    left: 0,
    center: 50,
    right: 100,
  };
  const ky: Record<string, number> = {
    top: 0,
    center: 50,
    bottom: 100,
  };
  const axis = (
    token: string,
    map: Record<string, number>,
    basis: number,
  ): number | null => {
    const key = token.toLowerCase();
    const pct = Object.prototype.hasOwnProperty.call(map, key)
      ? map[key]
      : null;
    return pct === null ? len(token, basis) : (pct / 100) * basis;
  };
  const x = axis(w[0], kx, box.w);
  const y = w.length === 2 ? axis(w[1], ky, box.h) : box.h / 2;
  if (x === null || y === null) {
    return null;
  }
  return { x: box.x + x, y: box.y + y };
}

/** Splits `<radius…> [at <position>]`. */
function splitAt(args: string): [string[], string[]] {
  const w = words(args);
  const i = w.findIndex((t) => t.toLowerCase() === "at");
  return i < 0 ? [w, []] : [w.slice(0, i), w.slice(i + 1)];
}

/**
 * The CSS default radius is `closest-side` — the distance to the
 * nearest edge, per axis. A percentage radius on `circle()` resolves
 * against `√((w² + h²) / 2)`, the CSS-defined single reference for a
 * two-axis box.
 */
function radius(
  token: string | undefined,
  box: Rect,
  c: Point,
  axis: "x" | "y" | "both",
): number | null {
  if (token === undefined || token.toLowerCase() === "closest-side") {
    const dx = Math.min(c.x - box.x, box.x + box.w - c.x);
    const dy = Math.min(c.y - box.y, box.y + box.h - c.y);
    return axis === "x" ? dx : axis === "y" ? dy : Math.min(dx, dy);
  }
  const basis =
    axis === "x"
      ? box.w
      : axis === "y"
      ? box.h
      : Math.sqrt((box.w * box.w + box.h * box.h) / 2);
  const r = len(token, basis);
  return r === null || r < 0 ? null : r;
}

/** Four cubics, one per quadrant, clockwise from 3 o'clock. */
function ellipsePath(
  c: Point,
  rx: number,
  ry: number,
): readonly Subpath[] {
  const ox = rx * KAPPA;
  const oy = ry * KAPPA;
  const p = (x: number, y: number): Point => ({ x, y });
  const segments: Segment[] = [
    {
      k: "cubic",
      c1: p(c.x + rx, c.y + oy),
      c2: p(c.x + ox, c.y + ry),
      to: p(c.x, c.y + ry),
    },
    {
      k: "cubic",
      c1: p(c.x - ox, c.y + ry),
      c2: p(c.x - rx, c.y + oy),
      to: p(c.x - rx, c.y),
    },
    {
      k: "cubic",
      c1: p(c.x - rx, c.y - oy),
      c2: p(c.x - ox, c.y - ry),
      to: p(c.x, c.y - ry),
    },
    {
      k: "cubic",
      c1: p(c.x + ox, c.y - ry),
      c2: p(c.x + rx, c.y - oy),
      to: p(c.x + rx, c.y),
    },
  ];
  return [{ start: p(c.x + rx, c.y), segments }];
}

function circle(args: string, box: Rect): readonly Subpath[] | null {
  const [r, at] = splitAt(args);
  if (r.length > 1) {
    return null;
  }
  const c = position(at, box);
  if (c === null) {
    return null;
  }
  const rad = radius(r[0], box, c, "both");
  return rad === null ? null : ellipsePath(c, rad, rad);
}

function ellipse(args: string, box: Rect): readonly Subpath[] | null {
  const [r, at] = splitAt(args);
  if (r.length !== 0 && r.length !== 2) {
    return null;
  }
  const c = position(at, box);
  if (c === null) {
    return null;
  }
  const rx = radius(r[0], box, c, "x");
  const ry = radius(r[1], box, c, "y");
  return rx === null || ry === null ? null : ellipsePath(c, rx, ry);
}

/**
 * `polygon([fill-rule,] x y [, …])`. The fill rule is
 * dropped: a single non-self-intersecting outline is the only form
 * the corpus produces, and honouring `evenodd` would need a rule the
 * `Subpath[]` contract has nowhere to carry.
 */
function polygon(args: string, box: Rect): readonly Subpath[] | null {
  const parts = commas(args);
  if (parts.length > 0) {
    const first = parts[0].toLowerCase();
    if (first === "nonzero" || first === "evenodd") {
      parts.shift();
    }
  }
  if (parts.length < 3) {
    return null;
  }
  const pts: Point[] = [];
  for (const part of parts) {
    const w = words(part);
    if (w.length !== 2) {
      return null;
    }
    const x = len(w[0], box.w);
    const y = len(w[1], box.h);
    if (x === null || y === null) {
      return null;
    }
    pts.push({ x: box.x + x, y: box.y + y });
  }
  const segments: Segment[] = pts
    .slice(1)
    .map((to): Segment => ({ k: "line", to }));
  segments.push({ k: "line", to: pts[0] });
  return [{ start: pts[0], segments }];
}
