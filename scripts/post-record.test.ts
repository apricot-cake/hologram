// Unit tests for native-host/post-record.mts = the shared post-record schema and its
// normalization builder (#5 St2 / #295). Runs on plain Node (no Electron needed).

import { describe, expect, test } from 'vitest';
import { isVideoFileName, normalizePostRecord, recordHoldsContent } from '../native-host/post-record.mts';

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

  // Same behavior as buildRecord in extension/background.ts
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
    'quotedPost',
    'replyToPost',
    'seriesId',
    'seriesTitle',
    'seriesOrder',
    'editedAt',
    'cw',
    'eagleName',
    'memo',
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
    'mediaMaxW',
    'mediaMaxH',
    'mediaMaxBytes',
    'imageIndex',
    'imageCount',
  ])('%s の既定は null', (k) => {
    expect(rec[k]).toBeNull();
  });

  // A three-way value (unknown/true/false), not false
  test.each(['isReply', 'isQuote', 'isThread', 'isEdited', 'sensitive'])('%s の既定は null（三値）', (k) => {
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
      isEdited: true,
      editedAt: '2026-02-02T00:00:00.000Z',
      hashtags: ['a', 'b', 3, null],
      media: [{ url: 'https://x/1.jpg', width: 10, height: 20, file: '1.jpg' }, { file: '2.jpg' }, null, { url: 'https://x/2.mp4', file: '2.mp4', type: 'video', posterFile: 'poster.jpg' }],
      capturedAt: '2026-01-01T00:00:00.000Z',
      capturedVia: 'x-bookmarks',
      imageIndex: 2,
      imageCount: 4,
    },
    fixedNow,
  );

  test('明示されたフィールドはそのまま通る', () => {
    expect(rec).toMatchObject({ url: 'https://bsky.app/profile/a/post/b', likes: 42, isReply: true });
  });

  // #189: isEdited and editedAt are independent (on X, only the former can be filled in
  // on its own), so this verifies both pass through unchanged when given.
  test('isEdited / editedAt もそのまま通る', () => {
    expect(rec).toMatchObject({ isEdited: true, editedAt: '2026-02-02T00:00:00.000Z' });
  });

  // #178: unlike isEdited, sensitive=false is a "confirmed value" the platform actually
  // answered with, so it must survive without being rounded to null.
  test('sensitive=false もそのまま通る（isEdited と違い null に丸めない）', () => {
    const withFalse = normalizePostRecord({ captureId: 'cap-2b', cw: 'spoiler text', sensitive: false }, fixedNow);
    expect(withFalse).toMatchObject({ cw: 'spoiler text', sensitive: false });
  });

  test('文字列でないハッシュタグは落とす（変換しない）', () => {
    expect(rec.hashtags).toEqual(['a', 'b']);
  });

  // #197: hashtags/tags get NFKC + trim applied at this one spot in the save pipeline.
  // Glyph variation that platforms like pixiv hand over in raw notation (full-width/
  // half-width, leading/trailing whitespace) is folded here, so the vocabulary list and
  // count aggregation don't come out split. Case and katakana⇔hiragana are NOT folded.
  describe('タグ・ハッシュタグの字形正規化（#197）', () => {
    const norm = (hashtags: unknown, tags: unknown) => normalizePostRecord({ captureId: 'cap-tags', hashtags, tags } as never, fixedNow);

    test('全角英数は半角へ畳む', () => {
      expect(norm(['＃ＶＴｕｂｅｒ'], ['ＡＢＣ'])).toMatchObject({ hashtags: ['#VTuber'], tags: ['ABC'] });
    });

    test('前後の空白を trim する', () => {
      expect(norm([], ['  猫  '])).toMatchObject({ tags: ['猫'] });
    });

    test('正規化した結果が同じになれば重複排除する', () => {
      expect(norm([], ['ＡＢＣ', 'ABC', ' ABC '])).toMatchObject({ tags: ['ABC'] });
    });

    test('大小文字・カナ⇔かなは畳まない（表示とユーザーの表記選択を保持）', () => {
      expect(norm([], ['VTuber', 'ネコ', 'ねこ'])).toMatchObject({ tags: ['VTuber', 'ネコ', 'ねこ'] });
    });
  });

  test('null の media エントリは穴として残さず落とす', () => {
    expect(rec.media).toHaveLength(3);
  });

  test('media はフィールド単位で正規化される（生のまま素通ししない）', () => {
    expect(rec.media[0]).toEqual({ url: 'https://x/1.jpg', alt: null, width: 10, height: 20, file: '1.jpg', type: null, posterFile: null, frames: null });
  });

  test('url を欠く media エントリにも全フィールドが入る', () => {
    expect(rec.media[1]).toEqual({ url: '', alt: null, width: null, height: null, file: '2.jpg', type: null, posterFile: null, frames: null });
  });

  test('動画の media は type と posterFile を運ぶ（#119 St1）', () => {
    expect(rec.media[2]).toEqual({ url: 'https://x/2.mp4', alt: null, width: null, height: null, file: '2.mp4', type: 'video', posterFile: 'poster.jpg', frames: null });
  });

  // #119 St3: the frame table is all-or-nothing = if even one entry is broken, the
  // frames after it drift out of sync with the picture. It's more correct to make it
  // unplayable (i.e. show the poster) than to let it survive partially.
  describe('うごイラのコマ表（#119 St3）', () => {
    const one = (frames: unknown) => normalizePostRecord({ captureId: 'c', media: [{ file: 'u.zip', type: 'ugoira', frames }] } as any).media[0];

    test('正しい表はそのまま通る', () => {
      const frames = [
        { file: '000000.jpg', delay: 60 },
        { file: '000001.jpg', delay: 30 },
      ];
      expect(one(frames).frames).toEqual(frames);
    });

    test('余計なフィールドは落とす（生のまま素通ししない）', () => {
      expect(one([{ file: '0.jpg', delay: 60, extra: 'x' }]).frames).toEqual([{ file: '0.jpg', delay: 60 }]);
    });

    test.each([
      ['空配列', []],
      ['配列でない', { file: '0.jpg' }],
      ['delay が数でない', [{ file: '0.jpg', delay: '60' }]],
      ['file が空', [{ file: '', delay: 60 }]],
      ['1件だけ壊れている', [{ file: '0.jpg', delay: 60 }, null]],
    ])('%s なら null（部分的に残さない）', (_label, frames) => {
      expect(one(frames).frames).toBeNull();
    });
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

  // #560: the extension has been sending these two fields for a long time, but they were
  // dropped here and had no DB column either, so the inspector's "N / M" image counter never showed.
  test('imageIndex / imageCount が通る（#560 ドラッグ保存の元投稿での位置）', () => {
    expect({ imageIndex: rec.imageIndex, imageCount: rec.imageCount }).toEqual({ imageIndex: 2, imageCount: 4 });
  });

  test('数でない imageIndex / imageCount は null になる', () => {
    const bad = normalizePostRecord({ captureId: 'cap-3', imageIndex: '2', imageCount: Number.NaN } as never, fixedNow);
    expect({ imageIndex: bad.imageIndex, imageCount: bad.imageCount }).toEqual({ imageIndex: null, imageCount: null });
  });
});

// #36: memo replaces the Eagle-migration `description` field. A record built
// fresh carries it under the new key; a record from before the rename (a
// pre-#36 sidecar/ZIP export, or the external Eagle-migration converter,
// which still writes `description`) has to keep reading as a memo too.
describe('memo（#36, 旧 description の統合）', () => {
  test('memo で渡せばそのまま通る', () => {
    expect(normalizePostRecord({ captureId: 'cap-memo-1', memo: 'ここに注釈' } as never, fixedNow).memo).toBe('ここに注釈');
  });

  test('旧 description しか無いレコードは memo として読める', () => {
    expect(normalizePostRecord({ captureId: 'cap-memo-2', description: '旧フィールドの注釈' } as never, fixedNow).memo).toBe('旧フィールドの注釈');
  });

  test('両方あれば memo を優先する', () => {
    expect(normalizePostRecord({ captureId: 'cap-memo-3', memo: '新', description: '旧' } as never, fixedNow).memo).toBe('新');
  });
});

// The very reason this builder exists (#5, comment from 2026-07-18):
// importPostRecords in app/src/main/ipc-transfer.ts (the import-posts handler at the
// time) listed ~30 fields by hand, and silently dropped media[] and replyToId. The
// shared builder can't drop a field the producing side put in = the most it can do is
// fill in a default for something that was omitted.
describe('生成側が入れたフィールドは落とさない', () => {
  const rec = normalizePostRecord({ captureId: 'cap-3', media: [{ url: 'https://x/1.jpg', file: '1.jpg' }], replyToId: 'parent-123' }, fixedNow);

  test('media が生き残る', () => {
    expect(rec.media).toHaveLength(1);
  });

  test('replyToId が生き残る', () => {
    expect(rec.replyToId).toBe('parent-123');
  });
});

// #188: confirms pixiv series info (extension/utils/extractor/pixiv.ts) makes it all the way through.
describe('シリーズ情報（#188）', () => {
  test('seriesId/seriesTitle/seriesOrder がそのまま通る', () => {
    const rec = normalizePostRecord({ captureId: 'cap-4', seriesId: '999', seriesTitle: 'ある冒険', seriesOrder: 3 }, fixedNow);
    expect({ seriesId: rec.seriesId, seriesTitle: rec.seriesTitle, seriesOrder: rec.seriesOrder }).toEqual({ seriesId: '999', seriesTitle: 'ある冒険', seriesOrder: 3 });
  });

  test('seriesOrder は数値以外を落とす（他の number フィールドと同じ規約）', () => {
    const rec = normalizePostRecord({ captureId: 'cap-5', seriesOrder: '3' as any }, fixedNow);
    expect(rec.seriesOrder).toBeNull();
  });
});

// #180: quoted/renoted and (Misskey-only) reply-to sidecar sub-records — this
// is the ONE gate every producer's raw extension output passes through, so
// it's what decides whether a malformed sub-record reaches the DB writer as
// something other than a clean QuotedPostShape or null.
describe('quotedPost / replyToPost（#180）', () => {
  const sample = { url: 'https://x.com/bob/status/9', displayName: 'Bob', screenName: 'bob', userId: '2', avatar: null, text: 'hi', date: '2026-01-01T00:00:00.000Z', cw: null, media: [] };

  test('妥当なサブレコードはそのまま通る', () => {
    const rec = normalizePostRecord({ captureId: 'cap-6', quotedPost: sample, replyToPost: sample }, fixedNow);
    expect(rec.quotedPost).toEqual(sample);
    expect(rec.replyToPost).toEqual(sample);
  });

  test('media[] も他フィールドと同じ正規化を通る（不正エントリは落ちる）', () => {
    const withBadMedia = { ...sample, media: [{ url: 'https://x.com/a.jpg', alt: null, width: null, height: null, file: '' }, 'not an object' as any] };
    const rec = normalizePostRecord({ captureId: 'cap-7', quotedPost: withBadMedia }, fixedNow);
    expect(rec.quotedPost?.media).toEqual([{ url: 'https://x.com/a.jpg', alt: null, width: null, height: null, file: '', type: null, posterFile: null, frames: null }]);
  });

  test.each([undefined, null, 'not an object', 42, []])('オブジェクトでない値は %p でも null に落ちる（all-or-nothing）', (bad) => {
    const rec = normalizePostRecord({ captureId: 'cap-8', quotedPost: bad as any }, fixedNow);
    expect(rec.quotedPost).toBeNull();
  });
});

// #492: the single rule that decides "what does the library actually have for this
// post". The bridge refuses via this before writing, and the badge index
// (app/src/main/lib-saved-index.ts) writes the same rule in SQL to decide whether to
// answer "saved". If the two drift apart, a post holding no content stays badged as
// saved, and every intake afterward skips it = it can never be retried.
describe('recordHoldsContent — 投稿の中身を持っているか', () => {
  // A record holding nothing but what can be recovered from the URL = a shell. Since
  // screenName comes from the URL and date from the post id, having these filled in still doesn't count as "actually fetched".
  const shell = { captureId: 'cap-shell', url: 'https://x.com/u/status/1', platform: 'x', screenName: 'u', date: '2026-06-23T11:15:10.728Z' };

  test('殻は false', () => {
    expect(recordHoldsContent(normalizePostRecord(shell, fixedNow))).toBe(false);
  });

  test.each([
    ['テキストのみ投稿（#365）', { text: 'hi' }],
    ['スクリーンショット', { image: 'cap.jpg' }],
    ['動画', { video: 'cap.mp4' }],
    ['タイトル（pixiv）', { title: '作品名' }],
    ['投稿者名だけ取れた', { displayName: 'Someone' }],
    ['メディアが落ちている', { media: [{ url: 'https://x/1.jpg', file: '1.jpg' }] }],
  ])('%s は true', (_label, extra) => {
    expect(recordHoldsContent(normalizePostRecord({ ...shell, ...extra }, fixedNow))).toBe(true);
  });

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['空オブジェクト', {}],
    ['空文字だけ', { text: '', image: '', title: '', displayName: '', media: [] }],
  ])('%s は false（正規化前の生の形でも落ちない）', (_label, rec) => {
    expect(recordHoldsContent(rec as never)).toBe(false);
  });
});

// #496: image is the stills field. A record with a video file put there can't be
// displayed end to end = the read side treats image as a still, so <img> gets handed an
// mp4 and renders nothing, and there's no field left pointing at the poster image that
// sits on disk (it just gets counted as orphan media). writePost funnels every record
// through here, so this is the sole gate keeping posts.image from ever holding a video's name.
describe('image に動画ファイルは置かせない（#496）', () => {
  test.each([['mp4'], ['webm'], ['mov'], ['m4v']])('.%s は video 欄へ移す', (ext) => {
    const rec = normalizePostRecord({ captureId: 'cap-v', image: `cap-v-media-0.${ext}` }, fixedNow);
    expect(rec.image).toBeNull();
    expect(rec.video).toBe(`cap-v-media-0.${ext}`);
  });

  test('静止画はそのまま image に残る', () => {
    const rec = normalizePostRecord({ captureId: 'cap-s', image: 'cap-s.jpg' }, fixedNow);
    expect(rec.image).toBe('cap-s.jpg');
    expect(rec.video).toBeNull();
  });

  // If both are filled in, whichever side wrote video is authoritative = the misplaced one isn't a still either, so it's discarded
  test('video が既にあれば上書きしない', () => {
    const rec = normalizePostRecord({ captureId: 'cap-b', image: 'wrong.mp4', video: 'right.mp4' }, fixedNow);
    expect(rec.image).toBeNull();
    expect(rec.video).toBe('right.mp4');
  });

  // Meshes with the #492 rule = merely moving the field must not demote it to "no content"
  test('移した後も recordHoldsContent は true', () => {
    expect(recordHoldsContent(normalizePostRecord({ captureId: 'cap-h', image: 'cap-h-media-0.mp4' }, fixedNow))).toBe(true);
  });

  test.each([
    ['mp4', 'a.mp4', true],
    ['大文字', 'A.MP4', true],
    ['jpg', 'a.jpg', false],
    ['うごイラの zip（動画ではない）', 'u-media-0.zip', false],
    ['拡張子なし', 'a', false],
    ['null', null, false],
  ])('isVideoFileName: %s', (_label, name, expected) => {
    expect(isVideoFileName(name as string | null)).toBe(expected);
  });
});
