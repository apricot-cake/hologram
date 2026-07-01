'use strict';

// Prune-safety guard for the incremental mirror (added after the 2026-06-23
// library-loss incident). Pruning deletes mirror files that are missing from src
// — correct when the user really deleted posts, catastrophic when src is empty or
// decimated because config pointed at a wrong/empty folder (the exact failure that
// made the library vanish). In that case the mirror is the ONLY surviving copy and
// pruning would wipe it. The decision is pulled out as a pure function so it can be
// unit-tested without spinning up Electron.

// Skip the prune when src has fallen below this fraction of the last healthy run.
const PRUNE_SHRINK_RATIO = 0.5;

// Decide whether a mirror prune must be skipped.
//   srcCount  — files currently in the source library
//   destCount — files currently in the mirror (nothing to destroy if 0)
//   baseline  — src count from the last run we trusted (carried forward across skips)
// Returns { skip, reason } where reason is 'empty' | 'shrink' | null.
function pruneDecision({ srcCount, destCount, baseline }) {
  const src = Number(srcCount) || 0;
  const dest = Number(destCount) || 0;
  const base = Number(baseline) || 0;
  if (dest === 0) return { skip: false, reason: null }; // empty mirror — prune can't lose anything
  if (src === 0) return { skip: true, reason: 'empty' }; // src vanished entirely
  if (base > 0 && src < base * PRUNE_SHRINK_RATIO) return { skip: true, reason: 'shrink' };
  return { skip: false, reason: null };
}

// The baseline to persist for the NEXT run: trust this run's count only when we
// did NOT skip, so one empty/partial blip can't poison the threshold afterward.
function nextBaseline(skipped, srcCount, baseline) {
  return skipped ? Number(baseline) || 0 : Number(srcCount) || 0;
}

module.exports = { pruneDecision, nextBaseline, PRUNE_SHRINK_RATIO };
