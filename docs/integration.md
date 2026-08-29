# Integration

**Scope:** how `@hdml/components` is consumed by other repos and apps — the published npm
shape, the dist variants, version alignment rules, and what the HDIO server expects from the
uploads this package produces.

Adjacent reading: [docs/components.md](components.md) for the element registry ·
[docs/hdio-client.md](hdio-client.md) for the on-the-wire FlatBuffers payload.

## Published package

```
name:    @hdml/components
version: 0.0.0-alpha.0  (per package.json; the actually-published alpha is unverified)
license: Apache-2.0
registry: https://registry.npmjs.org/  (publishConfig)
access:   public
```

| `package.json` field | Resolves to |
|---|---|
| `main` | `cjs/index.js` |
| `module` | `esm/index.js` |
| `types` | `dts/index.d.ts` |
| `customElements` | `custom-elements.json` (CEM, produced by `npm run manifest`) |
| `exports` | the four entry points below |
| `sideEffects` | the eight paths below |

`main` / `module` / `types` are kept alongside `exports` as the fallback for resolvers
that do not read `exports` — removing them would be a second breaking change.

## Entry points

The package publishes **four** entries. `.` is the compatibility root and keeps today's
surface exactly; `./hdio`, `./hdql` and `./hdvl` are purely additive.

| Entry | Registers | Notes |
|---|---|---|
| `.` | `<hdml-io>` + the eleven HDQL elements — **twelve** tags | Byte-for-byte what it registered before the split. No display module, no geometry kernel. |
| `./hdio` | `<hdml-io>` only | The other eleven modules in `src/hdio/` are its supporting graph and define no tag. |
| `./hdql` | the eleven HDQL elements | Same import order as `.` — that order is the public registration order. |
| `./hdvl` | the **twenty-one** display tags | The display half. It also exports the vocabulary (`HDVL_TAG_NAMES`, `HDVL_FAMILIES`, `familyOf` + the twenty `*_ATTRS_LIST` enums re-exported from `@hdml/types`) and no element class — importing it additionally registers SPEC §9's 35 `--hdml-*` custom properties and adopts the two `hdml-fallback` rules into `document.adoptedStyleSheets`. Deliberately **not** reachable from `.`: a consumer authoring an HDML document does not pay for the display layer. |

```jsonc
"exports": {
  ".":      { "types":   "./dts/index.d.ts",
              "import":  "./esm/index.js",
              "require": "./cjs/index.js" },
  "./hdio": { "types":   "./dts/hdio/index.d.ts",
              "import":  "./esm/hdio/index.js",
              "require": "./cjs/hdio/index.js" },
  "./hdql": { "types":   "./dts/hdql/index.d.ts",
              "import":  "./esm/hdql/index.js",
              "require": "./cjs/hdql/index.js" },
  "./hdvl": { "types":   "./dts/hdvl/index.d.ts",
              "import":  "./esm/hdvl/index.js",
              "require": "./cjs/hdvl/index.js" }
}
```

**`exports` is a resolution *fence*, not just a map — this is a breaking change.** The
moment the field exists, every path it does not list becomes unreachable to a modern
resolver, including deep paths such as `@hdml/components/esm/hdql/HdmlFrame.js`. That is
intended: a consumer importing a deep path breaks, the four documented entry points do
not. Import by entry point.

`src/bundle.ts` → `esm/bundle.js` is deliberately **not** an entry point. It exists only
as the esbuild entry for `bin/index.min.js` and is excluded from CEM analysis alongside
`src/index.ts`.

### Bundle budget

**Measurements, and a build assertion that enforces them.**
[`scripts/check-dist.mjs`](../scripts/check-dist.mjs) bundles each entry the way a
consumer's bundler would — esbuild, `--bundle --minify --format=esm`, no plugins,
nothing external — gzips the result at level 9, and fails the build over its ceiling.
The whole of `check-dist` runs in **0.74 s** with the four bundles included.

| Artifact | Measured (2026-08-29) | Ceiling |
|---|---|---|
| `.` | 785.1 kB / 216.4 kB | 825 kB / 228 kB |
| `./hdio` | 779.3 kB / 215.3 kB | 819 kB / 227 kB |
| `./hdql` | 35.5 kB / 9.7 kB | 38 kB / 11 kB |
| `./hdvl` | 409.2 kB / 116.2 kB | 430 kB / 123 kB |
| `bin/index.min.js` | 1 203.5 kB / 328.5 kB | 1 264 kB / 345 kB |

Every ceiling is **measured × 1.05, rounded up to the whole kB** — five per cent absorbs
a widget and does not absorb a dependency, which is the only regression the check exists
to catch. The ceilings live in one place, `BUDGET` in `check-dist.mjs`; this table is a
copy for readers and the script is the authority.

**`.` and `./hdio` legitimately carry the whole `@hdml/parser` graph.** The checked-in
[`endpoint.ts`](../src/hdio/endpoint.ts) is the same-thread `MessageChannel` form, and
only the IIFE build swaps in the `Worker`-spawning one — so the number above *is* what an
ESM consumer pays.

**`./hdvl` is 409.2 kB where RFC 016/001 §9.5 budgeted 120, and 47.6 % of it is
`apache-arrow` that nothing in the display half calls.** The path is
`uid()` → `@hdml/hash` → `@hdml/common`, whose `index.js` is a `globalThis` barrel doing
an unconditional `import * as arrow from "apache-arrow"`. Removing it was measured and
**would not have been enough** — `./hdvl` is 194.4 kB / 62.2 kB with `@hdml/hash`
stubbed out, still 1.6× the old ceiling, because §9.5 also under-counted the local
source (108.4 kB against a budgeted 60) and `temporal-polyfill` (54.6 kB against 40).

And it costs **a consumer of this package nothing**: importing `.` *and* `./hdvl`
bundles to 949.2 kB / 270.1 kB either way, byte for byte, because
[`decode.ts`](../src/hdio/decode.ts) imports `arrow` deliberately — it decodes Arrow IPC.
The leak is paid only by a consumer importing `./hdvl` **alone**, which is a coherent
shape (HDVL binds purely through `document` events, and `HdmlConfig` is shared with a
separate consumer repo) but not one this project targets. The ceilings are therefore a
**regression guard rather than a target**; the reasoning is in
[docs/decisions.md](decisions.md).

The IIFE bundle at `bin/index.min.js` is **not** referenced from `package.json` — it ships
in the publish payload but consumers wire it manually via `<script src=…/bin/index.min.js>`.
Pages in [html/hdio/hdml-io.bin.html](../html/hdio/hdml-io.bin.html) use it directly.

`TODO(confirm: whether the published tarball deliberately includes all four output dirs and
custom-elements.json, since package.json has no "files" field — by default npm publishes
everything that is not gitignored, but `bin/cjs/dts/esm` are gitignored.)`

## Side-effect import contract

`@hdml/components` is **side-effectful by design.** Importing the entry registers every
custom element on the global `customElementRegistry`:

```ts
// src/index.ts
import "./hdio/HdmlIo";
import "./hdql/HdmlConnection";
// …10 more hdml-* elements
```

Consumers should import the whole module exactly once, before any `<hdml-*>` tag is parsed:

```ts
import "@hdml/components";        // the twelve tags of the root entry
import "@hdml/components/hdql";   // or just the eleven data elements
```

### `sideEffects`

Because the whole package is side-effectful by design, it declares the field explicitly.
This is **required, not cosmetic**: a bundler that respects `sideEffects` and finds it
absent may still strip a bare import, and every `customElements.define` would vanish.

```jsonc
"sideEffects": [
  "./esm/index.js",   "./cjs/index.js",
  "./esm/hdio/*.js",  "./cjs/hdio/*.js",
  "./esm/hdql/*.js",  "./cjs/hdql/*.js",
  "./esm/hdvl/*.js",  "./cjs/hdvl/*.js"
]
```

Two properties of that value are load-bearing, and the TODO this section replaces got
both of them wrong:

- **Both module formats, for every entry.** The side effect is the *registration*, not a
  property of module syntax. Guarding `./esm/hdql/*.js` while leaving `./cjs/hdql/*.js`
  unlisted would protect one build of the same source and not the other.
- **The element modules, not the entry files.** `sideEffects` is a **whitelist**: every
  file it does not match is asserted pure, and a bundler drops bare imports of it. The
  registration lives in the element module, not in the entry that imports it. Listing
  only `./esm/hdql/index.js` therefore strips exactly what the field exists to protect —
  measured, with esbuild reporting *"Ignoring this import because
  `esm/hdql/HdmlSortBy.js` was marked as having no side effects"*, and `bin/index.min.js`
  collapsing from 1 058 169 bytes to 136 with no tag registered.

A per-directory glob satisfies both while staying one pair of paths per entry, and it
covers new modules in an entry's directory without another `package.json` edit.

Both this list and the `exports` map are **generated from one array** in
[scripts/check-dist.mjs](../scripts/check-dist.mjs), which fails the build if they
disagree, if a named path is missing after a build, or if an `exports` target is not
covered by `sideEffects`. A new entry point cannot silently skip its declaration.

## Dist variants

```mermaid
flowchart LR
  src["src/"] -->|tsc cjs| cjs["cjs/ — Node / older bundlers"]
  src -->|tsc esm| esm["esm/ — modern bundlers"]
  src -->|tsc dts| dts["dts/ — type defs"]
  esm --> entry["esm/bundle.js — all three layers"]
  entry -->|esbuild + worker plugin| bin["bin/index.min.js — drop-in script tag"]
```

- **`esm/`** keeps `import _script from "./HdmlIo.worker"` resolving to the literal
  `"_script"`. `<hdml-io>` runs the message handler on the main thread.
- **`bin/index.min.js`** inlines the bundled Worker source as a JS string. `<hdml-io>`
  spawns a real `Worker` via Blob URL.
- **`cjs/`** behaves like `esm/` for the Worker question, with CommonJS module shape.

If your app already runs in a Worker-friendly bundler (Vite, Webpack), pull `esm/index.js`
and let the bundler decide whether to extract the Worker file. If you are loading from a
plain `<script>` tag, use `bin/index.min.js`.

## Browser support

Test runner runs **chromium, firefox, webkit** (see [.testrc.js](../.testrc.js)). The
`@web/dev-server-legacy` plugin is wired with `webcomponents: false` for dev and `true` for
tests — implying production targets evergreen browsers and the optional webcomponentsjs
polyfill is only needed for legacy.

`whatwg-fetch` is in `dependencies` so `HdioClient`'s `fetch` call still works under older
runtimes that lack it.

## Version alignment

The five `@hdml/*` dependencies must move as one — they share types and a FlatBuffers
contract.

| Dep | This repo pins | Workspace target |
|---|---|---|
| `@hdml/common` | `0.0.2-alpha.24` | `0.0.2-alpha.24` |
| `@hdml/hash` | `0.0.2-alpha.24` | `0.0.2-alpha.24` |
| `@hdml/parser` | `0.0.2-alpha.24` | `0.0.2-alpha.24` |
| `@hdml/buffer` | `0.0.2-alpha.24` | `0.0.2-alpha.24` |
| `@hdml/types` | `0.0.2-alpha.24` | `0.0.2-alpha.24` |

The five `@hdml/*` deps are aligned with the workspace lockstep at `0.0.2-alpha.24`
(the HDVL display-vocabulary release). Bump all five together when realigning; no
need to bump them individually.

The pins are **exact**, not caret ranges. A caret range lets a stale
`package-lock.json` keep resolving an older tree while the manifest reads new — a
divergence only a clean CI run would surface. `@hdml/schemas` is not pinned here: it
arrives transitively through `@hdml/buffer`, `@hdml/parser` and `@hdml/types`, and must
resolve at the same lockstep version. Verify a bump by reading the **installed** tree,
not the manifest:

```bash
for p in common hash parser buffer types schemas; do
  printf '%-10s ' "$p"
  node -p "require('./node_modules/@hdml/$p/package.json').version"
done
```

**Do not regenerate `package-lock.json` wholesale to perform an `@hdml/*` bump.**
Deleting the lockfile floats every unpinned transitive dependency — most consequentially
`playwright`, which arrives via `@web/test-runner-playwright` and whose browser revisions
must match the ones baked into the devcontainer's read-only `/ms-playwright`. A floated
`playwright` fails every test on all three engines with *"Executable doesn't exist"*.
Editing the manifest and running plain `npm install` updates only the entries the changed
manifest no longer satisfies, which is exactly the six `@hdml/*` lines.

`lit` (`^3.2.1`) and `whatwg-fetch` are not bound to the workspace lockstep.

## What HDIO sees on the wire

`<hdml-io>` posts an `application/octet-stream` body to
`POST {host}/{tenant}/api/v1/documents/dynamic`
([HdioClient.ts:209](../src/hdio/HdioClient.ts#L209); see
[docs/hdio-client.md](hdio-client.md)) carrying a real `Authorization: Bearer <access>`.
The body is the `state.data` buffer produced by
[src/hdio/parse.ts:151](../src/hdio/parse.ts#L151), which is `fileifize(blobs)` from
`@hdml/buffer` — the whole `DocumentFilesStruct`, re-sent on every change. The **201**
response is `{ stored[], ddl[] }`, folded into the ref→key→stored registry.

Path scheme used by the client to identify each artifact (built in
[src/hdio/parse.ts:62-112](../src/hdio/parse.ts#L62-L112)):

```
hdml-connection=<name>@<hashOfBase64(serialized)>.html
hdml-model=<name>@<hash>.html
hdml-frame=<name>@<hash>.html
```

The hash is content-addressed; identical content → identical path, so re-renders that don't
change anything do not produce new artifacts. `TODO(confirm: HDIO server treats these
.html-suffixed virtual paths as opaque keys and matches the same scheme on the receiving
side.)`

## Consumer checklist

1. `npm i @hdml/components` (plus a peer `lit@^3` if your app doesn't already have one).
2. `import "@hdml/components";` exactly once.
3. Put `<hdml-io host tenant token>` somewhere in the page.
4. Author the HDML using `<hdml-connection>`, `<hdml-model>`, `<hdml-frame>` and their
   children. The element registry is global — no scoping needed.
5. Drive `host` / `tenant` / `token` from your auth layer. Empty values make `<hdml-io>` a
   no-op.

The `hdom-changed` event is public; you can listen on `document` to observe the same signal
`<hdml-io>` uses, e.g. for debugging.
