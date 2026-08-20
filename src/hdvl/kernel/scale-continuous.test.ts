/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { assert } from "@open-wc/testing";
import {
  ContinuousSpec,
  continuousSpec,
  project,
  transform,
  untransform,
} from "./scale-continuous";

/**
 * RFC §4.1 and §4.5 — the continuous transforms and `project`.
 *
 * A pure fixture table: no DOM, no computed style, no element, no
 * `fixture` import and no `await`. That is the module's own
 * invariant, and the grep
 * `grep -rn "document\.\|window\." src/hdvl/kernel/` is what keeps
 * it true.
 *
 * **Which cross-engine rule applies where** (plan rules 1, 2, 9):
 *
 * - `linear` is **exact `deepEqual` / `strictEqual`**. Its
 *   transform is the identity and its projection is rational
 *   arithmetic over exactly-representable fixtures, so a
 *   `closeTo` would be hiding a real defect.
 * - Anything whose value went through `Math.log`, `Math.log1p`,
 *   `Math.pow`, `Math.exp` or `Math.expm1` is
 *   **`closeTo(…, 1e-9)`** — ECMAScript does not require
 *   correctly-rounded transcendentals and V8, SpiderMonkey and
 *   JavaScriptCore differ in the last ulp. That covers `log`,
 *   `pow` and `symlog` outright.
 * - A **sign** or a **`-0`** is asserted exactly even on a
 *   transcendental path: `Object.is` answers a question no
 *   tolerance can.
 */

const LINEAR = continuousSpec("linear");
const LOG10 = continuousSpec("log");
const CUBE = continuousSpec("pow", { exponent: 3 });
const CBRT = continuousSpec("pow", { exponent: 1 / 3 });
const SQRT = continuousSpec("sqrt");
const SYMLOG = continuousSpec("symlog");

/* -------------------------------------------------------------- */
/* The spec                                                       */
/* -------------------------------------------------------------- */

suite("hdvl/kernel/scale-continuous — continuousSpec", () => {
  test("resolves sqrt to pow with exponent 0.5", () => {
    // §4.1: "resolved at parse time so exactly one code path
    // exists". After this call there is no `sqrt` anywhere.
    assert.deepEqual(continuousSpec("sqrt"), {
      type: "pow",
      base: 10,
      exponent: 0.5,
      constant: 1,
    });
  });

  test("ignores an exponent passed alongside sqrt", () => {
    // §4.1 defines sqrt AS exponent 0.5, not as a default.
    assert.strictEqual(
      continuousSpec("sqrt", { exponent: 3 }).exponent,
      0.5,
    );
  });

  test("applies §4.5's defaults", () => {
    assert.deepEqual(continuousSpec("linear"), {
      type: "linear",
      base: 10,
      exponent: 1,
      constant: 1,
    });
    assert.strictEqual(continuousSpec("log").base, 10);
    assert.strictEqual(continuousSpec("pow").exponent, 1);
    assert.strictEqual(continuousSpec("symlog").constant, 1);
  });

  test("honours every override", () => {
    assert.deepEqual(
      continuousSpec("symlog", { base: 2, constant: 7 }),
      { type: "symlog", base: 2, exponent: 1, constant: 7 },
    );
  });
});

/* -------------------------------------------------------------- */
/* transform / untransform                                        */
/* -------------------------------------------------------------- */

suite("hdvl/kernel/scale-continuous — transform", () => {
  test("linear is the identity, exactly", () => {
    // Rule 1: nothing transcendental on the path.
    for (const v of [-8, -0.5, 0, 0.25, 3, 1e9]) {
      assert.strictEqual(transform(LINEAR, v), v);
    }
  });

  test("log divides by log(base)", () => {
    assert.closeTo(transform(LOG10, 1000), 3, 1e-9);
    assert.closeTo(transform(LOG10, 1), 0, 1e-9);
    const log2 = continuousSpec("log", { base: 2 });
    assert.closeTo(transform(log2, 64), 6, 1e-9);
  });

  test("pow is sign-preserving", () => {
    // The magnitude is rule 2; the SIGN is exact, and it is the
    // half of §4.5's `sign(v) · |v|^exponent` that a naive
    // `Math.pow(v, e)` gets wrong — `Math.pow(-8, 1/3)` is NaN.
    assert.closeTo(transform(CBRT, -8), -2, 1e-9);
    assert.isBelow(transform(CBRT, -8), 0);
    assert.closeTo(transform(CBRT, 8), 2, 1e-9);
    assert.closeTo(transform(SQRT, 9), 3, 1e-9);
    assert.isBelow(transform(SQRT, -9), 0);
  });

  test("symlog is odd, and defined at the origin", () => {
    // §4.5's `sign(v) · log1p(|v| / C)` is ONE formula over the
    // whole line — the "linear region" is a tick-ladder notion
    // (§4.8), not a second branch here. What is assertable of
    // the transform is that it is odd, finite at 0, and
    // approaches v / C as v does.
    // The expectations are hand-stated decimals — ln 2 and
    // ln 1.5 — not a second call to `log1p`, which would only
    // assert that the code equals itself.
    assert.closeTo(transform(SYMLOG, 1), 0.6931471805599453, 1e-9);
    assert.closeTo(transform(SYMLOG, 0.5), 0.4054651081081644, 1e-9);
    assert.closeTo(transform(SYMLOG, -1), -0.6931471805599453, 1e-9);
    assert.strictEqual(transform(SYMLOG, 0), 0);
    // C scales the input: at C = 10, v = 10 sits exactly where
    // v = 1 sits at C = 1.
    const c10 = continuousSpec("symlog", { constant: 10 });
    assert.closeTo(transform(c10, 10), 0.6931471805599453, 1e-9);
  });

  test("is monotonic across the sign change", () => {
    for (const spec of [LINEAR, CBRT, SYMLOG]) {
      const values = [-100, -10, -1, -0.1, 0, 0.1, 1, 10, 100];
      const ts = values.map((v) => transform(spec, v));
      for (let i = 1; i < ts.length; i++) {
        assert.isAbove(ts[i], ts[i - 1], `${spec.type} at ${i}`);
      }
    }
  });

  test("log of a non-positive value does not throw", () => {
    // The kernel is honest, not defensive: §4.5's V2 is checked
    // at step 18 from the resolved DOMAIN, and a kernel that
    // threw would leave the validator unable to evaluate the
    // very scale it has to diagnose.
    assert.strictEqual(transform(LOG10, 0), -Infinity);
    assert.isNaN(transform(LOG10, -5));
    assert.isNaN(transform(LOG10, -0.5));
  });

  test("emits +0, never -0", () => {
    // `Math.sign(-0)` is -0, and both `pow` and `symlog`
    // multiply by it. A signed zero is not `deepEqual` to zero
    // and serializes as "-0" (plan rule 9).
    assert.isTrue(Object.is(Math.sign(-0), -0));
    for (const spec of [LINEAR, CBRT, SQRT, SYMLOG]) {
      assert.isTrue(
        Object.is(transform(spec, -0), 0),
        `${spec.type} transform(-0)`,
      );
      assert.isTrue(
        Object.is(untransform(spec, -0), 0),
        `${spec.type} untransform(-0)`,
      );
    }
  });
});

suite("hdvl/kernel/scale-continuous — untransform", () => {
  const ROUND_TRIPS: [ContinuousSpec, number[]][] = [
    [LOG10, [1, 7, 1000, 0.001]],
    [CUBE, [-8, -1, 0, 2.5, 100]],
    [CBRT, [-27, -1, 0, 5, 64]],
    [SQRT, [0, 2, 9, 1e4]],
    [SYMLOG, [-42, -1, 0, 0.5, 900]],
  ];

  for (const [spec, values] of ROUND_TRIPS) {
    test(`${spec.type} e=${spec.exponent} round-trips`, () => {
      for (const v of values) {
        assert.closeTo(
          untransform(spec, transform(spec, v)),
          v,
          1e-9,
          `${spec.type} at ${v}`,
        );
      }
    });
  }

  test("linear round-trips exactly", () => {
    for (const v of [-8, -0.5, 0, 0.25, 3, 1e9]) {
      assert.strictEqual(
        untransform(LINEAR, transform(LINEAR, v)),
        v,
      );
    }
  });
});

/* -------------------------------------------------------------- */
/* project                                                        */
/* -------------------------------------------------------------- */

suite("hdvl/kernel/scale-continuous — project", () => {
  test("linear projection is exact", () => {
    // Rule 1: every fixture is exactly representable, so this
    // is rational arithmetic end to end.
    assert.strictEqual(project(LINEAR, [0, 10], [0, 100], 2.5), 25);
    assert.strictEqual(project(LINEAR, [0, 4], [0, 1], 3), 0.75);
    assert.strictEqual(project(LINEAR, [0, 10], [0, 100], 0), 0);
    assert.strictEqual(project(LINEAR, [0, 10], [0, 100], 10), 100);
    // A y range runs bottom → top (§4.3), which is an ordinary
    // descending range and needs no `reverse`.
    assert.strictEqual(project(LINEAR, [0, 10], [200, 0], 2.5), 150);
  });

  test("projects through a transform", () => {
    assert.closeTo(
      project(LOG10, [1, 1000], [0, 300], 10),
      100,
      1e-9,
    );
    assert.closeTo(project(SQRT, [0, 100], [0, 50], 25), 25, 1e-9);
  });

  test("reverse reverses the RANGE, not the domain", () => {
    // §4.2 step 6. Implemented as swapping r0 and r1, so the
    // domain endpoints keep their meaning and only the mapping
    // turns around.
    assert.strictEqual(
      project(LINEAR, [0, 10], [0, 100], 2.5, { reverse: true }),
      75,
    );
    assert.strictEqual(
      project(LINEAR, [0, 10], [0, 100], 0, { reverse: true }),
      100,
    );
  });

  test("clamp pins to the RANGE edge", () => {
    // Not the domain edge — the value is projected and then
    // held inside [min(r0, r1), max(r0, r1)].
    assert.strictEqual(
      project(LINEAR, [0, 10], [0, 100], 20, { clamp: true }),
      100,
    );
    assert.strictEqual(
      project(LINEAR, [0, 10], [0, 100], -5, { clamp: true }),
      0,
    );
    assert.strictEqual(
      project(LINEAR, [0, 10], [200, 0], 20, { clamp: true }),
      0,
    );
  });

  test("clamp respects reverse", () => {
    const opts = { clamp: true, reverse: true };
    assert.strictEqual(
      project(LINEAR, [0, 10], [0, 100], 20, opts),
      0,
    );
    assert.strictEqual(
      project(LINEAR, [0, 10], [0, 100], -5, opts),
      100,
    );
  });

  test("without clamp a value projects past the edge", () => {
    assert.strictEqual(project(LINEAR, [0, 10], [0, 100], 20), 200);
  });

  test("a degenerate domain maps everything to r0", () => {
    // Never NaN, never Infinity: a scale whose domain has not
    // spread yet must still place a mark somewhere.
    const specs: [ContinuousSpec, [number, number]][] = [
      [LINEAR, [5, 5]],
      [LOG10, [10, 10]],
      [LOG10, [0, 0]],
      [CBRT, [3, 3]],
      [SYMLOG, [2, 2]],
    ];
    for (const [spec, domain] of specs) {
      const at = project(spec, domain, [7, 90], 123);
      assert.strictEqual(at, 7, `${spec.type} ${domain.join()}`);
    }
  });

  test("a degenerate domain honours reverse", () => {
    assert.strictEqual(
      project(LINEAR, [5, 5], [7, 90], 123, { reverse: true }),
      90,
    );
  });

  test("emits +0, never -0", () => {
    // r0 = -0 would reach a scene through every degenerate
    // scale on the page.
    assert.isTrue(Object.is(project(LINEAR, [5, 5], [-0, 90], 1), 0));
    assert.isTrue(
      Object.is(project(LINEAR, [0, 10], [0, -100], 0), 0),
    );
  });

  test("a projection through a bad log domain does not throw", () => {
    // V2's job, at step 18, from the domain. Here it is simply
    // arithmetic that produced a non-finite answer.
    assert.isNaN(project(LOG10, [0, 100], [0, 300], 10));
    assert.isNaN(project(LOG10, [-10, 100], [0, 300], 10));
  });
});
