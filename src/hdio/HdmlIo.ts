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

/**
 * The `hdml-io` component.
 *
 * @tagname hdml-io
 *
 * @attribute {string} host
 * @attribute {string} tenant
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
  token: null | string = null;

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
   * Slice A scaffold — assigning it also **starts** the fallback
   * `port1` so later `result` / `auth` messages can arrive; B/D flesh
   * out the routing.
   *
   * @private
   */
  #onMessage = (): void => {
    // Slice A: no inbound routing yet (props/html never reply).
    // Wired by later steps (result/auth/error, RFC §2.5).
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
        token: this.token,
      },
    });
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
