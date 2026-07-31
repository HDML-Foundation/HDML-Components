# `<hdml-io>` and the HDIO client

**Scope:** the host element that uploads the HDML document — its attributes, the Worker
message protocol, and the HTTP calls it makes to the HDIO server.

Adjacent reading: [docs/architecture.md](architecture.md) for the end-to-end picture ·
[docs/decisions.md](decisions.md) for the `endpoint.ts` seam that flips between
Worker / MessagePort-fallback execution.

## Element surface

[src/hdio/HdmlIo.ts](../src/hdio/HdmlIo.ts) registers `<hdml-io>` (extends `LitElement`, not
`HdomElement`). It renders `<slot></slot>` and exposes three attributes:

| Attribute | Type | Purpose |
|---|---|---|
| `host` | string | Base URL of the HDIO server (no trailing slash) — the one base every request is sent to |
| `tenant` | string | Tenant identifier — the leading path segment of every request (`/{tenant}/api/v1/…`) |
| `mode` | string | Auth flow selector (B1, §3.1): `token` (default) or `oidc`. Forwarded to the worker in `props`. |
| `token` | string | Token mode: a **single-use handoff code** the host app's backend minted in issuance step 1, redeemed here for the access/refresh pair (§3.2, B2). Not a bearer token. |

Place one `<hdml-io>` in the page **as a sibling** of the `<hdml-*>` declarations — not as a
parent. It listens to `document` for `hdom-changed` events, so any position works as long as
it is connected.

Auth is **opt-in**: a page that leaves `mode`/`token` unset (and uses its own client/server
mechanism) leaves `<hdml-io>` inert — no request is sent without an access token. Tokens are
held **in memory only** in both modes (B4), so re-auth happens automatically on every reload.

- **token mode** (`mode` unset or `mode="token"`) — the `token` attribute carries the handoff
  code; the worker redeems it (§3.2).
- **oidc mode** (`mode="oidc"`) — no `token`; the element runs a full-page redirect / callback
  dance (§3.3, below).

```html
<hdml-io host="https://hdio.example" tenant="acme" token="…"></hdml-io>
<hdml-io host="https://hdio.example" tenant="acme" mode="oidc"></hdml-io>
```

### OIDC mode — the main-thread state machine (§3.3, B3/B5)

`mode="oidc"` auto-triggers login — there is no manual `login()`. Because the navigation /
`history` / `location` concerns are main-thread (a worker has none), the redirect dance lives
in `HdmlIo.ts` while the code→token **exchange** runs in the worker. The connect /
attribute-change handler is an **ordered, reentrancy-guarded** state machine (a pure
`nextAuthAction` decision in [src/hdio/oidc.ts](../src/hdio/oidc.ts) + a thin effect):

1. **`?code&state` on the URL** → post `oidc-callback` to the worker (it `exchangeOidcCode`s);
   on the `auth {ok:true}` reply the element `history.replaceState`s to strip the params and
   proceeds authed.
2. else **`token` set** → the `props` path forwards it (token mode; the worker redeems).
3. else **`mode === "oidc"`** → `location.assign` to
   `` `${host}/{tenant}/api/v1/auth/login?redirect_uri=<origin+pathname>` `` — the login target
   is `host`-based like every call; only the `redirect_uri` **value** is the app's own page
   (URL-encoded, no query). A **reentrancy guard** (`#navigating`) ensures the flurry of
   `attributeChangedCallback` fires (`mode`/`token` in either order) triggers **exactly one**
   navigation.
4. else **inert**.

A stale reload (a spent single-use `state` → the callback 401s) comes back as `auth
{ok:false, reason:"stale"}`, which the state machine treats as "start over" and re-navigates —
**not** a hard error. An `auth {ok:false, reason:"error"}` is surfaced once (dev-log), no loop.

> **Deployment requirement.** The exact `redirect_uri` (`location.origin + location.pathname`)
> must be **pre-registered** in the tenant's SSO config, or the server answers `403
> ErrRedirectURINotAllowed` (`slices.Contains(oidc.RedirectURIs, …)`).

## Lifecycle

```mermaid
sequenceDiagram
  participant Page as Page (hdml-*)
  participant Io as <hdml-io>
  participant W as Worker (or main thread)
  participant C as HdioClient
  participant S as HDIO Server

  Page->>Io: connectedCallback
  Io->>Io: connectedCallback → #enableMessagable, #listenHdomChanges
  Io->>Io: #endpoint = createEndpoint(); #endpoint.onmessage = #onMessage
  alt IIFE build (esbuild swaps endpoint.js)
    Io->>W: new Worker(Blob URL of bundled worker)
  else ESM/CJS build (checked-in endpoint.ts)
    Io->>W: new MessageChannel() → port1 (port2 runs createHandler)
  end
  Io->>W: endpoint.postMessage {type:"props", data:{host,tenant,mode,token}}
  W->>C: new HdioClient(host,tenant)  // 2-arg, no session bootstrap
  W->>C: redeemHandoff(token)  // once per distinct handoff code
  C->>S: POST /{tenant}/api/v1/auth/token  {token: handoff}
  S-->>C: 200 {access_token, refresh_token, expires_in, token_type}
  C->>C: hold both tokens in memory only (B4)
  Io->>W: postMessage {type:"html", data:{html: concat(outerHTML)}}
  W->>W: parse(state, html)  // bottom-up Merkle namer
  W->>C: postDocument(state.data)  // awaits any in-flight redeem
  C->>S: POST /{tenant}/api/v1/documents/dynamic  (octet-stream, Bearer access)
  S-->>C: 201 {stored:[{key,type,stored}], ddl:[…]}
  W->>W: recordStored(registry, body)  // fold stored[] (ref→{key,stored})
  Page->>Io: attributeChangedCallback (host/tenant/token)
  Io->>W: debounced postMessage {type:"props",...}  // 5ms throdeb.debounce
  Page->>Io: hdom-changed (any hdml-*)
  Io->>W: debounced postMessage {type:"html",...}
  Page->>Io: disconnectedCallback
  Io->>W: closeEndpoint(#endpoint)  // terminate() (Worker) / close() (port1)
```

The `props` and `html` posts are independently debounced 5 ms via `throdeb.debounce` from
`@hdml/common` — see [src/hdio/HdmlIo.ts:84-93](../src/hdio/HdmlIo.ts#L84-L93) and
[src/hdio/HdmlIo.ts:121-140](../src/hdio/HdmlIo.ts#L121-L140).

The `html` post concatenates `outerHTML` for *every* `hdml-connection`, `hdml-model`, and
`hdml-frame` in the document. Nested children (tables, fields, joins, etc.) ride along inside
their parent's `outerHTML`; they are not posted separately. See
[src/hdio/HdmlIo.ts:125-133](../src/hdio/HdmlIo.ts#L125-L133).

## Worker message protocol

Implemented in [src/hdio/onmessage.ts](../src/hdio/onmessage.ts) as
`createHandler(post)` — the handler is parameterized on its outbound sink
`post(msg, transfer?)`, and its `client` / `state` are **closure** state (one
endpoint, one client). Both directions are a discriminated union on `type`
(RFC 014/001 §2.5) — this supersedes the old two-variant `HdmlMessage`.

**Main → worker** (delivered to the `createHandler` listener):

| `type` | Payload | Wired? |
|---|---|---|
| `props` | `{host, tenant, mode?, token?, config?}` | ✅ Slice A/B |
| `html` | `{html}` | ✅ Slice A |
| `oidc-callback` | `{code, state}` | ✅ Slice B (Step 03) |
| `subscribe` | `{id, ref, column, raw?}` | ⏳ Step 07 |
| `unsubscribe` | `{id}` | ⏳ Step 07 |

**Worker → main** (via `post(msg, transfer?)`):

| `type` | Payload | Transfer | Wired? |
|---|---|---|---|
| `auth` | `{ok, reason?: "stale" \| "error", detail?}` | — | ✅ Slice B (Step 03) |
| `result` | `{ref, column, values?, domain, type}` | `[ArrayBuffer]` when `values` present | ⏳ Slice D |
| `error` | `{ref?, message}` | — | ⏳ D |

- **`props`** — (re)constructs the in-Worker `HdioClient` (2-arg: `host`, `tenant`),
  closing any prior one. In **token mode**, if `data.token` (a handoff code) is present it
  calls `client.redeemHandoff(token)` — but **once per distinct code**: the last redeemed
  code is retained in closure state so a debounced re-`props` carrying the same single-use
  code does not redeem it twice (§3.2, B2). A failed redeem is logged, not re-thrown.
- **`html`** — calls `parse(state, html)` (the bottom-up Merkle namer — see [docs/architecture.md#parse--serialize](architecture.md#parse--serialize)) then `client.postDocument(state.data)`, folding the returned 201 body via `recordStored(state.registry, body)`. `postDocument` internally awaits any in-flight redeem (§3.2), so an `html` that races the auth round-trip still posts with a real `Bearer`. `parse` re-names and re-packs the **whole** document every call (no dedup — every element is re-posted; the server idempotent-skips already-present keys). `state` is closure-scoped and holds the `ref → {key, stored}` registry (keyed by local ref `hdml-{type}={name}`) that survives for the endpoint's lifetime — the substrate for the post→confirm→query handshake (RFC 004 Slice E §8.6, E-L).
- **`oidc-callback`** — calls `client.exchangeOidcCode(code, state)` (OIDC mode, §3.3). On
  success it posts `auth {ok:true}`; on a **stale-marked 401** (the single-use `state` already
  spent — `isStaleAuthError`) it posts `auth {ok:false, reason:"stale"}`; any other error posts
  `auth {ok:false, reason:"error", detail}`. The exchange runs **worker-side** so the token
  pair never touches the main thread (B4), reusing the one `${host}` base / `TokenResponse`
  parse.

The remaining **outbound** variants (`result` / `error` for the query leg) are **declared but
not yet routed** — Slice D wires them. `result` messages will carry a **transferable
`ArrayBuffer`** via the transfer-list form `post(msg, [buf])` (the source buffer detaches —
RFC §2.6, A4). The `auth` reply is consumed by `HdmlIo.ts`'s `#onMessage` — the main-thread
state machine's `strip` (ok) / `re-navigate` (stale) branches (§3.3).

### Column decode + scale domain (Slice D, D9/D3)

The `result` payload's `type` / `values` / `domain` come from two **pure** modules the worker
calls once per coalesced column (Step 07 wires them into `subscribe` → `result`):

- [src/hdio/decode.ts](../src/hdio/decode.ts) — `decode(ipc)` turns an Arrow IPC payload into
  one `DecodedColumn { name, type, values }` per field, reading each column's kind **off the
  self-describing Arrow result schema** (`field.type`), never the authored frame `type`
  (§5.7, D9):

  | Arrow type | `type` tag | `values` |
  |---|---|---|
  | `Utf8` | `{kind:"string"}` | `string[]` |
  | integer ≤32-bit / float | `{kind:"number"}` | `Float64Array` |
  | 64-bit integer | `{kind:"bigint"}` | `BigInt64Array` |
  | `Date32` / `Date64` | `{kind:"date", unit:"ms"}` | epoch-ms at **UTC midnight** (a calendar day) |
  | `Time32` / `Time64` | `{kind:"time", unit:"ms"}` | **ms since midnight** — a within-day offset, **not** an instant |
  | `Timestamp` | `{kind:"timestamp", unit:"ms", zone?}` | epoch-ms instant, **UTC at the edge** |

  The three temporal families stay **distinct** (never collapsed to one instant), and every
  family is normalized to **ms** here (Arrow's native s/ms/µs/ns converted at decode). A
  zone-less `Timestamp` is read as **UTC** (the one silent decision — deterministic across
  clients, no local-offset shift); a zoned one passes its timezone through as `zone` **without
  shifting the instant**.
- [src/hdio/reducers.ts](../src/hdio/reducers.ts) — `domainFor(col)` returns the
  type-appropriate scale `Domain`: an `extent` `[min, max]` for a numeric/temporal column, or
  the insertion-order-stable `ordinal` distinct list for a `string` one (§5.3, D3). `distinct`
  is computed **only** for strings, so a continuous column never pays a distinct pass — an
  ordinal date bucket an author emits as `VARCHAR` arrives as a string and is handled
  ordinally.

## Query-target resolution (Slice C)

[src/hdio/artifact.ts](../src/hdio/artifact.ts) is the bridge from the parse/save path to a
query: it turns a **source ref** (a query handle, identical grammar to an `hdml-frame`
`source`) into the `doc_path` the server's `walkChain` reads (RFC 014/001 §4, C1–C6). It is
pure — no network, no `@hdml/*` (the transform is IO's own contract with the server, so there
is **no** lockstep bump).

### Source-ref grammar

Two forms, classified on the first character (§2.9):

```
local:   ?hdml-{kind}={name}[&column={col}]
static:  /{dir}/{file}.html?hdml-{kind}={name}[&column={col}]
```

`{kind}` is `frame` | `model` **only** — a connection is not queryable (it has no
`hdml-{kind}={name}@{source}` artifact and the server's `parseArtifactKind` rejects it), so a
`connection` kind throws. The two kinds resolve **uniformly**; a bare-model query's meaning is
the server's `walkChain` concern, so a model is **never** rejected. The `&column=` tail is the
per-subscriber column selector consumed by Step 07 — it is **not** part of the `doc_path` and
is stripped by the resolver. The static ref names the authored **`.html`** markup file
(`.html` = authored source, `.hdml` = compiled artifact).

### `resolveQueryTarget(ref, registry)` — one resolver, two branches

Returns `{ docPath, stored }`:

| Branch | Input | `docPath` | `stored` | Server round-trip |
|---|---|---|---|---|
| **local** (`?`) | `?hdml-{kind}={name}[&column=…]` | `dynamic:` + `registry` entry's canonical key | the entry's `stored` flag | none — reads the worker registry |
| **static** (`/`) | `/{dir}/{file}.html?hdml-{kind}={name}` | `staticRefToDocPath(ref)` | always `true` | none — pure transform |

The **local** branch strips the `&column=` tail, looks the `hdml-{kind}={name}` key up in the
registry, and returns `dynamic:{entry.key}` carrying the entry's `stored` flag (the
post→confirm→query gate — a local target's first query holds until `stored: true`, D4). An
**unknown** local ref **throws** — but as a *pure function*: the query leg (Step 07) reads the
throw as *not-ready-yet* inside the D4 gate window, not an immediate failure. The **static**
branch never touches the registry (it is already server-side, no gate, `stored: true`); a wrong
basename is a query-time **404**, unforeseeable by the FE.

The resolved `docPath` is exactly what the server's `leafRef` expects: a `dynamic:`-prefixed
key selects the Redis-backed dynamic store, a `/`-prefixed path is a static artifact parsed by
`parseArtifactFile(filepath.Base(rel))`
([artifact_resolver.go:75-106](../../HDIO-Server/internal/compile/artifact_resolver.go#L75)).

### `staticRefToDocPath(ref)` — the precomputable pure transform

The static `@…` segment is the source-doc **basename**, not a content hash (only the dynamic
form is `@{hashify(...)}`), so a static target resolves with **zero content and zero server
round-trip**. It mirrors the Go `parseHTMLSourceRef` + `deriveSource` + `docArtifactPath`
([artifact_naming.go:21-108](../../HDIO-Server/internal/compile/artifact_naming.go#L21)):

```
HTML-form:     /{dir}/{file}.html?hdml-{kind}={name}
artifact-form: /{dir}/hdml-{kind}={name}@{file}.hdml
```

The output is **always** `/`-prefixed (the `/` marks a static target), and the directory
segment is omitted for a top-level source (`dir === "."`). Because relocating the transform to
TS does not dissolve the cross-language contract, `artifact.test.ts` pins a Go-derived fixture
— each vector traced to the Go source:

| Input ref | `doc_path` | Pins |
|---|---|---|
| `/x/a.b.html?hdml-frame=f` | `/x/hdml-frame=f@a.b.hdml` | `filepath.Ext` strips only the last extension → `source = a.b` |
| `/maang?hdml-frame=x` | `/hdml-frame=x@maang.hdml` | no extension → `source = maang`, `dir = "."` |
| `/full.html?hdml-model=m` | `/hdml-model=m@full.hdml` | top-level `dir === "."` → no dir prefix (FE keeps the leading `/`) |
| `/a/b/c.html?hdml-frame=f` | `/a/b/hdml-frame=f@c.hdml` | `filepath.Join(docPath, file)` |

`validateElementName` is mirrored too (rejects `""`, `/`, `\`, `..`), so a bad element name
fails **locally**, not at the server.

### The registry is the unified query-target map (C6)

The `ref → { key, stored }` registry in worker `state`
([parse.ts](../src/hdio/parse.ts) `RegistryEntry` / `HdioState`) — folded on each 201 via
`recordStored` — **is** the query-target map `resolveQueryTarget` reads for the local branch;
`resolveQueryTarget` is the single entry point both branches go through. Serialization is
untouched: `parse()` still leaves a `/`-prefixed static `source` **verbatim** (the server's
`parseHTMLSourceRef` errors on a ref without `?`, so pre-converting a `source` edge to
artifact-form would break `walkChain`, C5). Only the **query handle** is converted to
artifact-form, never the document's serialized `source` edges.

## HdioClient

[src/hdio/HdioClient.ts](../src/hdio/HdioClient.ts) wraps `fetch` (polyfilled via
`whatwg-fetch`) and is the **sole** HTTP surface to the HDIO server (RFC 014/001 §2.7). It
was rewritten for the post-006 auth surface: there is **no** `session` bootstrap (the dead
`GET …/sessions` leg — and the `Bearer null` it produced — is gone). The access + refresh
tokens live **in memory only** (B4, §3.4): no `sessionStorage`, re-auth on every reload.

Constructor: `(host, tenant)` — two args, no token, no side effect. The client is inert
(`authed === false`) until an explicit `redeemHandoff` (token mode) or `exchangeOidcCode`
(OIDC mode) succeeds.

Surface implemented after Slice B (parts 1 + 2):

```ts
constructor(host: string, tenant: string);
redeemHandoff(code: string): Promise<void>;          // issuance step 2 (§3.2)
exchangeOidcCode(code: string, state: string): Promise<void>; // OIDC (§3.3)
refresh(): Promise<void>;                              // silent, on 401 / expiry
postDocument(data: Uint8Array): Promise<unknown>;      // → 201 body
close(): void;                                          // abort in-flight + clear tokens
get authed(): boolean;                                 // #access != null
```

`submitQuery` / `queryStatus` / `queryResult` / `cancelQuery` are Step 07. The module also
exports `isStaleAuthError(error)` — the type guard the worker uses to map a callback 401 to
`auth {reason:"stale"}`.

### Endpoint surface

**One** base — the `host` attribute. Every request is sent to `` `${host}${path}` `` (the
dead `/public/api/v1/{tenant}` base is gone). Routes are all verified against
[HDIO-Server handlers.go](../../HDIO-Server/internal/api/handlers.go):

| Call | Method + path | Body | Returns |
|---|---|---|---|
| `redeemHandoff(code)` | `POST /{tenant}/api/v1/auth/token` | `{ token: code }` (JSON) | `{ access_token, refresh_token, expires_in, token_type }` |
| `exchangeOidcCode(code, state)` | `GET /{tenant}/api/v1/auth/callback?code&state` | — (bodiless GET) | same token pair; **401** → stale-marked reject (`isStaleAuthError`) |
| `refresh()` | `POST /{tenant}/api/v1/auth/token/refresh` | `{ refresh_token }` (JSON) | same shape |
| `postDocument(data)` | `POST /{tenant}/api/v1/documents/dynamic` | `data.slice().buffer` (octet-stream `DocumentFilesStruct`) | `201 { stored[], ddl[] }` |

`redeemHandoff` / `exchangeOidcCode` / `refresh` parse the token pair and hold both in memory;
`authed` becomes `true`. All three share the in-flight `#pending` guard, so a document POST
that races any of them awaits it first. Common request options: `mode: cors`, `redirect:
follow`, `cache: no-cache`. The body content-type is set **only when a body is present** —
`application/json` for the auth POSTs, `application/octet-stream` for the document POST, and
**nothing on a bodiless GET** (the OIDC callback, and — historically — the removed `sessions`
leg). The `Authorization: Bearer <access>` header is attached only when a token is held —
never `Bearer null`.

`postDocument` awaits any in-flight redeem/refresh first (so an early `html` still carries a
real `Bearer`), then posts. On a **401** it calls `refresh()` and retries **once**; a second
401 surfaces. The **201** `{ stored: [{ key, type, stored }], ddl: [{ name, status,
detail? }] }` (RFC 004 Slice E §7.2) is returned to the caller (the worker's `html` handler),
which folds the confirmed `stored[]` keys into the registry via `recordStored` — both
`stored:true` (freshly written) and `stored:false` (idempotent-skip, already present) mark the
entry present/queryable (E-L). `close()` aborts the instance-held `AbortController` (threaded
onto every request) and nulls both tokens.

### Error handling

`!response.ok` builds an `Error` **without** assuming a JSON body: only a JSON content-type is
parsed (server errors are `{ error }` — see
[HDIO-Server errors.go](../../HDIO-Server/internal/api/errors.go) `WriteError`), and anything
else — a 502 HTML page, an empty 413 — falls back to `response.statusText` or the status code.
This replaces the old unconditional `await response.json()` that threw a parse error on a
non-JSON body and masked the real status. The worker's `props` / `html` handlers
`.catch(console.error)` the surfaced error.

## Same-thread fallback (the `endpoint.ts` seam)

The build-time branch is gone from `HdmlIo.ts`. It holds `#endpoint: null | Endpoint`
(`Worker | MessagePort`) and calls only `createEndpoint()` / `closeEndpoint()` from
[src/hdio/endpoint.ts](../src/hdio/endpoint.ts).

In the ESM and CJS builds, the **checked-in** `endpoint.ts` is the fallback: `createEndpoint`
builds a private `MessageChannel`, wires `createHandler(post)` onto `port2.onmessage`, and
returns `port1` to the element. No global slot is touched — nothing off-page can reach it
(this replaces the pre-Slice-A `globalThis.self` path, which on the main thread hijacked
`window.onmessage`, A1). The handler still runs on the main thread (the fallback is a
correctness/isolation fix, not parallelism — real off-thread work is the IIFE build).

In the IIFE build (`bin/index.min.js`), the esbuild plugin in
[.esbuildrc.mjs](../.esbuildrc.mjs) matches **`endpoint.js`** (not `*.worker.js`) and replaces
the whole module with a `createEndpoint` that Blob-URL-spawns the bundled `HdmlIo.worker.js` as
a real `Worker` (and a `closeEndpoint` that `terminate()`s it). See
[docs/decisions.md#the-endpointts-seam](decisions.md#the-endpointts-seam).
