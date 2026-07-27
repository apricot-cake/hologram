// ミラーの prune 安全弁（app/src/main/backup-guard.ts）のユニットテスト。
// 2026-06-23 のライブラリ消失事故を受けて追加したもの。純ロジック＝Electron 不要。

import { describe, expect, test } from 'vitest';
import { PRUNE_SHRINK_RATIO, nextBaseline, pruneDecision } from '../app/src/main/backup-guard';

const PRUNE = { skip: false, reason: null };

describe('pruneDecision', () => {
  test('健全な実行では prune する（件数が横ばい）', () => {
    expect(pruneDecision({ srcCount: 100, destCount: 100, baseline: 100 })).toEqual(PRUNE);
  });

  // 100 のうち 60 残る → 50% 超 → ユーザーが本当に何件か消しただけ
  test('正当な小規模削除なら prune する（比率より上）', () => {
    expect(pruneDecision({ srcCount: 60, destCount: 100, baseline: 100 })).toEqual(PRUNE);
  });

  test('src が空なら prune を止める', () => {
    expect(pruneDecision({ srcCount: 0, destCount: 100, baseline: 100 })).toEqual({ skip: true, reason: 'empty' });
  });

  // 100 のうち 20 → 50% を大きく下回る → フォルダ違い/空 → ミラーを守る
  test('急減したら prune を止める', () => {
    expect(pruneDecision({ srcCount: 20, destCount: 100, baseline: 100 })).toEqual({ skip: true, reason: 'shrink' });
  });

  // ちょうど 50% は「下回って」いない（厳密な <）
  test('比率ちょうどは急減ではない', () => {
    expect(pruneDecision({ srcCount: 50, destCount: 100, baseline: 100 })).toEqual(PRUNE);
  });

  // 初回バックアップ: dest も src も空 → 何も写さず何も消さない
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

  // 実行A: 100 で健全 → baseline 100。実行B: src=0 で skip → 0 でなく 100 を持ち越す。
  test('skip した実行は古い baseline を持ち越す（汚染させない）', () => {
    expect(nextBaseline(true, 0, 100)).toBe(100);
    expect(nextBaseline(true, 20, 100)).toBe(100);
  });
});
