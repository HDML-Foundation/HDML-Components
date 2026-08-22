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
import { FakeIo, mountFakeIo } from "../testing/FakeIo";
import type { FakeColumn, FakeResult } from "../testing/FakeIo";
import type { Channel } from "./resolve";
import type { Scale } from "./scale";
import { HdmlViewElement } from "./view";
import { chainScaleOf } from "./scale";
import { splitColorList } from "./kernel/color";
import { subscriptionsOf } from "./subscribe";
import { diagnosticsOf } from "./validate";

/**
 * Contract 2, whole (§2.4, §4.2, §4.3, §5.5, §5.11, H1).
 *
 * Slice C's fixture is a **recording** probe, not a painting one:
 * view → plane → scale chain → `<hdvl-probe>`, whose job is to
 * record the `FrameContext` it was handed so a test can ask the
 * chain for the very `Scale` objects the frame resolved with.
 *
 * Every plane carries `padding: 0` so the scale's content box is
 * the view's, and every dimension is chosen so the expected number
 * is exactly representable — `W = 76, n = 4, b = 0.8` gives
 * `step = 20` (the plan's rule-1 amendment).
 */

/** A numeric column, domain-only: `raw:false` needs no values. */
function extentCol(lo: number, hi: number): FakeColumn {
  return {
    values: undefined,
    nulls: undefined,
    domain: { kind: "extent", value: [lo, hi] },
    type: { kind: "number" },
  };
}

/** A timestamp column, epoch-ms. */
function stampCol(lo: number, hi: number): FakeColumn {
  return {
    values: undefined,
    nulls: undefined,
    domain: { kind: "extent", value: [lo, hi] },
    type: { kind: "timestamp", unit: "ms" },
  };
}

/** A ms-since-midnight column — what V2 makes a datetime refuse. */
function timeCol(): FakeColumn {
  return {
    values: undefined,
    nulls: undefined,
    domain: { kind: "extent", value: [0, 1000] },
    type: { kind: "time", unit: "ms" },
  };
}

/** A string column: an insertion-ordered distinct list. */
function ordinalCol(values: string[]): FakeColumn {
  return {
    values: undefined,
    nulls: undefined,
    domain: { kind: "ordinal", value: values },
    type: { kind: "string" },
  };
}

function result(
  columns: Record<string, FakeColumn>,
  rows = 4,
): FakeResult {
  return { generation: 1, rows, columns };
}

function tick(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

async function settle(root: Element): Promise<void> {
  const all = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const el of all) {
    if (el instanceof LitElement) {
      await el.updateComplete;
    }
  }
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

/** The probe in a view, and the `Scale` its chain resolved. */
function probeOf(view: HdmlViewElement): HdvlProbeElement {
  return <HdvlProbeElement>view.querySelector(PROBE_TAG);
}

function scaleFor(
  view: HdmlViewElement,
  channel: Channel,
): Scale | null {
  const probe = probeOf(view);
  const call = probe.last;
  return call === null
    ? null
    : chainScaleOf(call.ctx, probe, channel);
}

/** A `Scale` that must exist, for the many tests that assume one. */
function must(view: HdmlViewElement, channel: Channel): Scale {
  const scale = scaleFor(view, channel);
  assert.isNotNull(scale, `no ${channel} scale resolved`);
  return scale;
}

const SOURCE = "?hdml-frame=nums";

suite("hdvl/scale — Contract 2 is whole", () => {
  // §2.4's members, enumerated. The mechanical half of H1.
  //
  // There are NINE of them, not the eleven the step-18 prompt says
  // in five places: two `readonly` fields and seven methods, and
  // the RFC's own code block is the count. Asserted here so the
  // number is a test rather than a memory.
  const MEMBERS = [
    "kind",
    "channel",
    "domain",
    "range",
    "project",
    "bandOf",
    "paint",
    "ticks",
    "format",
  ];

  async function ofKind(tag: string): Promise<HdmlViewElement> {
    const markup =
      tag === "ordinal"
        ? html`
            <hdml-view
              aria-label="ordinal"
              style="width: 400px; height: 76px"
            >
              <hdml-cartesian-plane style="padding: 0">
                <hdml-ordinal-scale
                  channel="y"
                  values='["a", "b", "c", "d"]'
                >
                  <hdvl-probe></hdvl-probe>
                </hdml-ordinal-scale>
              </hdml-cartesian-plane>
            </hdml-view>
          `
        : tag === "datetime"
        ? html`
            <hdml-view
              aria-label="datetime"
              style="width: 400px; height: 76px"
            >
              <hdml-cartesian-plane style="padding: 0">
                <hdml-datetime-scale
                  channel="x"
                  min="2025-01-01"
                  max="2025-01-03"
                >
                  <hdvl-probe></hdvl-probe>
                </hdml-datetime-scale>
              </hdml-cartesian-plane>
            </hdml-view>
          `
        : html`
            <hdml-view
              aria-label="continuous"
              style="width: 400px; height: 76px"
            >
              <hdml-cartesian-plane style="padding: 0">
                <hdml-continuous-scale channel="x" min="0" max="100">
                  <hdvl-probe></hdvl-probe>
                </hdml-continuous-scale>
              </hdml-cartesian-plane>
            </hdml-view>
          `;
    return mount(markup);
  }

  test("every member answers on all three kinds", async () => {
    for (const kind of ["continuous", "datetime", "ordinal"]) {
      const view = await ofKind(kind);
      const scale = must(view, kind === "ordinal" ? "y" : "x");
      for (const name of MEMBERS) {
        assert.isDefined(
          (<Record<string, unknown>>(<unknown>scale))[name],
          `${kind}.${name}`,
        );
      }
      assert.strictEqual(scale.kind, kind);
    }
    assert.strictEqual(MEMBERS.length, 9);
  });

  test("x runs left to right over the content box", async () => {
    const view = await ofKind("continuous");
    assert.deepEqual(must(view, "x").range(), [0, 400]);
  });

  test("y runs bottom to top, so descending", async () => {
    const view = await ofKind("ordinal");
    assert.deepEqual(must(view, "y").range(), [76, 0]);
  });

  test("a continuous domain projects linearly", async () => {
    const view = await ofKind("continuous");
    const scale = must(view, "x");
    assert.strictEqual(scale.project(0), 0);
    assert.strictEqual(scale.project(50), 200);
    assert.strictEqual(scale.project(100), 400);
  });

  test("ticks({count: 5}) works here, not at step 24", async () => {
    const view = await ofKind("continuous");
    const ticks = must(view, "x").ticks({ count: 5 });
    assert.deepEqual(
      ticks.map((t) => t.value),
      [0, 20, 40, 60, 80, 100],
    );
    // `at` is in the channel's range unit — CSS px here.
    assert.deepEqual(
      ticks.map((t) => t.at),
      [0, 80, 160, 240, 320, 400],
    );
  });

  test("a datetime ticks through the calendar ladder", async () => {
    const view = await ofKind("datetime");
    const ticks = must(view, "x").ticks({ count: 2 });
    assert.isAbove(ticks.length, 1);
    for (const t of ticks) {
      assert.isNumber(t.value);
      assert.isAtLeast(t.at, 0);
      assert.isAtMost(t.at, 400);
    }
  });

  test("an ordinal ticks by thinning its domain", async () => {
    const view = await ofKind("ordinal");
    const ticks = must(view, "y").ticks({ count: 2 });
    assert.deepEqual(
      ticks.map((t) => t.value),
      ["a", "c"],
    );
  });

  test("bandOf start is the low edge on a descending y", async () => {
    const view = await ofKind("ordinal");
    const scale = must(view, "y");
    // W = 76, n = 4, b = 0.8 → step = 20 exactly.
    assert.deepEqual(scale.bandOf("a"), {
      start: 60,
      width: 16,
      centre: 68,
    });
    assert.deepEqual(scale.bandOf("d"), {
      start: 0,
      width: 16,
      centre: 8,
    });
    for (const v of ["a", "b", "c", "d"]) {
      const band = scale.bandOf(v);
      assert.isNotNull(band);
      assert.isAtLeast((<{ width: number }>band).width, 0);
    }
  });

  test("bandOf is null on a non-ordinal scale", async () => {
    const view = await ofKind("continuous");
    assert.isNull(must(view, "x").bandOf("a"));
    const dates = await ofKind("datetime");
    assert.isNull(must(dates, "x").bandOf("a"));
  });

  test("an ordinal projects to the band centre", async () => {
    const view = await ofKind("ordinal");
    assert.strictEqual(must(view, "y").project("a"), 68);
  });

  test("a value outside an ordinal domain is null", async () => {
    const view = await ofKind("ordinal");
    // §2.4's own contract, and §4.7's "produces no mark".
    assert.isNull(must(view, "y").project("zzz"));
  });

  test("format renders an ordinal string verbatim", async () => {
    const view = await ofKind("ordinal");
    assert.strictEqual(must(view, "y").format("a"), "a");
  });

  test("format runs a number through the skeleton", async () => {
    const view = await ofKind("continuous");
    const scale = must(view, "x");
    // Structural: the skeleton changes the answer, and both are
    // read from the same Intl the kernel used.
    assert.notStrictEqual(
      scale.format(0.5, "percent"),
      scale.format(0.5),
    );
  });
});

suite("hdvl/scale — paint and the color channel", () => {
  const PALETTE = "#1c8cf4 #f59e0b #10b981";

  async function ordinalColor(): Promise<HdmlViewElement> {
    return mount(html`
      <hdml-view
        aria-label="palette"
        style="width: 400px; height: 76px; --hdml-palette: ${PALETTE}"
      >
        <hdml-cartesian-plane style="padding: 0">
          <hdml-ordinal-scale
            channel="color"
            values='["north", "south", "east"]'
          >
            <hdvl-probe></hdvl-probe>
          </hdml-ordinal-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
  }

  async function rampView(stops: string): Promise<HdmlViewElement> {
    return mount(html`
      <hdml-view
        aria-label="ramp"
        style="width: 400px; height: 76px;
               --hdml-color-interpolate: ${stops}"
      >
        <hdml-cartesian-plane style="padding: 0">
          <hdml-continuous-scale channel="color" min="0" max="10">
            <hdvl-probe></hdvl-probe>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
  }

  // Plan rule 6: a `getComputedStyle` fixture runs on all three
  // engines, mandatory — this is exactly where they differ.
  test("an ordinal color paints the computed palette", async () => {
    const view = await ordinalColor();
    const scale = must(view, "color");
    const el = <HTMLElement>view.querySelector("hdml-ordinal-scale");
    const computed = splitColorList(
      getComputedStyle(el).getPropertyValue("--hdml-palette"),
    );
    assert.strictEqual(computed.length, 3);
    assert.strictEqual(scale.paint("north"), computed[0]);
    assert.strictEqual(scale.paint("south"), computed[1]);
    assert.strictEqual(scale.paint("east"), computed[2]);
  });

  test("each domain value paints a distinct colour", async () => {
    const view = await ordinalColor();
    const scale = must(view, "color");
    const seen = new Set(
      ["north", "south", "east"].map((v) => scale.paint(v)),
    );
    assert.strictEqual(seen.size, 3);
    assert.notInclude([...seen], null);
  });

  test("a continuous color interpolates end to end", async () => {
    const view = await rampView("#000000 #ffffff");
    const scale = must(view, "color");
    const el = <HTMLElement>(
      view.querySelector("hdml-continuous-scale")
    );
    const stops = splitColorList(
      getComputedStyle(el).getPropertyValue(
        "--hdml-color-interpolate",
      ),
    );
    assert.strictEqual(scale.paint(0), stops[0]);
    assert.strictEqual(scale.paint(10), stops[1]);
    const mid = scale.paint(5);
    assert.notStrictEqual(mid, stops[0]);
    assert.notStrictEqual(mid, stops[1]);
    assert.include(<string>mid, "color-mix(");
  });

  test("a single stop paints the whole range", async () => {
    const view = await rampView("#123456");
    const scale = must(view, "color");
    const one = scale.paint(0);
    assert.strictEqual(scale.paint(5), one);
    assert.strictEqual(scale.paint(10), one);
  });

  test("color has no range, and that is the contract", async () => {
    const view = await ordinalColor();
    assert.isNull(must(view, "color").range());
    assert.isNull(must(view, "color").project("north"));
  });

  test("paint is null on a non-color channel", async () => {
    const view = await mount(html`
      <hdml-view
        aria-label="not color"
        style="width: 400px; height: 76px"
      >
        <hdml-cartesian-plane style="padding: 0">
          <hdml-continuous-scale channel="x" min="0" max="10">
            <hdvl-probe></hdvl-probe>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
    assert.isNull(must(view, "x").paint(5));
  });
});

suite("hdvl/scale — §4.2 domain resolution", () => {
  let io: FakeIo;

  function view(
    inner: ReturnType<typeof html>,
  ): Promise<HdmlViewElement> {
    return mount(html`
      <hdml-view
        aria-label="domain"
        source="${SOURCE}"
        style="width: 400px; height: 76px"
      >
        <hdml-cartesian-plane style="padding: 0">
          ${inner}
        </hdml-cartesian-plane>
      </hdml-view>
    `);
  }

  setup(() => {
    io = mountFakeIo({
      [SOURCE]: result({
        rev: extentCol(90, 110),
        small: extentCol(20, 87),
        cats: ordinalCol(["c", "a", "b"]),
        empty_num: extentCol(NaN, NaN),
        empty_cat: ordinalCol([]),
        stamp: stampCol(Date.UTC(2025, 0, 1), Date.UTC(2025, 0, 3)),
        clock: timeCol(),
      }),
    });
  });

  test("a literal values array is used verbatim", async () => {
    const v = await view(html`
      <hdml-ordinal-scale channel="y" values='["x", "y"]'>
        <hdvl-probe></hdvl-probe>
      </hdml-ordinal-scale>
    `);
    assert.deepEqual(must(v, "y").domain(), {
      kind: "ordinal",
      values: ["x", "y"],
    });
    // ...and opens NO subscription, which is what keeps a
    // literal-only page out of `:state(loading)` forever.
    assert.strictEqual(subscriptionsOf(v).length, 0);
    assert.strictEqual(io.subscriptions.length, 0);
  });

  test("a column values opens a raw:false subscription", async () => {
    const v = await view(html`
      <hdml-continuous-scale channel="y" values="small">
        <hdvl-probe></hdvl-probe>
      </hdml-continuous-scale>
    `);
    const subs = subscriptionsOf(v);
    assert.strictEqual(subs.length, 1);
    assert.strictEqual(subs[0].slot, "values");
    assert.strictEqual(subs[0].column, "small");
    assert.isFalse(subs[0].raw);
    assert.deepEqual(must(v, "y").domain(), {
      kind: "extent",
      extent: [20, 87],
    });
  });

  test("no values derives no endpoint", async () => {
    const v = await view(html`
      <hdml-continuous-scale channel="y" min="1" max="9">
        <hdvl-probe></hdvl-probe>
      </hdml-continuous-scale>
    `);
    assert.strictEqual(subscriptionsOf(v).length, 0);
    assert.deepEqual(must(v, "y").domain(), {
      kind: "extent",
      extent: [1, 9],
    });
  });

  test("min and max override their endpoint, per one", async () => {
    const v = await view(html`
      <hdml-continuous-scale channel="y" min="0" values="small">
        <hdvl-probe></hdvl-probe>
      </hdml-continuous-scale>
    `);
    assert.deepEqual(must(v, "y").domain(), {
      kind: "extent",
      extent: [0, 87],
    });
  });

  // ★ Step 3. A legal source that returned NOTHING.
  test("a zero-row column is empty, never a diagnostic", async () => {
    const v = await view(html`
      <hdml-continuous-scale channel="y" values="empty_num">
        <hdvl-probe></hdvl-probe>
      </hdml-continuous-scale>
    `);
    assert.isNull(must(v, "y").domain());
    assert.deepEqual([...diagnosticsOf(v)], []);
    assert.isFalse(v.matches(":state(loading)"));
    assert.isTrue(v.matches(":state(empty)"));
  });

  test("a zero-row ordinal column is empty too", async () => {
    const v = await view(html`
      <hdml-ordinal-scale channel="y" values="empty_cat">
        <hdvl-probe></hdvl-probe>
      </hdml-ordinal-scale>
    `);
    assert.isNull(must(v, "y").domain());
    assert.deepEqual([...diagnosticsOf(v)], []);
  });

  test("zero extends a derived endpoint", async () => {
    const v = await view(html`
      <hdml-continuous-scale channel="y" values="small" zero>
        <hdvl-probe></hdvl-probe>
      </hdml-continuous-scale>
    `);
    assert.deepEqual(must(v, "y").domain()?.extent, [0, 87]);
  });

  test("zero leaves an authored endpoint alone", async () => {
    const v = await view(html`
      <hdml-continuous-scale channel="y" min="20" values="small" zero>
        <hdvl-probe></hdvl-probe>
      </hdml-continuous-scale>
    `);
    assert.deepEqual(must(v, "y").domain()?.extent, [20, 87]);
  });

  // ★ The two orders give different answers on this domain:
  // domain → zero → nice is [0, 120]; nice → zero would be
  // [0, 110], because niceing [90, 110] picks a step of 2 while
  // niceing [0, 110] picks 20.
  test("zero runs before nice, never the reverse", async () => {
    const v = await view(html`
      <hdml-continuous-scale channel="y" values="rev" zero nice>
        <hdvl-probe></hdvl-probe>
      </hdml-continuous-scale>
    `);
    assert.deepEqual(must(v, "y").domain()?.extent, [0, 120]);
  });

  test("nice alone leaves that domain where it was", async () => {
    const v = await view(html`
      <hdml-continuous-scale channel="y" values="rev" nice>
        <hdvl-probe></hdvl-probe>
      </hdml-continuous-scale>
    `);
    assert.deepEqual(must(v, "y").domain()?.extent, [90, 110]);
  });

  // V15, asserted as a BEHAVIOUR — SPEC calls it a no-op, not an
  // error, so there is no message and no 22nd DiagnosticCode.
  test("nice on an authored domain is a no-op", async () => {
    const v = await view(html`
      <hdml-continuous-scale channel="y" min="3" max="47" nice>
        <hdvl-probe></hdvl-probe>
      </hdml-continuous-scale>
    `);
    assert.deepEqual(must(v, "y").domain()?.extent, [3, 47]);
    assert.deepEqual([...diagnosticsOf(v)], []);
  });

  test("bare nice is a target count of 10", async () => {
    const v = await view(html`
      <hdml-continuous-scale channel="y" values="small" nice>
        <hdvl-probe></hdvl-probe>
      </hdml-continuous-scale>
    `);
    // tickStep(20, 87, 10) → step 10 → [20, 90].
    assert.deepEqual(must(v, "y").domain()?.extent, [20, 90]);
  });

  // ★ The assertion that proves resolution never read a pixel.
  test("nice is layout-independent across a resize", async () => {
    const v = await view(html`
      <hdml-continuous-scale channel="y" values="rev" zero nice>
        <hdvl-probe></hdvl-probe>
      </hdml-continuous-scale>
    `);
    const before = must(v, "y").domain();
    const wasRange = must(v, "y").range();
    v.style.height = "150px";
    v.markDirty();
    await quiesce(v);
    assert.deepEqual(must(v, "y").domain(), before);
    assert.notDeepEqual(must(v, "y").range(), wasRange);
  });

  test("reverse flips the range and not the domain", async () => {
    const plain = await view(html`
      <hdml-continuous-scale channel="y" min="0" max="10">
        <hdvl-probe></hdvl-probe>
      </hdml-continuous-scale>
    `);
    const flipped = await view(html`
      <hdml-continuous-scale channel="y" min="0" max="10" reverse>
        <hdvl-probe></hdvl-probe>
      </hdml-continuous-scale>
    `);
    assert.deepEqual(must(plain, "y").range(), [76, 0]);
    assert.deepEqual(must(flipped, "y").range(), [0, 76]);
    assert.deepEqual(
      must(flipped, "y").domain(),
      must(plain, "y").domain(),
    );
    assert.strictEqual(must(plain, "y").project(0), 76);
    assert.strictEqual(must(flipped, "y").project(0), 0);
  });

  test("sort keeps first-occurrence order by default", async () => {
    const v = await view(html`
      <hdml-ordinal-scale channel="y" values="cats">
        <hdvl-probe></hdvl-probe>
      </hdml-ordinal-scale>
    `);
    assert.deepEqual(must(v, "y").domain()?.values, ["c", "a", "b"]);
  });

  test("sort orders by code point in both directions", async () => {
    const up = await view(html`
      <hdml-ordinal-scale channel="y" values="cats" sort="ascending">
        <hdvl-probe></hdvl-probe>
      </hdml-ordinal-scale>
    `);
    const down = await view(html`
      <hdml-ordinal-scale channel="y" values="cats" sort="descending">
        <hdvl-probe></hdvl-probe>
      </hdml-ordinal-scale>
    `);
    assert.deepEqual(must(up, "y").domain()?.values, ["a", "b", "c"]);
    assert.deepEqual(must(down, "y").domain()?.values, [
      "c",
      "b",
      "a",
    ]);
  });

  test("a literal ISO min parses, zone-less as UTC", async () => {
    const v = await view(html`
      <hdml-datetime-scale
        channel="x"
        min="2025-01-01"
        max="2025-01-01T06:00"
      >
        <hdvl-probe></hdvl-probe>
      </hdml-datetime-scale>
    `);
    assert.deepEqual(must(v, "x").domain()?.extent, [
      Date.UTC(2025, 0, 1),
      Date.UTC(2025, 0, 1, 6),
    ]);
  });

  test("a zone moves the boundaries ticks returns", async () => {
    const utc = await view(html`
      <hdml-datetime-scale channel="x" values="stamp">
        <hdvl-probe></hdvl-probe>
      </hdml-datetime-scale>
    `);
    const ny = await view(html`
      <hdml-datetime-scale
        channel="x"
        values="stamp"
        zone="America/New_York"
      >
        <hdvl-probe></hdvl-probe>
      </hdml-datetime-scale>
    `);
    const a = must(utc, "x")
      .ticks({ count: 2 })
      .map((t) => t.value);
    const b = must(ny, "x")
      .ticks({ count: 2 })
      .map((t) => t.value);
    assert.notDeepEqual(a, b);
    assert.include(a, Date.UTC(2025, 0, 2));
    assert.include(b, Date.UTC(2025, 0, 2, 5));
  });

  test("an unknown zone falls back, never throws", async () => {
    const v = await view(html`
      <hdml-datetime-scale
        channel="x"
        values="stamp"
        zone="Mars/Olympus"
      >
        <hdvl-probe></hdvl-probe>
      </hdml-datetime-scale>
    `);
    assert.isNotNull(must(v, "x").domain());
    assert.include(
      must(v, "x")
        .ticks({ count: 2 })
        .map((t) => t.value),
      Date.UTC(2025, 0, 2),
    );
  });

  test("a column chain loads, then leaves loading", async () => {
    const v = await view(html`
      <hdml-continuous-scale channel="y" values="small">
        <hdvl-probe></hdvl-probe>
      </hdml-continuous-scale>
    `);
    assert.isFalse(v.matches(":state(loading)"));
    io.feed(SOURCE, result({ small: extentCol(1, 2) }));
    await quiesce(v);
    assert.deepEqual(must(v, "y").domain()?.extent, [1, 2]);
  });
});

suite("hdvl/scale — the two events", () => {
  let io: FakeIo;
  let data: CustomEvent<Record<string, unknown>>[] = [];
  let changes: CustomEvent<Record<string, unknown>>[] = [];

  const onData = (e: Event): void => {
    data.push(<CustomEvent<Record<string, unknown>>>e);
  };
  const onChange = (e: Event): void => {
    changes.push(<CustomEvent<Record<string, unknown>>>e);
  };

  setup(() => {
    data = [];
    changes = [];
    document.addEventListener("hdml-data", onData);
    document.addEventListener("hdml-scale-change", onChange);
    io = mountFakeIo({
      [SOURCE]: result({ small: extentCol(20, 87) }),
    });
  });

  teardown(() => {
    document.removeEventListener("hdml-data", onData);
    document.removeEventListener("hdml-scale-change", onChange);
  });

  function bound(): Promise<HdmlViewElement> {
    return mount(html`
      <hdml-view
        aria-label="events"
        source="${SOURCE}"
        style="width: 400px; height: 76px"
      >
        <hdml-cartesian-plane style="padding: 0">
          <hdml-continuous-scale channel="y" values="small" zero nice>
            <hdvl-probe></hdvl-probe>
          </hdml-continuous-scale>
        </hdml-cartesian-plane>
      </hdml-view>
    `);
  }

  // ★ H14. The key did not move; the VALUE did.
  test("hdml-data carries the resolved domain", async () => {
    const v = await bound();
    const last = data[data.length - 1];
    assert.isDefined(last);
    const domains = <Record<string, unknown>>last.detail.domains;
    assert.property(domains, "values");
    // The DELIVERED domain was [20, 87]; zero + nice widened it.
    assert.deepEqual(domains.values, {
      kind: "extent",
      extent: [0, 90],
    });
    assert.deepEqual(must(v, "y").domain(), domains.values);
  });

  test("scale-change carries channel, domain, range", async () => {
    const v = await bound();
    const last = changes[changes.length - 1];
    assert.isDefined(last);
    assert.strictEqual(last.detail.channel, "y");
    assert.deepEqual(last.detail.domain, must(v, "y").domain());
    assert.deepEqual(last.detail.range, must(v, "y").range());
  });

  test("neither event re-fires when nothing changed", async () => {
    const v = await bound();
    const before = changes.length;
    const beforeData = data.length;
    v.markDirty();
    await quiesce(v);
    assert.strictEqual(changes.length, before);
    assert.strictEqual(data.length, beforeData);
  });

  // ★ The two edges differ, and this is the test that says so.
  test("a resize re-fires the scale but not the data", async () => {
    const v = await bound();
    const before = changes.length;
    const beforeData = data.length;
    v.style.height = "150px";
    v.markDirty();
    await quiesce(v);
    assert.isAbove(changes.length, before);
    assert.strictEqual(data.length, beforeData);
  });

  test("a new delivery re-fires the scale change", async () => {
    const v = await bound();
    const before = changes.length;
    io.feed(SOURCE, result({ small: extentCol(0, 5) }));
    await quiesce(v);
    assert.isAbove(changes.length, before);
    assert.deepEqual(must(v, "y").domain()?.extent, [0, 5]);
  });

  test("a modifier change re-fires the scale change", async () => {
    const v = await bound();
    const el = <HTMLElement>v.querySelector("hdml-continuous-scale");
    const before = changes.length;
    el.removeAttribute("nice");
    await quiesce(v);
    assert.isAbove(changes.length, before);
    assert.deepEqual(must(v, "y").domain()?.extent, [0, 87]);
  });
});
