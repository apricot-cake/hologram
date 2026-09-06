let open_ = false;
let requestedSection_: string | null = null;
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

export function open(section?: string): void {
  requestedSection_ = typeof section === 'string' && section ? section : null;
  set(true);
}

export function requestedSection(): string | null {
  return requestedSection_;
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
