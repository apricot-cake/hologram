// Backup-status-rail bridge — the imperative→declarative bridge for #mirrorStatus (the
// always-visible sidebar footer that shows the auto-backup state). viewer.js keeps ALL
// state derivation (backup config + last result + syncing flag → the model) inside
// setupMirrorStatusRail; the React island renders the glyph + text and owns the host's
// className/title. No callbacks (same shape as the selection-bar bridge).
//
// model: see viewer.js's updateMirrorStatus() —
//   null (hidden) | { kind:'syncing'|'error'|'done', text, title, time? }
// Plain IIFE on window (like store.js); loaded BEFORE viewer.js.
(function () {
  'use strict';
  let current: CorpusMirrorModel | null = null;
  const subs = new Set<() => void>();
  window.corpusMirror = {
    render(model) {
      current = model || null;
      for (const cb of [...subs]) {
        try {
          cb();
        } catch (_e) {
          /* ignore */
        }
      }
    },
    get() {
      return current;
    },
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
})();
