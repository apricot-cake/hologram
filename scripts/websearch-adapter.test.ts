// Unit tests for the tree -> QueryState adapter (#207). Builds small condition trees by
// hand (same helper shape as scripts/query.test.ts) and checks what buildWebSearchState
// keeps, approximates via dropping, or reports as a tree-shape drop.
import { describe, expect, test } from 'vitest';
import { buildWebSearchState } from '../app/src/renderer/src/websearch/adapter';
import type { ResolvedUser } from '../app/src/renderer/src/websearch/types';

const leaf = (type: string, value?: unknown, extra?: object) => Object.assign({ kind: 'cond', type, value }, extra);
const group = (op: 'and' | 'or', children: unknown[], neg?: boolean) => ({ kind: 'group', op, neg: !!neg, children });

const noUser = { resolveUser: () => null };

describe('buildWebSearchState', () => {
  test('a bare positive text leaf becomes an AND term', () => {
    const tree = group('and', [leaf('text', 'sunset')]);
    const { state, treeDrops } = buildWebSearchState(tree as any, noUser);
    expect(state.terms).toEqual(['sunset']);
    expect(treeDrops).toEqual([]);
  });

  test('a negated text leaf is excluded', () => {
    const tree = group('and', [leaf('text', 'spoiler', { neg: true })]);
    const { state } = buildWebSearchState(tree as any, noUser);
    expect(state.exclude).toEqual(['spoiler']);
    expect(state.terms).toEqual([]);
  });

  test('an AND cluster of hashtags narrows (all required)', () => {
    const tree = group('and', [group('and', [leaf('hashtag', 'cat'), leaf('hashtag', 'dog')])]);
    const { state } = buildWebSearchState(tree as any, noUser);
    expect(state.hashtag.sort()).toEqual(['cat', 'dog']);
    expect(state.hashtagOr).toEqual([]);
  });

  test('an OR cluster of tags becomes hashtagOr', () => {
    const tree = group('and', [group('or', [leaf('tag', 'catA'), leaf('tag', 'catB')])]);
    const { state } = buildWebSearchState(tree as any, noUser);
    expect(state.hashtagOr.sort()).toEqual(['catA', 'catB']);
    expect(state.hashtag).toEqual([]);
  });

  test('an OR cluster of a type with no OR concept is dropped wholesale', () => {
    const tree = group('and', [group('or', [leaf('media', 'image'), leaf('media', 'video')])]);
    const { state, treeDrops } = buildWebSearchState(tree as any, noUser);
    expect(state.mediaOnly).toBe(false);
    expect(treeDrops.length).toBe(1);
  });

  test('a resolved user leaf becomes fromUser', () => {
    const resolved: ResolvedUser = { platform: 'x', handle: 'neko' };
    const tree = group('and', [leaf('user', 'x:@neko')]);
    const { state } = buildWebSearchState(tree as any, { resolveUser: () => resolved });
    expect(state.fromUser).toEqual(resolved);
  });

  test('an unresolvable user leaf is dropped, not silently ignored', () => {
    const tree = group('and', [leaf('user', 'x:12345', { label: 'ねこ' })]);
    const { state, treeDrops } = buildWebSearchState(tree as any, noUser);
    expect(state.fromUser).toBeNull();
    expect(treeDrops.some((d) => d.reason.includes('ねこ'))).toBe(true);
  });

  test('two distinct positive users can never both be "the" author - dropped', () => {
    const a: ResolvedUser = { platform: 'x', handle: 'alice' };
    const b: ResolvedUser = { platform: 'x', handle: 'bob' };
    const tree = group('and', [leaf('user', 'x:@alice'), leaf('user', 'x:@bob')]);
    let call = 0;
    const { state, treeDrops } = buildWebSearchState(tree as any, { resolveUser: () => (call++ === 0 ? a : b) });
    expect(state.fromUser).toBeNull();
    expect(treeDrops.length).toBeGreaterThan(0);
  });

  test('a negated user leaf becomes an excludeUser entry', () => {
    const resolved: ResolvedUser = { platform: 'bluesky', handle: 'alice.bsky.social' };
    const tree = group('and', [leaf('user', 'bluesky:@alice', { neg: true })]);
    const { state } = buildWebSearchState(tree as any, { resolveUser: () => resolved });
    expect(state.excludeUser).toEqual([resolved]);
  });

  test('the posted-date leaf (dateField "date") maps to since/until', () => {
    const tree = group('and', [leaf('date', undefined, { from: '2026-01-01', to: '2026-01-31' })]);
    const { state } = buildWebSearchState(tree as any, noUser);
    expect(state.since).toBe('2026-01-01');
    expect(state.until).toBe('2026-01-31');
  });

  test('a library-only date axis (capturedAt) is dropped, never translated', () => {
    const tree = group('and', [leaf('date', undefined, { dateField: 'capturedAt', from: '2026-01-01' })]);
    const { state, treeDrops } = buildWebSearchState(tree as any, noUser);
    expect(state.since).toBeNull();
    expect(treeDrops.length).toBe(1);
  });

  test('media leaf: video sets videoOnly, image/gif set mediaOnly', () => {
    const t1 = buildWebSearchState(group('and', [leaf('media', 'video')]) as any, noUser);
    expect(t1.state.videoOnly).toBe(true);
    const t2 = buildWebSearchState(group('and', [leaf('media', 'image')]) as any, noUser);
    expect(t2.state.mediaOnly).toBe(true);
    expect(t2.state.videoOnly).toBe(false);
  });

  test('postType: "post" excludes replies, "reply" means replies-only, "quote" is dropped', () => {
    const post = buildWebSearchState(group('and', [leaf('postType', 'post')]) as any, noUser);
    expect(post.state.excludeReplies).toBe(true);
    const reply = buildWebSearchState(group('and', [leaf('postType', 'reply')]) as any, noUser);
    expect(reply.state.repliesOnly).toBe(true);
    const quote = buildWebSearchState(group('and', [leaf('postType', 'quote')]) as any, noUser);
    expect(quote.treeDrops.length).toBe(1);
  });

  test('engagement: a "gte" floor maps to the matching min*, an "lte" ceiling is dropped', () => {
    const gte = buildWebSearchState(group('and', [leaf('engagement', undefined, { engType: 'likes', min: 500, op: 'gte' })]) as any, noUser);
    expect(gte.state.minLikes).toBe(500);
    const lte = buildWebSearchState(group('and', [leaf('engagement', undefined, { engType: 'likes', min: 500, op: 'lte' })]) as any, noUser);
    expect(lte.state.minLikes).toBeNull();
    expect(lte.treeDrops.length).toBe(1);
  });

  test('library-only leaf types (folder/dimension/kind/domain) are always dropped', () => {
    for (const type of ['folder', 'dimension', 'kind', 'domain']) {
      const { state, treeDrops } = buildWebSearchState(group('and', [leaf(type, 'x')]) as any, noUser);
      expect(treeDrops.length).toBe(1);
      expect(state.terms).toEqual([]);
    }
  });

  test('platform/instance leaves are silently subsumed by the row itself (no drop, no term)', () => {
    const { state, treeDrops } = buildWebSearchState(group('and', [leaf('platform', 'x'), leaf('instance', 'misskey.io')]) as any, noUser);
    expect(treeDrops).toEqual([]);
    expect(state.terms).toEqual([]);
  });

  test('a non-facet-CNF tree (OR root) is reported as one whole-tree drop', () => {
    const tree = group('or', [leaf('text', 'a'), leaf('text', 'b')]);
    const { state, treeDrops } = buildWebSearchState(tree as any, noUser);
    expect(state.terms).toEqual([]);
    expect(treeDrops.length).toBe(1);
  });

  test('null/empty tree yields an empty state with no drops', () => {
    const { state, treeDrops } = buildWebSearchState(null, noUser);
    expect(state.terms).toEqual([]);
    expect(treeDrops).toEqual([]);
  });
});
