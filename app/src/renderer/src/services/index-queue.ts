// Background-indexing progress, renderer side (#834, parent #98) — a store the
// toolbar indicator subscribes to.
//
// A store rather than per-component state because the shape is push-driven: main
// coalesces its own status changes and broadcasts them, so a component that
// polled would either miss the end of a run or ask for a value that has not
// moved. useSyncExternalStore over this is the same arrangement the triage count
// uses (services/triage-builder.ts).
import { hologramIpc } from './ipc.ts';
import type { IndexQueueStatus } from '../../../main/ipc-payloads.ts';

const IDLE: IndexQueueStatus = { active: false, paused: false, scanning: false, done: 0, total: 0, currentKind: null };

let status: IndexQueueStatus = IDLE;
const listeners = new Set<() => void>();
let attached = false;

function set(next: IndexQueueStatus) {
  status = next || IDLE;
  for (const cb of listeners) cb();
}

/**
 * Subscribes and, on the first subscriber, attaches to main's push and fetches
 * the current value once. The fetch matters on a reload mid-run: the push only
 * fires on a CHANGE, so a window that missed the last one would otherwise show
 * nothing until the next job finished.
 */
export function subscribeIndexQueue(cb: () => void): () => void {
  listeners.add(cb);
  if (!attached) {
    attached = true;
    hologramIpc.onIndexQueueProgress((s) => set(s));
    Promise.resolve(hologramIpc.getIndexQueueStatus())
      .then((s) => s && set(s))
      .catch(() => {
        /* main not answering — stay idle rather than showing a broken indicator */
      });
  }
  return () => listeners.delete(cb);
}

export function indexQueueStatus(): IndexQueueStatus {
  return status;
}

export function pauseIndexQueue() {
  return Promise.resolve(hologramIpc.pauseIndexQueue())
    .then((s) => s && set(s))
    .catch(() => {});
}

export function resumeIndexQueue() {
  return Promise.resolve(hologramIpc.resumeIndexQueue())
    .then((s) => s && set(s))
    .catch(() => {});
}
