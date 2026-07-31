/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/* eslint-disable max-len */

import { assert } from "@open-wc/testing";
import {
  resolveQueryTarget,
  staticRefToDocPath,
  validateElementName,
} from "./artifact";
import type { RegistryEntry } from "./parse";

const withEntry = (
  key: string,
  entry: RegistryEntry,
): Map<string, RegistryEntry> => new Map([[key, entry]]);

suite("artifact — staticRefToDocPath (Go-derived C4 fixture)", () => {
  // Each vector is traced to the Go deriveSource/docArtifactPath and
  // uses the resolved `/`-prefixed output (the FE always keeps the
  // leading `/` — RFC §4.4 leading-slash decision).
  const vectors: Array<[string, string]> = [
    // filepath.Ext strips only the last extension → source = a.b.
    ["/x/a.b.html?hdml-frame=f", "/x/hdml-frame=f@a.b.hdml"],
    // Ext("maang") == "" → source = maang, dir = ".".
    ["/maang?hdml-frame=x", "/hdml-frame=x@maang.hdml"],
    // docPath == "." → no dir prefix; FE keeps the leading `/`.
    ["/full.html?hdml-model=m", "/hdml-model=m@full.hdml"],
    // filepath.Join(docPath, file) for a nested dir.
    ["/a/b/c.html?hdml-frame=f", "/a/b/hdml-frame=f@c.hdml"],
  ];
  for (const [ref, docPath] of vectors) {
    test(`${ref} → ${docPath}`, () => {
      assert.equal(staticRefToDocPath(ref), docPath);
    });
  }

  test("a &column= tail is ignored for the doc_path", () => {
    assert.equal(
      staticRefToDocPath("/x/a.b.html?hdml-frame=f&column=close"),
      "/x/hdml-frame=f@a.b.hdml",
    );
  });

  test("a model static ref is accepted, not rejected", () => {
    assert.equal(
      staticRefToDocPath("/a/full.html?hdml-model=m"),
      "/a/hdml-model=m@full.hdml",
    );
  });

  test("a bad element name throws locally", () => {
    assert.throws(() => staticRefToDocPath("/x.html?hdml-frame=a/b"));
    assert.throws(() =>
      staticRefToDocPath("/x.html?hdml-frame=../x"),
    );
  });

  test("a ref without a ? query throws", () => {
    assert.throws(() => staticRefToDocPath("/x/a.html"));
  });

  test("a connection kind throws (not queryable)", () => {
    assert.throws(() =>
      staticRefToDocPath("/x.html?hdml-connection=c"),
    );
  });
});

suite("artifact — resolveQueryTarget", () => {
  test("a local ref → dynamic:{key} when stored:true", () => {
    const reg = withEntry("hdml-frame=sales", {
      key: "hdml-frame=sales@abc123.hdml",
      stored: true,
    });
    assert.deepEqual(resolveQueryTarget("?hdml-frame=sales", reg), {
      docPath: "dynamic:hdml-frame=sales@abc123.hdml",
      stored: true,
    });
  });

  test("a local ref reports stored:false faithfully", () => {
    const reg = withEntry("hdml-frame=sales", {
      key: "hdml-frame=sales@abc123.hdml",
      stored: false,
    });
    assert.deepEqual(resolveQueryTarget("?hdml-frame=sales", reg), {
      docPath: "dynamic:hdml-frame=sales@abc123.hdml",
      stored: false,
    });
  });

  test("a local model ref is accepted, not rejected", () => {
    const reg = withEntry("hdml-model=m", {
      key: "hdml-model=m@abc.hdml",
      stored: true,
    });
    assert.deepEqual(resolveQueryTarget("?hdml-model=m", reg), {
      docPath: "dynamic:hdml-model=m@abc.hdml",
      stored: true,
    });
  });

  test("an unknown local ref throws (not-ready-yet, D4)", () => {
    assert.throws(() =>
      resolveQueryTarget("?hdml-frame=missing", new Map()),
    );
  });

  test("a &column= tail is stripped for the lookup key", () => {
    const reg = withEntry("hdml-frame=sales", {
      key: "hdml-frame=sales@abc.hdml",
      stored: true,
    });
    assert.deepEqual(
      resolveQueryTarget("?hdml-frame=sales&column=x", reg),
      { docPath: "dynamic:hdml-frame=sales@abc.hdml", stored: true },
    );
  });

  test("a static ref resolves without touching the registry", () => {
    // Any registry access explodes; the static branch must not read
    // it (zero server round-trip, no gate — RFC §4.2).
    const reg = new Map<string, RegistryEntry>();
    reg.get = () => {
      throw new Error("registry touched");
    };
    assert.deepEqual(
      resolveQueryTarget("/maang/full.html?hdml-frame=stock", reg),
      {
        docPath: "/maang/hdml-frame=stock@full.hdml",
        stored: true,
      },
    );
  });
});

suite("artifact — validateElementName mirror", () => {
  test("rejects empty, path-separator, and .. names", () => {
    assert.throws(() => validateElementName(""));
    assert.throws(() => validateElementName("a/b"));
    assert.throws(() => validateElementName("a\\b"));
    assert.throws(() => validateElementName("../x"));
  });

  test("accepts a normal name", () => {
    assert.doesNotThrow(() =>
      validateElementName("maang_stock_frame"),
    );
  });
});
