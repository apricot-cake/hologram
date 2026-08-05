// Logic unit tests for records.ts. Directly verifies URL→key normalization (postKeyOf),
// stamping (stampPost), the record-shape helpers, grouping (makeGroupRecords = injects
// manualGroups/ungrouped as getters), the gallery/card view models, and percentileFn.

import { beforeEach, describe, expect, test } from 'vitest';
import * as R from '../app/src/renderer/src/services/records';

describe('postKeyOf: URL → プラットフォーム別グループキー', () => {
  test.each([
    ['https://x.com/some_user/status/123456', 'x:123456'],
    ['https://twitter.com/some_user/status/123456', 'x:123456'], // x⇄twitter unified
    ['https://x.com/u/status/123456?s=20', 'x:123456'],
    ['https://bsky.app/profile/alice.bsky.social/post/3kabc', 'bluesky:alice.bsky.social/3kabc'],
    ['https://mstdn.jp/@user/112233', 'mastodon:mstdn.jp:112233'], // host included
    ['https://misskey.io/notes/9abcdef', 'misskey:misskey.io:9abcdef'],
    ['https://www.pixiv.net/artworks/9900', 'pixiv:9900'],
    ['https://www.pixiv.net/en/artworks/9900', 'pixiv:9900'], // language prefix
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
    expect(R.isScreenshot(drag)).toBe(false); // drag is excluded
    expect(R.isScreenshot(eagle)).toBe(false); // non-JPEG is excluded
  });

  test('captureFile はスクショのみ', () => {
    expect(R.captureFile(shot)).toBe('a.jpg');
    expect(R.captureFile(drag)).toBe('');
  });

  test('artworkFile は media 優先、無ければ非スクショの image', () => {
    expect(R.artworkFile(withMedia)).toBe('m1.png');
    expect(R.artworkFile(eagle)).toBe('c.png');
  });

  // #618: the original image comes first regardless of display. A capture is only a stand-in for a post with no original image.
  test('densityImage はアートワーク優先（キャプチャは代役）', () => {
    expect(R.densityImage(withMedia)).toBe('m1.png');
    expect(R.densityImage(shot)).toBe('a.jpg');
  });

  test('groupFilesOf は media が無ければ artwork', () => {
    expect(R.groupFilesOf(eagle)).toEqual(['c.png']);
  });

  // #236: media も artwork も無い収蔵ファイルは自分の file へ落ちる（ドラッグ
  // アウト/#132 が持ち出す先）。
  test('groupFilesOf は media も artwork も無ければ収蔵ファイル自身（#236）', () => {
    expect(R.groupFilesOf({ assetClass: 'file', file: 'doc.pdf', image: null, video: null })).toEqual(['doc.pdf']);
    expect(R.groupFilesOf({})).toEqual([]);
  });

  test('isFileAsset は assetClass:file の判定だけを持つ', () => {
    expect(R.isFileAsset({ assetClass: 'file' })).toBe(true);
    expect(R.isFileAsset({ assetClass: 'media' })).toBe(false);
    expect(R.isFileAsset({})).toBe(false);
  });

  test('postIdKey は captureId 優先＋フォールバック', () => {
    expect(R.postIdKey({ captureId: 'c1' })).toBe('c1');
    expect(R.postIdKey({ url: 'u', capturedAt: 't' })).toBe('u|t');
  });

  // #119 St1: when media[0] is a video, it uses the poster as the still thumbnail (a raw
  // video can't go in <img src>). With no poster, densityImage falls back to a capture, in cap||art order.
  describe('動画つき（#119 St1）', () => {
    const withVideoPoster = { image: 'shot.jpg', media: [{ file: 'clip.mp4', type: 'video', posterFile: 'clip-poster.jpg' }] };
    const withVideoNoPoster = { image: 'shot.jpg', media: [{ file: 'clip.mp4', type: 'video' }] };

    test('artworkFile はポスターがあればそれを採る', () => {
      expect(R.artworkFile(withVideoPoster)).toBe('clip-poster.jpg');
    });

    test('ポスターが無ければ空（生の動画を <img> へ渡さない）', () => {
      expect(R.artworkFile(withVideoNoPoster)).toBe('');
    });

    test('densityImage はポスター無しならスクショへ落ちる', () => {
      expect(R.densityImage(withVideoNoPoster)).toBe('shot.jpg');
    });

    test('mediaFilesOf は type を問わず実ファイルを返す（ギャラリー用）', () => {
      expect(R.mediaFilesOf(withVideoPoster)).toEqual(['clip.mp4']);
    });
  });

  // #496: image is the stills field, and if a video's name ended up in it, it can't be
  // handed to <img>. The current normalizePostRecord moves that into the video field, but
  // rows written before that rule remain in the DB = the read side also has to refuse
  // based on the filename (having no face and showing a blank card mean different things).
  // There's no alternate poster available here = returns empty.
  describe('image が動画名だった古い行（#496）', () => {
    test('artworkFile は空（生の動画を <img> へ渡さない）', () => {
      expect(R.artworkFile({ image: 'cap-media-0.mp4' })).toBe('');
    });

    test('media[] が生きていればそちらのポスターが勝つ（image は見ない）', () => {
      expect(R.artworkFile({ image: 'cap-media-0.mp4', media: [{ file: 'cap-media-0.mp4', type: 'video', posterFile: 'cap-poster.jpg' }] })).toBe('cap-poster.jpg');
    });
  });

  // #119 St3: an ugoira's body is a zip = just like a video, it can't go in <img src>
  describe('うごイラつき（#119 St3）', () => {
    test('artworkFile はポスターを採る', () => {
      expect(R.artworkFile({ image: 'shot.jpg', media: [{ file: 'u-media-0.zip', type: 'ugoira', posterFile: 'u-poster.jpg' }] })).toBe('u-poster.jpg');
    });

    test('ポスターが無ければ空（zip を <img> へ渡さない）', () => {
      expect(R.artworkFile({ image: 'shot.jpg', media: [{ file: 'u-media-0.zip', type: 'ugoira' }] })).toBe('');
    });
  });
});

// #144: the argument is { id?, recs } derived from an image entry (the old { img:{recs} } tab shape is retired)
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

  // files is flatMap(groupFilesOf) = "artwork pages" only (a screenshot has no artwork, so it's empty)
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

    // No replyToId, and the same date too (unset) → captureId decides the tiebreak, a1 comes first
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

  // Getter injection = also proves that reassignment is live
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

    // #89: even if captureId is in reverse order from the reply chain, paging must go
    // root→leaf (the old captureId ordering produced reverse order = a bug that caused real harm)
    test('連鎖順（根→葉）でページ送りされる（captureId 逆順でも）', () => {
      const root = mk({ captureId: 'z_root', url: 'https://x.com/u/status/1', userId: 'u1', image: 'z.jpg', text: '本編1' });
      const r1 = mk({ captureId: 'm_rep1', url: 'https://x.com/u/status/2', userId: 'u1', replyToId: '1', image: 'm.jpg', text: '本編2' });
      const r2 = mk({ captureId: 'a_rep2', url: 'https://x.com/u/status/3', userId: 'u1', replyToId: '2', image: 'a.jpg', text: '本編3' });

      // Passed in out of order, to show that the sort — not the input — decides the outcome
      const thread = groupRecords([r2, root, r1]).find((g) => g.records.length === 3);
      expect(thread.records.map((r: any) => r.captureId)).toEqual(['z_root', 'm_rep1', 'a_rep2']);
    });

    // Each post links an alias to its "immediate parent"'s key, so alias depth = thread
    // length. The old implementation's fixed depth-10 cap split threads longer than 11 posts across multiple cards.
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

    // Mutual replies (impossible on a real SNS = corrupt data) form a cycle of aliases.
    // The seen-set guard must halt instead of looping forever.
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

  // A screenshot goes to the end, and the original image (video→media) comes first (#143 = keep the thumbnail matching the original image)
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

  // A text-only post has the screenshot as its sole, leading item (thumbnail = capture matches — no special case needed)
  test('本文だけの投稿はキャプチャ1枚', () => {
    const textOnly = buildGalleryItems({ image: 'shot.jpg' });
    expect(textOnly).toHaveLength(1);
    expect(textOnly[0].src).toBe('stub://shot.jpg');
  });

  // #496: a video post's detail view = the poster becomes the card's face, and opening it
  // plays the video itself. The shape the save side (handleSavePost) writes = image is empty, media[0] holds the body and posterFile.
  test('動画投稿は media[0] の動画1件になる（video フラグつき）', () => {
    const items = buildGalleryItems({ media: [{ file: 'cap-media-0.mp4', type: 'video', posterFile: 'cap-poster.jpg' }] });
    expect(items).toEqual([{ src: 'stub://cap-media-0.mp4', alt: '', video: true, ugoira: undefined, poster: undefined }]);
  });

  // An old row where the same post's video name was written into the image field = handing
  // <img> an mp4 goes blank. Instead of dropping the item, it's shown as <video> = the file is on disk in a playable state.
  test('image が動画名でも <video> として出す（真っ白にしない）', () => {
    const [it] = buildGalleryItems({ image: 'cap-media-0.mp4' });
    expect(it).toMatchObject({ src: 'stub://cap-media-0.mp4', video: true });
  });

  // #119 St3: a zip can't be shown by itself = it only becomes an item once the frame table is passed along with it
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
  // Default display = grid, original ratio, info shown, avatar shown (formerly 'card')
  let shape = { list: false, square: false, info: true, avatar: true };
  let relevant = true; // whether the condition for showing engagement/captured-date is met
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
    shape: () => shape,
    imgAspect: () => ({ capX: '4/3' }),
    gridThumbW: () => 200,
    listThumbW: () => 50,
    showEngagement: () => relevant,
    showCaptured: () => relevant,
  });
  // A helper that swaps the display, evaluates one case, and always restores it afterward
  const withShape = (next: Partial<typeof shape>, fn: () => void) => {
    const prev = shape;
    shape = { ...prev, ...next };
    try {
      fn();
    } finally {
      shape = prev;
    }
  };

  // Baseline: card view, screenshot (jpeg), multi-image group, mixed engagement,
  // both dates on the same calendar day, thread+quote flags
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

  test('index / postKey', () => {
    expect(m).toMatchObject({ index: 5, postKey: 'capX' });
  });

  test('エンゲージメントは非ゼロだけ（0 は null）', () => {
    expect(m.stats).toMatchObject({ likes: 'N12', replies: 'N3', reposts: null, bookmarks: null });
  });

  test('同じ日なら取得日を重複排除する（投稿日だけ残る）', () => {
    expect(m.footDates.post.label).toBe('2026-04-01');
    expect(m.footDates.cap).toBeNull();
  });

  // The platform badge has been removed from the thumbnail (1423e65) = pfName is no longer shown
  test('投稿者の同定（userName / handle）', () => {
    expect(m).toMatchObject({ userName: 'Alice', handle: '@alice' });
  });

  // #658: the avatar model that AuthorLine draws (a real image, or a colored-monogram fallback)
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

  test('フラグは thread/quote のみ（reply は false）', () => {
    expect(m.flags).toEqual(['THREAD', 'QUOTE']);
  });

  // mediaType 'image' is the default, so no label is shown (#110). video/gif do show one.
  test('mediaLabel は image では空、video ではラベルあり', () => {
    expect(m.mediaLabel).toBe('');
    expect(model({ ...p, mediaType: 'video' }).mediaLabel).not.toBe('');
  });

  // #618: numbers are shown only if sort or filter actually brings engagement into the conversation
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

  // For square and list, height is decided on the layout side = no reservation is needed
  test('aspRatio は正方形サムネ・リストでは空', () => {
    withShape({ square: true }, () => expect(model(p).aspRatio).toBe(''));
    withShape({ list: true }, () => expect(model(p).aspRatio).toBe(''));
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

  // #119 St1: a leading media item backed by mp4 (video/gif type) shows a badge. A real
  // .gif does not, since it plays just by loading.
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

    // #119 St3: ugoira is also on the "doesn't move without a click" side = shows a badge
    test('うごイラでは true で、imgSrc はポスター', () => {
      const mUgoira = model({ ...p, mediaType: 'gif', media: [{ file: 'u-media-0.zip', type: 'ugoira', posterFile: 'u-poster.jpg' }] }, ['u-media-0.zip']);
      expect(mUgoira.videoBadge).toBe(true);
      expect(mUgoira.imgSrc).toBe('u-poster.jpg@200');
    });
  });

  // #476: a GIF backed by an mp4 (X animated_gif / Mastodon gifv) loops in place on both
  // the card and the list. The one and only signal for this is the per-item type='gif'
  // (attached at save time, #119 St1) = neither the actual file extension nor the mediaType label.
  describe('videoSrc（mp4実体のGIFの自動再生）', () => {
    const gifMedia = [{ file: 'g-media-0.mp4', type: 'gif', posterFile: 'g-poster.jpg' }];
    const gifPost = { ...p, mediaType: 'gif', media: gifMedia };
    test('元比率グリッドでは原寸の mp4 を再生し、ポスターを poster に敷く', () => {
      const mGif = model(gifPost, ['g-media-0.mp4']);
      expect(mGif.videoSrc).toBe('g-media-0.mp4@0'); // no w = doesn't route through the thumbnailer (it would get flattened to 1 frame)
      expect(mGif.videoPoster).toBe('g-poster.jpg@200');
      expect(mGif.hasThumb).toBe(true);
    });

    // Also plays in a row (the acceptance criterion is: what played on the site also plays in the list).
    test('リストでも再生する（poster は行のサムネ幅）', () => {
      withShape({ list: true }, () => {
        const mGif = model(gifPost, ['g-media-0.mp4']);
        expect(mGif.imgSrc).toBe('g-poster.jpg@50'); // preferring the original image (here, its poster) is the same in the list too (#618)
        expect(mGif.videoSrc).toBe('g-media-0.mp4@0');
        expect(mGif.videoPoster).toBe('g-poster.jpg@50');
      });
    });

    // Playback and image quality follow the "shape" axis (settled 2026-07-19) = square is a cropped still
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

    // A real .gif has no per-item type (it's downloaded as a still) = stays as <img>
    test('実 gif ファイルは <img> のまま（判定は拡張子でなく type）', () => {
      const mReal = model({ ...p, mediaType: 'gif', media: [{ file: 'anim.gif' }] }, ['anim.gif']);
      expect(mReal.videoSrc).toBe('');
      expect(mReal.videoBadge).toBe(false);
    });

    // mediaType is for the display label, a separate axis from the intake type (the separation from #119 St1).
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
      expect(mNo.hasThumb).toBe(true); // there are cases that play even with not a single still available
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

  // #8: an animated webp needs the same carve-out .gif gets — the delegated
  // thumbnailer would otherwise flatten it to a static JPEG like any other webp.
  test('animated webp（shotAnimated）も原寸のまま（w=0）でアニメーションを保つ', () => {
    expect(model({ ...p, image: 'anim.webp', shotAnimated: true }, ['anim.webp']).imgSrc).toBe('anim.webp@0');
  });

  // A STILL webp is exactly what #8 wants thumbnailed — no exemption for it.
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

  // #236: a collected item (assetClass:'file') has no image/video/media — the
  // card still needs a thumb slot (asset://…?w= is tried, same route as any
  // other card; CardThumb falls back to the generic icon+name+ext on error)
  // plus the fields that fallback reads.
  describe('収蔵ファイル（assetClass:file、#236）', () => {
    const fileP = { ...p, assetClass: 'file', image: null, video: null, mediaType: null, media: [], title: 'my-report', file: 'drag-1-0000.pdf' };

    test('imgSrc は file を fileSrc に通したもの＝hasThumb は true', () => {
      const mFile = model(fileP, []);
      expect(mFile.imgSrc).toBe('drag-1-0000.pdf@200');
      expect(mFile.hasThumb).toBe(true);
      expect(mFile.isFileCard).toBe(true);
    });

    test('fileExt は拡張子を大文字化したもの、fileName は拡張子を除いたタイトル', () => {
      const mFile = model(fileP, []);
      expect(mFile.fileExt).toBe('PDF');
      expect(mFile.fileName).toBe('my-report');
    });

    test('タイトルが無ければ fileName はファイル名（拡張子抜き）へ落ちる', () => {
      const mFile = model({ ...fileP, title: '' }, []);
      expect(mFile.fileName).toBe('drag-1-0000');
    });

    test('メディア投稿では isFileCard / fileExt / fileName は立たない', () => {
      expect(m.isFileCard).toBeFalsy();
      expect(m.fileExt).toBe('');
      expect(m.fileName).toBe('');
    });
  });

  // #365: a text-only post has no image to measure or learn from at all (shotW/H
  // is always 0, and there's no capture to have populated the aspect cache) — the
  // original-aspect grid instead reserves height from the body's own length.
  // #953 narrows that to the state which still DRAWS the plate: with the info block
  // on, the body is a line in the card body and the card is exactly as tall as the
  // text, so there is no picture-shaped box left to reserve.
  describe('本文からの高さ予約（テキストのみ、#365 → #953）', () => {
    // image/mediaType cleared, captureId swapped so the stub aspect cache (keyed
    // on the baseline's 'capX') can't accidentally supply an answer either.
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

    test('正方形サムネ・リストでは（テキストのみでも）空のまま', () => {
      withShape({ square: true, info: false }, () => expect(model({ ...textOnlyBase, text: 'x'.repeat(500) }).aspRatio).toBe(''));
      withShape({ list: true, info: false }, () => expect(model({ ...textOnlyBase, text: 'x'.repeat(500) }).aspRatio).toBe(''));
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

// #132: if what was grabbed is inside the selection, take the whole selection; if it's
// outside, take just that one. The selection is only read, never rewritten (Explorer's
// "the selection changes on drag" is mousedown's doing = not part of the drag's own
// design. Hologram's selection is a work set the user builds by hand = a drag-out must
// not disturb it. Settled by the user on 2026-07-17). The DOM/IPC wiring
// (handleCardDragStart) just calls this = this pure function is the source of truth for the rule.
describe('dragFilesOf（ドラッグアウトが何を渡すか）', () => {
  const G = (key: string, files: string[]) => ({ key, files, records: [], rep: {} });
  const a = G('a', ['a1.jpg']);
  const b = G('b', ['b1.jpg', 'b2.jpg']); // a multi-image post
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
