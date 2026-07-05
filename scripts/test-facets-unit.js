'use strict';

// facets.js（window.corpusFacets）のロジック単体テスト。facets.js は CommonJS でも
// export するので直接 require し、facetCounts（バケット集計）と qfValues（15カテゴリの
// フライアウト行モデル）をスタブ deps 注入で直接検証する。
//
//   node scripts/test-facets-unit.js

const path = require('node:path');

const F = require(path.join(__dirname, '..', 'app', 'renderer', 'facets.js'));

let failed = 0;
function assert(name, cond) {
  if (cond) {
    console.log('ok  ', name);
  } else {
    console.log('FAIL', name);
    failed++;
  }
}

// --- スタブ環境: 投稿6件（x2・misskey1・mastodon1・pixiv1・PFなし1） ---
const posts = [
  { url: 'https://x.com/a/status/1', platform: 'x', userId: 'u1', screenName: 'alice', displayName: 'アリス', tags: ['風景', '作品A'], hashtags: ['art'], mediaType: 'image', isReply: false, isQuote: false, isThread: false },
  { url: 'https://x.com/b/status/2', platform: 'x', userId: 'u2', screenName: 'bob', displayName: '', tags: ['風景'], hashtags: ['art', 'wip'], mediaType: 'video', isReply: true, isQuote: false, isThread: false },
  { url: 'https://misskey.io/notes/n1', platform: 'misskey', userId: 'u3', screenName: 'carol', tags: [], hashtags: [], mediaType: 'image', isReply: false, isQuote: true, isThread: false },
  { url: 'https://mstdn.jp/@d/3', platform: 'mastodon', userId: 'u4', screenName: 'dan', tags: ['キャラX'], hashtags: [], mediaType: 'gif', isReply: false, isQuote: false, isThread: true },
  { url: 'https://www.pixiv.net/artworks/9', platform: 'pixiv', userId: 'u5', screenName: 'eve', tags: ['未分類タグ'], hashtags: [], mediaType: 'image', isReply: false, isQuote: false, isThread: false },
  { url: null, platform: null, tags: ['風景'], hashtags: [], mediaType: 'image', isReply: false, isQuote: false, isThread: false },
];
// 現在クエリの母集団＝先頭3件だけに絞れている想定（facet count はこちらで数える）
const filtered = posts.slice(0, 3);

const active = new Set(['platform:x', 'tag:風景']);
const posterActive = new Set(['tag:P趣味']);
let tagGroups = [];
const multiOnly = false;

const KIND = { 作品A: 'work', キャラX: 'character', P作品: 'work' };

const posters = [
  { key: 'x:u1', platform: 'x', screenName: 'alice', displayName: 'アリス', count: 3 },
  { key: 'misskey:u3', platform: 'misskey', instance: 'misskey.io', screenName: 'carol', count: 2 },
  { key: 'mastodon:u4', platform: 'mastodon', instance: 'mstdn.jp', screenName: 'dan', count: 1 },
];
const posterTags = { 'x:u1': ['P趣味', 'P作品'], 'misskey:u3': ['P趣味'], 'mastodon:u4': [] };
const posterFolders = [{ id: 'pf1', name: '推し', items: ['x:u1', 'mastodon:u4'] }];

const deps = {
  getFilteredPosts: () => filtered,
  qHasValue: (t, v) => active.has(t + ':' + v),
  posterQHasValue: (t, v) => posterActive.has(t + ':' + v),
  allPosts: () => posts,
  hostOf: (url) => {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  },
  userKey: (p) => p.platform + ':' + (p.userId || '@' + (p.screenName || '')),
  MSG: { kindPost: 'SNS投稿', kindImage: '画像', qfPost: '投稿', qfReply: 'リプライ', qfQuote: '引用', qfThread: 'スレッド', qfImage: '画像', qfVideo: '動画', qfGif: 'GIF', qfMultiImage: '複数画像', qfPlatformNone: 'なし', tagGroupOther: 'その他' },
  PF_NAME: { x: 'X', bluesky: 'Bluesky', misskey: 'Misskey', mastodon: 'Mastodon', pixiv: 'pixiv' },
  tagKindOf: (t) => KIND[t],
  tagGroups: () => tagGroups,
  multiOnly: () => multiOnly,
  posterTagsOf: (key) => posterTags[key] || [],
  filteredPosters: () => posters,
  posterFilterVocab: () => ['P趣味', 'P作品'],
  namedPosters: () => posters,
  posterFolders: () => posterFolders,
  buildUsers: () => posters.map((u) => ({ key: u.key, screenName: u.screenName, displayName: u.displayName, count: u.count })),
};
const { facetCounts, qfValues } = F.makeFacets(deps);

// --- facetCounts ---
{
  const m = facetCounts((p) => p.platform || '__none');
  assert('facetCounts 既定母集団=filtered', m.get('x') === 2 && m.get('misskey') === 1 && !m.has('pixiv'));
  const t = facetCounts((p) => p.tags);
  assert('facetCounts 配列キーは各値を加算', t.get('風景') === 2 && t.get('作品A') === 1);
  const skip = facetCounts(() => null);
  assert('facetCounts null はスキップ', skip.size === 0);
  const pool = facetCounts((p) => p.platform, posts.slice(3));
  assert('facetCounts pool 指定で母集団切替', pool.get('mastodon') === 1 && pool.get('pixiv') === 1);
}

// --- kind / platform ---
{
  const rows = qfValues('kind');
  assert('kind 2値・ラベル', rows.length === 2 && rows[0].l === 'SNS投稿' && rows[1].v === 'image');

  const p = qfValues('platform');
  const main = p.filter((r) => !r.sub);
  assert('platform 主行=5PF+なし', main.length === 6 && main[5].v === '__none');
  assert('platform on 反映（x が active）', main[0].v === 'x' && main[0].on === true && main[1].on === false);
  assert('platform count は filtered 由来', main[0].count === 2 && main.find((r) => r.v === 'pixiv').count === 0);
  const subs = p.filter((r) => r.sub);
  assert('platform インスタンスサブ行（全ライブラリから列挙・type=instance）', subs.length === 2 && subs.every((r) => r.type === 'instance') && subs.some((r) => r.v === 'misskey.io') && subs.some((r) => r.v === 'mstdn.jp'));
  assert('platform サブ行 count（mstdn.jp は filtered 外=0）', subs.find((r) => r.v === 'misskey.io').count === 1 && subs.find((r) => r.v === 'mstdn.jp').count === 0);
}

// --- postType / media ---
{
  const rows = qfValues('postType');
  const by = Object.fromEntries(rows.map((r) => [r.v, r.count]));
  assert('postType 多重バケット', by.post === 1 && by.reply === 1 && by.quote === 1 && by.thread === 0);

  // 複数画像 moved to its own sidebar toggle row — the メディア flyout is back to
  // exactly the per-record media types (no __multi).
  const media = qfValues('media');
  assert('media = image/video/gif のみ（__multi 撤去）', media.length === 3 && media.map((r) => r.v).join(',') === 'image,video,gif');
  assert('media count', media[0].count === 2 && media[1].count === 1);
}

// --- tag（グループ見出し・__other） ---
{
  let rows = qfValues('tag');
  // グループ未定義: 種別付き（作品A/キャラX）を除いた一般タグのみ・present 先行
  assert(
    'tag 一般タグのみ（種別付き除外）',
    rows.every((r) => r.v !== '作品A' && r.v !== 'キャラX'),
  );
  assert('tag present 先行（風景 count=2 が先頭）', rows[0].v === '風景' && rows[0].count === 2);

  tagGroups = [{ id: 'g1', name: '雰囲気', tags: ['風景'] }];
  rows = qfValues('tag');
  assert('tag グループ見出し+その他見出し', rows[0].ghead === '雰囲気' && rows[1].v === '風景' && rows.some((r) => r.ghead === 'その他'));
  const otherIdx = rows.findIndex((r) => r.ghead === 'その他');
  assert('tag その他見出し下＝未所属のみ', rows[otherIdx + 1].v === '未分類タグ');
  tagGroups = [];
}

// --- work / character（用語帳） ---
{
  const w = qfValues('work');
  assert('work 種別スコープ＋type=tag', w.length === 1 && w[0].v === '作品A' && w[0].type === 'tag' && w[0].count === 1);
  const c = qfValues('character');
  assert('character 種別スコープ（filtered 外は count 0）', c.length === 1 && c[0].v === 'キャラX' && c[0].count === 0);
}

// --- hashtag / user / instance ---
{
  const h = qfValues('hashtag');
  assert('hashtag # ラベル＋count 降順', h[0].l === '#art' && h[0].count === 2 && h[1].count === 1);

  const u = qfValues('user');
  assert('user 表示名フォールバック（displayName→screenName）', u.some((r) => r.l === 'アリス') && u.some((r) => r.l === 'bob' || r.l === 'carol'));
  assert('user count は filtered の userKey 集計', u.find((r) => r.v === 'x:u1').count === 1);

  const i = qfValues('instance');
  assert('instance misskey/mastodon ホスト列挙', i.length === 2 && i.some((r) => r.v === 'misskey.io') && i.some((r) => r.v === 'mstdn.jp'));
  assert('instance present 先行', i[0].v === 'misskey.io' && i[0].count === 1);
}

// --- poster-* ---
{
  const pt = qfValues('poster-tag');
  assert('poster-tag 一般のみ＋posterQB on', pt.length === 1 && pt[0].v === 'P趣味' && pt[0].on === true && pt[0].count === 2);
  const pw = qfValues('poster-work');
  assert('poster-work 種別スコープ', pw.length === 1 && pw[0].v === 'P作品' && pw[0].kind === 'work');
  const pp = qfValues('poster-platform');
  assert('poster-platform PF_ORDER 順＝x が先頭', pp.length === 3 && pp[0].v === 'x' && pp[1].v === 'misskey');
  const pi = qfValues('poster-instance');
  assert('poster-instance ホスト列挙', pi.length === 2 && pi.every((r) => r.facetDim));
  const pf = qfValues('poster-folder');
  assert('poster-folder メンバー数 count', pf.length === 1 && pf[0].l === '推し' && pf[0].count === 2);
}

assert('default → []', qfValues('nonsense').length === 0);

if (failed) {
  console.error(`FAIL test-facets-unit: ${failed} assertion(s) red`);
  process.exit(1);
}
console.log('PASS test-facets-unit: facetCounts / qfValues 15カテゴリの行モデル all green');
