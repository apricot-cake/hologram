// Unit tests for services/fulltext.ts (#29 — full-text search across tabs).
// The IPC round-trip (bm25 rank) is real-device territory (skill verify-with-cdp);
// this only checks the pure parts: which field a query matches first (and that a
// tag/hashtag hit never shadows a body hit), the snippet it returns, and the
// rank/date-fallback ordering.

import { describe, expect, test } from 'vitest';
import { matchPost, rankFullTextMatches } from '../app/src/renderer/src/services/fulltext';

const post = (over: Record<string, unknown> = {}) => ({ captureId: 'c1', date: '2026-01-01T00:00:00.000Z', ...over }) as unknown as HologramPost;

describe('matchPost: フィールドの優先順位', () => {
  test('本文が一致すればタグより先に本文として報告する', () => {
    const p = post({ text: '今日は猫と散歩した', tags: ['猫'] });
    const m = matchPost('猫', p);
    expect(m?.field).toBe('text');
  });

  test('タグ経由のヒットは本文ヒットに見えない（タグとして報告）', () => {
    const p = post({ text: '今日は良い天気だった', tags: ['ねこ'] });
    const m = matchPost('ねこ', p);
    expect(m?.field).toBe('tag');
  });

  test('ハッシュタグ経由のヒットもハッシュタグとして報告する', () => {
    const p = post({ text: '今日は良い天気だった', hashtags: ['ねこの日'] });
    const m = matchPost('ねこ', p);
    expect(m?.field).toBe('hashtag');
  });

  test('メディアの ALT テキストにもヒットする（#288 ホームワーク）', () => {
    const p = post({ text: '', media: [{ file: 'a.png', alt: '窓辺で眠る猫の写真' }] });
    const m = matchPost('猫', p);
    expect(m?.field).toBe('alt');
  });

  test('引用元の本文にもヒットする（親側のヒットとして報告）', () => {
    const p = post({ text: '見て', quotedPost: { text: '今日拾った猫です' } });
    const m = matchPost('猫', p);
    expect(m?.field).toBe('quoted');
    expect(m?.post).toBe(p); // ヒットは常に親投稿を指す（#180）
  });

  // #181: a link-share post's OGP card title/description are searchable,
  // reported as their own field (same "field priority, not a body hit"
  // treatment as quoted/poll just above).
  test('リンクカードのタイトルにもヒットする', () => {
    const p = post({ text: '見て', linkCard: { title: '猫カフェ特集記事', description: null } });
    const m = matchPost('猫', p);
    expect(m?.field).toBe('linkCard');
  });

  test('どのフィールドにも無ければ null', () => {
    const p = post({ text: '今日は良い天気だった', tags: ['犬'] });
    expect(matchPost('猫', p)).toBeNull();
  });

  test('空クエリは null', () => {
    expect(matchPost('', post({ text: '猫' }))).toBeNull();
  });
});

describe('matchPost: スニペット', () => {
  test('一致箇所のオフセットを返す', () => {
    const p = post({ text: '今日は天気が良くて猫と散歩した' });
    const m = matchPost('猫と散歩', p);
    if (!m) throw new Error('expected a match');
    expect(m.snippetText.slice(m.matchStart, m.matchEnd)).toBe('猫と散歩');
  });
});

describe('rankFullTextMatches: bm25 順 + 日付フォールバック', () => {
  const mk = (id: string, date: string) => ({ post: post({ captureId: id, date }), field: 'text' as const, snippetText: '', matchStart: -1, matchEnd: -1 });

  test('rank がある物同士は bm25 昇順（より負の方が関連度が高い）', () => {
    const a = mk('a', '2026-01-01T00:00:00.000Z');
    const b = mk('b', '2026-01-01T00:00:00.000Z');
    const ranks = new Map([
      ['a', -1.0],
      ['b', -5.0],
    ]);
    expect(rankFullTextMatches([a, b], ranks).map((m) => m.post.captureId)).toEqual(['b', 'a']);
  });

  test('rank が無いヒットは rank があるヒットの後ろへ落ちる（#288 の列不足を吸収する暫定フォールバック）', () => {
    const ranked = mk('ranked', '2020-01-01T00:00:00.000Z'); // 古いが rank は最上位
    const unranked = mk('unranked', '2026-06-01T00:00:00.000Z'); // 新しいが rank 無し（例: ALT 経由）
    const ranks = new Map([['ranked', -9.0]]);
    expect(rankFullTextMatches([unranked, ranked], ranks).map((m) => m.post.captureId)).toEqual(['ranked', 'unranked']);
  });

  test('どちらも rank が無ければ日付降順', () => {
    const older = mk('older', '2025-01-01T00:00:00.000Z');
    const newer = mk('newer', '2026-06-01T00:00:00.000Z');
    expect(rankFullTextMatches([older, newer], new Map()).map((m) => m.post.captureId)).toEqual(['newer', 'older']);
  });
});
