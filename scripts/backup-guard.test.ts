// Unit tests for the backup's prune safety valve (app/src/main/backup-guard.ts).
// Added in response to the 2026-06-23 library loss incident. Pure logic = no Electron needed.

import { describe, expect, test } from 'vitest';
import { PRUNE_SHRINK_RATIO, nextBaseline, pruneDecision } from '../app/src/main/backup-guard';

const PRUNE = { skip: false, reason: null };

describe('pruneDecision', () => {
  test('健全な実行では prune する（件数が横ばい）', () => {
    expect(pruneDecision({ srcCount: 100, destCount: 100, baseline: 100 })).toEqual(PRUNE);
  });

  // 60 of 100 remain → over 50% → the user just genuinely deleted a few items
  test('正当な小規模削除なら prune する（比率より上）', () => {
    expect(pruneDecision({ srcCount: 60, destCount: 100, baseline: 100 })).toEqual(PRUNE);
  });

  test('src が空なら prune を止める', () => {
    expect(pruneDecision({ srcCount: 0, destCount: 100, baseline: 100 })).toEqual({ skip: true, reason: 'empty' });
  });

  // 20 of 100 → well under 50% → wrong folder / empty → protect the mirror
  test('急減したら prune を止める', () => {
    expect(pruneDecision({ srcCount: 20, destCount: 100, baseline: 100 })).toEqual({ skip: true, reason: 'shrink' });
  });

  // Exactly 50% doesn't count as "under" (strict <)
  test('比率ちょうどは急減ではない', () => {
    expect(pruneDecision({ srcCount: 50, destCount: 100, baseline: 100 })).toEqual(PRUNE);
  });

  // First backup: dest and src are both empty → copy nothing, delete nothing
  test('ミラーが空なら決して止めない（失うものが無い）', () => {
    expect(pruneDecision({ srcCount: 0, destCount: 0, baseline: 0 })).toEqual(PRUNE);
  });

  describe('baseline 無し（初回）は empty ガードだけ効く', () => {
    test('src に中身があれば通常どおり prune', () => {
      expect(pruneDecision({ srcCount: 5, destCount: 100, baseline: 0 })).toEqual(PRUNE);
    });

    test('src が消えていれば empty ガードが捕まえる', () => {
      expect(pruneDecision({ srcCount: 0, destCount: 100, baseline: 0 })).toEqual({ skip: true, reason: 'empty' });
    });
  });

  test('比率の定数が実際に効いている', () => {
    const justUnder = Math.floor(100 * PRUNE_SHRINK_RATIO) - 1;
    expect(pruneDecision({ srcCount: justUnder, destCount: 100, baseline: 100 }).reason).toBe('shrink');
  });
});

describe('nextBaseline', () => {
  test('健全な実行は今回の件数を baseline にする', () => {
    expect(nextBaseline(false, 60, 100)).toBe(60);
  });

  // Run A: 100, healthy → baseline 100. Run B: src=0, skip → carries forward 100, not 0.
  test('skip した実行は古い baseline を持ち越す（汚染させない）', () => {
    expect(nextBaseline(true, 0, 100)).toBe(100);
    expect(nextBaseline(true, 20, 100)).toBe(100);
  });
});
