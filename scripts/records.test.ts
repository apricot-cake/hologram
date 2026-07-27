// records.ts のロジック単体テスト。URL→キー正規化（postKeyOf）・スタンプ（stampPost）・
// レコード形状ヘルパ・グルーピング（makeGroupRecords＝manualGroups/ungrouped をゲッター注入）・
// ギャラリー・カードのビューモデル・percentileFn を直接検証する。

import { beforeEach, describe, expect, test } from 'vitest';
import * as R from '../app/src/renderer/src/services/records';

describe('postKeyOf: URL → プラットフォーム別グループキー', () => {
  test.each([
    ['https://x.com/some_user/status/123456', 'x:123456'],
    ['https://twitter.com/some_user/status/123456', 'x:123456'], // x⇄twitter 統合
    ['https://x.com/u/status/123456?s=20', 'x:123456'],
    ['https://bsky.app/profile/alice.bsky.social/post/3kabc', 'bluesky:alice.bsky.social/3kabc'],
    ['https://mstdn.jp/@user/112233', 'mastodon:mstdn.jp:112233'], // ホスト込み
    ['https://misskey.io/notes/9abcdef', 'misskey:misskey.io:9abcdef'],
    ['https://www.pixiv.net/artworks/9900', 'pixiv:9900'],
    ['https://www.pixiv.net/en/artworks/9900', 'pixiv:9900'], // 言語プレフィックス
  ])('%s → %s', (url, expected) => {
    expect(R.postKeyOf(url)).toBe(expected);
  });

  test.each([['', null, 'not a url', 'https://x.com/some_user']].flat())('キーにならないものは null: %s', (url) => {
    expect(R.postKeyOf(url)).toBeNull();
  });
});

describe('stampPost: 並べ替え用タイムスタンプとグループキーの前計算', () => {
  test('揃っていれば全部埋まる', () => {
    const p = R.stampPost({ url: 'https://x.com/u/status/7', date: '2026-04-01T10:00:00Z', capturedAt: '2026-04-02T10:00:00Z', quotedUrl: 'https://x.com/v/status/8' });

    expect(p._dateMs).toBe(+new Date('2026-04-01T10:00:00Z'));
    expect(p._capturedMs).toBe(+new Date('2026-04-02T10:00:00Z'));
    expect(p._postKey).toBe('x:7');
    expect(p._quotedKey).toBe('x:8');
  });

  test('欠けていれば 0 / null', () => {
    expect(R.stampPost({})).toMatchObject({ _dateMs: 0, _capturedMs: 0, _postKey: null, _quotedKey: null });
  });
});

describe('レコード形状ヘルパ', () => {
  const shot = { image: 'a.jpg', media: [] };
  const drag = { image: 'b.jpg', source: 'drag' };
  const eagle = { image: 'c.png', source: 'eagle-migration' };
  const withMedia = { image: 'd.jpg', media: [{ file: 'm1.png' }, { file: 'm2.png' }, {}] };

  test('mediaFilesOf は有効な file だけ', () => {
    expect(R.mediaFilesOf(withMedia)).toEqual(['m1.png', 'm2.png']);
    expect(R.mediaFilesOf({})).toEqual([]);
  });

  test('isScreenshot は jpg のキャプチャだけ', () => {
    expect(R.isScreenshot(shot)).toBe(true);
    expect(R.isScreenshot(drag)).toBe(false); // drag は除外
    expect(R.isScreenshot(eagle)).toBe(false); // 非 JPEG は除外
  });

  test('captureFile はスクショのみ', () => {
    expect(R.captureFile(shot)).toBe('a.jpg');
    expect(R.captureFile(drag)).toBe('');
  });

  test('artworkFile は media 優先、無ければ非スクショの image', () => {
    expect(R.artworkFile(withMedia)).toBe('m1.png');
    expect(R.artworkFile(eagle)).toBe('c.png');
  });

  test('densityImage は list=キャプチャ優先・card=アートワーク優先', () => {
    expect(R.densityImage(withMedia, 'list')).toBe('d.jpg');
    expect(R.densityImage(withMedia, 'card')).toBe('m1.png');
  });

  test('groupFilesOf は media が無ければ artwork', () => {
    expect(R.groupFilesOf(eagle)).toEqual(['c.png']);
  });

  test('postIdKey は captureId 優先＋フォールバック', () => {
    expect(R.postIdKey({ captureId: 'c1' })).toBe('c1');
    expect(R.postIdKey({ url: 'u', capturedAt: 't' })).toBe('u|t');
  });

  // #119 St1: 動画が先頭の media[] はポスターを静止画サムネに使う（生の動画は <img src> に
  // できない）。ポスターが無ければ densityImage の cap||art 順でキャプチャへ落ちる。
  describe('動画つき（#119 St1）', () => {
    const withVideoPoster = { image: 'shot.jpg', media: [{ file: 'clip.mp4', type: 'video', posterFile: 'clip-poster.jpg' }] };
    const withVideoNoPoster = { image: 'shot.jpg', media: [{ file: 'clip.mp4', type: 'video' }] };

    test('artworkFile はポスターがあればそれを採る', () => {
      expect(R.artworkFile(withVideoPoster)).toBe('clip-poster.jpg');
    });

    test('ポスターが無ければ空（生の動画を <img> へ渡さない）', () => {
      expect(R.artworkFile(withVideoNoPoster)).toBe('');
    });

    test('densityImage card はポスター無しならスクショへ落ちる', () => {
      expect(R.densityImage(withVideoNoPoster, 'card')).toBe('shot.jpg');
    });

    test('mediaFilesOf は type を問わず実ファイルを返す（ギャラリー用）', () => {
      expect(R.mediaFilesOf(withVideoPoster)).toEqual(['clip.mp4']);
    });
  });
});

// #144: 引数は image エントリ由来の { id?, recs }（旧 { img:{recs} } タブ形は廃止）
describe('imageTabGroup / imageTabTitleOf', () => {
  const shot: any = { captureId: 'a', image: 'a.jpg', media: [] };
  const art: any = { captureId: 'b', image: 'b.png', source: 'drag', text: 'hi', media: [{ file: 'm.png' }] };
  const lib = new Map([
    ['a', shot],
    ['b', art],
  ]);
  const byId = (id: string) => lib.get(id);

  test('key と rep（スクショ優先＝groupRecords と同じ）', () => {
    const g = R.imageTabGroup({ id: 't1', recs: ['a', 'b'] }, byId);
    expect(g.key).toBe('imgtab:t1');
    expect(g.rep).toBe(shot);
  });

  // files は flatMap(groupFilesOf)＝「作品ページ」だけ（スクショは artwork を持たず空）
  test('records の解決と files', () => {
    const g = R.imageTabGroup({ id: 't1', recs: ['a', 'b'] }, byId);
    expect(g.records).toHaveLength(2);
    expect(g.files).toEqual(['m.png']);
  });

  test('1件も解決できなければ null（missing 状態へ縮退）', () => {
    expect(R.imageTabGroup({ id: 't2', recs: ['x', 'y'] }, byId)).toBeNull();
    expect(R.imageTabGroup({ id: 't3', recs: undefined }, byId)).toBeNull();
  });

  test('タイトルは text→title→displayName→フォールバックで、24字超は省略', () => {
    expect(R.imageTabTitleOf({ rep: { text: 'hello world' } }, '無題')).toBe('hello world');
    expect(R.imageTabTitleOf({ rep: { title: 'あ'.repeat(30) } }, '無題')).toBe(`${'あ'.repeat(24)}…`);
    expect(R.imageTabTitleOf({ rep: { displayName: 'nick' } }, '無題')).toBe('nick');
    expect(R.imageTabTitleOf({ rep: {} }, '無題')).toBe('無題');
  });
});

describe('makeGroupRecords', () => {
  let manualGroups: any[];
  let ungrouped: Set<string>;
  let groupRecords: (list: any[]) => any[];

  const mk = (over: any) => R.stampPost(Object.assign({ media: [], tags: [], hashtags: [] }, over));
  const a1 = mk({ captureId: 'a1', url: 'https://x.com/u/status/1', userId: 'u1', image: 'a1.jpg', text: '' });
  const a2 = mk({ captureId: 'a2', url: 'https://x.com/u/status/1', userId: 'u1', image: 'a2.png', source: 'drag', text: 'つづき' });
  const b = mk({ captureId: 'b0', url: 'https://x.com/u/status/2', userId: 'u1', image: 'b.jpg', text: '' });

  beforeEach(() => {
    manualGroups = [];
    ungrouped = new Set();
    groupRecords = R.makeGroupRecords({ manualGroups: () => manualGroups, ungrouped: () => ungrouped });
  });

  describe('同一 URL の自動グループ', () => {
    test('1グループへ集約する', () => {
      const gs = groupRecords([a2, a1, b]);
      expect(gs).toHaveLength(2);
      expect(gs.find((g) => g.records.length === 2)).toBeTruthy();
    });

    // replyToId 無し＋日付も同じ（未設定）→ captureId の決着で a1 が先
    test('連鎖が無ければ date/captureId のフォールバック順', () => {
      const ga = groupRecords([a2, a1, b]).find((g) => g.records.length === 2);
      expect(ga.records.map((r: any) => r.captureId)).toEqual(['a1', 'a2']);
    });

    test('rep はスクショ優先、files はグループ集約（drag は artwork 扱い）', () => {
      const ga = groupRecords([a2, a1, b]).find((g) => g.records.length === 2);
      expect(ga.rep).toBe(a1);
      expect(ga.files).toEqual(['a2.png']);
    });
  });

  test('手動グループが URL キーに勝つ', () => {
    manualGroups = [['a1', 'b0']];
    const manual = groupRecords([a1, a2, b]).find((g) => String(g.key).startsWith('manual:'));

    expect(manual.records).toHaveLength(2);
    expect(manual.records.map((r: any) => r.captureId)).toContain('b0');
  });

  // ゲッター注入＝再代入が生きていることの証明でもある
  test('ungrouped に入れると自動グループが解散する', () => {
    ungrouped = new Set(['x:1']);
    expect(groupRecords([a1, a2, b])).toHaveLength(3);
  });

  describe('セルフリプの合流', () => {
    const parent = mk({ captureId: 'p1', url: 'https://x.com/u/status/100', userId: 'u9', image: 'p.jpg', text: 'リプ元' });
    const child = mk({ captureId: 'p2', url: 'https://x.com/u/status/101', userId: 'u9', replyToId: '100', image: 'q.jpg', text: 'セルフリプ' });
    const other = mk({ captureId: 'p3', url: 'https://x.com/u/status/102', userId: 'OTHER', replyToId: '100', image: 'r.jpg', text: '他人のリプ' });

    test('同一作者の返信は親グループへ合流し、他人の返信は合流しない', () => {
      const gs = groupRecords([parent, child, other]);
      const merged = gs.find((g) => g.records.length === 2);

      expect(merged.records.map((r: any) => r.captureId).sort()).toEqual(['p1', 'p2']);
      expect(gs).toHaveLength(2);
    });

    // #89: captureId が返信の連鎖と逆順でも、根→葉でページ送りされなければならない
    // （旧 captureId 順は逆順を作っていた＝実害のあったバグ）
    test('連鎖順（根→葉）でページ送りされる（captureId 逆順でも）', () => {
      const root = mk({ captureId: 'z_root', url: 'https://x.com/u/status/1', userId: 'u1', image: 'z.jpg', text: '本編1' });
      const r1 = mk({ captureId: 'm_rep1', url: 'https://x.com/u/status/2', userId: 'u1', replyToId: '1', image: 'm.jpg', text: '本編2' });
      const r2 = mk({ captureId: 'a_rep2', url: 'https://x.com/u/status/3', userId: 'u1', replyToId: '2', image: 'a.jpg', text: '本編3' });

      // 入力ではなく並べ替えが決めていることを示すため、順序を崩して渡す
      const thread = groupRecords([r2, root, r1]).find((g) => g.records.length === 3);
      expect(thread.records.map((r: any) => r.captureId)).toEqual(['z_root', 'm_rep1', 'a_rep2']);
    });

    // 各投稿は「直近の親」のキーへ別名を張るので、別名の深さ＝スレッドの長さ。
    // 旧実装の固定深さ10の上限は、11件を超えるスレッドを複数カードへ割っていた。
    test('長いセルフリプ連鎖（15件）も1グループ', () => {
      const chain = Array.from({ length: 15 }, (_, i) =>
        mk({
          captureId: `c${String(i).padStart(2, '0')}`,
          url: `https://x.com/u/status/${200 + i}`,
          userId: 'u9',
          replyToId: i === 0 ? undefined : String(200 + i - 1),
          image: `c${i}.jpg`,
          text: '',
        }),
      );

      const gs = groupRecords(chain);
      expect(gs).toHaveLength(1);
      expect(gs[0].records).toHaveLength(15);
    });

    // 相互リプ（実在の SNS では不可能＝壊れたデータ）は別名の環を作る。
    // seen 集合のガードが無限ループでなく停止しなければならない。
    test('相互リプの環でも停止する', () => {
      const ra = mk({ captureId: 'r1', url: 'https://x.com/u/status/301', userId: 'u9', replyToId: '302', image: 'ra.jpg', text: '' });
      const rb = mk({ captureId: 'r2', url: 'https://x.com/u/status/302', userId: 'u9', replyToId: '301', image: 'rb.jpg', text: '' });

      expect(groupRecords([ra, rb])).toHaveLength(2);
    });
  });

  test('連鎖が無ければ date 昇順（captureId より date が優先）', () => {
    const early = mk({ captureId: 'zz', url: 'https://x.com/u/status/50', userId: 'u1', image: 'e.jpg', text: '', date: '2026-01-01T00:00:00Z' });
    const late = mk({ captureId: 'aa', url: 'https://x.com/u/status/50', userId: 'u1', image: 'l.jpg', text: '', date: '2026-06-01T00:00:00Z' });

    const g = groupRecords([late, early]).find((x) => x.records.length === 2);
    expect(g.records.map((r: any) => r.captureId)).toEqual(['zz', 'aa']);
  });
});

describe('percentileFn: プラットフォーム内の likes パーセンタイル', () => {
  const list = [
    { platform: 'x', likes: 0 },
    { platform: 'x', likes: 10 },
    { platform: 'x', likes: 100 },
    { platform: 'misskey', likes: 5 },
  ];
  const pct = R.percentileFn(list);

  test('最下位は 0・最上位は 1', () => {
    expect(pct(list[0])).toBe(0);
    expect(pct(list[2])).toBe(1);
  });

  test('そのプラットフォームに1件しかなければ 1', () => {
    expect(pct(list[3])).toBe(1);
  });

  test('プラットフォームごとに分離して数える', () => {
    expect(pct(list[1])).toBe(0.5);
  });
});

describe('makeGallery（ライトボックスの項目）', () => {
  const { buildGalleryItems, buildGroupGalleryItems } = R.makeGallery({ fileSrc: (f: string) => `stub://${f}` });
  const p1 = { image: 'shot.jpg', video: 'clip.mp4', media: [{ file: 'a.png', alt: 'A' }, { file: 'b.mp4' }, null, { file: '' }] };
  const items = buildGalleryItems(p1);

  // スクショは末尾へ回り、元画像（video→media）が先頭に立つ（#143＝サムネと元画像を一致させる）
  test('順序は元画像が先頭・キャプチャが末尾', () => {
    expect(items.map((i: any) => i.src)).toEqual(['stub://clip.mp4', 'stub://a.png', 'stub://b.mp4', 'stub://shot.jpg']);
  });

  test('video フラグ（video=true / media は拡張子判定 / 末尾のキャプチャ=false）', () => {
    expect(items.map((i: any) => i.video)).toEqual([true, false, true, false]);
  });

  test('alt を引き継ぐ（無指定は空）', () => {
    expect(items[1].alt).toBe('A');
    expect(items[0].alt).toBe('');
  });

  test('capture フラグは末尾だけ', () => {
    expect(items[3].capture).toBe(true);
    expect(items[0].capture).toBeUndefined();
  });

  test('null・空 file の media は飛ばす', () => {
    expect(items).toHaveLength(4);
  });

  // 本文だけの投稿はスクショが唯一かつ先頭（サムネ＝キャプチャと一致・特例不要）
  test('本文だけの投稿はキャプチャ1枚', () => {
    const textOnly = buildGalleryItems({ image: 'shot.jpg' });
    expect(textOnly).toHaveLength(1);
    expect(textOnly[0].src).toBe('stub://shot.jpg');
  });

  test('グループが1件なら rep の項目をそのまま', () => {
    const r1 = { image: 'shot.jpg' };
    expect(buildGroupGalleryItems({ records: [r1], rep: r1 })).toHaveLength(1);
  });

  test('グループが複数なら src で重複排除し、元画像先頭・キャプチャ末尾', () => {
    const r1 = { image: 'shot.jpg' };
    const r2 = { image: 'shot.jpg', media: [{ file: 'c.png' }] };

    expect(buildGroupGalleryItems({ records: [r1, r2], rep: r1 }).map((i: any) => i.src)).toEqual(['stub://c.png', 'stub://shot.jpg']);
  });
});

describe('makeCardModel（カード1枚のビューモデル）', () => {
  const STATIC_MSG: Record<string, string> = { qfThread: 'THREAD', qfReply: 'REPLY', qfQuote: 'QUOTE', qfImage: 'IMG', qfVideo: 'VID', qfGif: 'GIF' };
  let view = 'card';
  const cardModel = R.makeCardModel({
    t: (key: string, subs: any[]) => {
      if (key === 'postedOn') return `posted ${subs[0]}`;
      if (key === 'captured') return `cap ${subs[0]}`;
      return STATIC_MSG[key];
    },
    formatCount: (n: number) => `N${n}`,
    formatDate: (d: string) => `D${d}`,
    compactDate: (d: string) => d.slice(0, 10),
    fileSrc: (f: string, w?: number) => `${f}@${w || 0}`,
    smokeCapture: false,
    currentView: () => view,
    imgAspect: () => ({ capX: '4/3' }),
    tileThumbW: () => 100,
    cardThumbW: () => 200,
    listThumbW: () => 50,
  });

  // 基準: card ビュー・スクショ（jpeg）・複数画像グループ・エンゲージメント混在・
  // 2つの日付が同じ暦日・thread+quote のフラグ
  const p: any = {
    url: 'https://x.com/u/status/1',
    captureId: 'capX',
    platform: 'x',
    displayName: 'Alice',
    screenName: 'alice',
    title: '',
    text: 'hello',
    likes: 12,
    reposts: 0,
    replies: 3,
    bookmarks: 0,
    date: '2026-04-01T10:00:00Z',
    capturedAt: '2026-04-01T20:00:00Z',
    isThread: true,
    isReply: false,
    isQuote: true,
    mediaType: 'image',
    shotW: 800,
    shotH: 600,
    tags: ['t1'],
    image: 'shot.jpg',
  };
  const model = (rep: any, files: string[] = ['a.jpg'], i = 0) => cardModel({ rep, records: [rep], files }, i);
  const m = model(p, ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'], 5);

  test('index / url / postKey / noUrl', () => {
    expect(m).toMatchObject({ index: 5, url: 'https://x.com/u/status/1', postKey: 'capX', noUrl: false });
  });

  test('エンゲージメントは非ゼロだけ（0 は null）', () => {
    expect(m.stats).toMatchObject({ likes: 'N12', replies: 'N3', reposts: null, bookmarks: null });
  });

  test('同じ日なら取得日を重複排除する（投稿日だけ残る）', () => {
    expect(m.footDates.post.label).toBe('2026-04-01');
    expect(m.footDates.cap).toBeNull();
  });

  // プラットフォームのバッジはサムネから撤去済み（1423e65）＝pfName はもう出さない
  test('投稿者の同定（userName / handle）', () => {
    expect(m).toMatchObject({ userName: 'Alice', handle: '@alice' });
  });

  test('フラグは thread/quote のみ（reply は false）', () => {
    expect(m.flags).toEqual(['THREAD', 'QUOTE']);
  });

  // mediaType 'image' は既定なのでラベルを出さない（#110）。video/gif は出す。
  test('mediaLabel は image では空、video ではラベルあり', () => {
    expect(m.mediaLabel).toBe('');
    expect(model({ ...p, mediaType: 'video' }).mediaLabel).not.toBe('');
  });

  test('likesOv は formatCount(likes)', () => {
    expect(m.likesOv).toBe('N12');
  });

  test('aspRatio は shotW/shotH（card＝メイソンリーの高さ予約）', () => {
    expect(m.aspRatio).toBe('800/600');
  });

  test('nImg と stackSrcs（2・3枚目のみ・幅は cardThumbW）', () => {
    expect(m.nImg).toBe(4);
    expect(m.stackSrcs).toEqual(['b.jpg@200', 'c.jpg@200']);
  });

  test('imgSrc は fileSrc(shot.jpg, cardThumbW)', () => {
    expect(m.imgSrc).toBe('shot.jpg@200');
    expect(m.hasThumb).toBe(true);
  });

  test('tags を引き継ぐ', () => {
    expect(m.tags).toEqual(['t1']);
  });

  // #119 St1: mp4 backed な先頭メディア（video/gif type）はバッジを出す。実 .gif は
  // 読み込めば動いて見えるので出さない。
  describe('videoBadge', () => {
    test('画像投稿では false', () => {
      expect(m.videoBadge).toBe(false);
    });

    test('video メディアでは true で、imgSrc はポスター', () => {
      const mVideo = model({ ...p, mediaType: 'video', media: [{ file: 'clip.mp4', type: 'video', posterFile: 'clip-poster.jpg' }] }, ['clip.mp4']);
      expect(mVideo.videoBadge).toBe(true);
      expect(mVideo.imgSrc).toBe('clip-poster.jpg@200');
    });

    test('実 gif ファイル（per-item type 無し）では false', () => {
      expect(model({ ...p, mediaType: 'gif', media: [{ file: 'anim.gif' }] }, ['anim.gif']).videoBadge).toBe(false);
    });
  });

  test('本文が投稿者名と同じなら空にする（ライブラリ画像の重複排除）', () => {
    expect(model({ ...p, text: 'Alice' }).text).toBe('');
  });

  test('GIF は原寸のまま（w=0）でアニメーションを保つ', () => {
    expect(model({ ...p, image: 'anim.gif' }, ['anim.gif']).imgSrc).toBe('anim.gif@0');
  });

  test('shotW/H が無ければ学習したアスペクト比のキャッシュへ落ちる（card のみ）', () => {
    expect(model({ ...p, shotW: 0, shotH: 0 }).aspRatio).toBe('4/3');
  });

  test('tile 密度ではアスペクト比の予約をしない', () => {
    view = 'tile';
    try {
      expect(model(p).aspRatio).toBe('');
    } finally {
      view = 'card';
    }
  });
});

// #132: 掴んだものが選択内なら選択全体・選択外ならそれだけ。選択は読むだけで書き換えない
// （Explorer の「ドラッグで選択が変わる」は mousedown の仕業＝ドラッグ側の設計ではない。
// Hologram の選択は手で作る作業セット＝持ち出しで壊さない。2026-07-17 ユーザー確定）。
// DOM/IPC 配線（handleCardDragStart）はここを呼ぶだけ＝規則の正はこの純関数。
describe('dragFilesOf（ドラッグアウトが何を渡すか）', () => {
  const G = (key: string, files: string[]) => ({ key, files, records: [], rep: {} });
  const a = G('a', ['a1.jpg']);
  const b = G('b', ['b1.jpg', 'b2.jpg']); // 複数画像の投稿
  const c = G('c', ['c1.jpg']);

  test('選択が無ければ掴んだカードだけ', () => {
    expect(R.dragFilesOf(a, [])).toEqual(['a1.jpg']);
  });

  test('選択内を掴んだら選択全体（複数画像投稿は全ファイル）', () => {
    expect(R.dragFilesOf(a, [a, b])).toEqual(['a1.jpg', 'b1.jpg', 'b2.jpg']);
  });

  test('選択外を掴んだら選択を無視してそのカードだけ', () => {
    expect(R.dragFilesOf(c, [a, b])).toEqual(['c1.jpg']);
  });

  test('単一選択をそのまま掴んだらその1件', () => {
    expect(R.dragFilesOf(b, [b])).toEqual(['b1.jpg', 'b2.jpg']);
  });

  test('同じファイルを持つグループが2つ選ばれていても1回だけ渡す', () => {
    const dup1 = G('d1', ['same.jpg', 'x.jpg']);
    const dup2 = G('d2', ['same.jpg', 'y.jpg']);

    expect(R.dragFilesOf(dup1, [dup1, dup2])).toEqual(['same.jpg', 'x.jpg', 'y.jpg']);
  });

  test('選択順を保つ（ドロップ先の並びが選択順に従う）', () => {
    expect(R.dragFilesOf(b, [b, a])).toEqual(['b1.jpg', 'b2.jpg', 'a1.jpg']);
  });

  test('渡された選択配列を書き換えない', () => {
    const sel = [a, b];
    R.dragFilesOf(a, sel);

    expect(sel).toEqual([a, b]);
  });

  test('ファイルを持たないグループは空（呼び出し側に dragOut を呼ばせない）', () => {
    expect(R.dragFilesOf(G('e', []), [])).toEqual([]);
  });
});
