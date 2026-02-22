/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { throdeb } from "@hdml/common";
import { LitElement, TemplateResult, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import _script from "./HdmlIo.worker";

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
   * @private
   */
  #messagable: null | Window | Worker = null;

  /**
   * Enables the messagable. Called by the `connectedCallback` method.
   *
   * @private
   */
  #enableMessagable = () => {
    if (_script === "_script") {
      this.#messagable = globalThis.self;
    } else {
      const blob = new Blob([_script], { type: "text/javascript" });
      const url = URL.createObjectURL(blob);
      this.#messagable = new Worker(url);
      URL.revokeObjectURL(url);
    }
    this.#sendProps();
    this.#sendHtml();
  };

  /**
   * Disables the messagable. Called by the `disconnectedCallback`
   * method.
   *
   * @private
   */
  #disableMessagable = () => {
    if (_script === "_script") {
      this.#messagable = null;
    } else {
      (<Worker>this.#messagable).terminate();
    }
  };

  /**
   * Sends the properties to the worker. Called by the
   * `attributeChangedCallback` method.
   *
   * @private
   */
  #sendProps = throdeb.debounce(5, () => {
    this.#messagable?.postMessage({
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
    this.#messagable?.postMessage({
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
