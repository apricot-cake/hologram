'use strict';

// users.js（window.corpusUsers）のロジック単体テスト。users.js は CommonJS でも
// export するので直接 require し、buildUsers（投稿者ロールアップ＋世代キャッシュ）と
// buildSuggest（検索サジェスト＝タグ上位＋投稿者マッチ）をスタブ deps 注入で検証する。
//
//   node scripts/test-users-unit.js

const path = require('node:path');

const U = require(path.join(__dirname, '..', 'app', 'renderer', 'users.js'));

let failed = 0;
function assert(name, cond) {
  if (cond) {
    console.log('ok  ', name);
  } else {
    console.log('FAIL', name);
    failed++;
  }
}

// --- スタブ環境: newest-first の投稿列（先頭が最新） ---
// u1(x) は3投稿＝最初の非空値が勝つ（displayName は2投稿目で補完）・日付範囲を集計。
// u3(misskey) はインスタンス抽出。url 無しはスキップ。
let posts = [
  { url: 'https://x.com/a/status/3', platform: 'x', userId: 'u1', screenName: 'alice', displayName: '', avatarFile: '', followers: null, date: '2026-03-03', capturedAt: '2026-06-03' },
  { url: 'https://x.com/a/status/2', platform: 'x', userId: 'u1', screenName: 'alice', displayName: 'アリス', avatarFile: 'ava1.jpg', followers: 120, date: '2026-03-01', capturedAt: '2026-06-01' },
  { url: 'https://x.com/a/status/1', platform: 'x', userId: 'u1', screenName: 'alice', displayName: '旧アリス', avatarFile: 'ava0.jpg', followers: 99, date: '2026-03-02', capturedAt: '2026-06-02', authorCreatedAt: '2020-01-01' },
  { url: 'https://misskey.io/notes/n1', platform: 'misskey', userId: 'u3', screenName: 'carol', displayName: 'キャロル', tags: ['風景'], date: '2026-02-01' },
  { url: null, platform: null, tags: ['取込タグ'] },
];
let gen = 1;

// fuzzy スタブ: exact では絶対当たらない照合（クエリ '☆' を「'風'を含む」へ解釈）＋
// 呼び出し記録＝注入経路そのものを検証する（query.js テストと同じ流儀）。
let fuzzyMode = false;
const compileCalls = [];
const corpusSearch = {
  isFuzzy: () => fuzzyMode,
  compile: (q) => {
    compileCalls.push(q);
    return (s) => String(s).includes('風') || String(s).includes('carol');
  },
};

const { buildUsers, buildSuggest } = U.makeUsers({
  allPosts: () => posts,
  generation: () => gen,
  userKey: (p) => p.platform + ':' + (p.userId || '@' + (p.screenName || '')),
  hostOf: (url) => {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  },
  corpusSearch: () => corpusSearch,
});

// --- buildUsers ---
{
  const users = buildUsers();
  assert('url 無しはスキップ（2投稿者のみ）', users.length === 2);
  const a = users.find((u) => u.key === 'x:u1');
  assert('count 集計', a.count === 3);
  assert('displayName＝最初の非空値（newest-first で最新）', a.displayName === 'アリス');
  assert('avatarFile/followers も同 idiom', a.avatarFile === 'ava1.jpg' && a.followers === 120);
  assert('authorCreatedAt 補完', a.authorCreatedAt === '2020-01-01');
  assert('日付範囲: latest/firstPost', a.latest === '2026-03-03' && a.firstPost === '2026-03-01');
  assert('取得日範囲: lastCapture/firstCapture', a.lastCapture === '2026-06-03' && a.firstCapture === '2026-06-01');
  assert('x はインスタンス無し', a.instance === '');
  const c = users.find((u) => u.key === 'misskey:u3');
  assert('misskey はインスタンス抽出', c.instance === 'misskey.io');

  // 世代キャッシュ: 同一世代は同一配列・世代バンプで再構築
  const again = buildUsers();
  assert('同一世代はキャッシュ（同一参照）', again === users);
  posts = posts.concat([{ url: 'https://x.com/b/status/9', platform: 'x', userId: 'u2', screenName: 'bob', date: '2026-01-01' }]);
  const stale = buildUsers();
  assert('世代据え置きでは新規投稿が見えない（キャッシュ健在）', stale.length === 2);
  gen = 2;
  const fresh = buildUsers();
  assert('世代バンプで再構築（3投稿者）', fresh.length === 3 && fresh.some((u) => u.key === 'x:u2'));
}

// --- buildSuggest（exact モード） ---
{
  // タグは SNS 投稿（url あり）のみ集計＝「取込タグ」は候補に出ない
  const none = buildSuggest('取込');
  assert('url 無し投稿のタグは集計外', !none.some((it) => it.kind === 'tag'));

  const s = buildSuggest('風景');
  const tag = s.find((it) => it.kind === 'tag');
  assert('tag 候補（value/label/note=count）', tag && tag.value === '風景' && tag.note === 1);

  const byName = buildSuggest('ALICE'); // 大文字入力
  assert(
    'user 候補は大文字小文字を無視（screenName マッチ）',
    byName.some((it) => it.kind === 'user' && it.value === 'x:u1'),
  );
  const byDisp = buildSuggest('アリス');
  const u = byDisp.find((it) => it.kind === 'user');
  assert('displayName マッチ＋label＝displayName・note＝count', u && u.value === 'x:u1' && u.label === 'アリス' && u.note === 3);
  const noDisp = buildSuggest('bob');
  const b = noDisp.find((it) => it.kind === 'user');
  assert('displayName 空は screenName へフォールバック', b && b.label === 'bob');
}

// --- buildSuggest（fuzzy モード＝注入経路の検証） ---
{
  fuzzyMode = true;
  const s = buildSuggest('☆'); // exact なら何にも当たらないクエリ
  assert('fuzzy: compile がクエリで呼ばれる', compileCalls.includes('☆'));
  assert(
    'fuzzy: matcher 経由でタグ「風景」が当たる',
    s.some((it) => it.kind === 'tag' && it.value === '風景'),
  );
  assert(
    'fuzzy: matcher 経由で carol が当たる',
    s.some((it) => it.kind === 'user' && it.value === 'misskey:u3'),
  );
  fuzzyMode = false;
}

// --- 上限（tag 6 件・user 4 件） ---
{
  gen = 3;
  posts = [];
  for (let i = 0; i < 10; i++) {
    posts.push({ url: `https://x.com/t/status/${i}`, platform: 'x', userId: 'tagger', screenName: 'tagger', tags: Array.from({ length: 10 }, (_, j) => `共通${j}`).slice(0, 10 - i) });
  }
  for (let i = 0; i < 6; i++) {
    posts.push({ url: `https://x.com/u${i}/status/1`, platform: 'x', userId: `common${i}`, screenName: `共通ユーザー${i}` });
  }
  const s = buildSuggest('共通');
  const tags = s.filter((it) => it.kind === 'tag');
  const users = s.filter((it) => it.kind === 'user');
  assert('tag 候補は上位6件', tags.length === 6);
  assert('tag は count 降順（共通0 が10件で先頭）', tags[0].value === '共通0' && tags[0].note === 10 && tags[1].note >= tags[2].note);
  assert('user 候補は4件まで', users.length === 4);
}

if (failed) {
  console.error(`FAIL test-users-unit: ${failed} assertion(s) red`);
  process.exit(1);
}
console.log('PASS test-users-unit: buildUsers（ロールアップ＋世代キャッシュ）/ buildSuggest（exact・fuzzy・上限） all green');
