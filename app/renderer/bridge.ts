// makeCallbackBridge — the shared imperative→declarative "callback bridge" behind
// the popover models whose payloads carry CALLBACKS (onPick/onApply/onManage/…),
// which is why they can't live in the serializable window.corpusStore. Each bridge
// holds the CURRENT rendered model + a subscriber set; open() replaces the model and
// stamps a monotonic openId (the island keys its React root on it, so re-opening —
// even onto the same node, or after a pick — remounts and resets local input state);
// close() clears; get()/subscribe() drive the island's useSyncExternalStore.
//
// Consolidates the byte-identical subscribe/notify/openId boilerplate that qf-pop.js
// and filter-popover.js each hand-rolled. menu.js/kind-menu.js are intentionally NOT
// folded here — they carry extra behavior (menu.pick() stay-open routing; kind-menu's
// open signature) that this minimal shape doesn't cover. Plain IIFE on window (like
// store.js); loaded BEFORE its consumers.
(function () {
  'use strict';
  function makeCallbackBridge(name?: string): CorpusCallbackBridge {
    let current: { openId: number; [k: string]: any } | null = null;
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
    const api = {
      open(model: { [k: string]: any }) {
        current = { ...model, openId: ++seq };
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
      subscribe(cb: () => void) {
        subs.add(cb);
        return () => subs.delete(cb);
      },
    };
    if (name) (window as any)[name] = api;
    return api;
  }
  window.corpusMakeBridge = makeCallbackBridge;
})();
