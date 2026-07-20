// Seeded shuffle ordering (#118) — the "random" post sort. The order is NOT a
// one-shot Fisher-Yates over the array: it is a pure function of (seed, record
// key), so the same seed reproduces the same order across re-sorts, incremental
// updates, virtualized re-renders and tab restores, and it never depends on the
// input order. Re-rolling means replacing the seed, nothing else.
//
// The seed rides in the per-tab snapshot (tabs-builder) so a restored tab shows
// the order it had. No dependencies — a pure module the listing pipeline imports
// directly (and the unit tests load standalone under Node).

// FNV-1a (32-bit). Small, dependency-free, and well spread over short ASCII keys,
// which is all the sort comparator needs — this is ordering, not cryptography.
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // h *= 16777619 in 32-bit space (Math.imul keeps it exact past 2^31).
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// The comparator key for one record under one seed.
export const shuffleRank = (seed: string, key: string): number => fnv1a(seed + '|' + key);

// A fresh seed. Any string works as long as picks differ; keep it short so it
// stays readable inside the persisted tab state.
export const newShuffleSeed = (): string => Math.random().toString(36).slice(2, 10);
