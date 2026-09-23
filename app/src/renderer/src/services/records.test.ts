// records.ts のロジックの単体テスト。URL→キーの正規化 (postKeyOf)、スタンプ付け
// (stampPost)、レコード形状のヘルパ、まとめ (makeGroupRecords＝manualGroups/ungrouped を
// getter として注入する)、ギャラリーとカードのビューモデル、percentileFn を直に見る。

import { beforeEach, describe, expect, test } from 'vitest';
import * as R from './records';

describe('postKeyOf: URL → プラットフォーム別グループキー', () => {
  test.each([
    ['https://x.com/some_user/status/123456', 'x:123456'],
    ['https://twitter.com/some_user/status/123456', 'x:123456'], // x⇄twitter は同一視
    ['https://x.com/u/status/123456?s=20', 'x:123456'],
    ['https://bsky.app/profile/alice.bsky.social/post/3kabc', 'bluesky:alice.bsky.social/3kabc'],
    ['https://www.pixiv.net/artworks/9900', 'pixiv:9900'],
    ['https://www.pixiv.net/en/artworks/9900', 'pixiv:9900'], // 言語の接頭辞
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
  const image = { image: 'a.jpg', media: [] };
  const eagle = { image: 'c.png', source: 'eagle-migration' };
  const withMedia = { image: 'd.jpg', media: [{ file: 'm1.png' }, { file: 'm2.png' }, {}] };

  test('mediaFilesOf は有効な file だけ', () => {
    expect(R.mediaFilesOf(withMedia)).toEqual(['m1.png', 'm2.png']);
    expect(R.mediaFilesOf({})).toEqual([]);
  });

  test('artworkFile は media 優先、無ければ image', () => {
    expect(R.artworkFile(withMedia)).toBe('m1.png');
    expect(R.artworkFile(eagle)).toBe('c.png');
  });

  test('densityImage はアートワークだけを返す', () => {
    expect(R.densityImage(withMedia)).toBe('m1.png');
    expect(R.densityImage(image)).toBe('a.jpg');
    expect(R.densityImage({ text: '本文だけ' })).toBe('');
  });

  test('groupFilesOf は media が無ければ artwork', () => {
    expect(R.groupFilesOf(eagle)).toEqual(['c.png']);
  });

  test('groupFilesOf は media も artwork も無ければ空', () => {
    expect(R.groupFilesOf({})).toEqual([]);
  });

  test('postIdKey は captureId 優先＋フォールバック', () => {
    expect(R.postIdKey({ captureId: 'c1' })).toBe('c1');
    expect(R.postIdKey({ url: 'u', capturedAt: 't' })).toBe('u|t');
  });

  describe('displayPostText', () => {
    test('画像つき X 投稿の末尾に残る添付 t.co だけを隠す', () => {
      const post = { platform: 'x', text: '本文 https://t.co/media123', media: [{ file: 'a.jpg', url: 'https://pbs.twimg.com/media/a.jpg' }] };
      expect(R.displayPostText(post)).toBe('本文');
      expect(post.text).toBe('本文 https://t.co/media123');
    });

    test('通常の外部リンクは画像つき投稿でも残す', () => {
      const post = { platform: 'x', text: '本文 https://example.com/article', media: [{ file: 'a.jpg' }] };
      expect(R.displayPostText(post)).toBe('本文 https://example.com/article');
    });

    test('media.url と同じ URL が本文にあればプラットフォームを問わず隠す', () => {
      const post = { platform: 'bluesky', text: '本文\nhttps://cdn.example/image.jpg', media: [{ file: 'a.jpg', url: 'https://cdn.example/image.jpg' }] };
      expect(R.displayPostText(post)).toBe('本文');
    });

    test('画像がない投稿の短縮 URL は本文として残す', () => {
      expect(R.displayPostText({ platform: 'x', text: '本文 https://t.co/link123', media: [] })).toBe('本文 https://t.co/link123');
    });
  });

  // #119 St1: media[0] が動画なら、静止画のサムネイルにはポスターを使う（生の動画は
  // <img src> に入れられない）。ポスターが無ければ画像は表示しない。
  describe('動画つき（#119 St1）', () => {
    const withVideoPoster = { image: 'shot.jpg', media: [{ file: 'clip.mp4', type: 'video', posterFile: 'clip-poster.jpg' }] };
    const withVideoNoPoster = { image: 'shot.jpg', media: [{ file: 'clip.mp4', type: 'video' }] };

    test('artworkFile はポスターがあればそれを採る', () => {
      expect(R.artworkFile(withVideoPoster)).toBe('clip-poster.jpg');
    });

    test('ポスターが無ければ空（生の動画を <img> へ渡さない）', () => {
      expect(R.artworkFile(withVideoNoPoster)).toBe('');
    });

    test('densityImage はポスター無しなら空', () => {
      expect(R.densityImage(withVideoNoPoster)).toBe('');
    });

    test('mediaFilesOf は type を問わず実ファイルを返す（ギャラリー用）', () => {
      expect(R.mediaFilesOf(withVideoPoster)).toEqual(['clip.mp4']);
    });
  });

  // #496: image は静止画の欄で、そこに動画の名前が入ってしまうと <img> へ渡せない。
  // いまの normalizePostRecord はそれを video の欄へ移すが、その規則より前に書かれた行が
  // DB に残っている＝読む側もファイル名で拒まなければいけない（顔が無いことと、カードが
  // 真っ白になることは別）。ここには代わりのポスターも無い＝空を返す。
  describe('image が動画名だった古い行（#496）', () => {
    test('artworkFile は空（生の動画を <img> へ渡さない）', () => {
      expect(R.artworkFile({ image: 'cap-media-0.mp4' })).toBe('');
    });

    test('media[] が生きていればそちらのポスターが勝つ（image は見ない）', () => {
      expect(R.artworkFile({ image: 'cap-media-0.mp4', media: [{ file: 'cap-media-0.mp4', type: 'video', posterFile: 'cap-poster.jpg' }] })).toBe('cap-poster.jpg');
    });
  });

  // #119 St3: うごイラの本体は zip＝動画と同じく <img src> には入れられない
  describe('うごイラつき（#119 St3）', () => {
    test('artworkFile はポスターを採る', () => {
      expect(R.artworkFile({ image: 'shot.jpg', media: [{ file: 'u-media-0.zip', type: 'ugoira', posterFile: 'u-poster.jpg' }] })).toBe('u-poster.jpg');
    });

    test('ポスターが無ければ空（zip を <img> へ渡さない）', () => {
      expect(R.artworkFile({ image: 'shot.jpg', media: [{ file: 'u-media-0.zip', type: 'ugoira' }] })).toBe('');
    });
  });
});

// #144: 引数は画像のエントリから作った { id?, recs }（古い { img:{recs} } のタブの形は廃止）
describe('imageTabGroup / imageTabTitleOf', () => {
  const image: any = { captureId: 'a', image: 'a.jpg', media: [] };
  const art: any = { captureId: 'b', image: 'b.png', source: 'drag', text: 'hi', media: [{ file: 'm.png' }] };
  const lib = new Map([
    ['a', image],
    ['b', art],
  ]);
  const byId = (id: string) => lib.get(id);

  test('key と rep（本文ありを優先＝groupRecords と同じ）', () => {
    const g = R.imageTabGroup({ id: 't1', recs: ['a', 'b'] }, byId);
    expect(g.key).toBe('imgtab:t1');
    expect(g.rep).toBe(art);
  });

  test('records の解決と files', () => {
    const g = R.imageTabGroup({ id: 't1', recs: ['a', 'b'] }, byId);
    expect(g.records).toHaveLength(2);
    expect(g.files).toEqual(['a.jpg', 'm.png']);
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

    // replyToId が無く、date も同じ（未設定）→ 同着は captureId で決まり、a1 が先
    test('連鎖が無ければ date/captureId のフォールバック順', () => {
      const ga = groupRecords([a2, a1, b]).find((g) => g.records.length === 2);
      expect(ga.records.map((r: any) => r.captureId)).toEqual(['a1', 'a2']);
    });

    test('rep は本文ありを優先し、files はグループの原本を集約する', () => {
      const ga = groupRecords([a2, a1, b]).find((g) => g.records.length === 2);
      expect(ga.rep).toBe(a2);
      expect(ga.files).toEqual(['a1.jpg', 'a2.png']);
    });
  });

  test('手動グループが URL キーに勝つ', () => {
    manualGroups = [['a1', 'b0']];
    const manual = groupRecords([a1, a2, b]).find((g) => String(g.key).startsWith('manual:'));

    expect(manual.records).toHaveLength(2);
    expect(manual.records.map((r: any) => r.captureId)).toContain('b0');
  });

  // getter で注入している＝代入し直しがそのまま効くことも同時に示す
  test('ungrouped に入れると自動グループが解散する', () => {
    ungrouped = new Set(['x:1']);
    expect(groupRecords([a1, a2, b])).toHaveLength(3);
  });

  describe('ビューア用のセルフリプの合流', () => {
    beforeEach(() => {
      groupRecords = R.makeGroupRecords({ manualGroups: () => manualGroups, ungrouped: () => ungrouped, joinReplies: true });
    });
    const parent = mk({ captureId: 'p1', url: 'https://x.com/u/status/100', userId: 'u9', image: 'p.jpg', text: 'リプ元' });
    const child = mk({ captureId: 'p2', url: 'https://x.com/u/status/101', userId: 'u9', replyToId: '100', image: 'q.jpg', text: 'セルフリプ' });
    const other = mk({ captureId: 'p3', url: 'https://x.com/u/status/102', userId: 'OTHER', replyToId: '100', image: 'r.jpg', text: '他人のリプ' });

    test('同一作者の返信は親グループへ合流し、他人の返信は合流しない', () => {
      const gs = groupRecords([parent, child, other]);
      const merged = gs.find((g) => g.records.length === 2);

      expect(merged.records.map((r: any) => r.captureId).sort()).toEqual(['p1', 'p2']);
      expect(gs).toHaveLength(2);
    });

    // #89: captureId が返信の連鎖と逆順でも、ページ送りは根→葉でなければいけない
    // （旧来の captureId 順では逆順になっていた＝実害の出た不具合）
    test('連鎖順（根→葉）でページ送りされる（captureId 逆順でも）', () => {
      const root = mk({ captureId: 'z_root', url: 'https://x.com/u/status/1', userId: 'u1', image: 'z.jpg', text: '本編1' });
      const r1 = mk({ captureId: 'm_rep1', url: 'https://x.com/u/status/2', userId: 'u1', replyToId: '1', image: 'm.jpg', text: '本編2' });
      const r2 = mk({ captureId: 'a_rep2', url: 'https://x.com/u/status/3', userId: 'u1', replyToId: '2', image: 'a.jpg', text: '本編3' });

      // 入力ではなく並べ替えが結果を決めることを示すため、順不同で渡す
      const thread = groupRecords([r2, root, r1]).find((g) => g.records.length === 3);
      expect(thread.records.map((r: any) => r.captureId)).toEqual(['z_root', 'm_rep1', 'a_rep2']);
    });

    // どの投稿も「直近の親」のキーへ別名を結ぶので、別名の深さ＝スレッドの長さになる。
    // 旧実装は深さ10で固定的に打ち切っていたため、11件を超えるスレッドが複数のカードへ割れていた。
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

    // 相互の返信（実在の SNS では起こり得ない＝壊れたデータ）は別名の環を作る。
    // 既視の集合による防ぎが、無限に回らず止めなければいけない。
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
    { platform: 'test-platform', likes: 5 },
    { platform: 'bluesky', likes: 0 },
    { platform: 'bluesky', likes: 0 },
    { platform: 'pixiv', likes: 0 },
    { platform: 'pixiv', likes: 0 },
    { platform: 'pixiv', likes: 100 },
    { platform: 'x', likes: null },
    { platform: '', likes: 50 },
  ];
  const pct = R.percentileFn(list);

  test('最下位は 0・最上位は 1', () => {
    expect(pct(list[0])).toBe(0);
    expect(pct(list[2])).toBe(1);
  });

  test('そのプラットフォームに1件しかなければ順位を付けない', () => {
    expect(pct(list[3])).toBeNull();
  });

  test('プラットフォームごとに分離して数える', () => {
    expect(pct(list[1])).toBe(0.5);
  });

  test('全件同値なら順位を付けない', () => {
    expect(pct(list[4])).toBeNull();
    expect(pct(list[5])).toBeNull();
  });

  test('同値には平均順位を割り当てる', () => {
    expect(pct(list[6])).toBe(0.25);
    expect(pct(list[7])).toBe(0.25);
    expect(pct(list[8])).toBe(1);
  });

  test('likes 欠損とプラットフォーム不明は順位を付けない', () => {
    expect(pct(list[9])).toBeNull();
    expect(pct(list[10])).toBeNull();
  });
});

describe('makeGallery（ライトボックスの項目）', () => {
  const { buildGalleryItems, buildGroupGalleryItems } = R.makeGallery({ fileSrc: (f: string) => `stub://${f}` });
  test('通常画像と旧形式の画像で保存済みの回転・反転を引き継ぐ', () => {
    const media = [{ file: 'edit.png', rotation: 90, flipped: true }];
    for (const post of [{ media }, { image: 'edit.png', media }]) {
      expect(buildGalleryItems(post)[0]).toMatchObject({ rotation: 90, flipped: true });
    }
  });
  test('旧形式の画像に編集用番号を割り当て、保存後も画像を重複させない', () => {
    const post = { captureId: 'legacy', image: 'legacy.png', media: [] };
    expect(buildGalleryItems(post)[0]).toMatchObject({ postId: 'legacy', mediaSeq: 0 });
    const crop = { x: 0.1, y: 0.2, width: 0.7, height: 0.6 };
    const saved = buildGalleryItems({ ...post, media: [{ file: post.image, type: 'image', crop }] });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ mediaSeq: 0, crop });
  });
  const p1 = { image: 'cover.jpg', video: 'clip.mp4', media: [{ file: 'a.png', alt: 'A' }, { file: 'b.mp4' }, null, { file: '' }] };
  const items = buildGalleryItems(p1);

  test('image、video、media の順で原本を並べる', () => {
    expect(items.map((i: any) => i.src)).toEqual(['stub://cover.jpg', 'stub://clip.mp4', 'stub://a.png', 'stub://b.mp4']);
  });

  test('video フラグ', () => {
    expect(items.map((i: any) => i.video)).toEqual([false, true, false, true]);
  });

  test('alt を引き継ぐ（無指定は空）', () => {
    expect(items[2].alt).toBe('A');
    expect(items[0].alt).toBe('');
  });

  test('null・空 file の media は飛ばす', () => {
    expect(items).toHaveLength(4);
  });

  test('本文だけの投稿にはギャラリー項目がない', () => {
    expect(buildGalleryItems({ text: '本文だけ' })).toEqual([]);
  });

  // #496: 動画投稿の詳細＝ポスターがカードの顔になり、開くと動画そのものが再生される。
  // 保存側 (handleSavePost) が書く形＝image は空で、media[0] が本体と posterFile を持つ。
  test('動画投稿は media[0] の動画1件になる（video フラグつき）', () => {
    const items = buildGalleryItems({ media: [{ file: 'cap-media-0.mp4', type: 'video', posterFile: 'cap-poster.jpg' }] });
    expect(items).toEqual([{ src: 'stub://cap-media-0.mp4', alt: '', video: true, postId: undefined, mediaSeq: 0, crop: null, width: undefined, height: undefined, ugoira: undefined, poster: undefined }]);
  });

  // 同じ投稿の動画の名前が image の欄に書かれている古い行＝<img> へ mp4 を渡すと真っ白になる。
  // 項目ごと落とすのではなく <video> として出す＝ファイルは再生できる状態でディスクにある。
  test('image が動画名でも <video> として出す（真っ白にしない）', () => {
    const [it] = buildGalleryItems({ image: 'cap-media-0.mp4' });
    expect(it).toMatchObject({ src: 'stub://cap-media-0.mp4', video: true });
  });

  // #119 St3: zip は単体では出せない＝コマ表が一緒に渡って初めて項目になる
  describe('うごイラの項目', () => {
    const frames = [
      { file: '000000.jpg', delay: 60 },
      { file: '000001.jpg', delay: 30 },
    ];

    test('コマ表とポスターを項目に載せる', () => {
      const [it] = buildGalleryItems({ media: [{ file: 'u-media-0.zip', type: 'ugoira', posterFile: 'u-poster.jpg', frames }] });
      expect(it).toMatchObject({ src: 'stub://u-media-0.zip', video: false, ugoira: { file: 'u-media-0.zip', frames }, poster: 'stub://u-poster.jpg' });
    });

    test('コマ表が失われていたらポスターの静止画に落とす（再生できない zip を渡さない）', () => {
      const [it] = buildGalleryItems({ media: [{ file: 'u-media-0.zip', type: 'ugoira', posterFile: 'u-poster.jpg' }] });
      expect(it).toMatchObject({ src: 'stub://u-poster.jpg', video: false });
      expect(it.ugoira).toBeUndefined();
    });

    test('コマ表もポスターも無ければ項目にしない', () => {
      expect(buildGalleryItems({ media: [{ file: 'u-media-0.zip', type: 'ugoira' }] })).toHaveLength(0);
    });
  });

  test('グループが1件なら rep の項目をそのまま', () => {
    const r1 = { image: 'cover.jpg' };
    expect(buildGroupGalleryItems({ records: [r1], rep: r1 })).toHaveLength(1);
  });

  test('グループが複数なら src で重複排除する', () => {
    const r1 = { captureId: 'p1', image: 'cover.jpg' };
    const r2 = { captureId: 'p2', image: 'cover.jpg', media: [{ file: 'c.png' }] };

    expect(buildGroupGalleryItems({ records: [r1, r2], rep: r1 }).map((i: any) => i.src)).toEqual(['stub://cover.jpg', 'stub://c.png']);
    expect(buildGroupGalleryItems({ records: [r1, r2], rep: r1 }).map((i: any) => i.postId)).toEqual(['p1', 'p2']);
  });
});

describe('makeCardModel（カード1枚のビューモデル）', () => {
  const STATIC_MSG: Record<string, string> = { qfThread: 'THREAD', qfReply: 'REPLY', qfQuote: 'QUOTE', qfImage: 'IMG', qfVideo: 'VID', qfGif: 'GIF' };
  // 既定の表示＝グリッド・元比率・情報表示あり・アバターあり（旧 'card'）
  let shape = { square: false, info: true, avatar: true };
  let relevant = true; // エンゲージメントと取得日を出す条件が満たされているか
  let sortMetric = '';
  let likesPercentile: number | null = 0.75;
  const cardModel = R.makeCardModel({
    t: (key: string, options: Record<string, unknown>) => {
      if (key === 'postedOn') return `posted ${options.date}`;
      if (key === 'captured') return `cap ${options.date}`;
      if (key === 'cardPopularityTop') return `TOP${options.percent}`;
      return STATIC_MSG[key];
    },
    formatCount: (n: number) => `N${n}`,
    formatDate: (d: string) => `D${d}`,
    compactDate: (d: string) => d.slice(0, 10),
    fileSrc: (f: string, w?: number) => `${f}@${w || 0}`,
    smokeCapture: false,
    shape: () => shape,
    imgAspect: () => ({ capX: '4/3' }),
    gridThumbW: () => 200,
    sortMetric: () => sortMetric,
    likesPercentile: () => likesPercentile,
    showCaptured: () => relevant,
  });
  // 表示を差し替えて1ケースを評価し、必ず元へ戻すヘルパ
  const withShape = (next: Partial<typeof shape>, fn: () => void) => {
    const prev = shape;
    shape = { ...prev, ...next };
    try {
      fn();
    } finally {
      shape = prev;
    }
  };

  // 基準: カード表示・スクショ (jpeg)・複数画像のグループ・エンゲージメントは混在・
  // 2つの日付が同じ暦日・thread と quote のフラグ
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
    localViewCount: 4,
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

  test('index / postKey', () => {
    expect(m).toMatchObject({ index: 5, postKey: 'capX' });
  });

  test('通常の並びでは反応数を表示しない', () => {
    expect(m.stats).toEqual({});
  });

  test.each([
    ['local-views-desc', { localViews: 'N4' }],
    ['likes-pct', { popularity: 'TOP25' }],
  ])('%s は並び替えに使う値だけを表示する', (sort, expected) => {
    sortMetric = sort;
    try {
      expect(model(p).stats).toEqual(expected);
    } finally {
      sortMetric = '';
    }
  });

  test('SNS 内人気順は最上位も上位 1% と表示する', () => {
    sortMetric = 'likes-pct';
    likesPercentile = 1;
    try {
      expect(model(p).stats).toEqual({ popularity: 'TOP1' });
    } finally {
      sortMetric = '';
      likesPercentile = 0.75;
    }
  });

  test('SNS 内人気順で順位を計算できない投稿には上位率を表示しない', () => {
    sortMetric = 'likes-pct';
    likesPercentile = null;
    try {
      expect(model(p).stats).toEqual({ popularity: null });
    } finally {
      sortMetric = '';
      likesPercentile = 0.75;
    }
  });

  test('複数保存をまとめたカードは並び順を決めた最大値を表示する', () => {
    sortMetric = 'local-views-desc';
    try {
      const older = { ...p, captureId: 'capOlder', localViewCount: 30 };
      expect(cardModel({ rep: p, records: [p, older], files: ['a.jpg'] }, 0).stats).toEqual({ localViews: 'N30' });
    } finally {
      sortMetric = '';
    }
  });

  test('同じ日なら取得日を重複排除する（投稿日だけ残る）', () => {
    expect(m.footDates.post.label).toBe('2026-04-01');
    expect(m.footDates.cap).toBeNull();
  });

  // プラットフォームの印はサムネイルから外した (1423e65)＝pfName はもう出さない
  test('投稿者の同定（userName / handle）', () => {
    expect(m).toMatchObject({ userName: 'Alice', handle: '@alice' });
  });

  // #658: AuthorLine が描くアバターのモデル（実際の画像か、色付きモノグラムのフォールバック）
  describe('アバター（#658）', () => {
    test('avatarFile があれば avatarSrc を fileSrc 経由で持ち、フォールバック2つは null', () => {
      const withAvatar = model({ ...p, avatarFile: 'ava.jpg' });
      expect(withAvatar.avatarSrc).toBe('ava.jpg@0');
      expect(withAvatar.monogram).toBeNull();
      expect(withAvatar.monoHue).toBeNull();
    });

    test('avatarFile が無ければ avatarSrc は falsy、monogram は userName の頭文字、monoHue は [0,360) の数値', () => {
      expect(m.avatarSrc).toBeFalsy();
      expect(m.monogram).toBe('A'); // userName: 'Alice'
      expect(typeof m.monoHue).toBe('number');
      expect(m.monoHue).toBeGreaterThanOrEqual(0);
      expect(m.monoHue).toBeLessThan(360);
    });

    test('同じ投稿から2回作っても monoHue は同じ（決定的）', () => {
      const a = model(p);
      const b = model(p);
      expect(a.monoHue).toBe(b.monoHue);
    });
  });

  test('カードから thread を外し、quote だけを残す（reply は false）', () => {
    expect(m.flags).toEqual(['QUOTE']);
  });

  // mediaType の 'image' は既定なのでラベルを出さない (#110)。video/gif は出す。
  test('mediaLabel は image では空、video ではラベルあり', () => {
    expect(m.mediaLabel).toBe('');
    expect(model({ ...p, mediaType: 'video' }).mediaLabel).not.toBe('');
  });

  // #618: 数字を出すのは、並べ替えか絞り込みが実際にエンゲージメントを話に持ち込んだときだけ
  test('関係のない時はエンゲージメントも取得日もモデルに載らない', () => {
    relevant = false;
    try {
      const quiet = model(p);
      expect(quiet.stats).toEqual({});
      expect(quiet.footDates.cap).toBeNull();
    } finally {
      relevant = true;
    }
  });

  test('aspRatio は shotW/shotH（元比率グリッド＝高さ予約）', () => {
    expect(m.aspRatio).toBe('800/600');
  });

  test('aspRatio は正方形サムネでは空', () => {
    withShape({ square: true }, () => expect(model(p).aspRatio).toBe(''));
  });

  test('nImg と stackSrcs（2・3枚目のみ・幅はセル幅）', () => {
    expect(m.nImg).toBe(4);
    expect(m.stackSrcs).toEqual(['b.jpg@200', 'c.jpg@200']);
  });

  test('imgSrc は fileSrc(shot.jpg, グリッドのサムネ幅)', () => {
    expect(m.imgSrc).toBe('shot.jpg@200');
    expect(m.hasThumb).toBe(true);
  });

  test('tags を引き継ぐ', () => {
    expect(m.tags).toEqual(['t1']);
  });

  // #119 St1: 先頭のメディアが mp4 を実体に持つ場合（type が video/gif）は印を出す。
  // 実際の .gif は読み込むだけで動くので出さない。
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

    // #119 St3: うごイラも「クリックしないと動かない」側＝印を出す
    test('うごイラでは true で、imgSrc はポスター', () => {
      const mUgoira = model({ ...p, mediaType: 'gif', media: [{ file: 'u-media-0.zip', type: 'ugoira', posterFile: 'u-poster.jpg' }] }, ['u-media-0.zip']);
      expect(mUgoira.videoBadge).toBe(true);
      expect(mUgoira.imgSrc).toBe('u-poster.jpg@200');
    });
  });

  describe('videoSrc（mp4実体のGIFの自動再生）', () => {
    const gifMedia = [{ file: 'g-media-0.mp4', type: 'gif', posterFile: 'g-poster.jpg' }];
    const gifPost = { ...p, mediaType: 'gif', media: gifMedia };
    test('元比率グリッドでは原寸の mp4 を再生し、ポスターを poster に敷く', () => {
      const mGif = model(gifPost, ['g-media-0.mp4']);
      expect(mGif.videoSrc).toBe('g-media-0.mp4@0'); // w を付けない＝サムネイラを通さない（通すと1コマに潰れる）
      expect(mGif.videoPoster).toBe('g-poster.jpg@200');
      expect(mGif.hasThumb).toBe(true);
    });

    // 再生と画質は「形」の軸に従う（2026-07-19 に決定）＝正方形は切り抜いた静止画
    test('正方形サムネは静止のまま＝再生せず ▶ バッジを出す', () => {
      withShape({ square: true }, () => {
        const mGif = model(gifPost, ['g-media-0.mp4']);
        expect(mGif.videoSrc).toBe('');
        expect(mGif.videoBadge).toBe(true);
      });
    });

    test('動画（type video）は長さがある＝勝手に再生しない', () => {
      const mVideo = model({ ...p, mediaType: 'video', media: [{ file: 'clip.mp4', type: 'video', posterFile: 'clip-poster.jpg' }] }, ['clip.mp4']);
      expect(mVideo.videoSrc).toBe('');
      expect(mVideo.videoBadge).toBe(true);
    });

    test('うごイラ（type ugoira）は zip の展開が要る＝一覧では再生しない', () => {
      const mUgoira = model({ ...p, mediaType: 'gif', media: [{ file: 'u-media-0.zip', type: 'ugoira', posterFile: 'u-poster.jpg' }] }, ['u-media-0.zip']);
      expect(mUgoira.videoSrc).toBe('');
      expect(mUgoira.videoBadge).toBe(true);
    });

    // 実際の .gif は項目ごとの type を持たない（静止画として落としてくる）＝<img> のまま
    test('実 gif ファイルは <img> のまま（判定は拡張子でなく type）', () => {
      const mReal = model({ ...p, mediaType: 'gif', media: [{ file: 'anim.gif' }] }, ['anim.gif']);
      expect(mReal.videoSrc).toBe('');
      expect(mReal.videoBadge).toBe(false);
    });

    // mediaType は表示のラベル用で、取り込みの type とは別の軸（#119 St1 で分けたもの）。
    test('mediaType が gif でも先頭メディアが動画なら再生しない', () => {
      const mMislabel = model({ ...p, mediaType: 'gif', media: [{ file: 'clip.mp4', type: 'video', posterFile: 'clip-poster.jpg' }] }, ['clip.mp4']);
      expect(mMislabel.videoSrc).toBe('');
    });

    test('再生している面には ▶ バッジを出さない（動いているものに再生を促さない）', () => {
      expect(model(gifPost, ['g-media-0.mp4']).videoBadge).toBe(false);
    });

    test('ポスターが無くても再生する（poster 無し・サムネの当ても無い）', () => {
      const noPoster = { ...p, mediaType: 'gif', image: '', media: [{ file: 'g-media-0.mp4', type: 'gif' }] };
      const mNo = model(noPoster, ['g-media-0.mp4']);
      expect(mNo.videoSrc).toBe('g-media-0.mp4@0');
      expect(mNo.videoPoster).toBe('');
      expect(mNo.hasThumb).toBe(true); // 静止画が1枚も無いまま再生する場合がある
    });

    test('メディアが無い投稿では空（画像だけのカードに <video> を生やさない）', () => {
      expect(m.videoSrc).toBe('');
      expect(m.videoPoster).toBe('');
    });
  });

  test('本文が投稿者名と同じなら空にする（ライブラリ画像の重複排除）', () => {
    expect(model({ ...p, text: 'Alice' }).text).toBe('');
  });

  test('GIF は原寸のまま（w=0）でアニメーションを保つ', () => {
    expect(model({ ...p, image: 'anim.gif' }, ['anim.gif']).imgSrc).toBe('anim.gif@0');
  });

  // #8: アニメーションする webp には、.gif と同じ例外が要る＝そうしないと、任せている
  // サムネイラが他の webp と同じように静止した JPEG へ潰してしまう。
  test('animated webp（shotAnimated）も原寸のまま（w=0）でアニメーションを保つ', () => {
    expect(model({ ...p, image: 'anim.webp', shotAnimated: true }, ['anim.webp']).imgSrc).toBe('anim.webp@0');
  });

  // 静止した webp こそ #8 がサムネイル化したいもの＝こちらは例外にしない。
  test('静止 webp（shotAnimated なし）はサムネイル化される（#8 の本題）', () => {
    expect(model({ ...p, image: 'still.webp' }, ['still.webp']).imgSrc).toBe('still.webp@200');
  });

  test('正方形グリッドは shotAnimated でもサムネイル化する（再生軸は正方形の外側だけ）', () => {
    withShape({ square: true }, () => {
      expect(model({ ...p, image: 'anim.webp', shotAnimated: true }, ['anim.webp']).imgSrc).toBe('anim.webp@200');
    });
  });

  test('shotW/H が無ければ学習したアスペクト比のキャッシュへ落ちる（元比率グリッドのみ）', () => {
    expect(model({ ...p, shotW: 0, shotH: 0 }).aspRatio).toBe('4/3');
  });

  // #365: テキストのみ投稿には、測る画像も学習する画像もまったく無い（shotW/H は常に 0 で、
  // アスペクト比のキャッシュを埋めたキャプチャも無い）＝元比率グリッドは、代わりに本文自身の
  // 長さから高さを予約する。#953 はそれを、いまもプレートを描く状態だけに絞った。情報表示が
  // 入っていると本文はカード本体の中の一行になり、カードの高さは文字ちょうどになるので、
  // 予約すべき画像の形をした枠が残らない。
  describe('本文からの高さ予約（テキストのみ、#365 → #953）', () => {
    // image と mediaType を空にし、captureId も入れ替える。基準の 'capX' を鍵にした差し替えの
    // アスペクト比キャッシュが、うっかり答えを供給しないようにするため。
    const textOnlyBase = { ...p, image: '', mediaType: null, shotW: 0, shotH: 0, captureId: 'noimg' };

    test('情報表示 OFF（プレートを描く状態）では本文の長さから段階的なアスペクト比を選ぶ', () => {
      withShape({ info: false }, () => {
        expect(model({ ...textOnlyBase, text: 'short' }).aspRatio).toBe('4/3');
        expect(model({ ...textOnlyBase, text: 'x'.repeat(150) }).aspRatio).toBe('1/1');
        expect(model({ ...textOnlyBase, text: 'x'.repeat(300) }).aspRatio).toBe('3/4');
        expect(model({ ...textOnlyBase, text: 'x'.repeat(500) }).aspRatio).toBe('2/3');
      });
    });

    test('情報表示 ON では空＝本文はカード本体に書かれ、画像枠を予約しない（#953）', () => {
      expect(model({ ...textOnlyBase, text: 'short' }).aspRatio).toBe('');
      expect(model({ ...textOnlyBase, text: 'x'.repeat(500) }).aspRatio).toBe('');
    });

    test('正方形サムネでは（テキストのみでも）空のまま', () => {
      withShape({ square: true, info: false }, () => expect(model({ ...textOnlyBase, text: 'x'.repeat(500) }).aspRatio).toBe(''));
    });

    test('画像がある投稿には適用しない（既存の画像あり表示は変わらない）', () => {
      withShape({ info: false }, () => expect(model({ ...p, shotW: 0, shotH: 0, captureId: 'noimg' }).aspRatio).toBe(''));
    });

    test('hasThumb は false（PostCard が本文の置き場を選ぶ合図）', () => {
      expect(model(textOnlyBase).hasThumb).toBe(false);
    });
  });

  describe('R.textPlateAspect（#365）', () => {
    test.each([
      ['', '4/3'],
      ['a'.repeat(80), '4/3'],
      ['a'.repeat(81), '1/1'],
      ['a'.repeat(220), '1/1'],
      ['a'.repeat(221), '3/4'],
      ['a'.repeat(420), '3/4'],
      ['a'.repeat(421), '2/3'],
      ['a'.repeat(2000), '2/3'],
    ])('%s文字 → %s', (text, expected) => {
      expect(R.textPlateAspect(text)).toBe(expected);
    });
  });
});
