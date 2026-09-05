// 木 → QueryState のアダプタ（#207）の単体テスト。小さな条件木を手で組み（ヘルパの形は
// scripts/query.test.ts と同じ）、buildWebSearchState が何を保つか、何を落として近似するか、
// 何を木の形の問題として報告するかを見る。
import { describe, expect, test } from 'vitest';
import { buildWebSearchState } from '../app/src/renderer/src/websearch/adapter';
import type { ResolvedUser } from '../app/src/renderer/src/websearch/types';

const leaf = (type: string, value?: unknown, extra?: object) => Object.assign({ kind: 'cond', type, value }, extra);
const group = (op: 'and' | 'or', children: unknown[], neg?: boolean) => ({ kind: 'group', op, neg: !!neg, children });

const noUser = { resolveUser: () => null };

describe('buildWebSearchState', () => {
  test('裸の肯定 text 葉は AND の語になる', () => {
    const tree = group('and', [leaf('text', 'sunset')]);
    const { state, treeDrops } = buildWebSearchState(tree as any, noUser);
    expect(state.terms).toEqual(['sunset']);
    expect(treeDrops).toEqual([]);
  });

  test('否定された text 葉は除外語になる', () => {
    const tree = group('and', [leaf('text', 'spoiler', { neg: true })]);
    const { state } = buildWebSearchState(tree as any, noUser);
    expect(state.exclude).toEqual(['spoiler']);
    expect(state.terms).toEqual([]);
  });

  test('ハッシュタグの AND の束は絞り込みになる（全部必須）', () => {
    const tree = group('and', [group('and', [leaf('hashtag', 'cat'), leaf('hashtag', 'dog')])]);
    const { state } = buildWebSearchState(tree as any, noUser);
    expect(state.hashtag.sort()).toEqual(['cat', 'dog']);
    expect(state.hashtagOr).toEqual([]);
  });

  test('タグの OR の束は hashtagOr になる', () => {
    const tree = group('and', [group('or', [leaf('tag', 'catA'), leaf('tag', 'catB')])]);
    const { state } = buildWebSearchState(tree as any, noUser);
    expect(state.hashtagOr.sort()).toEqual(['catA', 'catB']);
    expect(state.hashtag).toEqual([]);
  });

  test('OR の概念が無い型の OR の束は丸ごと落とす', () => {
    const tree = group('and', [group('or', [leaf('media', 'image'), leaf('media', 'video')])]);
    const { state, treeDrops } = buildWebSearchState(tree as any, noUser);
    expect(state.mediaOnly).toBe(false);
    expect(treeDrops.length).toBe(1);
  });

  test('解決できた user 葉は fromUser になる', () => {
    const resolved: ResolvedUser = { platform: 'x', handle: 'neko' };
    const tree = group('and', [leaf('user', 'x:@neko')]);
    const { state } = buildWebSearchState(tree as any, { resolveUser: () => resolved });
    expect(state.fromUser).toEqual(resolved);
  });

  test('解決できない user 葉は落とす。黙って無視はしない', () => {
    const tree = group('and', [leaf('user', 'x:12345', { label: 'ねこ' })]);
    const { state, treeDrops } = buildWebSearchState(tree as any, noUser);
    expect(state.fromUser).toBeNull();
    expect(treeDrops.some((d) => d.reason.includes('ねこ'))).toBe(true);
  });

  test('別々の肯定 user が2つあると、どちらも「その」投稿者にはなれない＝落とす', () => {
    const a: ResolvedUser = { platform: 'x', handle: 'alice' };
    const b: ResolvedUser = { platform: 'x', handle: 'bob' };
    const tree = group('and', [leaf('user', 'x:@alice'), leaf('user', 'x:@bob')]);
    let call = 0;
    const { state, treeDrops } = buildWebSearchState(tree as any, { resolveUser: () => (call++ === 0 ? a : b) });
    expect(state.fromUser).toBeNull();
    expect(treeDrops.length).toBeGreaterThan(0);
  });

  test('否定された user 葉は excludeUser のエントリになる', () => {
    const resolved: ResolvedUser = { platform: 'bluesky', handle: 'alice.bsky.social' };
    const tree = group('and', [leaf('user', 'bluesky:@alice', { neg: true })]);
    const { state } = buildWebSearchState(tree as any, { resolveUser: () => resolved });
    expect(state.excludeUser).toEqual([resolved]);
  });

  test('投稿日の葉（dateField "date"）は since/until へ写る', () => {
    const tree = group('and', [leaf('date', undefined, { from: '2026-01-01', to: '2026-01-31' })]);
    const { state } = buildWebSearchState(tree as any, noUser);
    expect(state.since).toBe('2026-01-01');
    expect(state.until).toBe('2026-01-31');
  });

  test('ライブラリにしか無い日付の軸（capturedAt）は落とす。決して読み替えない', () => {
    const tree = group('and', [leaf('date', undefined, { dateField: 'capturedAt', from: '2026-01-01' })]);
    const { state, treeDrops } = buildWebSearchState(tree as any, noUser);
    expect(state.since).toBeNull();
    expect(treeDrops.length).toBe(1);
  });

  test('media 葉: video は videoOnly を、image/gif は mediaOnly を立てる', () => {
    const t1 = buildWebSearchState(group('and', [leaf('media', 'video')]) as any, noUser);
    expect(t1.state.videoOnly).toBe(true);
    const t2 = buildWebSearchState(group('and', [leaf('media', 'image')]) as any, noUser);
    expect(t2.state.mediaOnly).toBe(true);
    expect(t2.state.videoOnly).toBe(false);
  });

  test('postType: "post" は返信を除き、"reply" は返信だけ、"quote" は落とす', () => {
    const post = buildWebSearchState(group('and', [leaf('postType', 'post')]) as any, noUser);
    expect(post.state.excludeReplies).toBe(true);
    const reply = buildWebSearchState(group('and', [leaf('postType', 'reply')]) as any, noUser);
    expect(reply.state.repliesOnly).toBe(true);
    const quote = buildWebSearchState(group('and', [leaf('postType', 'quote')]) as any, noUser);
    expect(quote.treeDrops.length).toBe(1);
  });

  test('engagement: "gte" の下限は対応する min* へ写り、"lte" の上限は落とす', () => {
    const gte = buildWebSearchState(group('and', [leaf('engagement', undefined, { engType: 'likes', min: 500, op: 'gte' })]) as any, noUser);
    expect(gte.state.minLikes).toBe(500);
    const lte = buildWebSearchState(group('and', [leaf('engagement', undefined, { engType: 'likes', min: 500, op: 'lte' })]) as any, noUser);
    expect(lte.state.minLikes).toBeNull();
    expect(lte.treeDrops.length).toBe(1);
  });

  test('ライブラリにしか無い葉型（folder/dimension/kind/domain）は必ず落とす', () => {
    for (const type of ['folder', 'dimension', 'kind', 'domain']) {
      const { state, treeDrops } = buildWebSearchState(group('and', [leaf(type, 'x')]) as any, noUser);
      expect(treeDrops.length).toBe(1);
      expect(state.terms).toEqual([]);
    }
  });

  test('platform の葉は行そのものが黙って引き受ける（落とさないし語にもしない）', () => {
    const { state, treeDrops } = buildWebSearchState(group('and', [leaf('platform', 'x')]) as any, noUser);
    expect(treeDrops).toEqual([]);
    expect(state.terms).toEqual([]);
  });

  test('ファセットの CNF でない木（根が OR）は、木ごと1件落としたものとして報告する', () => {
    const tree = group('or', [leaf('text', 'a'), leaf('text', 'b')]);
    const { state, treeDrops } = buildWebSearchState(tree as any, noUser);
    expect(state.terms).toEqual([]);
    expect(treeDrops.length).toBe(1);
  });

  test('null や空の木は、何も落とさずに空の state を返す', () => {
    const { state, treeDrops } = buildWebSearchState(null, noUser);
    expect(state.terms).toEqual([]);
    expect(treeDrops).toEqual([]);
  });
});
