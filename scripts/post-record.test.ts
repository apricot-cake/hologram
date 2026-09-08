// native-host/post-record.mts ＝投稿レコードの共有スキーマと、その正規化ビルダーの
// 単体テスト（#5 St2 / #295）。素の Node で動く（Electron は要らない）。

import { describe, expect, test } from 'vitest';
import { isVideoFileName, normalizePostRecord, recordHoldsContent } from '../native-host/post-record.mts';

const FIXED_NOW = '2026-07-24T00:00:00.000Z';
const fixedNow = () => FIXED_NOW;

describe('既定値', () => {
  const rec = normalizePostRecord({ captureId: 'cap-1' }, fixedNow);

  test('どの生成側も自分で入れる唯一のフィールドは運ぶ', () => {
    expect(rec.captureId).toBe('cap-1');
  });

  test('capturedAt は無ければ now() へ落ちる', () => {
    expect(rec.capturedAt).toBe(FIXED_NOW);
  });

  // extension/background.ts の buildRecord と同じ挙動
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
    'bio',
    'profileLinks',
    'banner',
    'bannerFile',
    'authorCreatedAt',
    'date',
    'capturedVia',
    'lang',
    'quotedUrl',
    'replyToId',
    'quotedPost',
    'replyToPost',
    'poll',
    'linkCard',
    'seriesId',
    'seriesTitle',
    'seriesOrder',
    'cw',
    'eagleName',
    'source',
    'trashedAt',
    'followers',
    'following',
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
    'metaSource',
  ])('%s の既定は null', (k) => {
    expect(rec[k]).toBeNull();
  });

  // false ではなく三値（unknown/true/false）
  test.each(['isReply', 'isQuote', 'isThread', 'isEdited', 'sensitive', 'shotAnimated'])('%s の既定は null（三値）', (k) => {
    expect(rec[k]).toBeNull();
  });
});

describe('#8: shotAnimated（カード画像が animated webp か）', () => {
  test('true が素通しされる', () => {
    const rec = normalizePostRecord({ captureId: 'cap-anim', shotW: 300, shotH: 200, shotAnimated: true }, fixedNow);
    expect(rec.shotAnimated).toBe(true);
  });

  test('false が素通しされる（静止 webp）', () => {
    const rec = normalizePostRecord({ captureId: 'cap-still', shotW: 300, shotH: 200, shotAnimated: false }, fixedNow);
    expect(rec.shotAnimated).toBe(false);
  });
});

describe('投稿スキーマの検証', () => {
  test('取得値、既定値、タグの正規化を共通定義で組み立てる', () => {
    const rec = normalizePostRecord({ captureId: 'cap-2', likes: 42, sensitive: false, hashtags: [' ＡＢＣ ', 'ABC'], tags: ['猫'], media: [{ url: 'https://example.com/a.jpg', file: 'a.jpg' }], replyToId: 'parent', capturedAt: FIXED_NOW }, fixedNow);
    expect(rec).toMatchObject({ likes: 42, sensitive: false, hashtags: ['ABC'], tags: ['猫'], replyToId: 'parent', capturedAt: FIXED_NOW, updatedAt: FIXED_NOW });
    expect(rec.media[0]).toEqual({ url: 'https://example.com/a.jpg', file: 'a.jpg', alt: null, width: null, height: null, type: null, posterFile: null, frames: null, crop: null });
  });
  test('引用、アンケート、リンクカード、プロフィールを保持する', () => {
    const input = {
      captureId: 'nested',
      quotedPost: { text: 'quote', media: [{ url: 'https://example.com/q.jpg' }] },
      replyToPost: { text: 'parent' },
      poll: { choices: [{ text: 'Yes', votes: 0 }], multiple: false },
      linkCard: { url: 'https://example.com/article' },
      profileLinks: [{ name: 'web', value: 'https://example.com' }],
      metaSource: { title: 'ogp' },
    };
    const rec = normalizePostRecord(input, fixedNow);
    expect(rec.quotedPost?.text).toBe('quote');
    expect(rec.replyToPost?.text).toBe('parent');
    expect(rec.poll).toMatchObject({ choices: [{ text: 'Yes', votes: 0 }], multiple: false });
    expect(rec.linkCard).toEqual({ url: 'https://example.com/article', title: null, description: null, thumbnailFile: null });
    expect(rec.profileLinks).toEqual(input.profileLinks);
    expect(rec.metaSource).toEqual(input.metaSource);
  });
  test('うごイラの順序と遅延を保持する', () => {
    const frames = [
      { file: '0.jpg', delay: 60 },
      { file: '1.jpg', delay: 30 },
    ];
    expect(normalizePostRecord({ captureId: 'ugoira', media: [{ file: 'u.zip', type: 'ugoira', frames }] }, fixedNow).media[0].frames).toEqual(frames);
  });
  test.each([
    { captureId: '' },
    { captureId: undefined },
    { likes: '42' },
    { likes: -1 },
    { views: 1.5 },
    { likes: Number.NaN },
    { followers: Infinity },
    { text: 3 },
    { sensitive: 'false' },
    { hashtags: ['a', 3] },
    { tags: null },
    { media: [null] },
    { media: [{ width: '10' }] },
    { media: [{ crop: { x: 0.8, y: 0, width: 0.5, height: 1 } }] },
    { media: [{ frames: [] }] },
    { media: [{ frames: [{ file: '0.jpg', delay: '60' }] }] },
    { quotedPost: 'quote' },
    { quotedPost: { media: [null] } },
    { poll: { choices: [] } },
    { poll: { choices: [{ text: '', votes: 1 }] } },
    { poll: { choices: [{ text: 'Yes', votes: '1' }] } },
    { linkCard: { title: 'missing url' } },
    { profileLinks: [{ name: 'web' }] },
    { metaSource: { title: 1 } },
    { capturedAt: '' },
    { updatedAt: null },
    { imageIndex: '2' },
    { seriesOrder: '3' },
  ])('不正値を欠損へ読み替えない: %j', (bad) => {
    expect(() => normalizePostRecord({ captureId: 'invalid', ...bad } as never, fixedNow)).toThrow();
  });
});

// #492:「この投稿についてライブラリが実際に何を持っているか」を決める唯一の規則。
// ブリッジは書き込む前にこれで断り、印の索引（app/src/main/lib-saved-index.ts）は
//「保存済み」と答えるかどうかを決めるのに同じ規則を SQL で書いている。この2つが
// ずれると、中身を持たない投稿が保存済みの印のまま残り、以後の取り込みはそれを
// 飛ばす＝二度とやり直せない。
describe('recordHoldsContent — 投稿の中身を持っているか', () => {
  // URL から復元できるものしか持たないレコード＝殻。screenName は URL から、date は
  // 投稿 id から来るので、これらが埋まっていても「実際に取得できた」とは数えない。
  const shell = { captureId: 'cap-shell', url: 'https://x.com/u/status/1', platform: 'x', screenName: 'u', date: '2026-06-23T11:15:10.728Z' };

  test('殻は false', () => {
    expect(recordHoldsContent(normalizePostRecord(shell, fixedNow))).toBe(false);
  });

  test.each([
    ['テキストのみ投稿（#365）', { text: 'hi' }],
    ['ローカル画像', { image: 'cap.jpg' }],
    ['動画', { video: 'cap.mp4' }],
    ['タイトル（pixiv）', { title: '作品名' }],
    ['投稿者名だけ取れた', { displayName: 'Someone' }],
    ['メディアが落ちている', { media: [{ url: 'https://x/1.jpg', file: '1.jpg' }] }],
    ['リンクカードのみ（#181, コメント無しのリンク共有）', { linkCard: { url: 'https://example.com/article', title: null, description: null, thumbnailFile: null } }],
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

// #496: image は静止画の欄。動画ファイルをそこに置いたレコードは最後まで表示できない
// ＝読み手側は image を静止画として扱うので、<img> に mp4 が渡って何も描かれない。
// しかもディスク上にあるポスター画像を指すフィールドが残らない（孤児メディアとして
// 数えられるだけ）。writePost はすべてのレコードをここへ通すので、posts.image が動画の
// 名前を持つことを防ぐ唯一のゲートがここ。
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

  // 両方埋まっていれば video を書いた側が正＝置き場所を間違えた方は静止画でもないので捨てる
  test('video が既にあれば上書きしない', () => {
    const rec = normalizePostRecord({ captureId: 'cap-b', image: 'wrong.mp4', video: 'right.mp4' }, fixedNow);
    expect(rec.image).toBeNull();
    expect(rec.video).toBe('right.mp4');
  });

  // #492 の規則と噛み合う＝フィールドを移しただけで「中身なし」へ格下げしてはいけない
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
