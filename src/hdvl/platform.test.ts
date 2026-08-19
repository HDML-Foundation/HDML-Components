/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";

/**
 * The platform contract eight slices of HDVL rest on, asserted on
 * all three engines **before one display element exists** (RFC
 * 016/001 §10.4, §10.5, §10.6).
 *
 * None of these is a nice-to-have. `.testrc.js` turns the legacy
 * plugin's `webcomponents` polyfill on for every run; if ShadyCSS
 * ever activates, `adoptedStyleSheets`, `:host` scoping and
 * `::slotted` all change meaning underneath R28/R33's two-sheet
 * model. `CSS.registerProperty` throwing on re-registration is the
 * *premise* of H5's per-property try/catch. `transitionrun` on a
 * registered property is R24's frame sentinel, and RFC §10.6
 * discharged it as a drafting spike — this file turns that discharge
 * into a standing assertion, because a browser upgrade could revoke
 * it silently.
 *
 * **A red probe is a stop-and-ask, not a fix-forward.** Do not
 * weaken an assertion, skip an engine, or add a polyfill: any of the
 * eight going red changes what steps 09 and 11 can be built out of.
 *
 * This file lives under `src/hdvl/` deliberately — it is the display
 * half's platform contract, and `check-dist.mjs`'s §2.1 edge check
 * scans every `.ts` here, so it can never quietly reach into `hdio`.
 */

/** `CustomStateSet` has no `add` in TS 5.5's lib.dom. */
interface StateSet {
  add(value: string): void;
}

/** Tracks the elements a test appended, so teardown can clear. */
let planted: Element[] = [];

/**
 * Appends to `document.body` and registers the cleanup.
 *
 * @param el - The element to plant.
 * @returns The same element.
 */
function plant<T extends Element>(el: T): T {
  document.body.appendChild(el);
  planted.push(el);
  return el;
}

/**
 * Resolves `true` if `type` fires on `target` within `ms`.
 *
 * @param target - The event target.
 * @param type - The event name.
 * @param ms - The wait budget.
 * @returns Whether the event fired in time.
 */
function fired(
  target: EventTarget,
  type: string,
  ms: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      target.removeEventListener(type, onFire);
      resolve(false);
    }, ms);
    const onFire = (): void => {
      clearTimeout(timer);
      target.removeEventListener(type, onFire);
      resolve(true);
    };
    target.addEventListener(type, onFire);
  });
}

// One box element carrying the three shadow-scoping capabilities at
// once: a constructed sheet adopted into an open root, a
// `:host(...)`-qualified rule, and a `::slotted(...)` rule over an
// assigned light child.
class ProbeBox extends HTMLElement {
  public constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    const inner = document.createElement("div");
    inner.className = "inner";
    root.appendChild(inner);
    root.appendChild(document.createElement("slot"));
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(
      [
        ".inner { color: rgb(1, 2, 3); }",
        ":host([flag]) .inner { color: rgb(4, 5, 6); }",
        "::slotted(span) { color: rgb(7, 8, 9); }",
      ].join("\n"),
    );
    root.adoptedStyleSheets = [sheet];
  }
}
customElements.define("hdvl-probe-box", ProbeBox);

// An element with internals, for the `:state()` lifecycle surface.
class ProbeState extends HTMLElement {
  public readonly internals: ElementInternals;

  public constructor() {
    super();
    this.internals = this.attachInternals();
  }
}
customElements.define("hdvl-probe-state", ProbeState);

suite("HDVL platform capabilities", () => {
  teardown(() => {
    planted.forEach((el) => el.remove());
    planted = [];
  });

  test("1 no ShadyCSS/ShadyDOM is forced", () => {
    const w = window as unknown as {
      ShadyDOM?: { inUse?: boolean; force?: boolean };
      ShadyCSS?: { nativeShadow?: boolean };
    };
    // The legacy plugin injects webcomponentsjs on every run. It
    // must detect native shadow DOM and stay out of the way; if
    // ShadyCSS ever takes over, :host, ::slotted and
    // adoptedStyleSheets change meaning under R28/R33.
    assert.notOk(w.ShadyDOM?.inUse);
    assert.notOk(w.ShadyDOM?.force);
    if (w.ShadyCSS) {
      assert.isTrue(w.ShadyCSS.nativeShadow);
    }
    assert.isFunction(Element.prototype.attachShadow);
  });

  test("2 a constructed sheet adopts into a shadow root", () => {
    const el = plant(document.createElement("hdvl-probe-box"));
    const root = el.shadowRoot;
    assert.isNotNull(root);
    const sheets = root.adoptedStyleSheets;
    assert.lengthOf(sheets, 1);
    assert.instanceOf(sheets[0], CSSStyleSheet);
    const inner = root.querySelector(".inner");
    assert.isNotNull(inner);
    assert.equal(getComputedStyle(inner).color, "rgb(1, 2, 3)");
  });

  test("3 a :host(...) rule in an adopted sheet resolves", () => {
    const el = plant(document.createElement("hdvl-probe-box"));
    const inner = (el.shadowRoot as ShadowRoot).querySelector(
      ".inner",
    ) as Element;
    assert.equal(getComputedStyle(inner).color, "rgb(1, 2, 3)");
    el.setAttribute("flag", "");
    // R33: the element sheet is host-qualified throughout, so this
    // is how every display element's own CSS reaches its box.
    assert.equal(getComputedStyle(inner).color, "rgb(4, 5, 6)");
  });

  test("4 ::slotted selects an assigned light child", () => {
    const el = document.createElement("hdvl-probe-box");
    const span = document.createElement("span");
    span.textContent = "x";
    el.appendChild(span);
    plant(el);
    // §3.1's collapsed-slot model puts every child in a slot; the
    // view's CSS reaches them through ::slotted and nothing else.
    assert.equal(getComputedStyle(span).color, "rgb(7, 8, 9)");
  });

  test("5 registerProperty resolves, and re-throws", () => {
    const def: PropertyDefinition = {
      name: "--hdvl-probe-len",
      syntax: "<length>",
      inherits: false,
      initialValue: "7px",
    };
    CSS.registerProperty(def);
    const el = plant(document.createElement("div"));
    assert.equal(
      getComputedStyle(el)
        .getPropertyValue("--hdvl-probe-len")
        .trim(),
      "7px",
    );
    // H5's premise: a page that loads two builds registers the set
    // twice, so `properties.ts` needs a PER-PROPERTY try/catch — a
    // loop-level one would leave the second build a partial
    // registry.
    let err: unknown = null;
    try {
      CSS.registerProperty(def);
    } catch (e) {
      err = e;
    }
    assert.instanceOf(err, DOMException);
    assert.equal(err.name, "InvalidModificationError");
  });

  test("6 :state() matches after internals.states.add", () => {
    const el = plant(
      document.createElement("hdvl-probe-state"),
    ) as ProbeState;
    assert.isFalse(el.matches(":state(loading)"));
    (el.internals.states as unknown as StateSet).add("loading");
    // SPEC §1's lifecycle surface is :state(loading|empty|error).
    assert.isTrue(el.matches(":state(loading)"));
  });

  test("7 ResizeObserver delivers a first callback", async () => {
    const el = plant(document.createElement("div"));
    el.style.width = "40px";
    el.style.height = "20px";
    const seen = await new Promise<number>((resolve) => {
      const timer = setTimeout(() => resolve(-1), 2000);
      const ro = new ResizeObserver((entries) => {
        clearTimeout(timer);
        ro.disconnect();
        resolve(entries.length);
      });
      ro.observe(el);
    });
    // R27: the frame's MEASURE phase is driven by exactly this.
    assert.equal(seen, 1);
  });

  test("8 transitionrun fires inline and via a sheet", async () => {
    CSS.registerProperty({
      name: "--hdvl-probe-t1",
      syntax: "<length>",
      inherits: false,
      initialValue: "0px",
    });
    CSS.registerProperty({
      name: "--hdvl-probe-t2",
      syntax: "<length>",
      inherits: false,
      initialValue: "0px",
    });

    const inline = plant(document.createElement("div"));
    inline.style.transitionProperty = "--hdvl-probe-t1";
    inline.style.transitionDuration = "50ms";
    // Force a before-change style: a transition never runs on an
    // element's first style resolution.
    getComputedStyle(inline).getPropertyValue("--hdvl-probe-t1");
    const inlineRan = fired(inline, "transitionrun", 2000);
    inline.style.setProperty("--hdvl-probe-t1", "10px");
    assert.isTrue(await inlineRan);

    const style = document.createElement("style");
    style.textContent = ".hdvl-probe-t2 { --hdvl-probe-t2: 10px; }";
    const sheeted = plant(document.createElement("div"));
    sheeted.style.transitionProperty = "--hdvl-probe-t2";
    sheeted.style.transitionDuration = "50ms";
    getComputedStyle(sheeted).getPropertyValue("--hdvl-probe-t2");
    const sheetRan = fired(sheeted, "transitionrun", 2000);
    plant(style);
    sheeted.classList.add("hdvl-probe-t2");
    // R24's sentinel is a stylesheet-driven change, not an inline
    // one — a rule the author's CSS matched. Both paths must fire,
    // or the sentinel silently degrades to the MutationObserver.
    assert.isTrue(await sheetRan);
  });
});
