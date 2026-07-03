'use strict';

// records.js（window.corpusRecords）のロジック単体テスト。records.js は CommonJS
// でも export するので直接 require で読み込み、URL→キー正規化(postKeyOf)・
// スタンプ(stampPost)・record 形状ヘルパ・グルーピング(makeGroupRecords＝
// manualGroups/ungrouped をゲッター注入)・percentileFn を直接検証する。
//
//   node scripts/test-records-unit.js

const path = require('node:path');

const R = require(path.join(__dirname, '..', 'app', 'renderer', 'records.js'));

let failed = 0;
function assert(name, cond) {
  if (cond) {
    console.log('ok  ', name);
  } else {
    console.log('FAIL', name);
    failed++;
  }
}

// --- postKeyOf: URL → プラットフォーム別グループキー ---
assert('postKeyOf x.com status', R.postKeyOf('https://x.com/some_user/status/123456') === 'x:123456');
assert('postKeyOf twitter.com → 同一キー（x⇄twitter 統合）', R.postKeyOf('https://twitter.com/some_user/status/123456') === 'x:123456');
assert('postKeyOf x.com クエリ付きでも同一', R.postKeyOf('https://x.com/u/status/123456?s=20') === 'x:123456');
assert('postKeyOf bsky', R.postKeyOf('https://bsky.app/profile/alice.bsky.social/post/3kabc') === 'bluesky:alice.bsky.social/3kabc');
assert('postKeyOf mastodon（ホスト込み）', R.postKeyOf('https://mstdn.jp/@user/112233') === 'mastodon:mstdn.jp:112233');
assert('postKeyOf misskey（ホスト込み）', R.postKeyOf('https://misskey.io/notes/9abcdef') === 'misskey:misskey.io:9abcdef');
assert('postKeyOf pixiv', R.postKeyOf('https://www.pixiv.net/artworks/9900') === 'pixiv:9900');
assert('postKeyOf pixiv 言語プレフィックス', R.postKeyOf('https://www.pixiv.net/en/artworks/9900') === 'pixiv:9900');
assert('postKeyOf url なし → null', R.postKeyOf('') === null && R.postKeyOf(null) === null);
assert('postKeyOf 不正 URL → null', R.postKeyOf('not a url') === null);
assert('postKeyOf 非対応パス → null', R.postKeyOf('https://x.com/some_user') === null);

// --- stampPost: ソート用タイムスタンプ＋グループキーの前計算 ---
{
  const p = R.stampPost({ url: 'https://x.com/u/status/7', date: '2026-04-01T10:00:00Z', capturedAt: '2026-04-02T10:00:00Z', quotedUrl: 'https://x.com/v/status/8' });
  assert('stampPost _dateMs', p._dateMs === +new Date('2026-04-01T10:00:00Z'));
  assert('stampPost _capturedMs', p._capturedMs === +new Date('2026-04-02T10:00:00Z'));
  assert('stampPost _postKey', p._postKey === 'x:7');
  assert('stampPost _quotedKey', p._quotedKey === 'x:8');
  const q = R.stampPost({});
  assert('stampPost 欠損は 0 / null', q._dateMs === 0 && q._capturedMs === 0 && q._postKey === null && q._quotedKey === null);
}

// --- record 形状ヘルパ ---
{
  const shot = { image: 'a.jpg', media: [] };
  const drag = { image: 'b.jpg', source: 'drag' };
  const eagle = { image: 'c.png', source: 'eagle-migration' };
  const withMedia = { image: 'd.jpg', media: [{ file: 'm1.png' }, { file: 'm2.png' }, {}] };
  assert('mediaFilesOf 有効 file のみ', R.mediaFilesOf(withMedia).join(',') === 'm1.png,m2.png');
  assert('mediaFilesOf 非配列 → []', R.mediaFilesOf({}).length === 0);
  assert('isScreenshot jpg キャプチャ', R.isScreenshot(shot) === true);
  assert('isScreenshot drag は除外', R.isScreenshot(drag) === false);
  assert('isScreenshot 非JPEG は除外', R.isScreenshot(eagle) === false);
  assert('captureFile はスクショのみ', R.captureFile(shot) === 'a.jpg' && R.captureFile(drag) === '');
  assert('artworkFile media 優先', R.artworkFile(withMedia) === 'm1.png');
  assert('artworkFile 非スクショ image を採用', R.artworkFile(eagle) === 'c.png');
  assert('densityImage list=キャプチャ優先', R.densityImage(withMedia, 'list') === 'd.jpg');
  assert('densityImage card=アートワーク優先', R.densityImage(withMedia, 'card') === 'm1.png');
  assert('groupFilesOf media なければ artwork', R.groupFilesOf(eagle).join(',') === 'c.png');
  assert('postIdKey captureId 優先＋フォールバック', R.postIdKey({ captureId: 'c1' }) === 'c1' && R.postIdKey({ url: 'u', capturedAt: 't' }) === 'u|t');
}

// --- makeGroupRecords: URL 自動グループ／手動優先／opt-out／セルフリプ合流 ---
{
  let manualGroups = [];
  let ungrouped = new Set();
  const groupRecords = R.makeGroupRecords({ manualGroups: () => manualGroups, ungrouped: () => ungrouped });
  const mk = (over) => R.stampPost(Object.assign({ media: [], tags: [], hashtags: [] }, over));
  const a1 = mk({ captureId: 'a1', url: 'https://x.com/u/status/1', userId: 'u1', image: 'a1.jpg', text: '' });
  const a2 = mk({ captureId: 'a2', url: 'https://x.com/u/status/1', userId: 'u1', image: 'a2.png', source: 'drag', text: 'つづき' });
  const b = mk({ captureId: 'b0', url: 'https://x.com/u/status/2', userId: 'u1', image: 'b.jpg', text: '' });

  let gs = groupRecords([a2, a1, b]);
  assert('同一URLは1グループに集約', gs.length === 2 && gs.find((g) => g.records.length === 2));
  const ga = gs.find((g) => g.records.length === 2);
  assert('records は captureId 順', ga.records[0].captureId === 'a1' && ga.records[1].captureId === 'a2');
  assert('rep はスクショ優先', ga.rep === a1);
  assert('files はグループ集約（drag は artwork 扱い）', ga.files.join(',') === 'a2.png');

  // 手動グループが URL キーに勝つ（a1 と b を手動で束ねる／a2 は URL キー単独に）
  manualGroups = [['a1', 'b0']];
  gs = groupRecords([a1, a2, b]);
  const manual = gs.find((g) => String(g.key).indexOf('manual:') === 0);
  assert('手動グループ優先', manual && manual.records.length === 2 && manual.records.some((r) => r.captureId === 'b0'));
  manualGroups = [];

  // opt-out: キーを ungrouped に入れると自動グループが解散（ゲッター注入＝再代入が生きる証明）
  ungrouped = new Set(['x:1']);
  gs = groupRecords([a1, a2, b]);
  assert('ungrouped opt-out で solo 分解（deps はライブ読み）', gs.length === 3);
  ungrouped = new Set();

  // セルフリプ: 同一作者の replyToId がライブラリ内の親 post id を指すと親グループへ合流
  const parent = mk({ captureId: 'p1', url: 'https://x.com/u/status/100', userId: 'u9', image: 'p.jpg', text: 'リプ元' });
  const child = mk({ captureId: 'p2', url: 'https://x.com/u/status/101', userId: 'u9', replyToId: '100', image: 'q.jpg', text: 'セルフリプ' });
  const other = mk({ captureId: 'p3', url: 'https://x.com/u/status/102', userId: 'OTHER', replyToId: '100', image: 'r.jpg', text: '他人のリプ' });
  gs = groupRecords([parent, child, other]);
  const merged = gs.find((g) => g.records.length === 2);
  assert('セルフリプは親グループへ合流', merged && merged.records.some((r) => r.captureId === 'p1') && merged.records.some((r) => r.captureId === 'p2'));
  assert('他人のリプは合流しない', gs.length === 2);

  // Long self-reply chain: each post aliases to its IMMEDIATE parent's key, so
  // alias depth equals thread length. The old fixed depth-10 cap split threads
  // longer than ~11 posts into several cards (audit follow-up ②).
  {
    const chain = [];
    for (let i = 0; i < 15; i++) {
      chain.push(
        mk({
          captureId: 'c' + String(i).padStart(2, '0'),
          url: 'https://x.com/u/status/' + (200 + i),
          userId: 'u9',
          replyToId: i === 0 ? undefined : String(200 + i - 1),
          image: 'c' + i + '.jpg',
          text: '',
        }),
      );
    }
    gs = groupRecords(chain);
    assert('長いセルフリプ連鎖（15件）も1グループ', gs.length === 1 && gs[0].records.length === 15);
  }

  // Mutual replies (impossible on real SNS = corrupt data) form an alias cycle;
  // the seen-set guard must terminate instead of looping forever.
  {
    const ra = mk({ captureId: 'r1', url: 'https://x.com/u/status/301', userId: 'u9', replyToId: '302', image: 'ra.jpg', text: '' });
    const rb = mk({ captureId: 'r2', url: 'https://x.com/u/status/302', userId: 'u9', replyToId: '301', image: 'rb.jpg', text: '' });
    gs = groupRecords([ra, rb]);
    assert('相互リプの環でも停止する（自己解決で2グループ）', gs.length === 2);
  }
}

// --- percentileFn: プラットフォーム内 likes パーセンタイル ---
{
  const list = [
    { platform: 'x', likes: 0 },
    { platform: 'x', likes: 10 },
    { platform: 'x', likes: 100 },
    { platform: 'misskey', likes: 5 },
  ];
  const pct = R.percentileFn(list);
  assert('percentile 最下位=0', pct(list[0]) === 0);
  assert('percentile 最上位=1', pct(list[2]) === 1);
  assert('percentile 単独プラットフォームは 1', pct(list[3]) === 1);
  assert('percentile プラットフォーム分離（x の 10 は中位）', pct(list[1]) === 0.5);
}

// --- makeGallery: ライトボックス項目（image→video→media 順・グループは src 去重） ---
{
  const { buildGalleryItems, buildGroupGalleryItems } = R.makeGallery({ fileSrc: (f) => 'stub://' + f });
  const p1 = { image: 'shot.jpg', video: 'clip.mp4', media: [{ file: 'a.png', alt: 'A' }, { file: 'b.mp4' }, null, { file: '' }] };
  const items = buildGalleryItems(p1);
  assert('gallery 順序＝image→video→media', items.map((i) => i.src).join() === 'stub://shot.jpg,stub://clip.mp4,stub://a.png,stub://b.mp4');
  assert('gallery video フラグ（image=false/video=true/media は拡張子判定）', items.map((i) => i.video).join() === 'false,true,false,true');
  assert('gallery alt 引き継ぎ（無指定は空）', items[2].alt === 'A' && items[3].alt === '');
  assert('gallery null/空 file の media はスキップ', items.length === 4);
  const r1 = { image: 'shot.jpg' };
  const r2 = { image: 'shot.jpg', media: [{ file: 'c.png' }] };
  assert('group 単独＝rep の items 直行', buildGroupGalleryItems({ records: [r1], rep: r1 }).length === 1);
  const gi = buildGroupGalleryItems({ records: [r1, r2], rep: r1 });
  assert('group 複数＝src 去重（shot.jpg は1回）', gi.map((i) => i.src).join() === 'stub://shot.jpg,stub://c.png');
}

if (failed) {
  console.error(`FAIL test-records-unit: ${failed} assertion(s) red`);
  process.exit(1);
}
console.log('PASS test-records-unit: postKeyOf / stampPost / shape helpers / grouping / gallery / percentile all green');
