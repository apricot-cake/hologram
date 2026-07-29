// native-host/post-record.mts のユニットテスト＝投稿レコードの共有スキーマと正規化
// ビルダー（#5 St2 / #295）。素の Node で動く（Electron 不要）。

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
    expect(rec.media[0]).toEqual({ url: 'https://x/1.jpg', alt: null, width: 10, height: 20, file: '1.jpg', type: null, posterFile: null, frames: null });
  });

  test('url を欠く media エントリにも全フィールドが入る', () => {
    expect(rec.media[1]).toEqual({ url: '', alt: null, width: null, height: null, file: '2.jpg', type: null, posterFile: null, frames: null });
  });

  test('動画の media は type と posterFile を運ぶ（#119 St1）', () => {
    expect(rec.media[2]).toEqual({ url: 'https://x/2.mp4', alt: null, width: null, height: null, file: '2.mp4', type: 'video', posterFile: 'poster.jpg', frames: null });
  });

  // #119 St3: コマ表は全か無か＝1件でも壊れていたら以降のコマが絵とずれる。
  // 部分的に生き残らせるより、再生できない（＝ポスターを見せる）方が正しい。
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

// #492: 「ライブラリはこの投稿の何を持っているか」を1か所で決める規則。ブリッジは書く前に
// これで断り、バッジの索引（app/src/main/lib-saved-index.ts）は同じ規則を SQL で書いて
// 「保存済み」と答えるかを決める。両者がずれると、中身を持たない投稿にバッジが点いたまま
// 残り、以後の取込がそれを飛ばす＝取り直せなくなる。
describe('recordHoldsContent — 投稿の中身を持っているか', () => {
  // URL から復元できるものしか無いレコード＝殻。screenName は URL から、date は投稿 id
  // から取れるので、これらが埋まっていても「取得できた」ことにはならない。
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

// #496: image は静止画の欄。動画ファイルがそこに入ったレコードは端から端まで表示できない
// ＝読む側は image を静止画として扱うので <img> に mp4 が渡って何も描かれず、ディスクに
// あるポスター画像を指す欄も残らない（孤児メディアとして計上されるだけになる）。
// writePost は全レコードをここへ通すので、posts.image が動画名を持てない唯一の関門。
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

  // 両方入っていたら video を書いた側の指定が正＝置き違えた方は静止画でもないので捨てる
  test('video が既にあれば上書きしない', () => {
    const rec = normalizePostRecord({ captureId: 'cap-b', image: 'wrong.mp4', video: 'right.mp4' }, fixedNow);
    expect(rec.image).toBeNull();
    expect(rec.video).toBe('right.mp4');
  });

  // #492 の規則との噛み合わせ＝欄を移しただけで「中身なし」に転落させない
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
