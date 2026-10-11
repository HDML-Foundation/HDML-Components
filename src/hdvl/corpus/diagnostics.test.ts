/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import "../index";
import { mountCorpus } from "../../testing/corpus";
import { diagnosticsOf, pathOf } from "../validate";
import type { Diagnostic, SerialisableDiagnostic } from "../validate";
import type { HdmlViewElement } from "../view";

/**
 * ★★★ **`HDML.diagnostics()` — the serialisable projection**
 * (019 step 32, item 11, RFC 019/002 §5, D12).
 *
 * This file lives in `corpus/` rather than beside `validate.ts`
 * because every claim it makes needs a **real page**: a multi-view
 * one for the document-order composition, same-tag siblings for the
 * ordinal, and all twenty-nine views for the clean pass.
 * `validate.test.ts` would have given the code-space record for
 * free, but that record is already asserted there and does not
 * need a second home; a page corpus cannot be reconstructed.
 *
 * ★ **Four of the five assertions here are negative controls**, and
 * the reason is that this surface fails *quietly*. A
 * `diagnostics()` that returned `[]` unconditionally passes every
 * clean-page assertion; a path walk that forgot the ordinal gives
 * three identical paths that all *resolve*; and an additivity test
 * that pre-seeds the namespace after the module has already
 * registered tests nothing at all.
 */

/** The page the composition claims are made on — two views. */
const MULTI = "02-area";

/** The thirteen corpus pages and their view counts. */
const PAGES: readonly (readonly [string, number])[] = [
  ["00-minimal", 1],
  ["01-line", 1],
  ["02-area", 2],
  ["03-bar", 3],
  ["04-grouped-stacked", 5],
  ["05-scatter", 2],
  ["06-bubble", 1],
  ["07-mixed", 1],
  ["08-pie-doughnut", 4],
  ["09-polar-area", 2],
  ["10-radar", 1],
  ["11-multi-plane", 2],
  ["12-coverage", 4],
];

/** The namespace, typed enough to call without a cast per site. */
interface Ns {
  supports(tag: string, attr?: string): boolean;
  diagnostics(view?: Element): readonly SerialisableDiagnostic[];
  [key: string]: unknown;
}

function ns(): Ns {
  const scope = <{ HDML?: Ns }>(<unknown>globalThis);
  const found = scope.HDML;
  assert.isDefined(found, "the namespace is registered");
  return found;
}

/**
 * Builds a **detached** element tree from markup.
 *
 * ⚠⚠ **Measured trap, and it is why these fixtures are detached.**
 * `pathOf` is a pure DOM walk, so it needs no attached document —
 * and an ATTACHED synthetic view in this file is **styled by
 * whichever corpus page's `<style>` was injected last**. The
 * page sheets go into the shared `document.head` and their
 * selectors are global (019 step 30's comment in
 * `mountCorpus`); the drop-first rule there protects the next
 * *corpus* mount, not an `@open-wc` `fixture`. The first draft of
 * this file used `fixture()` and a bare `<hdml-view>` picked up
 * `12-coverage`'s `hdml-legend[channel="color"]` declarations,
 * firing V14 / V16 / V20 into the console from a page that does
 * not exist — harmless to these assertions and completely
 * test-order dependent.
 *
 * A detached tree also never upgrades its custom elements and
 * never runs a frame, so what it tests is the walk and nothing
 * else.
 */
function detached(markup: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = markup;
  return root;
}

/**
 * Makes one **real** diagnostic on a view and hands back its
 * internal form, the projection, and a restore.
 *
 * ⚠ The recipe is `corpus/validator.test.ts`'s `probeElements`, not
 * a new one: a bare `<hdml-axis>` at the **plane** level has no
 * `channel`, so V1 and V20 have nothing to say and the one finding
 * is **V13**'s. And it is `reindex()`, never `markDirty()` — only
 * `reindex` re-runs the structural pass.
 */
function withV13(view: HdmlViewElement): {
  stray: Element;
  internal: readonly Diagnostic[];
  projected: readonly SerialisableDiagnostic[];
  restore: () => void;
} {
  const plane = view.querySelector(
    "hdml-cartesian-plane, hdml-polar-plane",
  );
  assert.isNotNull(plane, "every view has a plane");
  const stray = document.createElement("hdml-axis");
  plane?.appendChild(stray);
  view.reindex();
  const internal = diagnosticsOf(view);
  assert.isNotEmpty(internal, "the probe produced a finding");
  return {
    stray,
    internal,
    projected: ns().diagnostics(view),
    restore: () => {
      stray.remove();
      view.reindex();
    },
  };
}

/* ---------------------------------------------------------------- */
/* 1. The headline — it serialises, and it is right                 */
/* ---------------------------------------------------------------- */

suite("HDML.diagnostics() — the serialisable projection", () => {
  test("★★★ the internal shape cannot be stringified", async () => {
    const page = await mountCorpus(MULTI);
    const probe = withV13(page.views[0]);
    // Not a LOSSY round-trip — a THROW. A Lit element carries own
    // enumerable fields that cycle, so the engines disagree only
    // about the message: chromium "Converting circular structure
    // to JSON", firefox "cyclic object value", webkit
    // "JSON.stringify cannot serialize cyclic structures". A
    // caller therefore gets no result at all, which is why the
    // gate for the projection is `doesNotThrow` and not a
    // comparison against a value that cannot be obtained.
    assert.throws(() => JSON.stringify(probe.internal));
    probe.restore();
  });

  test("★★★ the projection round-trips and deep-equals", async () => {
    const page = await mountCorpus(MULTI);
    const probe = withV13(page.views[0]);
    let text = "";
    assert.doesNotThrow(() => {
      text = JSON.stringify(probe.projected);
    });
    // ⚠ `doesNotThrow` alone passes for a projection that is
    // serialisable and WRONG, so the round-trip is deep-equal and
    // every field is then checked against the internal form below.
    assert.deepEqual(
      JSON.parse(text),
      JSON.parse(JSON.stringify(probe.projected)),
    );
    assert.deepEqual(<SerialisableDiagnostic[]>JSON.parse(text), [
      ...probe.projected,
    ]);
    probe.restore();
  });

  test("★★★ control 1 — every field is the finding's", async () => {
    // Negative control: a stub returning `[]`, or a projection
    // that dropped a member, passes every clean-page assertion in
    // this file. So the projected set is compared to the internal
    // one field by field, on a REAL finding.
    const page = await mountCorpus(MULTI);
    const probe = withV13(page.views[0]);
    assert.lengthOf(probe.projected, probe.internal.length);
    probe.internal.forEach((d, i) => {
      const p = probe.projected[i];
      assert.strictEqual(p.rule, d.rule);
      assert.strictEqual(p.code, d.code);
      assert.strictEqual(p.severity, d.severity);
      assert.strictEqual(p.message, d.message);
      assert.strictEqual(p.path, pathOf(d.element));
      assert.strictEqual(p.unit, pathOf(d.unit));
      assert.strictEqual(p.channel, d.channel ?? null);
      assert.strictEqual(p.source, d.source ?? null);
    });
    // The finding under test is V13's, named so a change of recipe
    // cannot quietly make this a test of some other rule.
    assert.include(
      probe.internal.map((d) => d.rule),
      "V13",
    );
    probe.restore();
  });

  test("★★ the core is flat and nothing is optional", async () => {
    // RFC 019/002 §2.1's amendment (C231): the wire is FLAT, with
    // `path`/`line`/`column`/`offset` top-level and `column`
    // spelled in full. §5.2's nested `anchor` and §9.1's
    // "anchor.path" both predate it. A nested anchor would
    // unmarshal into HDIO-Server's `domain.HdmlDiagnostic` with a
    // NIL ERROR and a zero anchor — working, and locationless.
    const page = await mountCorpus(MULTI);
    const probe = withV13(page.views[0]);
    for (const d of probe.projected) {
      assert.notProperty(d, "anchor");
      assert.notProperty(d, "col");
      assert.notProperty(d, "element");
      // Every key is present on every row, `null` where
      // inapplicable: `JSON.stringify` DROPS an `undefined`
      // member, so an optional one would vary the key set row to
      // row over the one channel this exists for.
      assert.hasAllKeys(d, [
        "code",
        "severity",
        "message",
        "path",
        "line",
        "column",
        "offset",
        "rule",
        "unit",
        "channel",
        "source",
      ]);
      assert.isNull(d.line, "no line on the browser leg, ever");
      assert.isNull(d.column);
      assert.isNull(d.offset);
      assert.isString(d.path);
      assert.isString(d.unit);
    }
    probe.restore();
  });
});

/* ---------------------------------------------------------------- */
/* 2. The anchor path                                               */
/* ---------------------------------------------------------------- */

/** Resolves a tag-and-ordinal path back to its element. */
function resolve(root: ParentNode, path: string): null | Element {
  let scope: ParentNode = root;
  let found: null | Element = null;
  for (const seg of path.split("/")) {
    const m = /^(.+)\[(\d+)\]$/.exec(seg);
    assert.isNotNull(m, `"${seg}" is tag-and-ordinal`);
    const tag = m[1];
    const want = Number(m[2]);
    // The walk's own relation, inverted: descend through anything,
    // but never THROUGH a vocabulary element, so each one is its
    // own addressing level.
    const level: Element[] = [];
    const visit = (node: ParentNode): void => {
      for (const child of Array.from(node.children)) {
        if (child.localName.startsWith("hdml-")) {
          level.push(child);
          continue;
        }
        visit(child);
      }
    };
    visit(scope);
    const same = level.filter((el) => el.localName === tag);
    assert.isAtLeast(same.length, want + 1, `${path}: ${seg}`);
    found = same[want];
    scope = found;
  }
  return found;
}

suite("HDML.diagnostics() — the anchor path", () => {
  test("★★★ a path resolves to the IDENTICAL element", async () => {
    const page = await mountCorpus(MULTI);
    const probe = withV13(page.views[0]);
    probe.internal.forEach((d, i) => {
      const p = probe.projected[i];
      assert.isString(p.path);
      // `===`, not an equality of tag: a walk that lost the
      // ordinal still resolves to SOMETHING of the right tag.
      assert.strictEqual(
        resolve(document, <string>p.path),
        d.element,
      );
      assert.strictEqual(resolve(document, <string>p.unit), d.unit);
    });
    probe.restore();
  });

  test("★★★ control 2 — three siblings, three paths", () => {
    // Negative control: a walk that forgot the ordinal gives three
    // IDENTICAL paths that all resolve to the first, and every
    // "it resolves" assertion above still passes. The corpus has
    // same-tag pairs; three is the smallest count at which an
    // off-by-one in the ordinal is also visible.
    const root = detached(`
        <hdml-view aria-label="three">
          <hdml-cartesian-plane>
            <hdml-continuous-scale channel="x" min="0" max="1">
              <hdml-continuous-scale channel="y" min="0" max="1">
                <hdml-axis channel="x"></hdml-axis>
                <hdml-axis channel="y"></hdml-axis>
                <hdml-label channel="x"></hdml-label>
                <div class="wrapper">
                  <hdml-label channel="y"></hdml-label>
                </div>
              </hdml-continuous-scale>
            </hdml-continuous-scale>
          </hdml-cartesian-plane>
        </hdml-view>
    `);
    const scale = <Element>(
      root.querySelector('hdml-continuous-scale[channel="y"]')
    );
    const three = Array.from(scale.querySelectorAll("hdml-axis"));
    // A third sibling, appended, so the set is three.
    const extra = document.createElement("hdml-axis");
    extra.setAttribute("channel", "x");
    scale.appendChild(extra);
    three.push(extra);
    assert.lengthOf(three, 3);

    const paths = three.map((el) => pathOf(el));
    assert.lengthOf(new Set(paths), 3, "three distinct paths");
    paths.forEach((p, i) => {
      assert.isString(p);
      assert.strictEqual(resolve(root, <string>p), three[i]);
    });
    // The ordinals are 0-based and consecutive, and every segment
    // carries one — an only child of its tag is `[0]`, not bare.
    assert.deepEqual(
      paths.map((p) => (<string>p).split("/").pop()),
      ["hdml-axis[0]", "hdml-axis[1]", "hdml-axis[2]"],
    );
  });

  test("★★ the walk ignores HTML and starts at the view", () => {
    const root = detached(`
      <section><hdml-view aria-label="wrapped">
        <hdml-cartesian-plane>
          <hdml-continuous-scale channel="x" min="0" max="1">
            <hdml-continuous-scale channel="y" min="0" max="1">
              <div class="a">
                <hdml-label channel="x"></hdml-label>
              </div>
              <div class="b">
                <hdml-label channel="y"></hdml-label>
              </div>
            </hdml-continuous-scale>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view></section>
    `);
    const labels = Array.from(root.querySelectorAll("hdml-label"));
    assert.lengthOf(labels, 2);
    // ★ The two labels sit in DIFFERENT wrapper <div>s and are
    // still siblings [0] and [1]: the walk climbs through any
    // intervening element, exactly as the parser's
    // `getHdmlParentTag` does. A path that counted the HTML would
    // make BOTH `hdml-label[0]`.
    assert.deepEqual(
      labels.map((el) => pathOf(el)?.split("/").pop()),
      ["hdml-label[0]", "hdml-label[1]"],
    );
    // ★ No `html[0]/body[0]/div[0]/section[0]` prefix: the walk
    // stops at the outermost vocabulary element and includes it.
    for (const el of labels) {
      assert.match(
        <string>pathOf(el),
        /^hdml-view\[\d+\]\/hdml-cartesian-plane\[0\]\//,
      );
    }
  });

  test("★ a non-vocabulary or detached element has no path", () => {
    const root = detached(`<span class="x"></span>`);
    const span = <Element>root.querySelector("span");
    assert.isNull(pathOf(span), "a <span> is not an address");
    const orphan = document.createElement("hdml-axis");
    assert.isNull(pathOf(orphan), "unlinked, so unaddressable");
    // A misspelled tag is not vocabulary: membership, not prefix.
    const typo = document.createElement("hdml-labl");
    root.appendChild(typo);
    assert.isNull(pathOf(typo));
  });
});

/* ---------------------------------------------------------------- */
/* 3. The namespace                                                 */
/* ---------------------------------------------------------------- */

suite("HDML.diagnostics() — the namespace is additive", () => {
  test("★★ it sits beside supports, which still works", () => {
    const keys = Object.keys(ns());
    assert.includeMembers(keys, ["supports", "diagnostics"]);
    assert.isTrue(ns().supports("hdml-stack"));
    assert.isTrue(ns().supports("hdml-stack", "offset"));
    assert.isFalse(ns().supports("hdml-model"));
    assert.isFunction(ns().diagnostics);
  });

  test("★★ control 3 — a foreign member survives", async () => {
    // ⚠ The naive form of this control tests NOTHING: the module
    // registers at import time, so a member seeded now was seeded
    // after the only call. The control therefore seeds a foreign
    // member and RE-INVOKES `registerNamespace`, which is the
    // claim — a second build importing the module must install
    // beside what it finds, not replace the object.
    const scope = <{ HDML?: Record<string, unknown> }>(
      (<unknown>globalThis)
    );
    const before = scope.HDML;
    const sentinel = { owner: "a host app" };
    (<Record<string, unknown>>scope.HDML).hostOwned = sentinel;
    const { registerNamespace } = await import("../supports");
    registerNamespace();
    assert.strictEqual(
      scope.HDML,
      before,
      "the object itself is never replaced",
    );
    assert.strictEqual(
      (<Record<string, unknown>>scope.HDML).hostOwned,
      sentinel,
    );
    assert.isFunction(ns().supports);
    assert.isFunction(ns().diagnostics);
    // Idempotent: calling it twice changes nothing.
    registerNamespace();
    assert.strictEqual(scope.HDML, before);
    assert.strictEqual(
      (<Record<string, unknown>>scope.HDML).hostOwned,
      sentinel,
    );
    delete (<Record<string, unknown>>scope.HDML).hostOwned;
  });
});

/* ---------------------------------------------------------------- */
/* 4. Composition, and the clean corpus                             */
/* ---------------------------------------------------------------- */

suite("HDML.diagnostics() — composition and the clean pass", () => {
  test("★★ control 4 — no-arg is the concatenation", async () => {
    // ⚠ On a one-view page a flat concatenation that happens to
    // look sorted passes, so the claim is made on a MULTI-view
    // page and the per-view sets are non-empty.
    const page = await mountCorpus(MULTI);
    assert.lengthOf(page.views, 2);
    const probes = page.views.map((v) => withV13(v));
    const perView = page.views.flatMap((v) => [
      ...ns().diagnostics(v),
    ]);
    assert.lengthOf(perView, 2, "one finding per view");
    assert.deepEqual([...ns().diagnostics()], perView);
    // Document order, and distinguishable — the `hdml-view`
    // segment is what makes the two halves different strings.
    const paths = perView.map((d) => d.path);
    assert.lengthOf(new Set(paths), 2);
    probes.forEach((p) => p.restore());
  });

  test("★ a page with no view answers [], and does not throw", () => {
    const root = detached(`<p>no charts here</p>`);
    assert.deepEqual(
      [...ns().diagnostics(<Element>root.querySelector("p"))],
      [],
      "a non-view element is [], never a throw",
    );
    assert.doesNotThrow(() => ns().diagnostics(root));
  });

  test("★★ every corpus view is [], as a result", async () => {
    for (const [name, count] of PAGES) {
      const page = await mountCorpus(name);
      assert.lengthOf(page.views, count, name);
      for (const view of page.views) {
        assert.deepEqual(
          [...ns().diagnostics(view)],
          [],
          `${name} is clean`,
        );
        // ★ The silence is a RESULT, not a vacuum: mutate, assert
        // non-empty, restore, assert empty again — the recovery
        // shape `corpus/validator.test.ts` uses.
        const probe = withV13(view);
        assert.isNotEmpty(probe.projected, `${name} goes red`);
        probe.restore();
        assert.deepEqual(
          [...ns().diagnostics(view)],
          [],
          `${name} recovers`,
        );
      }
    }
  });

  test("★ a view whose memo was dropped answers []", async () => {
    // Inherited from `diagnosticsOf`, documented, and pinned here
    // because it is also the exact shape of a false negative:
    // `forgetView` runs in `disconnectedCallback`.
    const page = await mountCorpus(MULTI);
    const view = page.views[0];
    const probe = withV13(view);
    assert.isNotEmpty(ns().diagnostics(view));
    view.remove();
    assert.deepEqual(
      [...ns().diagnostics(view)],
      [],
      "a disconnected view reports nothing, not its last fault",
    );
    probe.stray.remove();
  });
});
