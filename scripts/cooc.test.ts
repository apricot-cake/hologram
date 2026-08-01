// Unit tests for cooc.ts logic. Tests charCandidatesFor (strong tier = work -> character),
// worksCooccurringWith (history lookup for same-name-character detection), and
// relatedTagCandidates (weak tier = related suggestions from all-tag co-occurrence)
// directly, via stub deps injection.

import { describe, expect, test } from 'vitest';
import { makeCooc } from '../app/src/renderer/src/services/cooc';

// Stub environment: 8 posts with deliberately constructed co-occurrence patterns
// 風景<->夜=3 posts / 風景<->作品A=3 posts / 風景<->キャラX=2 posts (below the threshold of 3) / 作品B has only 1 post
const KIND: Record<string, string> = { 作品A: 'work', 作品B: 'work', キャラX: 'character', キャラY: 'character' };
const posts = [
  { captureId: 'c1', tags: ['作品A', 'キャラX', '風景'] },
  { captureId: 'c2', tags: ['作品A', 'キャラX', '風景'] },
  { captureId: 'c3', tags: ['作品A', 'キャラY', '風景'] },
  { captureId: 'c4', tags: ['作品B', 'キャラY'] },
  { captureId: 'c5', tags: ['風景', '夜'] },
  { captureId: 'c6', tags: ['風景', '夜'] },
  { captureId: 'c7', tags: ['風景', '夜'] },
  { captureId: 'c8', tags: null }, // missing tags is ignored
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
    // 夜=3, 作品A=3 meet the threshold (default 3). キャラX=2, キャラY=1 are "thin" so they stay silent.
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

  // count is the max value across pairs, not a sum (3 with 風景, 0 with 夜 -> stays 3)
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
