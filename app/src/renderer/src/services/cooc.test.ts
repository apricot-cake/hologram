import { postView } from '../../../../../tests/helpers/test-post-view.ts';
// cooc.ts のロジックの単体テスト。スタブの deps を差し込んで、charCandidatesFor（強ティア＝
// 作品 → キャラ）、worksCooccurringWith（同名キャラ検知のための履歴照会）、
// relatedTagCandidates（弱ティア＝全タグの共起から出す関連提案）を直接見る。

import { describe, expect, test } from 'vitest';
import { makeCooc } from './cooc';

// スタブ環境: 共起の型を意図して作り込んだ投稿8件
// 風景←→夜=3件 / 風景←→作品A=3件 / 風景←→キャラX=2件（しきい値3に届かない）/ 作品B は1件だけ
const posts = [
  { captureId: 'c1', tags: ['作品A', 'キャラX', '風景'] },
  { captureId: 'c2', tags: ['作品A', 'キャラX', '風景'] },
  { captureId: 'c3', tags: ['作品A', 'キャラY', '風景'] },
  { captureId: 'c4', tags: ['作品B', 'キャラY'] },
  { captureId: 'c5', tags: ['風景', '夜'] },
  { captureId: 'c6', tags: ['風景', '夜'] },
  { captureId: 'c7', tags: ['風景', '夜'] },
  { captureId: 'c8', tags: [] }, // タグのない投稿
];

const { relatedTagCandidates } = makeCooc({
  allPosts: () => posts.map(postView),
});

describe('relatedTagCandidates（弱ティア＝全タグ共起）', () => {
  test('既定閾値3: 夜・作品A のみ（キャラX=2 は沈黙）', () => {
    // 夜=3、作品A=3 がしきい値（既定は3）に届く。キャラX=2、キャラY=1 は「薄い」ので黙る。
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

  // count はペアをまたいだ最大値であって合算ではない（風景 とは3、夜 とは0 → 3のまま）
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
