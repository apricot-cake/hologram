// cooc.ts のロジック単体テスト。charCandidatesFor（強＝作品→キャラ）・
// worksCooccurringWith（同名キャラ検知の履歴照会）・relatedTagCandidates
// （弱＝全タグ共起の関連提案）を、スタブ deps 注入で直接検証する。

import { describe, expect, test } from 'vitest';
import { makeCooc } from '../app/src/renderer/src/services/cooc';

// スタブ環境: 共起パターンを作り込んだ投稿8件
// 風景↔夜=3件 / 風景↔作品A=3件 / 風景↔キャラX=2件（閾値3未満） / 作品B は1件のみ
const KIND: Record<string, string> = { 作品A: 'work', 作品B: 'work', キャラX: 'character', キャラY: 'character' };
const posts = [
  { captureId: 'c1', tags: ['作品A', 'キャラX', '風景'] },
  { captureId: 'c2', tags: ['作品A', 'キャラX', '風景'] },
  { captureId: 'c3', tags: ['作品A', 'キャラY', '風景'] },
  { captureId: 'c4', tags: ['作品B', 'キャラY'] },
  { captureId: 'c5', tags: ['風景', '夜'] },
  { captureId: 'c6', tags: ['風景', '夜'] },
  { captureId: 'c7', tags: ['風景', '夜'] },
  { captureId: 'c8', tags: null }, // 欠損 tags は無視される
];

const { charCandidatesFor, worksCooccurringWith, relatedTagCandidates } = makeCooc({
  allPosts: () => posts,
  tagKindOf: (t: string) => KIND[t] || null,
});

describe('charCandidatesFor（強ティア＝作品→キャラ・頻度降順）', () => {
  test('作品A→キャラX(2)・キャラY(1) の降順', () => {
    expect(charCandidatesFor(['作品A'])).toEqual([
      ['キャラX', 2],
      ['キャラY', 1],
    ]);
  });

  test('作品B→キャラY のみ', () => {
    expect(charCandidatesFor(['作品B'])).toEqual([['キャラY', 1]]);
  });

  test('空入力→[]', () => {
    expect(charCandidatesFor([])).toEqual([]);
    expect(charCandidatesFor(null)).toEqual([]);
  });
});

describe('worksCooccurringWith（同名キャラ検知の履歴照会）', () => {
  test('キャラY→作品A+作品B', () => {
    expect(worksCooccurringWith('キャラY', null)).toEqual(new Set(['作品A', '作品B']));
  });

  test('excludeIds で c4 を除外→作品A のみ', () => {
    expect(worksCooccurringWith('キャラY', new Set(['c4']))).toEqual(new Set(['作品A']));
  });

  test('未知タグ→空', () => {
    expect(worksCooccurringWith('存在しない', null).size).toBe(0);
  });
});

describe('relatedTagCandidates（弱ティア＝全タグ共起）', () => {
  test('既定閾値3: 夜・作品A のみ（キャラX=2 は沈黙）', () => {
    // 夜=3・作品A=3 は閾値(既定3)を満たす。キャラX=2・キャラY=1 は「薄い」ので沈黙。
    const tags = relatedTagCandidates(['風景'], {}).map((x) => x.tag);
    expect(tags.sort()).toEqual(['作品A', '夜'].sort());
  });

  test('根拠の帰属: withTag=風景・count=3', () => {
    expect(relatedTagCandidates(['風景'], {}).every((x) => x.withTag === '風景' && x.count === 3)).toBe(true);
  });

  test('選択中タグ自身は提案しない', () => {
    expect(relatedTagCandidates(['風景'], {}).map((x) => x.tag)).not.toContain('風景');
  });

  test('minCount=2 でキャラX(2) が浮上', () => {
    expect(relatedTagCandidates(['風景'], { minCount: 2 })).toContainEqual(expect.objectContaining({ tag: 'キャラX', count: 2 }));
  });

  // count はペア最大値であって合算ではない（風景と3件・夜と0件→3のまま）
  test('count は最強ペアの値（合算しない）', () => {
    const workA = relatedTagCandidates(['風景', '夜'], { minCount: 1 }).find((x) => x.tag === '作品A');
    expect(workA).toMatchObject({ count: 3, withTag: '風景' });
  });

  test('exclude 指定タグは提案しない', () => {
    const tags = relatedTagCandidates(['風景'], { exclude: new Set(['夜']) }).map((x) => x.tag);
    expect(tags).not.toContain('夜');
    expect(tags).toContain('作品A');
  });

  test('limit で件数上限', () => {
    const r = relatedTagCandidates(['風景'], { minCount: 1, limit: 1 });
    expect(r).toHaveLength(1);
    expect(r[0].count).toBe(3);
  });

  test('空選択→[]', () => {
    expect(relatedTagCandidates([], {})).toEqual([]);
    expect(relatedTagCandidates(null, {})).toEqual([]);
  });
});
