/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * Interaction and the outward-event queue (RFC 016/001 §5.7, §5.11,
 * R10, R31, R37).
 *
 * Two things live here, and they are deliberately not the same
 * mechanism. **Proxied pointer events are synchronous** with the
 * platform event that caused them — a host app's tooltip must not
 * lag a frame behind the cursor. **The four named `hdml-*` events
 * are queued and dispatched after PAINT** (§5.11), because a
 * listener is entitled to mutate the DOM and a mutation inside a
 * phase corrupts the pass in flight.
 *
 * The view installs **one** delegated listener (R10). Identity is
 * therefore the event target: the proxied event is dispatched *from
 * the widget under the pointer*, so a container child is named by
 * being a real element and there is no `series` field (SPEC §10).
 *
 * @module hdvl/events
 */

import type { Hit } from "./renderer";
import { HdvlElement, writeState } from "./base";

/** SPEC §10's four named events. */
export const HDML_DATA = "hdml-data";
/** Produced by a scale at step 18; named here so the set is whole. */
export const HDML_SCALE_CHANGE = "hdml-scale-change";
export const HDML_RENDER = "hdml-render";
export const HDML_ERROR = "hdml-error";

/**
 * The pointer types the view proxies.
 *
 * SPEC §10 says "proxied pointer events" without enumerating them,
 * and §5.7's listener switches on `e.type`, so the set is a runtime
 * choice. This is the minimal one that carries every interaction
 * SPEC §12 hands to a host app: `pointermove` for tooltips and
 * hover, `pointerdown`/`pointerup` for selection and brush, and
 * `pointercancel` so a host app can tear a gesture down. Every one
 * of them bubbles, which is what makes a single delegated listener
 * possible — and what makes {@link HdmlPointerEvent}'s fence
 * mandatory.
 */
export const POINTER_TYPES: readonly string[] = [
  "pointermove",
  "pointerdown",
  "pointerup",
  "pointercancel",
];

/** {@link HdmlPointerEvent}'s init. */
export interface HdmlPointerEventInit extends PointerEventInit {
  index: number;
  datum?: Readonly<Record<string, unknown>> | null;
}

/**
 * A proxied pointer event (§5.7, R31).
 *
 * **`index` and `datum` are own properties, never `detail`.**
 * `UIEvent.detail` is a `long`: `new PointerEvent("pointerdown",
 * {detail: {index: 3}}).detail` is `0` on all three engines
 * (measured), so the earlier `CustomEvent`-with-`detail` contract
 * was literally unimplementable. A `CustomEvent` would also throw
 * away `clientX`, `buttons` and `pointerType` — the whole point of
 * proxying a *pointer* event.
 *
 * It stays a real `PointerEvent`, so `e instanceof PointerEvent`
 * holds and a host app's existing pointer handling keeps working
 * and simply gains two properties.
 */
export class HdmlPointerEvent extends PointerEvent {
  public readonly index: number;

  public readonly datum: Readonly<Record<string, unknown>> | null;

  public constructor(type: string, init: HdmlPointerEventInit) {
    super(type, init);
    this.index = init.index;
    this.datum = init.datum ?? null;
  }
}

/** A widget that can name the row a hit came from (§5.7). */
export interface DatumSource {
  /**
   * The source row **restricted to this widget's bound channels**,
   * in data space, pre-projection. It cannot be the full row: the
   * query union only ever fetches bound columns.
   */
  datumAt(index: number): Readonly<Record<string, unknown>> | null;
}

/** What the pointer path asks of the view (§5.7). */
export interface PointerHost {
  /**
   * The surface's rect, in viewport coordinates. Read **fresh per
   * event**, never cached — scrolling and zoom both move it.
   */
  rect(): DOMRect | null;
  /** The renderer's hit test, in view-local CSS px (§2.7). */
  resolve(x: number, y: number): Hit | null;
  /** `uid` → element: a read of the resolution index. */
  widget(uid: string): HdvlElement | null;
}

/** The view's half of §5.7. */
export interface PointerBridge {
  /** The delegated listener. */
  handle(e: Event): void;
  /** Drops `:state(hover)`, if any element carries it. */
  clear(): void;
  /** The element currently under the pointer, or `null`. */
  readonly hovered: HdvlElement | null;
}

/** One queued outward event. */
interface Queued {
  target: EventTarget;
  event: Event;
}

/**
 * The after-PAINT dispatch queue (§5.11).
 *
 * Collected during the frame, dispatched once the frame is over.
 * A listener that queues *more* events during the drain is served
 * by the next frame, never by this one — which is what keeps the
 * drain finite.
 */
export interface EventQueue {
  push(target: EventTarget, event: Event): void;
  flush(): void;
  clear(): void;
  readonly size: number;
}

/**
 * Builds an {@link EventQueue}.
 *
 * @returns An empty queue.
 */
export function createEventQueue(): EventQueue {
  let pending: Queued[] = [];
  return {
    push(target: EventTarget, event: Event): void {
      pending.push({ target, event });
    },
    flush(): void {
      const batch = pending;
      pending = [];
      for (const item of batch) {
        item.target.dispatchEvent(item.event);
      }
    },
    clear(): void {
      pending = [];
    },
    get size(): number {
      return pending.length;
    },
  };
}

/**
 * One of SPEC §10's four named events — a real `CustomEvent`,
 * `bubbles` + `composed`.
 *
 * @param type - The event name.
 * @param detail - Its detail, or `null` where SPEC defines none.
 * @returns The event, ready to queue.
 */
export function outward(
  type: string,
  detail: unknown = null,
): CustomEvent<unknown> {
  return new CustomEvent(type, {
    bubbles: true,
    composed: true,
    detail,
  });
}

/** Every pointer field a host app may read, copied across. */
function initFrom(e: PointerEvent): PointerEventInit {
  return {
    cancelable: e.cancelable,
    clientX: e.clientX,
    clientY: e.clientY,
    screenX: e.screenX,
    screenY: e.screenY,
    button: e.button,
    buttons: e.buttons,
    altKey: e.altKey,
    ctrlKey: e.ctrlKey,
    metaKey: e.metaKey,
    shiftKey: e.shiftKey,
    pointerId: e.pointerId,
    pointerType: e.pointerType,
    isPrimary: e.isPrimary,
    width: e.width,
    height: e.height,
    pressure: e.pressure,
    tangentialPressure: e.tangentialPressure,
    tiltX: e.tiltX,
    tiltY: e.tiltY,
    twist: e.twist,
  };
}

/** Duck-typed: a mark gains `datumAt` when it gains data. */
function datumOf(
  el: HdvlElement,
  index: number,
): Readonly<Record<string, unknown>> | null {
  const src = <Partial<DatumSource>>(<unknown>el);
  return typeof src.datumAt === "function"
    ? src.datumAt(index)
    : null;
}

/**
 * Builds the view's single delegated pointer listener (§5.7).
 *
 * @param host - The view's own seams.
 * @returns The bridge.
 */
export function createPointerBridge(
  host: PointerHost,
): PointerBridge {
  let hovered: HdvlElement | null = null;

  const hover = (next: HdvlElement | null): void => {
    if (hovered === next) {
      return;
    }
    if (hovered !== null) {
      writeState(hovered, "hover", false);
    }
    hovered = next;
    if (next !== null) {
      // §5.7: this may change a property the author transitioned,
      // which fires `transitionrun` → one more frame. That
      // converges and is benign — hit resolution runs on pointer
      // events, not on frames, so the second frame reaches the
      // same verdict and stops. Do not "fix" it.
      writeState(next, "hover", true);
    }
  };

  const handle = (raw: Event): void => {
    // THE PROXY FENCE — mandatory (R37). SPEC §10 requires
    // `bubbles` AND `composed`, so the event dispatched below from
    // a DESCENDANT of the view bubbles straight back into this
    // listener. Without the fence one native pointermove re-enters
    // until the stack runs out.
    //
    // Two alternatives are rejected and must stay rejected:
    // `bubbles: false` violates SPEC §10 and breaks a host app
    // listening on an ancestor; `e.isTrusted` is test-hostile,
    // because a script-dispatched PointerEvent is untrusted, so
    // every synthetic-interaction test would be silently ignored
    // while appearing to pass.
    if (raw instanceof HdmlPointerEvent) {
      return;
    }
    const e = <PointerEvent>raw;
    const r = host.rect();
    if (r === null) {
      hover(null);
      return;
    }
    // `resolve()` takes VIEW-LOCAL CSS px — the scene's own
    // coordinate space (§2.7). The renderer converts back to the
    // viewport for `elementFromPoint`; that conversion is its
    // business and never leaks out here.
    const hit = host.resolve(e.clientX - r.left, e.clientY - r.top);
    const widget = hit === null ? null : host.widget(hit.widget);
    if (hit === null || widget === null) {
      hover(null);
      return;
    }
    hover(widget);
    // The native event is NOT stopped: a host app sees both, and
    // tells them apart by class.
    widget.dispatchEvent(
      new HdmlPointerEvent(e.type, {
        ...initFrom(e),
        bubbles: true,
        composed: true,
        index: hit.index,
        datum: datumOf(widget, hit.index),
      }),
    );
  };

  return {
    handle,
    clear: (): void => {
      hover(null);
    },
    get hovered(): HdvlElement | null {
      return hovered;
    },
  };
}
