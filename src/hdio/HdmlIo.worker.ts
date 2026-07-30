/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { createHandler } from "./onmessage";

/**
 * A narrow view of the dedicated-worker global. The workspace
 * tsconfig ships the `DOM` lib (not `WebWorker`), so `self` is typed
 * as a `Window` whose `postMessage` wants a `targetOrigin`; this
 * structural type exposes the worker-scope `postMessage(msg,
 * transfer)` overload the A4 transfer list needs (RFC §2.6).
 */
interface WorkerScope {
  onmessage: ((ev: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

/**
 * The real worker entry — the only file that touches `self` (A3, RFC
 * §2.4). The `post` sink is `self.postMessage` in transfer-list form
 * (A4). In the IIFE build the esbuild plugin bundles this file into
 * the `endpoint.js` replacement (RFC §2.2); in esm/cjs it is
 * unreferenced (the fallback wires the handler onto a `MessagePort`).
 */
const scope = self as unknown as WorkerScope;

scope.onmessage = createHandler((msg, transfer) =>
  scope.postMessage(msg, transfer ?? []),
);
