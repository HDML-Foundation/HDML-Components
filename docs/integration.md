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
import "@hdml/components";   // registers <hdml-connection>, <hdml-model>, ..., <hdml-io>
```

If a bundler tree-shakes the package, the registrations vanish — `"sideEffects"` is **not**
declared in `package.json`. `TODO(confirm: add "sideEffects": false-with-exceptions, or
"sideEffects": ["./esm/index.js", "./esm/hdql/*.js", "./esm/hdio/*.js"], to make this safe
under bundlers that respect the field.)`

## Dist variants

```mermaid
flowchart LR
  src["src/"] -->|tsc cjs| cjs["cjs/ — Node / older bundlers"]
  src -->|tsc esm| esm["esm/ — modern bundlers"]
  src -->|tsc dts| dts["dts/ — type defs"]
  esm -->|esbuild + worker plugin| bin["bin/index.min.js — drop-in script tag"]
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
`POST {host}/public/api/v1/{tenant}/hdio/files` (see [docs/hdio-client.md](hdio-client.md)).
The body is the `state.data` buffer produced by
[src/hdio/parse.ts:114](../src/hdio/parse.ts#L114), which is `fileifize(hdomToSave)` from
`@hdml/buffer`. The HDIO server is expected to interpret this as a `FilesList` FlatBuffers
table (per the `HDML-Schemas` repo's `.fbs` definitions).

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
