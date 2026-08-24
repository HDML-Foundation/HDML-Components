/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert, fixture } from "@open-wc/testing";
import { html, unsafeStatic } from "lit/static-html.js";
import { LitElement } from "lit";
import "./index";
import type { Channel } from "./resolve";
import type { Scale, TickSpec } from "./scale";
import type { SceneGroup, SceneNode } from "./scene";
import { HdvlProbeElement, PROBE_TAG } from "../testing/probe";
import {
  installSceneRecorder,
  restoreRenderers,
  roundDeep,
  sceneOf,
} from "../testing/scene-of";
import { HdmlViewElement } from "./view";
import { HdmlLabelElement } from "./guide-label";
import { chainScaleOf } from "./scale";

/**
 * `hdml-label` — §6.5's formatted run, and the project's **first
 * text in a scene**.
 *
 * ★ **Which cross-engine rule applies where.**
 *
 * - **Rule 3** governs every scene assertion, through
 *   `sceneOf(view, {precision: 6})`.
 * - **Rule 4 — chromium only — covers rendered `Intl` strings**,
 *   which are ICU version and OS data. One suite is scoped, the
 *   scoping is *declared*, and the guard is asserted on all three
 *   engines so an engine-detection change cannot make it silently
 *   assert nothing. Everything else here compares a label to
 *   another label, or to a value read from the **same `Intl`
 *   call**, and runs everywhere.
 * - **Rule 8** would bind on anything through `measureText`. It
 *   binds nowhere in this file, because `hdml-label` does not call
 *   it: a `text` node carries `anchor` and `baseline` and the
 *   renderer places it. See the element's own JSDoc for what would
 *   need one.
 * - **Rule 9** — every produced coordinate is normalised at the
 *   source by `guidePoint`.
 */

const P = { precision: 6 };

/* -------------------------------------------------------------- */
/* Engine classification — the declared guard, asserted            */
/* -------------------------------------------------------------- */

type Engine = "chromium" | "firefox" | "webkit" | "unclassified";

/**
 * Which of the three engines this run is on.
 *
 * Firefox is tested first because its UA names neither of the
 * other two, and chromium before webkit because a chromium UA
 * also carries `AppleWebKit`.
 */
function engineOf(ua: string): Engine {
  if (/Firefox/.test(ua)) return "firefox";
  if (/Chrome|Chromium|Edg\//.test(ua)) return "chromium";
  if (/AppleWebKit/.test(ua)) return "webkit";
  return "unclassified";
}

/** The engine this run is on. */
const ENGINE = engineOf(navigator.userAgent);

/* -------------------------------------------------------------- */
/* Harness                                                         */
/* -------------------------------------------------------------- */

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

function labelOf(
  view: HdmlViewElement,
  channel = "y",
): HdmlLabelElement {
  return <HdmlLabelElement>(
    view.querySelector(`hdml-label[channel="${channel}"]`)
  );
}

function groupOf(view: HdmlViewElement, channel = "y"): SceneGroup {
  const uid = labelOf(view, channel).uid;
  const group = sceneOf(view, P).groups.find((g) => g.widget === uid);
  assert.isDefined(group, "the label painted no group");
  return group;
}

type TextNode = Extract<SceneNode, { k: "text" }>;

function texts(view: HdmlViewElement, channel = "y"): TextNode[] {
  return groupOf(view, channel).nodes.map((node) => {
    assert.strictEqual(node.k, "text");
    return <TextNode>node;
  });
}

/** The scale the chain resolved for a channel, read via the probe. */
function scaleOf(view: HdmlViewElement, channel: Channel): Scale {
  const probe = <HdvlProbeElement>view.querySelector(PROBE_TAG);
  const call = probe.last;
  assert.isNotNull(call, "the probe was never called");
  const scale = chainScaleOf(
    (<{ ctx: Parameters<typeof chainScaleOf>[0] }>call).ctx,
    probe,
    channel,
  );
  assert.isNotNull(scale, `no ${channel} scale`);
  return scale;
}

/** ★ R12's assertion: the positions of a real `ticks(spec)` call. */
function expected(
  view: HdmlViewElement,
  channel: Channel,
  spec: TickSpec,
): number[] {
  return <number[]>roundDeep(
    scaleOf(view, channel)
      .ticks(spec)
      .map((t) => t.at),
    P.precision,
  );
}

/** The compact part `Intl` gives one value, read off the same API. */
function suffixOf(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: "compact" })
    .formatToParts(value)
    .filter((p) => p.type === "compact")
    .map((p) => p.value)
    .join("");
}

/** A y-channel label over `[0, 0.2]`, on the UA gutter. */
function page(attrs: string, style = "") {
  // Step 23's T2: `lit/static-html` needs `unsafeStatic` for an
  // attribute LIST, not only for a tag.
  const spec = unsafeStatic(attrs);
  return html`
    <hdml-view aria-label="label" style="width: 400px; height: 200px">
      <hdml-cartesian-plane>
        <hdml-continuous-scale channel="x" min="0" max="4">
          <hdml-continuous-scale channel="y" min="0" max="0.2">
            <hdml-label
              channel="y"
              ${spec}
              style="${style}"
            ></hdml-label>
            <hdvl-probe></hdvl-probe>
          </hdml-continuous-scale>
        </hdml-continuous-scale>
      </hdml-cartesian-plane>
    </hdml-view>
  `;
}

/** An x-channel label, whose box the placement fixtures move. */
function xPage(style: string) {
  return html`
    <hdml-view aria-label="xlab" style="width: 400px; height: 200px">
      <hdml-cartesian-plane>
        <hdml-continuous-scale channel="x" min="0" max="4">
          <hdml-continuous-scale channel="y" min="0" max="200">
            <hdml-label
              channel="x"
              count="3"
              style="${style}"
            ></hdml-label>
            <hdvl-probe></hdvl-probe>
          </hdml-continuous-scale>
        </hdml-continuous-scale>
      </hdml-cartesian-plane>
    </hdml-view>
  `;
}

suite("hdvl/guide-label — §6.5's formatted run", () => {
  setup(() => {
    installSceneRecorder();
  });

  teardown(() => {
    restoreRenderers();
  });

  test("★ one text per tick, at scale.ticks(spec)", async () => {
    const view = await mount(page('step="0.05"'));
    const nodes = texts(view);
    assert.lengthOf(nodes, 5);
    assert.deepEqual(
      <number[]>roundDeep(
        nodes.map((n) => n.y),
        P.precision,
      ),
      expected(view, "y", { step: 0.05 }),
    );
    const font = getComputedStyle(labelOf(view));
    for (const node of nodes) {
      // §6.5: a label is what the reader is TOLD, so it is real
      // text and the renderer never aria-hides it.
      assert.isFalse(node.decorative);
      // §2.5: a tick position is not a source row index.
      assert.strictEqual(node.i, -1);
      assert.isNotNull(node.fill);
      assert.isString(node.text);
      // The font is TRANSFERRED from the measured snapshot, not
      // assembled here.
      assert.strictEqual(
        node.font.size,
        Number.parseFloat(
          font.getPropertyValue("--hdml-font-size").trim(),
        ),
      );
      assert.isTrue(node.font.family.length > 0);
    }
  });

  test("★ anchor and baseline follow the BOX", async () => {
    // §6.5 derives them from "which edge of its own box the scale's
    // axis runs along", and SPEC §7 gives the tag no `position`
    // attribute — so this is the derivation under a moved box, not
    // four cases keyed on the channel.
    const below = await mount(xPage(""));
    for (const node of texts(below, "x")) {
      assert.strictEqual(node.anchor, "middle");
      assert.strictEqual(node.baseline, "top");
    }

    const above = await mount(
      xPage("top: auto; bottom: 100%; height: 24px"),
    );
    for (const node of texts(above, "x")) {
      assert.strictEqual(node.anchor, "middle");
      assert.strictEqual(node.baseline, "bottom");
    }
    // Only the crossing moved: the positions ALONG x are unmoved.
    assert.deepEqual(
      texts(above, "x").map((n) => n.x),
      texts(below, "x").map((n) => n.x),
    );

    const left = await mount(page('count="3"'));
    for (const node of texts(left)) {
      assert.strictEqual(node.anchor, "end");
      assert.strictEqual(node.baseline, "middle");
    }

    const right = await mount(
      page('count="3"', "left: 100%; right: auto; width: 40px;"),
    );
    for (const node of texts(right)) {
      assert.strictEqual(node.anchor, "start");
      assert.strictEqual(node.baseline, "middle");
    }
  });

  test("★ ONE shared compact prefix over the set", async () => {
    // §4.9 / SPEC §7, asserted STRUCTURALLY so it holds on all
    // three engines: every label ends with the same part, that
    // part is the one `formatToParts` gives the largest-magnitude
    // value, and the naive per-value form really does differ.
    const view = await mount(html`
      <hdml-view
        aria-label="big"
        lang="en"
        style="width: 400px; height: 200px"
      >
        <hdml-cartesian-plane>
          <hdml-continuous-scale channel="x" min="0" max="4">
            <hdml-continuous-scale channel="y" min="0" max="1500000">
              <hdml-label
                channel="y"
                values="[900000, 1200000, 1500000]"
                format="compact-short"
              ></hdml-label>
              <hdvl-probe></hdvl-probe>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    const shown = texts(view).map((n) => n.text);
    assert.lengthOf(shown, 3);

    // ★ The view's `lang` is the locale (SPEC §7), so the part is
    // read from the SAME Intl call rather than from a literal —
    // which is what makes this assertion engine-independent.
    const suffix = suffixOf(1_500_000, "en");
    assert.isTrue(suffix.length > 0);
    assert.isTrue(
      shown.every((t) => t.endsWith(suffix)),
      shown.join(" "),
    );

    // …and the naive form differs, or the suite could not fail for
    // the reason it exists: 900 000 alone would say "K".
    assert.notStrictEqual(suffixOf(900_000, "en"), suffix);
  });

  test("★ the locale is the view's lang", async () => {
    // SPEC §7: "locale resolves from the nearest `lang` — no
    // `locale` attribute, no implicit engine state". Compared
    // between two views rather than to a string, so it holds on
    // every engine.
    const at = (lang: string) => html`
      <hdml-view
        aria-label="loc"
        lang=${lang}
        style="width: 400px; height: 200px"
      >
        <hdml-cartesian-plane>
          <hdml-continuous-scale channel="x" min="0" max="4">
            <hdml-continuous-scale channel="y" min="0" max="1500000">
              <hdml-label
                channel="y"
                values="[1200000]"
                format="compact-long"
              ></hdml-label>
              <hdvl-probe></hdvl-probe>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `;
    const en = await mount(at("en"));
    const de = await mount(at("de"));
    assert.notDeepEqual(
      texts(en).map((n) => n.text),
      texts(de).map((n) => n.text),
    );
  });

  test("★ the engine guard classifies on every engine", () => {
    // WHY THIS TEST EXISTS. One suite below is chromium-scoped
    // under rule 4. If `engineOf` ever stopped recognising an
    // engine it would return "unclassified", that suite would
    // quietly assert nothing on every engine, and the build would
    // stay green.
    assert.oneOf(ENGINE, ["chromium", "firefox", "webkit"]);
    assert.strictEqual(
      engineOf("Mozilla/5.0 Firefox/128.0"),
      "firefox",
    );
    assert.strictEqual(
      engineOf("Mozilla/5.0 AppleWebKit/537 Chrome/145 Safari/537"),
      "chromium",
    );
    assert.strictEqual(
      engineOf("Mozilla/5.0 AppleWebKit/605 Version/17 Safari/605"),
      "webkit",
    );
  });

  test("★ a datetime label formats in the scale's zone", async () => {
    // 2026-01-01T02:00:00Z is still 2025-12-31 in New York, so a
    // `MMM` label differs from the UTC rendering. The two scenes
    // are compared to EACH OTHER, never to a month name.
    const domain = '["2025-06-01T00:00:00Z", "2026-01-01T02:00:00Z"]';
    const at = (zone: string) => html`
      <hdml-view
        aria-label="dt"
        lang="en"
        style="width: 400px; height: 200px"
      >
        <hdml-cartesian-plane>
          <hdml-continuous-scale channel="y" min="0" max="1">
            <hdml-datetime-scale
              channel="x"
              values=${domain}
              zone=${zone}
            >
              <hdml-label
                channel="x"
                values='["2026-01-01T02:00:00Z"]'
                format="MMM"
              ></hdml-label>
              <hdvl-probe></hdvl-probe>
            </hdml-datetime-scale>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `;
    const utc = await mount(at("UTC"));
    const ny = await mount(at("America/New_York"));
    const a = texts(utc, "x").map((n) => n.text);
    const b = texts(ny, "x").map((n) => n.text);
    assert.lengthOf(a, 1);
    assert.lengthOf(b, 1);
    assert.notDeepEqual(a, b);
  });

  test("★ an ordinal label is verbatim", async () => {
    const view = await mount(html`
      <hdml-view aria-label="ord" style="width: 400px; height: 200px">
        <hdml-cartesian-plane>
          <hdml-ordinal-scale channel="x" values='["a","b","c","d"]'>
            <hdml-continuous-scale channel="y" min="0" max="100">
              <hdml-label channel="x"></hdml-label>
              <hdvl-probe></hdvl-probe>
            </hdml-continuous-scale>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    assert.deepEqual(
      texts(view, "x").map((n) => n.text),
      ["a", "b", "c", "d"],
    );
    // §4.4: an ordinal position is the band CENTRE.
    assert.deepEqual(
      <number[]>roundDeep(
        texts(view, "x").map((n) => n.x),
        P.precision,
      ),
      expected(view, "x", {}),
    );
  });

  test("a label with no format still formats", async () => {
    // `formatCompactSet` is total: the empty skeleton a bare label
    // carries maps to no bag and falls through to the locale's
    // default number formatting.
    const view = await mount(page('values="[0, 0.1, 0.2]"'));
    const shown = texts(view).map((n) => n.text);
    assert.lengthOf(shown, 3);
    for (const text of shown) {
      assert.isTrue(text.length > 0);
    }
    assert.strictEqual(new Set(shown).size, 3);
  });

  test("its role is guide, and the scene round-trips", async () => {
    const view = await mount(page('count="3"'));
    assert.strictEqual(groupOf(view).role, "guide");
    assert.isTrue(view.matches(":state(empty)"));
    const scene = sceneOf(view, P);
    // R2/R26: text nodes included.
    assert.deepEqual(structuredClone(<unknown>scene), <unknown>scene);
  });

  test("★ an angular channel paints a run per tick", async () => {
    // Step 24's placeholder asserted the opposite. What changed at
    // step 27 is `placementOf` moving up into `guide-spec.ts` as
    // `guidePlacement`; the derivation this element used is the one
    // both planes now share.
    const view = await mount(html`
      <hdml-view aria-label="pol" style="width: 400px; height: 200px">
        <hdml-polar-plane>
          <hdml-continuous-scale channel="angle" min="0" max="4">
            <hdml-continuous-scale channel="radius" min="0" max="10">
              <hdml-label channel="angle" count="4"></hdml-label>
              <hdvl-probe></hdvl-probe>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-polar-plane>
      </hdml-view>
    `);
    const probe = <HdvlProbeElement>view.querySelector(PROBE_TAG);
    probe.emit = true;
    view.markDirty();
    await quiesce(view);
    const groups = sceneOf(view, P).groups;
    const group = groups.find(
      (g) => g.widget === labelOf(view, "angle").uid,
    );
    assert.isDefined(group);
    assert.isAbove(group.nodes.length, 0);
    assert.isTrue(groups.some((g) => g.widget === probe.uid));
  });
});

/* -------------------------------------------------------------- */
/* ★ Rule 4's ONE declared exception — chromium only               */
/* -------------------------------------------------------------- */

suite("hdvl/guide-label — rendered strings", () => {
  /**
   * WHY THIS SUITE IS SCOPED AND NOTHING ELSE IS.
   *
   * Every assertion above compares a label to another label, or to
   * a part read from the same `Intl` call, or to a domain string
   * the document itself wrote. None of that depends on which ICU
   * an engine shipped. These do: the exact rendering of a compact
   * part is ICU version and OS data and differs between chromium,
   * firefox and webkit on the same machine. Plan rule 4 scopes
   * exactly this and nothing else, and this comment is the
   * declaration rule 4 requires.
   */
  const only = ENGINE === "chromium";

  setup(() => {
    installSceneRecorder();
  });

  teardown(() => {
    restoreRenderers();
  });

  async function shown(format: string): Promise<string[]> {
    const spec = unsafeStatic(format);
    const view = await mount(html`
      <hdml-view
        aria-label="str"
        lang="en"
        style="width: 400px; height: 200px"
      >
        <hdml-cartesian-plane>
          <hdml-continuous-scale channel="x" min="0" max="4">
            <hdml-continuous-scale channel="y" min="0" max="1500000">
              <hdml-label
                channel="y"
                values="[900000, 1200000, 1500000]"
                ${spec}
              ></hdml-label>
              <hdvl-probe></hdvl-probe>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    return texts(view).map((n) => n.text);
  }

  test("SPEC §7's axis reads 0.9M, 1.2M, 1.5M", async () => {
    if (!only) return;
    assert.deepEqual(await shown('format="compact-short"'), [
      "0.9M",
      "1.2M",
      "1.5M",
    ]);
  });

  test("a currency skeleton keeps its sign", async () => {
    if (!only) return;
    assert.deepEqual(
      await shown('format="currency/USD compact-short .#"'),
      ["$0.9M", "$1.2M", "$1.5M"],
    );
  });
});
