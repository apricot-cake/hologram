'use strict';

// Unit tests for the mirror prune-safety guard (app/backup-guard.js), added after
// the 2026-06-23 library-loss incident. Pure logic → no Electron needed.
//
//   node scripts/test-backup-guard.js

const assert = require('node:assert');
const { pruneDecision, nextBaseline, PRUNE_SHRINK_RATIO } = require('../app/backup-guard.mts');

let pass = 0;
function check(name, fn) {
  fn();
  pass++;
  console.log('  ok  ' + name);
}

// --- pruneDecision -----------------------------------------------------------

check('healthy run prunes (counts steady)', () => {
  const d = pruneDecision({ srcCount: 100, destCount: 100, baseline: 100 });
  assert.deepStrictEqual(d, { skip: false, reason: null });
});

check('legit small deletion still prunes (above ratio)', () => {
  // 60 of a 100 baseline survives → above 50% → user really deleted some posts.
  const d = pruneDecision({ srcCount: 60, destCount: 100, baseline: 100 });
  assert.deepStrictEqual(d, { skip: false, reason: null });
});

check('empty src holds the prune', () => {
  const d = pruneDecision({ srcCount: 0, destCount: 100, baseline: 100 });
  assert.deepStrictEqual(d, { skip: true, reason: 'empty' });
});

check('sharp shrink holds the prune', () => {
  // 20 of a 100 baseline → far below 50% → wrong/empty folder, protect the mirror.
  const d = pruneDecision({ srcCount: 20, destCount: 100, baseline: 100 });
  assert.deepStrictEqual(d, { skip: true, reason: 'shrink' });
});

check('exactly at the ratio is NOT a shrink (strict <)', () => {
  // 50 of 100 = exactly 50% → not strictly below → allowed.
  const d = pruneDecision({ srcCount: 50, destCount: 100, baseline: 100 });
  assert.deepStrictEqual(d, { skip: false, reason: null });
});

check('empty mirror never blocks (nothing to lose)', () => {
  // First-ever backup: dest empty, src empty → copy nothing, prune nothing.
  const d = pruneDecision({ srcCount: 0, destCount: 0, baseline: 0 });
  assert.deepStrictEqual(d, { skip: false, reason: null });
});

check('no baseline (first run) → only empty guard applies', () => {
  // baseline 0 → shrink check disabled; a populated src prunes normally.
  assert.deepStrictEqual(pruneDecision({ srcCount: 5, destCount: 100, baseline: 0 }), { skip: false, reason: null });
  // ...but a vanished src is still caught by the empty guard.
  assert.deepStrictEqual(pruneDecision({ srcCount: 0, destCount: 100, baseline: 0 }), { skip: true, reason: 'empty' });
});

check('ratio constant is honored', () => {
  const justUnder = Math.floor(100 * PRUNE_SHRINK_RATIO) - 1;
  assert.strictEqual(pruneDecision({ srcCount: justUnder, destCount: 100, baseline: 100 }).reason, 'shrink');
});

// --- nextBaseline ------------------------------------------------------------

check('healthy run adopts this run count as baseline', () => {
  assert.strictEqual(nextBaseline(false, 60, 100), 60);
});

check('skipped run carries the old baseline forward (no poisoning)', () => {
  // Run A: 100 healthy → baseline 100. Run B: src=0 skip → keep 100, NOT 0.
  assert.strictEqual(nextBaseline(true, 0, 100), 100);
  // Run C: src=20 partial shrink-skip → keep 100, NOT 20.
  assert.strictEqual(nextBaseline(true, 20, 100), 100);
});

console.log(`\nGUARD_TEST_PASS (${pass} checks)`);
