// Settings modal open/closed state — extracted out of islands/settings/index.tsx
// (the other "true island-pinned global", alongside lightbox.ts) so
// orchestrator.ts and the *-builder.ts modules can import it directly
// instead of reading a global bridge. A real ES module: React stays the source of
// truth through useSyncExternalStore (islands/settings/index.tsx wires isOpen/subscribe
// into the OpenStore the settings App.tsx expects); the brand-bar gear (orchestrator.ts)
// and the various Esc/shortcut guards (*-builder.ts, image-tab/index.tsx) call open()/
// close()/isOpen() directly.

let open_ = false;
const subs = new Set<() => void>();

export function isOpen(): boolean {
  return open_;
}

function set(v: boolean) {
  const next = !!v;
  if (next === open_) return;
  open_ = next;
  for (const cb of [...subs]) cb();
}

export function open(): void {
  set(true);
}

export function close(): void {
  set(false);
}

export function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}
