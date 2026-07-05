/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/* eslint-disable max-len */

import { assert } from "@open-wc/testing";
import { bytesToBase64, hashify } from "@hdml/hash";
import { deserialize, StructType } from "@hdml/buffer";
import type { Frame } from "@hdml/types";
import { parse } from "./parse";
import type { HdioState } from "./parse";
import { recordStored } from "./HdioClient";

const table = `
  <hdml-table name="t" type="table"
    identifier="\`c\`.\`s\`.\`t\`">
    <hdml-field name="a"></hdml-field>
  </hdml-table>`;

/** A model + a frame chain (f1 → model, f2 → f1) via local refs. */
const chainDoc = `
  <hdml-model name="m1">${table}</hdml-model>
  <hdml-frame name="f1" source="?hdml-model=m1">
    <hdml-field name="a"></hdml-field>
  </hdml-frame>
  <hdml-frame name="f2" source="?hdml-frame=f1">
    <hdml-field name="a"></hdml-field>
  </hdml-frame>`;

/** A frame with a `/`-prefixed static (git-authored) source. */
const staticDoc = `
  <hdml-model name="mm">${table}</hdml-model>
  <hdml-frame name="s1"
    source="/maang/full.html?hdml-frame=stock">
    <hdml-field name="a"></hdml-field>
  </hdml-frame>`;

const freshState = (): HdioState => ({
  data: new Uint8Array(),
  registry: new Map(),
});

/** Extracts the `@{hash}` segment out of a canonical key. */
const hashOf = (name: string): string =>
  name.slice(name.lastIndexOf("@") + 1, name.lastIndexOf(".hdml"));

/** Reads back the `source` of a serialized frame blob. */
const sourceOf = (content: Uint8Array): string =>
  (deserialize(content, StructType.FrameStruct) as Frame).source;

suite("parse — bottom-up Merkle namer", () => {
  test("names every element hdml-{type}={name}@{hash}.hdml", () => {
    const { blobs } = parse(freshState(), chainDoc);

    assert.lengthOf(blobs.models, 1);
    assert.lengthOf(blobs.frames, 2);

    const all = [...blobs.models, ...blobs.frames];
    for (const blob of all) {
      // Ends with `.hdml`, never `.html`.
      assert.match(
        blob.name,
        /^hdml-(model|frame)=.+@[a-z0-9]+\.hdml$/,
      );
      // The `@{hash}` is hashify(bytesToBase64()) of THIS element's
      // own (source-rewritten) content — the same pipeline the shared
      // TS<->Go vector pins in @hdml/hash.
      assert.equal(
        hashOf(blob.name),
        hashify(bytesToBase64(blob.content)),
      );
    }
  });

  test("child content embeds the parent's canonical key (Merkle)", () => {
    const { blobs } = parse(freshState(), chainDoc);

    const modelKey = blobs.models[0].name;
    const f1 = blobs.frames.find((b) =>
      b.name.startsWith("hdml-frame=f1@"),
    )!;
    const f2 = blobs.frames.find((b) =>
      b.name.startsWith("hdml-frame=f2@"),
    )!;

    // f1 sources the model: its serialized `source` is the model key.
    assert.equal(sourceOf(f1.content), modelKey);
    // f2 sources f1: its serialized `source` is f1's canonical key.
    assert.equal(sourceOf(f2.content), f1.name);
  });

  test("frames are ordered dependencies-before-dependents", () => {
    const { blobs } = parse(freshState(), chainDoc);
    const names = blobs.frames.map((b) => b.name);
    const i1 = names.findIndex((n) => n.startsWith("hdml-frame=f1@"));
    const i2 = names.findIndex((n) => n.startsWith("hdml-frame=f2@"));
    assert.isBelow(i1, i2);
  });
});

suite("parse — static source passthrough", () => {
  test("a `/`-prefixed source is serialized verbatim", () => {
    const { blobs } = parse(freshState(), staticDoc);
    const s1 = blobs.frames[0];
    assert.equal(
      sourceOf(s1.content),
      "/maang/full.html?hdml-frame=stock",
    );
    // No `@`-form rewrite of the static ref.
    assert.notInclude(sourceOf(s1.content), "@");
  });
});

suite("parse — full document re-sent each POST", () => {
  test("two parses of the same doc both emit the full set", () => {
    const state = freshState();
    const first = parse(state, chainDoc);
    const second = parse(state, chainDoc);

    // No dedup drop: the second parse re-emits every element.
    assert.lengthOf(second.blobs.models, 1);
    assert.lengthOf(second.blobs.frames, 2);
    assert.deepEqual(
      second.blobs.frames.map((b) => b.name).sort(),
      first.blobs.frames.map((b) => b.name).sort(),
    );
  });
});

suite("parse — ref→key→stored registry (E-L)", () => {
  test("records every element ref, initially not stored", () => {
    const state = freshState();
    parse(state, chainDoc);
    assert.isTrue(state.registry.has("hdml-model=m1"));
    assert.isTrue(state.registry.has("hdml-frame=f1"));
    assert.isTrue(state.registry.has("hdml-frame=f2"));
    assert.isFalse(state.registry.get("hdml-frame=f1")!.stored);
  });

  test("a 201 marks matching keys stored (true AND false both count)", () => {
    const state = freshState();
    parse(state, chainDoc);
    const m1 = state.registry.get("hdml-model=m1")!;
    const f1 = state.registry.get("hdml-frame=f1")!;

    // Server confirms m1 with stored:true and f1 with stored:false —
    // both mean present/queryable.
    recordStored(state.registry, {
      stored: [
        { key: m1.key, type: "model", stored: true },
        { key: f1.key, type: "frame", stored: false },
      ],
      ddl: [],
    });
    assert.isTrue(state.registry.get("hdml-model=m1")!.stored);
    assert.isTrue(state.registry.get("hdml-frame=f1")!.stored);
  });

  test("a changed element gets a new key and re-cleared stored", () => {
    const state = freshState();
    parse(state, chainDoc);
    // Simulate a prior 201 having marked both elements present.
    const f1Before = state.registry.get("hdml-frame=f1")!;
    const m1Before = state.registry.get("hdml-model=m1")!;
    f1Before.stored = true;
    m1Before.stored = true;
    const m1KeyBefore = m1Before.key;
    const f1KeyBefore = f1Before.key;

    // Re-parse with f1 changed (extra field) — m1 unchanged.
    const changed = `
      <hdml-model name="m1">${table}</hdml-model>
      <hdml-frame name="f1" source="?hdml-model=m1">
        <hdml-field name="a"></hdml-field>
        <hdml-field name="b"></hdml-field>
      </hdml-frame>`;
    parse(state, changed);

    const f1After = state.registry.get("hdml-frame=f1")!;
    assert.notEqual(f1After.key, f1KeyBefore);
    assert.isFalse(f1After.stored);
    // m1 is byte-identical → same key, stored flag preserved.
    assert.equal(
      state.registry.get("hdml-model=m1")!.key,
      m1KeyBefore,
    );
    assert.isTrue(state.registry.get("hdml-model=m1")!.stored);
  });
});
