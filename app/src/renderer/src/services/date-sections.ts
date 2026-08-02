// Month-section grouping for the post grid (#47) — pure bucketing over an
// ALREADY-SORTED array. Split out of post-grid-builder.ts the same way
// marquee.ts/zoom-anchor.ts are split from their React hosts: this runs against
// plain numbers, never the DOM or a masonic positioner, so it is unit-testable
// with plain arrays (scripts/date-sections.test.ts).
//
// Scope confirmed on the issue (2026-07-11 comment): section headers appear
// ONLY for the two date-based sorts (post date / captured date), keyed off
// whichever field that sort already orders by — there is no separate axis
// toggle. Engagement/random/name sorts never section.
//
// The "unknown date" bucket (ms <= 0 — the stampPost sentinel for a missing
// date) always lands in a TRAILING section regardless of sort direction. For
// date-asc that is a deliberate change to the underlying sort itself (see
// listing.ts) — pushing unknown-date records to the tail there is what keeps
// this module's job to plain contiguous grouping: it trusts its input is
// already in final display order and never re-sorts or special-cases an end.

/** Which precomputed timestamp field a sort buckets by, or null when that
 * sort has no date axis (engagement / random / name — no sectioning). */
export type DateSectionField = 'dateMs' | 'capturedMs' | null;

export function dateFieldForSort(sort: string): DateSectionField {
  if (sort === 'date-desc' || sort === 'date-asc') return 'dateMs';
  if (sort === 'captured-desc') return 'capturedMs';
  return null;
}

// One contiguous run of items sharing a calendar month (or the trailing
// "unknown date" run). `ms` is a representative timestamp for the bucket
// (the first item's) — the caller formats it into a locale label; this module
// stays free of Intl/i18n so it works the same under Node (scripts/*.test.ts)
// and the browser.
export interface DateSection {
  /** 'YYYY-M' (local calendar) for a real month, or 'unknown' for the sentinel bucket. */
  key: string;
  /** Representative ms for the bucket — 0 for 'unknown'. */
  ms: number;
  /** Index of this bucket's first item within the ORIGINAL flat `items` array passed in. */
  startIndex: number;
  count: number;
}

const monthKeyOf = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}`;
};

/**
 * Groups a pre-sorted array into contiguous month buckets. `msOf` reads the
 * bucketing timestamp off one item (already stamped by records.ts's
 * stampPost — this module never computes a date itself). A run only breaks
 * when the month key actually changes, so out-of-order input silently
 * produces extra (non-contiguous) buckets for the same month rather than
 * merging them back together — by design, since re-sorting here would hide a
 * caller bug instead of surfacing it.
 */
export function buildSections<T>(items: readonly T[], msOf: (item: T) => number): DateSection[] {
  const out: DateSection[] = [];
  let cur: DateSection | null = null;
  for (let i = 0; i < items.length; i++) {
    const ms = msOf(items[i]);
    const known = ms > 0;
    const key = known ? monthKeyOf(ms) : 'unknown';
    if (!cur || cur.key !== key) {
      cur = { key, ms: known ? ms : 0, startIndex: i, count: 0 };
      out.push(cur);
    }
    cur.count++;
  }
  return out;
}
