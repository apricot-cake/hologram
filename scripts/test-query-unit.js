'use strict';

// query.js（window.corpusQuery）のロジック単体テスト。window シムで読み込み、
// 条件ツリー評価(evalNode)・各リーフ述語(makePostPredOf)・日付のローカル日境界
// (localDayRange)・移行用 facetTreeFrom を直接検証する。
//
//   node scripts/test-query-unit.js

const fs = require('node:fs');
const path = require('node:path');

const code = fs.readFileSync(path.join(__dirname, '..', 'app', 'renderer', 'query.js'), 'utf8');
global.window = {};
// 間接 eval でグローバルスコープ実行（query.js は window.corpusQuery を生やす）。
// biome-ignore lint/security/noGlobalEval: intentional indirect eval to load a plain window-IIFE script into the Node test scope
// biome-ignore lint/style/noCommaOperator: (0, eval) IS the indirect-eval idiom
(0, eval)(code);
const Q = global.window.corpusQuery;

let failed = 0;
function assert(name, cond) {
  if (cond) {
    console.log('ok  ', name);
  } else {
    console.log('FAIL', name);
    failed++;
  }
}

// --- 述語ファクトリ: 依存はスタブ注入（コレクション/クリップ/あいまい照合）---
const clipped = new Set(['cap-clip']);
const collections = new Map([['col-1', new Set(['cap-in'])]]);
const fuzzyCalls = []; // 注入された compile が「いつ・何で」呼ばれたかの記録
const predOf = Q.makePostPredOf({
  isInCollection: (id, cap) => !!(collections.get(id) && collections.get(id).has(cap)),
  isClipped: (cap) => clipped.has(cap),
  // exact では絶対に当たらない照合を返す簡易 fuzzy＝経路が本当に注入側を通った証明
  fuzzyCompile: (q) => {
    fuzzyCalls.push(q);
    return (s) => s.includes('ネコ');
  },
});

const post = (over) =>
  Object.assign(
    {
      captureId: 'cap-1',
      url: 'https://misskey.io/notes/abc',
      platform: 'misskey',
      userId: 'u123',
      screenName: 'neko',
      displayName: '猫の人',
      text: 'こんにちは世界',
      title: '',
      tags: ['作画'],
      hashtags: ['drawing'],
      mediaType: 'image',
      likes: 12,
      isReply: false,
      isQuote: false,
      isThread: false,
      date: '2026-05-10T12:34:00Z',
    },
    over || {},
  );

// --- リーフ述語 ---
assert('kind: post=url あり', predOf({ type: 'kind', value: 'post' })(post()));
assert('kind: image=url なし', predOf({ type: 'kind', value: 'image' })(post({ url: '' })));
assert('platform: 一致', predOf({ type: 'platform', value: 'misskey' })(post()));
assert('platform: __none=プラットフォーム無し', predOf({ type: 'platform', value: '__none' })(post({ platform: '' })));
assert('user: userId 優先キー', predOf({ type: 'user', value: 'misskey:u123' })(post()));
assert('user: userId 無しは @handle フォールバック', predOf({ type: 'user', value: 'x:@neko' })(post({ platform: 'x', userId: '' })));
assert('instance: misskey/mastodon のみ host 照合', predOf({ type: 'instance', value: 'misskey.io' })(post()));
assert('instance: 他PFは不一致', !predOf({ type: 'instance', value: 'x.com' })(post({ platform: 'x', url: 'https://x.com/a/1' })));
assert('postType: plain post', predOf({ type: 'postType', value: 'post' })(post()));
assert('postType: reply', predOf({ type: 'postType', value: 'reply' })(post({ isReply: true })));
assert('media: 一致', predOf({ type: 'media', value: 'image' })(post()));
assert('tag: 含む', predOf({ type: 'tag', value: '作画' })(post()));
assert('tag: tags 欠損は不一致(クラッシュしない)', !predOf({ type: 'tag', value: '作画' })(post({ tags: undefined })));
assert('hashtag: 含む', predOf({ type: 'hashtag', value: 'drawing' })(post()));
assert('collection: 注入依存で判定', predOf({ type: 'collection', value: 'col-1' })(post({ captureId: 'cap-in' })));
assert('collection: 非所属', !predOf({ type: 'collection', value: 'col-1' })(post()));
assert('clip: 注入依存で判定', predOf({ type: 'clip' })(post({ captureId: 'cap-clip' })));
assert('workspace: clip の legacy 別名', predOf({ type: 'workspace' })(post({ captureId: 'cap-clip' })));

// --- date: ローカル日境界（to は翌日 0時「未満」＝単日レンジがその日全体を覆う）---
const may10 = { type: 'date', from: '2026-05-10', to: '2026-05-10' };
const dLocal = (s) => new Date(s); // ローカル解釈の Date で投稿を作る
assert('date: 単日レンジがその日のローカル 23:59 を含む', predOf(may10)({ date: dLocal('2026-05-10T23:59:00').toISOString() }));
assert('date: 翌日のローカル 00:00 は含まない', !predOf(may10)({ date: dLocal('2026-05-11T00:00:00').toISOString() }));
assert('date: フィールド欠損は不一致', !predOf(may10)({ date: '' }));
assert('date: dateField=capturedAt を参照', predOf({ type: 'date', dateField: 'capturedAt', from: '2026-05-10', to: '2026-05-10' })({ capturedAt: dLocal('2026-05-10T10:00:00').toISOString() }));

// --- engagement ---
assert('engagement: gte 既定', predOf({ type: 'engagement', engType: 'likes', min: 10 })(post()));
assert('engagement: lte', predOf({ type: 'engagement', engType: 'likes', op: 'lte', min: 20 })(post()));
assert('engagement: min<=0 は素通し', predOf({ type: 'engagement', engType: 'likes', min: 0 })(post({ likes: 0 })));

// --- text: exact / fuzzy / メモ化 ---
const tExact = { type: 'text', value: 'こんにちは', mode: 'exact' };
assert('text: exact 部分一致(本文)', predOf(tExact)(post()));
assert('text: exact はタグにも当たる', predOf({ type: 'text', value: '作画', mode: 'exact' })(post({ text: '' })));
assert('text: 不一致', !predOf({ type: 'text', value: '存在しない語', mode: 'exact' })(post()));
assert('text: 空値は素通し', predOf({ type: 'text', value: '  ' })(post()));
const tFuzzy = { type: 'text', value: 'ﾈｺ', mode: 'fuzzy' };
assert('text: fuzzy は注入 compile を経由して当たる', predOf(tFuzzy)(post({ text: 'ネコ' })) && fuzzyCalls.length === 1 && fuzzyCalls[0] === 'ﾈｺ');
const memoBefore = tFuzzy._compiled;
predOf(tFuzzy)(post());
assert('text: _compiled はノードにメモ化される(再 compile なし)', tFuzzy._compiled === memoBefore && typeof memoBefore === 'function' && fuzzyCalls.length === 1);
tFuzzy._compiled = null; // JSON 往復（保存/タブ復元）で関数だけ落ちた状態を再現
assert('text: _compiledKey が残っても _compiled 欠落なら再コンパイル', predOf(tFuzzy)(post({ text: 'ネコ' })) && fuzzyCalls.length === 2);

// --- evalNode: AND/OR/否定/入れ子 ---
const leaf = (type, value, neg) => ({ kind: 'cond', type, value, neg: !!neg });
const group = (op, children, neg) => ({ kind: 'group', op, neg: !!neg, children });
const p1 = post();
assert('evalNode: AND 全一致', Q.evalNode(group('and', [leaf('platform', 'misskey'), leaf('media', 'image')]), p1, predOf));
assert('evalNode: AND 一部不一致で false', !Q.evalNode(group('and', [leaf('platform', 'misskey'), leaf('media', 'video')]), p1, predOf));
assert('evalNode: OR どれか一致', Q.evalNode(group('or', [leaf('platform', 'x'), leaf('media', 'image')]), p1, predOf));
assert('evalNode: リーフ否定', Q.evalNode(group('and', [leaf('platform', 'x', true)]), p1, predOf));
assert('evalNode: グループ否定', !Q.evalNode(group('and', [leaf('platform', 'misskey')], true), p1, predOf));
assert('evalNode: 入れ子 (misskey AND (x OR image))', Q.evalNode(group('and', [leaf('platform', 'misskey'), group('or', [leaf('platform', 'x'), leaf('media', 'image')])]), p1, predOf));

// --- ツリー機構 ---
assert(
  'emptyTree: and ルート・子なし',
  (() => {
    const t = Q.emptyTree();
    return t.kind === 'group' && t.op === 'and' && t.children.length === 0;
  })(),
);
assert('opposite: and⇄or', Q.opposite('and') === 'or' && Q.opposite('or') === 'and');
const nested = group('and', [leaf('tag', 'a'), group('or', [leaf('tag', 'b'), leaf('tag', 'c')])]);
assert(
  'treeLeaves: 入れ子を平坦化',
  Q.treeLeaves(nested)
    .map((l) => l.value)
    .join(',') === 'a,b,c',
);
assert('treeLeaves: null 安全', Q.treeLeaves(null).length === 0);

// --- facetTreeFrom: 旧 faceted state からの移行 ---
const mig = Q.facetTreeFrom([{ type: 'platform', value: 'x' }, { type: 'platform', value: 'misskey' }, { type: 'tag', value: '作画' }, { type: 'clip' }], { platform: 'or', tag: 'not' });
assert(
  'facetTreeFrom: 型ごとにグループ化(platform=or 2葉)',
  mig.children.some((c) => c.kind === 'group' && c.op === 'or' && !c.neg && c.children.length === 2),
);
assert(
  'facetTreeFrom: not は neg グループ',
  mig.children.some((c) => c.kind === 'group' && c.neg && c.children[0].type === 'tag'),
);
assert(
  'facetTreeFrom: NO_OP 型(clip)は直下リーフ',
  mig.children.some((c) => c.kind === 'cond' && c.type === 'clip'),
);

// --- 純ヘルパ ---
assert('hostOf: 通常 URL', Q.hostOf('https://misskey.io/notes/x') === 'misskey.io');
assert('hostOf: 不正 URL は空文字', Q.hostOf('not a url') === '');
assert('userKey: userId 優先', Q.userKey({ platform: 'x', userId: 'u1', screenName: 's' }) === 'x:u1');
assert('userKey: handle フォールバック', Q.userKey({ platform: 'x', screenName: 's' }) === 'x:@s');
assert(
  'textHaystackOf: null 安全で文字列化',
  Q.textHaystackOf({ text: null, tags: ['t'] }).every((s) => typeof s === 'string'),
);
const ldr = Q.localDayRange('2026-05-10', '2026-05-10');
assert('localDayRange: to は翌日ローカル 0時(排他)', ldr.to.getTime() - ldr.from.getTime() === 24 * 3600 * 1000 || ldr.to.getDate() === 11);
assert('localDayRange: 片側 null 対応', Q.localDayRange('', '').from === null && Q.localDayRange('', '').to === null);

if (failed) {
  console.error(`FAIL test-query-unit: ${failed} assertion(s) red`);
  process.exit(1);
}
console.log('PASS test-query-unit');
