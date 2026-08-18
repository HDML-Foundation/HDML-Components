/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The shared main-thread config that hdml-io **and** the separate
 * consumer repo both read (RFC 014/001 §8, D8) — the one sync point
 * that keeps the discovery-bus event names and the D4 backstop in
 * step by construction. A host may set `window.HDML_CONFIG` before
 * or after importing this package; {@link readConfig} reads it lazily
 * and fills the settled defaults.
 */
export interface HdmlConfig {
  /**
   * D4 stored-gate backstop in ms, forwarded to the worker via
   * `props.config` (§5.4). Default `10000`.
   */
  queryReadyTimeout?: number;

  /**
   * The readiness event hdml-io announces on `document` when it is
   * ready to receive subscriptions (§5.8). Default `"hdml-io-ready"`.
   */
  readyEvent?: string;

  /**
   * The subscription-request event hdml-io listens for on `document`
   * (§5.8). Default `"hdml-io-request"`.
   */
  requestEvent?: string;

  /**
   * The provider-loss event hdml-io announces on `document` at
   * disconnect (§7.5 delta 7): the endpoint is gone, its generation
   * space has ended, and a consumer returns to `:state(loading)`
   * awaiting the next {@link HdmlConfig.readyEvent}. Default
   * `"hdml-io-gone"`.
   */
  goneEvent?: string;

  /**
   * Forces the `MutationObserver` fallback on for every view,
   * regardless of the W5 transition-sentinel auto-detection (§5.6).
   * Default `false`. Its **reader is `hdml-view`**, not `hdml-io`; it
   * lands here because `HdmlConfig` is the one type both repos read,
   * and a key added only when its reader arrives makes the contract
   * untestable meanwhile.
   */
  paranoidObserver?: boolean;
}

declare global {
  interface Window {
    HDML_CONFIG?: HdmlConfig;
  }
}

/**
 * The settled defaults (§8) — both repos read these effective values,
 * so only a consumer-repo override is co-designed.
 */
const DEFAULTS: Required<HdmlConfig> = {
  queryReadyTimeout: 10000,
  readyEvent: "hdml-io-ready",
  requestEvent: "hdml-io-request",
  goneEvent: "hdml-io-gone",
  paranoidObserver: false,
};

/**
 * Reads `window.HDML_CONFIG` and applies the settled defaults (§8).
 * Read at each use so a host that sets the global **after** import is
 * still honoured. An invalid `queryReadyTimeout` (non-number or ≤ 0)
 * falls back to the default; an empty event-name string does too.
 *
 * `paranoidObserver` is read `=== true`, **not** through the `||`
 * fallback the string keys use: `cfg.paranoidObserver || false` would
 * silently accept a host's `"false"` string as `true`.
 *
 * @returns The effective config with every field present.
 */
export function readConfig(): Required<HdmlConfig> {
  const cfg =
    typeof window !== "undefined" ? window.HDML_CONFIG : undefined;
  if (!cfg) {
    return { ...DEFAULTS };
  }
  const timeout =
    typeof cfg.queryReadyTimeout === "number" &&
    cfg.queryReadyTimeout > 0
      ? cfg.queryReadyTimeout
      : DEFAULTS.queryReadyTimeout;
  return {
    queryReadyTimeout: timeout,
    readyEvent: cfg.readyEvent || DEFAULTS.readyEvent,
    requestEvent: cfg.requestEvent || DEFAULTS.requestEvent,
    goneEvent: cfg.goneEvent || DEFAULTS.goneEvent,
    paranoidObserver: cfg.paranoidObserver === true,
  };
}
