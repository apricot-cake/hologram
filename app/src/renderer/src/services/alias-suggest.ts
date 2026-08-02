// Poster-alias candidate suggestion — #23 St2's decision-free ranking of WHICH
// posters likely name the same author/account, so a caller (future UI wiring)
// can offer them as a merge suggestion without ever merging on its own
// ("自動候補提案...自動マージはせず提案のみ" — 2026-07-11 design, reaffirmed by
// the issue's stage-2 title itself: "決定的ルールの重み付け：ハンドル完全一致＞
// displayName正規化一致＞類似").
//
// Pure logic, no side effects, no IPC — mirrors this issue's own header note on
// services/aliases.ts ("自動候補（段階②）は副作用を持たない純ロジックとして
// alias-suggest.ts に分離＝ユニットで回せる"). Callers pass already-FOLDED
// posters (one entry per existing alias group, e.g. namedPosters()'s
// HologramUserAgg[] — poster-grid-builder.ts's openAliasPicker() already excludes
// the "(unknown)" bucket the same way) so two members of an existing group never
// appear as two separate entries here; there is deliberately no separate
// resolve()/membersOf() plumbing in this module for that reason.
//
// Scope note (2026-08-02, #23 St2 round): this file lands the ranking algorithm
// only. It does not yet persist "却下" (dismiss) decisions — the isDismissed
// hook below is the extension point a future round wires up to a real
// dismissed-list (services/aliases.ts's own 2026-07 header note reserves that
// list for "this round", but doing it properly needs a new DB table + IPC +
// preload + ZIP export/import wiring, the same "6点セット" #23's St1 implementation
// note describes for poster-aliases.json — out of scope for a pure-logic-only
// slice). UI surfacing (an inspector affordance, a confirmation queue) is #23's
// stage ③ ("候補強化・確認キュー") and also not part of this file.

import { normalize } from './search.ts';
import { distance } from 'fastest-levenshtein';

export type AliasSuggestReason = 'handle' | 'displayName' | 'similar';

/** The subset of HologramUserAgg this module actually reads — kept as its own
 * local shape (rather than importing the ambient HologramUserAgg type) so this
 * file stays a plain, dependency-free module callers can unit-test in isolation. */
export interface AliasSuggestPoster {
  key: string;
  screenName: string;
  displayName: string;
}

export interface AliasSuggestPair {
  /** The two posters, ordered so the same pair always produces the same a/b
   * regardless of which order the caller's list had them in (string-sorted). */
  a: string;
  b: string;
  reason: AliasSuggestReason;
}

export interface AliasSuggestOptions {
  /** Reject-and-remember hook (#23 St2 design: "却下は dismissed に永続"). Not
   * backed by real storage in this file yet — see the header note above.
   * Defaults to "nothing is dismissed". */
  isDismissed?(a: string, b: string): boolean;
  /** Minimum normalized similarity (0..1, 1 = identical) for the 'similar' tier.
   * No canonical value exists for this — it is a tuning knob calibrated against
   * a real library's actual handles/display names, not a settled product
   * constant. 0.82 is a starting guess (tolerates a couple of edits on a
   * typical handle/display-name length) pending that calibration. */
  similarityThreshold?: number;
}

const DEFAULT_SIMILARITY_THRESHOLD = 0.82;
// Below this normalized length, edit-distance ratios are too noisy to mean
// anything ("ai" vs "bi" is already a 50% "similarity") — both tokenized ends
// of a candidate pair must clear this before the 'similar' tier considers them.
const MIN_SIMILAR_LEN = 3;

// screenName ("handle") normalization reuses search.ts's app-wide glyph rules
// (NFKC full/half-width, katakana→hiragana, lowercasing) and additionally
// drops a leading '@' — handles are stored/displayed with or without it
// inconsistently across platforms/UI, so it carries no matching signal.
function normHandle(s: string): string {
  const n = normalize(s);
  return n.startsWith('@') ? n.slice(1) : n;
}

function pairKeyOf(a: string, b: string): readonly [string, string] {
  return a < b ? [a, b] : [b, a];
}

// 1 = identical, 0 = maximally different (edit distance == longer string's length).
function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 0; // both empty — callers already gate on MIN_SIMILAR_LEN before calling this
  return 1 - distance(a, b) / maxLen;
}

// Cheap pre-filter before paying for an actual levenshtein call: distance(a,b)
// can never be smaller than the two strings' length difference, so
// similarity(a,b) can never exceed 1 - |lenA-lenB|/max(lenA,lenB). When even
// THAT best case falls short of the threshold, the real distance() call is
// skipped entirely.
function couldMeetThreshold(lenA: number, lenB: number, threshold: number): boolean {
  const maxLen = Math.max(lenA, lenB);
  return maxLen > 0 && Math.abs(lenA - lenB) <= (1 - threshold) * maxLen;
}

/**
 * Every candidate pair across `posters`, each tagged with the STRONGEST tier it
 * matched under (a pair that matches both the handle and the displayName rule
 * is reported once, as 'handle'). Order within the returned array is not
 * significant — callers sort/group by `reason` themselves.
 */
export function suggestPairs(posters: readonly AliasSuggestPoster[], opts: AliasSuggestOptions = {}): AliasSuggestPair[] {
  const isDismissed = opts.isDismissed ?? (() => false);
  const threshold = opts.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;

  // Defensive de-dup: a caller accidentally passing the same key twice would
  // otherwise self-pair (emit() below already skips a===b, but two distinct
  // array entries sharing a key would still slip through as "different").
  const seenKeys = new Set<string>();
  const list = posters.filter((p) => {
    if (seenKeys.has(p.key)) return false;
    seenKeys.add(p.key);
    return true;
  });

  // Pairs already emitted at a stronger tier (or explicitly dismissed) — a
  // weaker tier below must not re-surface either case.
  const claimed = new Set<string>();
  const out: AliasSuggestPair[] = [];

  function emit(x: AliasSuggestPoster, y: AliasSuggestPoster, reason: AliasSuggestReason) {
    if (x.key === y.key) return;
    const [a, b] = pairKeyOf(x.key, y.key);
    const id = a + '\0' + b;
    if (claimed.has(id)) return;
    claimed.add(id);
    if (isDismissed(a, b)) return;
    out.push({ a, b, reason });
  }

  // Tier 1: handle exact match.
  const byHandle = new Map<string, AliasSuggestPoster[]>();
  for (const p of list) {
    const h = normHandle(p.screenName);
    if (!h) continue;
    let bucket = byHandle.get(h);
    if (!bucket) byHandle.set(h, (bucket = []));
    bucket.push(p);
  }
  for (const bucket of byHandle.values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) emit(bucket[i], bucket[j], 'handle');
    }
  }

  // Tier 2: displayName normalized exact match.
  const byDisplay = new Map<string, AliasSuggestPoster[]>();
  for (const p of list) {
    const d = normalize(p.displayName);
    if (!d) continue;
    let bucket = byDisplay.get(d);
    if (!bucket) byDisplay.set(d, (bucket = []));
    bucket.push(p);
  }
  for (const bucket of byDisplay.values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) emit(bucket[i], bucket[j], 'displayName');
    }
  }

  // Tier 3: similar — edit-distance ratio over EITHER normalized field (best of
  // the two), for whichever pairs tiers 1/2 above didn't already claim. O(n²)
  // pairs, but this runs on demand (not a hot render-loop path — same
  // "computed when the suggestion surface is opened" cadence as the manual
  // picker's candidate list), and the length-difference short-circuit below
  // (distance(a,b) can never be smaller than |len(a)-len(b)|) skips the
  // levenshtein call entirely for pairs the threshold could never accept.
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const x = list[i];
      const y = list[j];
      const [a, b] = pairKeyOf(x.key, y.key);
      if (claimed.has(a + '\0' + b)) continue;

      const hx = normHandle(x.screenName);
      const hy = normHandle(y.screenName);
      const dx = normalize(x.displayName);
      const dy = normalize(y.displayName);

      let best = 0;
      if (hx.length >= MIN_SIMILAR_LEN && hy.length >= MIN_SIMILAR_LEN && couldMeetThreshold(hx.length, hy.length, threshold)) {
        best = Math.max(best, similarity(hx, hy));
      }
      if (dx.length >= MIN_SIMILAR_LEN && dy.length >= MIN_SIMILAR_LEN && couldMeetThreshold(dx.length, dy.length, threshold)) {
        best = Math.max(best, similarity(dx, dy));
      }
      if (best >= threshold) emit(x, y, 'similar');
    }
  }

  return out;
}

/** Convenience filter over suggestPairs() for a single subject poster (the
 * shape a per-poster UI affordance — e.g. an inspector suggestion row — would
 * actually consume; #23's confirmation queue (stage ③) would use suggestPairs()
 * directly instead). */
export function suggestionsFor(key: string, posters: readonly AliasSuggestPoster[], opts?: AliasSuggestOptions): AliasSuggestPair[] {
  return suggestPairs(posters, opts).filter((p) => p.a === key || p.b === key);
}
