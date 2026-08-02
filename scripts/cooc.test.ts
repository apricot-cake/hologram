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

// #774 splits what a post "carries" in two, and this file needs both readings:
// membership questions ("does this post belong under tag X") read the effective
// set, while the suggestion lists stay raw — an ancestor is never worth offering,
// because every post carrying the child already carries the parent.
describe('実効タグの適用範囲（#774）', () => {
  // 東方(work) ← 紅魔郷(work) ← レミリア(character). Only c-eff2 names 東方 itself.
  const effKind: Record<string, string> = { 東方: 'work', 紅魔郷: 'work', レミリア: 'character', 咲夜: 'character' };
  const effPosts = [
    { captureId: 'e1', tags: ['レミリア', '月'], effectiveTags: ['レミリア', '月', '紅魔郷', '東方'] },
    { captureId: 'e2', tags: ['東方', '咲夜'], effectiveTags: ['東方', '咲夜'] },
    { captureId: 'e3', tags: ['レミリア'], effectiveTags: ['レミリア', '紅魔郷', '東方'] },
  ];
  const c = makeCooc({ allPosts: () => effPosts, tagKindOf: (t: string) => effKind[t] || null });

  test('charCandidatesFor: 親作品で引くと、子作品しか付いていない投稿のキャラも出る', () => {
    // 東方 is only named on e2, but e1/e3 reach it through 紅魔郷.
    expect(c.charCandidatesFor(['東方'])).toEqual([
      ['レミリア', 2],
      ['咲夜', 1],
    ]);
  });

  test('charCandidatesFor: 候補として出るのは生タグだけ', () => {
    // 紅魔郷 is a work, not a character, so it never appears — but this also pins
    // that the emission loop reads tags, not effectiveTags.
    expect(c.charCandidatesFor(['紅魔郷']).map(([t]) => t)).toEqual(['レミリア']);
  });

  test('worksCooccurringWith: 含意された親作品も履歴に数える', () => {
    // Both halves read effective here: the result is a membership set the homonym
    // check tests against, not a list of tags to offer.
    expect(c.worksCooccurringWith('レミリア')).toEqual(new Set(['紅魔郷', '東方']));
  });

  test('worksCooccurringWith: 除外した投稿は履歴に入らない', () => {
    expect(c.worksCooccurringWith('レミリア', new Set(['e1', 'e3']))).toEqual(new Set());
  });

  test('relatedTagCandidates: 選択タグの祖先を提案しない（付けても絞り込めない）', () => {
    const tags = c.relatedTagCandidates(['レミリア'], { minCount: 1 }).map((x) => x.tag);
    expect(tags).not.toContain('紅魔郷');
    expect(tags).not.toContain('東方');
    expect(tags).toContain('月');
  });

  test('relatedTagCandidates: 件数は実際に一緒に付いた回数のまま', () => {
    const moon = c.relatedTagCandidates(['レミリア'], { minCount: 1 }).find((x) => x.tag === '月');
    expect(moon).toMatchObject({ count: 1, withTag: 'レミリア' });
  });

  test('実効配列を持たない記録は生タグへ落ちる', () => {
    const legacy = makeCooc({ allPosts: () => [{ captureId: 'l1', tags: ['レミリア', '月'] }], tagKindOf: (t: string) => effKind[t] || null });
    expect(legacy.worksCooccurringWith('レミリア')).toEqual(new Set());
  });
});
