/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */
import { LitElement, TemplateResult, html } from "lit";

export class HdqlElement extends LitElement {
  /**
   * @override
   */
  public connectedCallback(): void {
    super.connectedCallback();
    this.dispatchHdomChanges();
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
    this.dispatchHdomChanges();
  }

  /**
   * @override
   */
  public disconnectedCallback(): void {
    this.dispatchHdomChanges();
    super.disconnectedCallback();
  }

  /**
   * Dispatches `hdom-changed` event on the `document` element.
   */
  private dispatchHdomChanges(): void {
    document.dispatchEvent(
      new CustomEvent<HdqlElement>("hdom-changed", {
        cancelable: false,
        composed: false,
        bubbles: false,
        detail: this,
      }),
    );
  }

  public render(): TemplateResult<1> {
    return html`<slot></slot>`;
  }
}
