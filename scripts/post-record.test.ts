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
    'memo',
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

describe('素通しと変換', () => {
  const rec = normalizePostRecord(
    {
      captureId: 'cap-2',
      url: 'https://bsky.app/profile/a/post/b',
      likes: 42,
      isReply: true,
      isEdited: true,
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

  test('isEdited もそのまま通る', () => {
    expect(rec).toMatchObject({ isEdited: true });
  });

  // #178: isEdited と違い、sensitive=false はプラットフォームが実際に答えた
  //「確定値」だ。null に丸めずに生き残らせなければならない。
  test('sensitive=false もそのまま通る（isEdited と違い null に丸めない）', () => {
    const withFalse = normalizePostRecord({ captureId: 'cap-2b', cw: 'spoiler text', sensitive: false }, fixedNow);
    expect(withFalse).toMatchObject({ cw: 'spoiler text', sensitive: false });
  });

  test('文字列でないハッシュタグは落とす（変換しない）', () => {
    expect(rec.hashtags).toEqual(['a', 'b']);
  });

  // #197: hashtags/tags には保存パイプラインのこの1か所で NFKC と trim をかける。
  // pixiv のようなプラットフォームが原本の表記のまま渡してくるグリフの揺れ（全角・
  // 半角、前後の空白）はここで畳む。そうしないと語彙の一覧と件数の集計が割れて出る。
  // 大小文字とカナ⇔かなは一切畳まない。
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
    expect(rec.media[0]).toEqual({ url: 'https://x/1.jpg', alt: null, width: 10, height: 20, file: '1.jpg', type: null, posterFile: null, frames: null, crop: null });
  });

  test('url を欠く media エントリにも全フィールドが入る', () => {
    expect(rec.media[1]).toEqual({ url: '', alt: null, width: null, height: null, file: '2.jpg', type: null, posterFile: null, frames: null, crop: null });
  });

  test('動画の media は type と posterFile を運ぶ（#119 St1）', () => {
    expect(rec.media[2]).toEqual({ url: 'https://x/2.mp4', alt: null, width: null, height: null, file: '2.mp4', type: 'video', posterFile: 'poster.jpg', frames: null, crop: null });
  });

  // #119 St3: コマ表は all-or-nothing ＝エントリが1件でも壊れていれば、それ以降の
  // コマが絵とずれる。部分的に残すより、再生できなくする（＝ポスターを見せる）方が
  // 正しい。
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

  // #560: 拡張機能はこの2つのフィールドを長く送っていたが、ここで落とされ DB の列も
  // 無かった。そのためインスペクタの「N / M」の画像カウンタが一度も出なかった。
  test('imageIndex / imageCount が通る（#560 ドラッグ保存の元投稿での位置）', () => {
    expect({ imageIndex: rec.imageIndex, imageCount: rec.imageCount }).toEqual({ imageIndex: 2, imageCount: 4 });
  });

  test('数でない imageIndex / imageCount は null になる', () => {
    const bad = normalizePostRecord({ captureId: 'cap-3', imageIndex: '2', imageCount: Number.NaN } as never, fixedNow);
    expect({ imageIndex: bad.imageIndex, imageCount: bad.imageCount }).toEqual({ imageIndex: null, imageCount: null });
  });
});

// #36: memo は Eagle 移行時代の `description` フィールドを置き換えるもの。新しく
// 作ったレコードは新しいキーで持つ。改名より前のレコード（#36 以前のサイドカー・
// ZIP 書き出し、あるいは今も `description` を書く外部の Eagle 移行コンバータの出力）
// も、引き続きメモとして読めなければならない。
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

// このビルダーがそもそも存在する理由（#5、2026-07-18 のコメント）:
// 当時の import-posts ハンドラだった app/src/main/ipc-transfer.ts の
// importPostRecords は約30のフィールドを手で並べていて、media[] と replyToId を黙って
// 落としていた。共有のビルダーは生成側が入れたフィールドを落とせない＝できるのは、
// 省かれたものに既定値を埋めることまで。
describe('生成側が入れたフィールドは落とさない', () => {
  const rec = normalizePostRecord({ captureId: 'cap-3', media: [{ url: 'https://x/1.jpg', file: '1.jpg' }], replyToId: 'parent-123' }, fixedNow);

  test('media が生き残る', () => {
    expect(rec.media).toHaveLength(1);
  });

  test('replyToId が生き残る', () => {
    expect(rec.replyToId).toBe('parent-123');
  });
});

// #188: pixiv のシリーズ情報（extension/utils/extractor/pixiv.ts）が最後まで通ることを確かめる。
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

// #179: アンケート（extension/utils/extractor/x.ts）も、他の生成側
// フィールドと同じ唯一のゲートを通る。壊れたものが DB の書き手へ届く前に止まるのは
// ここ。
describe('アンケート（#179）', () => {
  test('選択肢を保ち、ラベルの無い選択肢だけを落とす', () => {
    const rec = normalizePostRecord(
      {
        captureId: 'cap-poll-1',
        poll: { choices: [{ text: 'Yes', votes: 3 }, { text: '', votes: 9 }, null, { text: 'No', votes: '1' }], multiple: true, expiresAt: '2026-01-02T00:00:00Z' },
      } as any,
      fixedNow,
    );
    expect(rec.poll).toEqual({
      // votes: '1' は文字列なので、ここの他の number フィールドと同じように
      // null へ正規化される＝決して型変換しない。
      choices: [
        { text: 'Yes', votes: 3 },
        { text: 'No', votes: null },
      ],
      multiple: true,
      expiresAt: '2026-01-02T00:00:00Z',
    });
  });

  test('選択肢が1つも無ければ poll ごと null', () => {
    expect(normalizePostRecord({ captureId: 'cap-poll-2', poll: { choices: [] } } as any, fixedNow).poll).toBeNull();
    expect(normalizePostRecord({ captureId: 'cap-poll-3', poll: { multiple: true } } as any, fixedNow).poll).toBeNull();
    expect(normalizePostRecord({ captureId: 'cap-poll-4', poll: 'yes' } as any, fixedNow).poll).toBeNull();
  });
});

// #181: OGP のプレビューカード（extension/utils/extractor/{bluesky,x}.ts）も、
// 他の生成側フィールドと同じ唯一のゲートを通る＝行き先の url を持たないカードが DB の
// 書き手へ届く前に落ちるのはここ。下の quotedPost と同じ all-or-nothing の形だが、
// ゲートがかかるのは `url` だけで、全フィールドが揃っていることは求めない（title /
// description / thumbnailFile はそれぞれ独立に省略できる）。
describe('リンクカード（#181）', () => {
  test('妥当なカードはそのまま通る（thumbnailFile はブリッジが後から埋める）', () => {
    const rec = normalizePostRecord({ captureId: 'cap-card-1', linkCard: { url: 'https://example.com/article', title: 'A great article', description: 'It explains things.', thumbnailFile: 'cap-card-1-linkcard.jpg' } }, fixedNow);
    expect(rec.linkCard).toEqual({ url: 'https://example.com/article', title: 'A great article', description: 'It explains things.', thumbnailFile: 'cap-card-1-linkcard.jpg' });
  });

  test('サムネが無い（未取得/取得失敗）カードもテキストは残る', () => {
    const rec = normalizePostRecord({ captureId: 'cap-card-2', linkCard: { url: 'https://example.com/no-image', title: 'No image', description: null, thumbnailFile: null } }, fixedNow);
    expect(rec.linkCard).toEqual({ url: 'https://example.com/no-image', title: 'No image', description: null, thumbnailFile: null });
  });

  test('url の無いカードは丸ごと null（url だけが必須のゲート）', () => {
    expect(normalizePostRecord({ captureId: 'cap-card-3', linkCard: { title: 'no url', description: null, thumbnailFile: null } } as any, fixedNow).linkCard).toBeNull();
  });

  test.each([undefined, null, 'not an object', 42, []])('オブジェクトでない値は %p でも null に落ちる', (bad) => {
    expect(normalizePostRecord({ captureId: 'cap-card-4', linkCard: bad as any }, fixedNow).linkCard).toBeNull();
  });
});

// #239: 対応サイト外の画像保存でページ文脈を抽出する経路において、
// title/description/author/published/siteName/url をそれぞれ何が埋めたか（上の
// linkCard のような形の決まったサブレコードではなく、フィールド名 → 出所の文字列と
// いう素のマップ）。
describe('metaSource（#239）', () => {
  test('妥当な文字列マップはそのまま通る', () => {
    const rec = normalizePostRecord({ captureId: 'cap-meta-1', metaSource: { title: 'ogp', author: 'jsonld', url: 'canonical' } }, fixedNow);
    expect(rec.metaSource).toEqual({ title: 'ogp', author: 'jsonld', url: 'canonical' });
  });

  test('文字列でない値を持つキーは黙って落とす（残りは通す）', () => {
    const rec = normalizePostRecord({ captureId: 'cap-meta-2', metaSource: { title: 'ogp', author: 42 as any, published: null as any } }, fixedNow);
    expect(rec.metaSource).toEqual({ title: 'ogp' });
  });

  test('全キーが文字列でない＝空オブジェクトでなく null', () => {
    const rec = normalizePostRecord({ captureId: 'cap-meta-3', metaSource: { author: 42 as any } }, fixedNow);
    expect(rec.metaSource).toBeNull();
  });

  test.each([undefined, null, 'not an object', 42, []])('オブジェクトでない値は %p でも null に落ちる', (bad) => {
    expect(normalizePostRecord({ captureId: 'cap-meta-4', metaSource: bad as any }, fixedNow).metaSource).toBeNull();
  });
});

// #180: 引用と返信先のサイドカーのサブレコード＝
// 生成側の生の拡張機能出力が通る唯一のゲートがここ。壊れたサブレコードが、きれいな
// QuotedPostShape でも null でもない何かとして DB の書き手へ届くかどうかを決めている。
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
    expect(rec.quotedPost?.media).toEqual([{ url: 'https://x.com/a.jpg', alt: null, width: null, height: null, file: '', type: null, posterFile: null, frames: null, crop: null }]);
  });

  test.each([undefined, null, 'not an object', 42, []])('オブジェクトでない値は %p でも null に落ちる（all-or-nothing）', (bad) => {
    const rec = normalizePostRecord({ captureId: 'cap-8', quotedPost: bad as any }, fixedNow);
    expect(rec.quotedPost).toBeNull();
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
