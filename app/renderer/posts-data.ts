// Subscribable posts data service — the "allPosts changed" choke
// point other services/islands can subscribe to, instead of only reaching allPosts
// via a viewer.js push. allPosts ITSELF stays a viewer.js `let` (44 read sites
// across the listing/grouping/filter pipeline — a full ownership move is out of
// scope and unnecessary risk here); this mirrors the same shape users.js/tags.js
// already use for allPosts — an INJECTED getter closure pointing at viewer's own
// state, not a service that owns it. get() returns the CURRENT reference (fresh
// array on add/remove, same reference on an in-place edit — content-only changes,
// e.g. a tag edit, don't need a new array for consumers that just want to know
// "something changed, re-read"); sync() is called from markPostsMutated(), the
// pre-existing single choke point for every allPosts mutation (see viewer.ts). A
// real ES module (named exports), imported directly by its consumers
// (viewer.ts / sidebar.ts / image-tab.ts).
let posts: HologramPost[] = [];
let generation = 0;
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
export function get(): HologramPost[] {
  return posts;
}
export function sync(next: HologramPost[]): void {
  posts = next;
  generation++;
  notify();
}
export function getGeneration(): number {
  return generation;
}
export function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}
