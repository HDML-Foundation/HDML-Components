/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { throdeb } from "@hdml/common";
import { LitElement, TemplateResult, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { Endpoint } from "./endpoint";
import { createEndpoint, closeEndpoint } from "./endpoint";
import type { OutboundMessage } from "./onmessage";
import { loginUrl, nextAuthAction, originPathname } from "./oidc";
import { exchangeCode } from "./exchange";
import { readConfig } from "./config";

/**
 * The endpoint-factory seam (RFC §2.2). Module-level — not a
 * per-instance field — so a test can substitute a controllable
 * endpoint (to spy the `subscribe`/`props` it receives and to feed
 * `result`s back) before any element upgrades: the legacy
 * webcomponents polyfill upgrades on connect and would clobber a
 * per-instance override (mirrors {@link nav}). Production defaults to
 * the real `endpoint.ts` seam; `HdmlIo` never branches on the build.
 *
 * @internal
 */
export const endpoints = {
  create: createEndpoint,
  close: closeEndpoint,
};

/**
 * One decoded column delivered back from the worker (RFC §5.6, D7) —
 * the `data` of a `result` message: the `(ref, column)` correlation,
 * the render-ready `domain` + `type`, the raw `values` when some
 * subscriber wanted them, and the row-null `nulls` bitmask when the
 * column has nulls (the faithful null carrier for a typed-array
 * column). `#fanOut` passes the payload through unchanged.
 */
type ResultPayload = Extract<
  OutboundMessage,
  { type: "result" }
>["data"];

/**
 * The provisional shape hdml-io reads off a D8 request event's
 * `detail` (RFC §8). **Provisional — pending the consumer repo:** the
 * exact detail schema, whether delivery is a callback and/or event,
 * and the consumer-side ref+column attribute are co-designed with the
 * separate consumer element and are **not** invented here. hdml-io
 * implements just enough to register a subscriber, drive
 * `subscribe`/`unsubscribe`, and fan a `result` out — reconciling
 * this against the real consumer contract later is expected, not a
 * regression.
 */
interface RequestDetail {
  id: string;
  ref: string;
  column: string;
  raw?: boolean;
  signal?: AbortSignal;
  deliver?: (r: ResultPayload) => void;
}

/**
 * One main-thread subscription (RFC §2.8, D7): its `(ref, column)`
 * binding, its `raw` flag, the `deliver` sink a `result` fans out to,
 * and the optional teardown `signal`.
 */
interface Subscriber {
  id: string;
  ref: string;
  column: string;
  raw: boolean;
  deliver: (r: ResultPayload) => void;
  signal?: AbortSignal;
}

/**
 * The main-thread navigation seam the OIDC state machine drives
 * (RFC §3.3): reading `?code&state` off the URL, the full-page
 * redirect to `/auth/login`, and the post-exchange `replaceState`
 * param strip — the three things a worker (no `window`) cannot do.
 */
interface NavSeam {
  href(): string;
  search(): string;
  navigate(url: string): void;
  strip(url: string): void;
}

/**
 * The single navigation seam every `<hdml-io>` reads (RFC §3.3).
 * Defaults to the real browser globals; a test overrides its methods
 * to assert the redirect / callback / strip dance without a real
 * navigation (which would reload the runner). Module-level — not a
 * per-instance field — so the override is in place before any
 * element's debounced auto-trigger fires, independent of custom-
 * element upgrade timing.
 *
 * @internal
 */
export const nav: NavSeam = {
  href: () => location.href,
  search: () => location.search,
  navigate: (url) => location.assign(url),
  strip: (url) => history.replaceState(null, "", url),
};

/**
 * The `hdml-io` component.
 *
 * @tagname hdml-io
 *
 * @attribute {string} host
 * @attribute {string} tenant
 * @attribute {string} mode
 * @attribute {string} token
 */
@customElement("hdml-io")
export class HdmlIo extends LitElement {
  /**
   * @internal
   */
  @property({ type: String })
  host: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  tenant: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  mode: null | string = null;

  /**
   * @internal
   */
  @property({ type: String })
  token: null | string = null;

  /**
   * Reentrancy guard for the auto-trigger state machine (B5): once a
   * navigation is committed, the flurry of `attributeChangedCallback`
   * fires — `mode`/`token` landing in either order — cannot trigger a
   * second one.
   *
   * @private
   */
  #navigating = false;

  /**
   * The message endpoint — a real `Worker` in the IIFE build, a
   * same-thread `MessagePort` in the esm/cjs fallback (RFC §2.2, A2).
   * The element never branches on the build: `createEndpoint` /
   * `closeEndpoint` (from `./endpoint`) hide it.
   *
   * @private
   */
  #endpoint: null | Endpoint = null;

  /**
   * Handles messages coming back from the endpoint (worker→main).
   * Only the query leg replies: a `result` fans out to the D8
   * subscribers (§2.5, D7). The OIDC exchange now runs on the main
   * thread (§3.3, {@link #runExchange}), so there is no `auth` reply
   * to route here.
   *
   * @private
   */
  #onMessage = (ev: MessageEvent): void => {
    const msg = ev.data as OutboundMessage;
    if (!msg) {
      return;
    }
    if (msg.type === "result") {
      this.#fanOut(msg.data);
    }
  };

  /**
   * The main-thread subscription registry (RFC §2.8, D7): `subId →
   * subscriber`, keyed for `(ref, column)` fan-out. De-duped by `id`,
   * so the symmetric handshake (§5.8) converges whether the request
   * arrives before or after connect.
   *
   * @private
   */
  #subscriptions = new Map<string, Subscriber>();

  /**
   * The request-event name captured at connect (from `HDML_CONFIG`),
   * so `removeEventListener` uses the exact string `addEventListener`
   * did even if the host mutates the config mid-life.
   *
   * @private
   */
  #requestEvent: null | string = null;

  /**
   * Fans one worker `result` out to **every** subscriber of that
   * `(ref, column)` (D7): the transfer already detached it from the
   * worker, so the main thread holds one copy — every matching
   * subscriber's `deliver` gets that same `payload` **by reference**,
   * never a re-clone.
   *
   * @param payload - The `result` message's `data`.
   * @private
   */
  #fanOut = (payload: ResultPayload): void => {
    this.#subscriptions.forEach((sub) => {
      if (sub.ref === payload.ref && sub.column === payload.column) {
        sub.deliver(payload);
      }
    });
  };

  /**
   * Enables the endpoint. Called by the `connectedCallback` method.
   * Assigning `#endpoint.onmessage` starts the port (fallback) so
   * inbound messages are delivered.
   *
   * @private
   */
  #enableMessagable = () => {
    this.#endpoint = endpoints.create();
    this.#endpoint.onmessage = this.#onMessage;
    this.#sendProps();
    this.#sendHtml();
  };

  /**
   * Disables the endpoint. Called by the `disconnectedCallback`
   * method.
   *
   * @private
   */
  #disableMessagable = () => {
    if (this.#endpoint) {
      endpoints.close(this.#endpoint);
      this.#endpoint = null;
    }
  };

  /**
   * Registers a subscriber from a D8 request event and posts
   * `subscribe` to the worker (RFC §5.8, §2.8). De-dupes by `id` (the
   * symmetric handshake may deliver the same request twice); an
   * already-aborted signal is a no-op. Teardown rides the request's
   * `AbortSignal` — on `abort` the subscription is dropped and
   * `unsubscribe` posted. Reading `detail` is the marked-provisional
   * seam (see {@link RequestDetail}).
   *
   * @param ev - The `bubbles`/`composed` request `CustomEvent`.
   * @private
   */
  #onRequest = (ev: Event): void => {
    const detail = (ev as CustomEvent<RequestDetail>).detail;
    if (
      !detail ||
      typeof detail.id !== "string" ||
      typeof detail.ref !== "string" ||
      typeof detail.column !== "string"
    ) {
      return;
    }
    if (
      this.#subscriptions.has(detail.id) ||
      detail.signal?.aborted
    ) {
      return;
    }
    const raw = detail.raw !== false;
    const sub: Subscriber = {
      id: detail.id,
      ref: detail.ref,
      column: detail.column,
      raw,
      deliver: detail.deliver ?? ((): void => undefined),
      signal: detail.signal,
    };
    this.#subscriptions.set(sub.id, sub);
    detail.signal?.addEventListener(
      "abort",
      () => this.#dropSubscriber(sub.id),
      { once: true },
    );
    this.#endpoint?.postMessage({
      type: "subscribe",
      data: { id: sub.id, ref: sub.ref, column: sub.column, raw },
    });
  };

  /**
   * Drops a subscriber (its `AbortSignal` fired = component
   * disconnect) and posts `unsubscribe` (RFC §5.8): the fan-out reads
   * the registry, so removal alone stops delivery.
   *
   * @param id - The subscription id to drop.
   * @private
   */
  #dropSubscriber = (id: string): void => {
    if (!this.#subscriptions.delete(id)) {
      return;
    }
    this.#endpoint?.postMessage({
      type: "unsubscribe",
      data: { id },
    });
  };

  /**
   * Wires the D8 request listener on `document` (RFC §5.8). The event
   * name is read from `HDML_CONFIG` and captured so teardown matches.
   *
   * @private
   */
  #listenRequests = () => {
    this.#requestEvent = readConfig().requestEvent;
    document.addEventListener(this.#requestEvent, this.#onRequest);
  };

  /**
   * Removes the request listener. Called by `disconnectedCallback`.
   *
   * @private
   */
  #unlistenRequests = () => {
    if (this.#requestEvent !== null) {
      document.removeEventListener(
        this.#requestEvent,
        this.#onRequest,
      );
      this.#requestEvent = null;
    }
  };

  /**
   * Announces `hdml-io-ready` on `document` (RFC §5.8, symmetric
   * handshake): fired once the endpoint + request listener are wired,
   * so a consumer that connected first re-dispatches its request and
   * the subscribe-before-hdml-io race closes. `bubbles`/`composed` so
   * it crosses any shadow boundary a consumer sits behind. "Ready"
   * means ready to **receive** — not parsed/stored; the D4 gate then
   * handles satisfiability.
   *
   * @private
   */
  #announceReady = () => {
    document.dispatchEvent(
      new CustomEvent(readConfig().readyEvent, {
        bubbles: true,
        composed: true,
      }),
    );
  };

  /**
   * Sends the properties to the worker. Called by the
   * `attributeChangedCallback` method.
   *
   * @private
   */
  #sendProps = throdeb.debounce(5, () => {
    this.#endpoint?.postMessage({
      type: "props",
      data: {
        host: this.host,
        tenant: this.tenant,
        mode: this.mode,
        token: this.token,
        // The D8 shared config, read lazily (§5.8): only the D4 gate
        // backstop is forwarded — a worker has no `window`.
        config: {
          queryReadyTimeout: readConfig().queryReadyTimeout,
        },
      },
    });
  });

  /**
   * Runs one step of the OIDC auto-trigger state machine (§3.3, B5):
   * compute the pure {@link nextAuthAction} from URL + attributes,
   * then apply its effect. The reentrancy guard makes exactly one
   * navigation possible per document.
   *
   * @private
   */
  #runAuth = (): void => {
    if (this.#navigating) {
      return;
    }
    const action = nextAuthAction({
      href: nav.href(),
      search: nav.search(),
      host: this.host ?? "",
      tenant: this.tenant ?? "",
      mode: this.mode,
      token: this.token,
    });
    switch (action.kind) {
      case "exchange":
        void this.#runExchange(action.code, action.state);
        break;
      case "redeem":
        // `props` already forwards the handoff `token`; the worker
        // redeems it (Step 02). Nudge in case this fired first.
        this.#sendProps();
        break;
      case "navigate":
        this.#navigating = true;
        nav.navigate(action.url);
        break;
      case "auth-error":
        // A non-recoverable IdP error (e.g. `access_denied`, or a
        // silent-auth failure that already fell back). Strip it off
        // the URL so a reload does not re-surface it, and log once —
        // no retry.
        nav.strip(originPathname(nav.href()));
        console.error("hdml-io oidc error:", action.error);
        break;
      case "inert":
        break;
    }
  };

  /**
   * Runs the OIDC code→token exchange on the **main thread** (§3.3).
   * It must run main-side, not in the worker: the IIFE build's worker
   * is inlined from a `blob:` URL, whose `fetch` carries `Origin:
   * null` — which a cross-origin HDIO server's CORS rejects, so a
   * worker-side callback never completes. On success the minted
   * `{access, refresh}` pair is the only token data handed to the
   * worker (`oidc-tokens`, held in memory there for the authed
   * document/query requests) and `?code&state` is stripped; a spent
   * `state` (401) restarts at the IdP; any other failure surfaces
   * once. The reentrancy guard still permits exactly one navigation.
   *
   * @param code - The `code` query param the IdP returned.
   * @param state - The single-use `state` query param.
   * @private
   */
  #runExchange = async (
    code: string,
    state: string,
  ): Promise<void> => {
    const result = await exchangeCode(
      this.host ?? "",
      this.tenant ?? "",
      code,
      state,
    );
    if (result.status === "ok") {
      this.#endpoint?.postMessage({
        type: "oidc-tokens",
        data: { access: result.access, refresh: result.refresh },
      });
      nav.strip(originPathname(nav.href()));
      return;
    }
    if (result.status === "stale") {
      this.#navigating = true;
      nav.navigate(
        loginUrl(this.host ?? "", this.tenant ?? "", nav.href()),
      );
      return;
    }
    console.error("hdml-io auth failed:", result.detail);
  };

  /**
   * Debounced entry to the state machine (§3.3), mirroring
   * `#sendProps` so the `mode`/`token` attribute flurry collapses to
   * one run.
   *
   * @private
   */
  #scheduleAuth = throdeb.debounce(5, () => {
    this.#runAuth();
  });

  /**
   * Listens for `hdom-changed` events. Called by the
   * `connectedCallback` method.
   *
   * @private
   */
  #listenHdomChanges = () => {
    document.addEventListener("hdom-changed", this.#sendHtml);
  };

  /**
   * Unlistens for `hdom-changed` events. Called by the
   * `disconnectedCallback` method.
   *
   * @private
   */
  #unlistenHdomChanges = () => {
    document.removeEventListener("hdom-changed", this.#sendHtml);
  };

  /**
   * Sends the HTML to the worker. Called by the `#listenHdomChanges`
   * and `#unlistenHdomChanges` methods.
   *
   * @private
   */
  #sendHtml = throdeb.debounce(5, () => {
    let connections: string = "";
    let models: string = "";
    let frames: string = "";
    document.querySelectorAll("hdml-connection").forEach((elm) => {
      connections = connections + `${elm.outerHTML}\n`;
    });
    document.querySelectorAll("hdml-model").forEach((elm) => {
      models = models + `${elm.outerHTML}\n`;
    });
    document.querySelectorAll("hdml-frame").forEach((elm) => {
      frames = frames + `${elm.outerHTML}\n`;
    });
    this.#endpoint?.postMessage({
      type: "html",
      data: {
        html: `${connections}${models}${frames}`,
      },
    });
  });

  /**
   * @override
   */
  public connectedCallback(): void {
    super.connectedCallback();
    this.#enableMessagable();
    this.#listenHdomChanges();
    this.#listenRequests();
    this.#scheduleAuth();
    // Announce last: the endpoint + request listener are wired, so a
    // consumer's re-dispatch on `hdml-io-ready` is answered (D8).
    this.#announceReady();
  }

  /**
   * @override
   */
  public attributeChangedCallback(
    name: string,
    old: string,
    value: string,
  ): void {
    super.attributeChangedCallback(name, old, value);
    this.#sendProps();
    if (name === "mode" || name === "token") {
      this.#scheduleAuth();
    }
  }

  /**
   * @override
   */
  public disconnectedCallback(): void {
    this.#unlistenHdomChanges();
    this.#unlistenRequests();
    this.#disableMessagable();
    // The endpoint (and the worker + tokens, B4) is gone; drop the
    // now-orphaned subscriptions so a reconnect starts clean.
    this.#subscriptions.clear();
    super.disconnectedCallback();
  }

  /**
   * @internal
   */
  public render(): TemplateResult<1> {
    return html`<slot></slot>`;
  }
}
