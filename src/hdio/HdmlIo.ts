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
   * Routes the `auth` reply of the OIDC exchange (RFC §2.5, §3.3):
   * `ok` → strip `?code&state` and stay put; `stale` → the spent
   * `state` means start over at the IdP; `error` → surface once, no
   * loop. (`result` / `error` for the query leg are Slice D.)
   *
   * @private
   */
  #onMessage = (ev: MessageEvent): void => {
    const msg = ev.data as OutboundMessage;
    if (!msg || msg.type !== "auth") {
      return;
    }
    if (msg.data.ok) {
      nav.strip(originPathname(nav.href()));
      return;
    }
    if (msg.data.reason === "stale") {
      this.#navigating = true;
      nav.navigate(
        loginUrl(this.host ?? "", this.tenant ?? "", nav.href()),
      );
      return;
    }
    console.error("hdml-io auth failed:", msg.data.detail);
  };

  /**
   * Enables the endpoint. Called by the `connectedCallback` method.
   * Assigning `#endpoint.onmessage` starts the port (fallback) so
   * inbound messages are delivered.
   *
   * @private
   */
  #enableMessagable = () => {
    this.#endpoint = createEndpoint();
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
      closeEndpoint(this.#endpoint);
      this.#endpoint = null;
    }
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
        this.#endpoint?.postMessage({
          type: "oidc-callback",
          data: { code: action.code, state: action.state },
        });
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
      case "inert":
        break;
    }
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
    this.#scheduleAuth();
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
    this.#disableMessagable();
    super.disconnectedCallback();
  }

  /**
   * @internal
   */
  public render(): TemplateResult<1> {
    return html`<slot></slot>`;
  }
}
