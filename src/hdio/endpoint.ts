/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { createHandler } from "./onmessage";

/**
 * The message endpoint the element talks to. In the esm/cjs builds
 * this checked-in fallback form is used — a same-thread `MessagePort`
 * (RFC §2.3). In the IIFE (`bin`) build the esbuild plugin swaps this
 * whole module for a `Worker`-spawning form (RFC §2.2, A2), so the
 * element never branches on the build. Both `Worker` and
 * `MessagePort` satisfy `postMessage` / `onmessage`.
 */
export type Endpoint = Worker | MessagePort;

/**
 * Creates the fallback endpoint (A1, RFC §2.3): a private
 * `MessageChannel` whose `port2` runs the handler and whose `port1`
 * is returned to the element. No global slot is touched — nothing
 * off-page can reach it (the pre-Slice-A `globalThis.self` path
 * hijacked `window.onmessage`). This is a correctness/isolation fix,
 * not parallelism: the fallback still parses on the main thread.
 *
 * The one gotcha: a port delivers nothing until started. Assigning
 * `port2.onmessage` starts it implicitly; `addEventListener` would
 * need `port2.start()` — use `.onmessage`.
 *
 * @returns The `port1` `MessagePort` the element owns.
 */
export function createEndpoint(): Endpoint {
  const { port1, port2 } = new MessageChannel();
  const handler = createHandler((msg, transfer) =>
    port2.postMessage(msg, transfer ?? []),
  );
  port2.onmessage = handler;
  return port1;
}

/**
 * Tears down an endpoint: terminate a `Worker`, close a `MessagePort`
 * (here, the element's `port1`).
 *
 * @param ep - The endpoint to close.
 */
export function closeEndpoint(ep: Endpoint): void {
  if (ep instanceof Worker) {
    ep.terminate();
  } else {
    ep.close();
  }
}
