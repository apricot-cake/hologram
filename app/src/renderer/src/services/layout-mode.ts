// Window-width layout mode (#259) — the ONE place that knows the breakpoint.
//
// #243 removed every width-driven reshape, and the cleanup had to hunt down width
// knowledge scattered across media queries and JS (an outside-click handler gated
// itself with its own `max-width: 1279px`, which is exactly the kind of stray copy
// that gets missed). Bringing width-linked presentation back, the number lives here
// and nowhere else: CSS keys off classes React derives from this store, not off its
// own media queries.
//
// What this decides is only the FORM a panel takes when it is open — never whether
// it is open. That stays the user's toggle (#243's actual principle, unchanged).
//
// 1280 with the boundary on the wide side: a 2560px display split in half lands
// exactly on 1280, and that half is wide enough to hold both panels plus a usable
// grid. A 1920 display's half (960) falls to the narrow side, which is the case
// that motivated the issue — 256 + 320 of panel against 382 of content.
export const WIDE_MIN_PX = 1280;

const query = `(min-width: ${WIDE_MIN_PX}px)`;
const mql = typeof matchMedia === 'function' ? matchMedia(query) : null;

let wide = mql ? mql.matches : true;
const subs = new Set<() => void>();

mql?.addEventListener('change', (e) => {
  if (e.matches === wide) return;
  wide = e.matches;
  for (const cb of [...subs]) {
    try {
      cb();
    } catch (_e) {
      /* ignore */
    }
  }
});

/** True while both side panels fit beside a usable grid. */
export function isWide(): boolean {
  return wide;
}

export function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}
