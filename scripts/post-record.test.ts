// native-host/post-record.mts のユニットテスト＝投稿レコードの共有スキーマと正規化
// ビルダー（#5 St2 / #295）。素の Node で動く（Electron 不要）。

import { describe, expect, test } from 'vitest';
import { normalizePostRecord } from '../native-host/post-record.mts';

const FIXED_NOW = '2026-07-24T00:00:00.000Z';
const fixedNow = () => FIXED_NOW;

describe('既定値', () => {
  const rec = normalizePostRecord({ captureId: 'cap-1' }, fixedNow);

  test('どの生成側も自分で入れる唯一のフィールドは運ぶ', () => {
    expect(rec.captureId).toBe('cap-1');
  });

  test("assetClass の既定は 'media'（#236 で確認した既定）", () => {
    expect(rec.assetClass).toBe('media');
  });

  test('capturedAt は無ければ now() へ落ちる', () => {
    expect(rec.capturedAt).toBe(FIXED_NOW);
  });

  // extension/background.ts の buildRecord と同じ振る舞い
  test('updatedAt は無ければ capturedAt へ落ちる', () => {
    expect(rec.updatedAt).toBe(FIXED_NOW);
  });

  test('配列フィールドの既定は []', () => {
    expect({ hashtags: rec.hashtags, tags: rec.tags, media: rec.media }).toEqual({ hashtags: [], tags: [], media: [] });
  });

  test.each([
    'mediaType',
    'image',
    'video',
    'url',
    'platform',
    'text',
    'title',
    'displayName',
    'screenName',
    'userId',
    'avatar',
    'avatarFile',
    'authorCreatedAt',
    'date',
    'capturedVia',
    'lang',
    'quotedUrl',
    'replyToId',
    'eagleName',
    'description',
    'source',
    'trashedAt',
    'followers',
    'likes',
    'reposts',
    'replies',
    'bookmarks',
    'views',
    'shotW',
    'shotH',
  ])('%s の既定は null', (k) => {
    expect(rec[k]).toBeNull();
  });

  // 三値（未知/true/false）であって false ではない
  test.each(['isReply', 'isQuote', 'isThread'])('%s の既定は null（三値）', (k) => {
    expect(rec[k]).toBeNull();
  });
});

describe('素通しと変換', () => {
  const rec = normalizePostRecord(
    {
      captureId: 'cap-2',
      url: 'https://bsky.app/profile/a/post/b',
      likes: 42,
      isReply: true,
      hashtags: ['a', 'b', 3, null],
      media: [{ url: 'https://x/1.jpg', width: 10, height: 20, file: '1.jpg' }, { file: '2.jpg' }, null, { url: 'https://x/2.mp4', file: '2.mp4', type: 'video', posterFile: 'poster.jpg' }],
      capturedAt: '2026-01-01T00:00:00.000Z',
      capturedVia: 'x-bookmarks',
    },
    fixedNow,
  );

  test('明示されたフィールドはそのまま通る', () => {
    expect(rec).toMatchObject({ url: 'https://bsky.app/profile/a/post/b', likes: 42, isReply: true });
  });

  test('文字列でないハッシュタグは落とす（変換しない）', () => {
    expect(rec.hashtags).toEqual(['a', 'b']);
  });

  test('null の media エントリは穴として残さず落とす', () => {
    expect(rec.media).toHaveLength(3);
  });

  test('media はフィールド単位で正規化される（生のまま素通ししない）', () => {
    expect(rec.media[0]).toEqual({ url: 'https://x/1.jpg', alt: null, width: 10, height: 20, file: '1.jpg', type: null, posterFile: null });
  });

  test('url を欠く media エントリにも全フィールドが入る', () => {
    expect(rec.media[1]).toEqual({ url: '', alt: null, width: null, height: null, file: '2.jpg', type: null, posterFile: null });
  });

  test('動画の media は type と posterFile を運ぶ（#119 St1）', () => {
    expect(rec.media[2]).toEqual({ url: 'https://x/2.mp4', alt: null, width: null, height: null, file: '2.mp4', type: 'video', posterFile: 'poster.jpg' });
  });

  test('明示された capturedAt は now() で上書きされない', () => {
    expect(rec.capturedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  test('updatedAt は now() ではなく明示された capturedAt へ落ちる', () => {
    expect(rec.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  test('capturedVia が通る（#362 一括取込の経路マーカー）', () => {
    expect(rec.capturedVia).toBe('x-bookmarks');
  });
});

// このビルダーが存在する理由そのもの（#5 2026-07-18 のコメント）:
// app/src/main/ipc-transfer.ts の import-posts は ~30 フィールドを手で並べており、
// media[] と replyToId を黙って落としていた。共有ビルダーは、生成側が入れたフィールドを
// 落とせない＝省略されたものに既定値を入れることしかできない。
describe('生成側が入れたフィールドは落とさない', () => {
  const rec = normalizePostRecord({ captureId: 'cap-3', media: [{ url: 'https://x/1.jpg', file: '1.jpg' }], replyToId: 'parent-123' }, fixedNow);

  test('media が生き残る', () => {
    expect(rec.media).toHaveLength(1);
  });

  test('replyToId が生き残る', () => {
    expect(rec.replyToId).toBe('parent-123');
  });
});
