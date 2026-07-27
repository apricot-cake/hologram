// makeCallbackBridge — the shared imperative→declarative "callback bridge" behind
// the popover models whose payloads carry CALLBACKS (onPick/onApply/onManage/…),
// which is why they can't live in the serializable hologramStore. Each bridge holds the
// CURRENT rendered model + a subscriber set; open() replaces the model and stamps a
// monotonic openId (the island keys its React root on it, so re-opening — even onto the
// same node, or after a pick — remounts and resets local input state); close() clears;
// get()/subscribe() drive the island's useSyncExternalStore.
//
// Consolidates the byte-identical subscribe/notify/openId boilerplate that qf-pop.ts
// and filter-popover.ts each hand-rolled. menu.ts/kind-menu.ts are intentionally NOT
// folded here — they carry extra behavior (menu.pick() stay-open routing; kind-menu's
// open signature) that this minimal shape doesn't cover. A real ES module (named
// export), imported directly by qf-pop.ts / filter-popover.ts.

interface CallbackBridge<T extends { openId: number }> {
  /** Replaces the model and stamps a fresh monotonic openId onto it. */
  open(model: Omit<T, 'openId'>): void;
  close(): void;
  get(): T | null;
  subscribe(cb: () => void): () => void;
}

export function makeCallbackBridge<T extends { openId: number }>(): CallbackBridge<T> {
  let current: T | null = null;
  let seq = 0;
  const subs = new Set<() => void>();
  const notify = () => {
    for (const cb of [...subs]) {
      try {
        cb();
      } catch (_e) {
        /* ignore */
      }
    }
  };
  return {
    open(model) {
      current = { ...(model as object), openId: ++seq } as T;
      notify();
    },
    close() {
      if (current) {
        current = null;
        notify();
      }
    },
    get() {
      return current;
    }, // stable ref between changes (useSyncExternalStore)
    subscribe(cb) {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
  };
}
