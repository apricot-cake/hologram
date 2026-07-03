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

// --- text: URL 照合（URL 形クエリのみ・postKeyOf 正規化・quotedUrl・fuzzy 不適用）---
const R = require(path.join(__dirname, '..', 'app', 'renderer', 'records.js'));
const predOfU = Q.makePostPredOf({
  isInCollection: () => false,
  isClipped: () => false,
  // exact では絶対に当たらない fuzzy スタブ＝URL ヒットが OR 経路である証明に使う
  fuzzyCompile: () => (s) => s.includes('ネコ'),
  postKeyOf: R.postKeyOf,
});
const xPost = R.stampPost(post({ url: 'https://x.com/foo/status/123', platform: 'x' }));
assert('text(url): フル URL 貼り付けが部分一致で当たる', predOfU({ type: 'text', value: 'https://x.com/foo/status/123', mode: 'exact' })(xPost));
assert('text(url): twitter.com 貼り付けが x.com 保存分に postKey で当たる', predOfU({ type: 'text', value: 'https://twitter.com/foo/status/123', mode: 'exact' })(xPost));
assert('text(url): ドメイン断片（misskey.io）も URL に当たる', predOfU({ type: 'text', value: 'misskey.io', mode: 'exact' })(R.stampPost(post())));
const quoter = R.stampPost(post({ quotedUrl: 'https://x.com/bar/status/999' }));
assert('text(url): 引用元 URL の貼り付けが引用した投稿に当たる', predOfU({ type: 'text', value: 'https://twitter.com/bar/status/999', mode: 'exact' })(quoter));
assert('text(url): 非URL形の語（notes）は URL だけの一致では当たらない', !predOfU({ type: 'text', value: 'notes', mode: 'exact' })(R.stampPost(post())));
assert('text(url): fuzzy モードでも URL 貼り付けは exact 経路で当たる', predOfU({ type: 'text', value: 'https://misskey.io/notes/abc', mode: 'fuzzy' })(R.stampPost(post())));
assert('text: description（Eagle 注釈）にも当たる', predOfU({ type: 'text', value: '注釈テキスト', mode: 'exact' })(post({ description: 'ここに注釈テキストがある' })));

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

// --- 木変異ドメイン（第9スライス: createQueryBuilder から抽出した純ロジック）---
const mkLeaf = (type, value, extra) => Object.assign({ kind: 'cond', type, value }, extra);
const mkGrp = (op, children, neg) => ({ kind: 'group', op, neg: !!neg, children });

// treeParentMap / nodeContains / detachNode
{
  const a = mkLeaf('tag', 'a');
  const b = mkLeaf('tag', 'b');
  const inner = mkGrp('or', [a, b]);
  const t = mkGrp('and', [inner]);
  const pmap = Q.treeParentMap(t);
  assert('treeParentMap: 子→親を全段解決', pmap.get(a) === inner && pmap.get(inner) === t);
  assert('nodeContains: 自身と子孫は true', Q.nodeContains(t, a) && Q.nodeContains(inner, inner));
  assert('nodeContains: 葉は子を含まない', !Q.nodeContains(a, b));
  Q.detachNode(a, pmap);
  assert('detachNode: 親の children から除去', inner.children.length === 1 && inner.children[0] === b);
  Q.detachNode(t, pmap); // 親なし（root）は no-op
  assert('detachNode: root は no-op', t.children.length === 1);
}

// cleanupTree: 空グループ除去・単独グループ折り畳み（neg は生存者へ合流）
{
  const only = mkLeaf('tag', 'x', { neg: false });
  const t = mkGrp('and', [mkGrp('or', [], false), mkGrp('or', [only], true)]);
  Q.cleanupTree(t);
  assert('cleanupTree: 空グループ除去+単独折り畳み', t.children.length === 1 && t.children[0] === only);
  assert('cleanupTree: 折り畳みで neg が生存者に反転合流', only.neg === true);
}

// hasLeafValue / removeCondsMatching
{
  const t = mkGrp('and', [mkLeaf('tag', 'a'), mkGrp('or', [mkLeaf('tag', 'b'), mkLeaf('platform', 'x')])]);
  assert('hasLeafValue: ネスト内も探索', Q.hasLeafValue(t, 'tag', 'b') && !Q.hasLeafValue(t, 'tag', 'zzz'));
  const changed = Q.removeCondsMatching(t, (c) => c.type === 'tag');
  assert('removeCondsMatching: 全段から削除+変更検知', changed && Q.treeLeaves(t).length === 1);
  assert('removeCondsMatching: 残り1葉のグループは折り畳み済み', t.children[0].kind === 'cond' && t.children[0].type === 'platform');
  assert('removeCondsMatching: 不一致なら false', Q.removeCondsMatching(t, (c) => c.type === 'nope') === false);
}

// sameLeaf: date は型一致のみ・engagement は engType・他は value
assert('sameLeaf: date は値無視で一致', Q.sameLeaf(mkLeaf('date', undefined, { from: '2026-01-01' }), { type: 'date' }));
assert('sameLeaf: engagement は engType 比較', Q.sameLeaf(mkLeaf('engagement', undefined, { engType: 'likes' }), { type: 'engagement', engType: 'likes' }) && !Q.sameLeaf(mkLeaf('engagement', undefined, { engType: 'likes' }), { type: 'engagement', engType: 'reposts' }));
assert('sameLeaf: 通常型は value 比較', Q.sameLeaf(mkLeaf('tag', 'a'), { type: 'tag', value: 'a' }) && !Q.sameLeaf(mkLeaf('tag', 'a'), { type: 'tag', value: 'b' }));

// buildShadow: 重複排除・date/engagement は素通し（kind/neg 除去）・label 保持
{
  const t = mkGrp('and', [mkLeaf('tag', 'a', { label: 'ラベル' }), mkGrp('or', [mkLeaf('tag', 'a'), mkLeaf('date', undefined, { neg: true, from: '2026-01-01', to: '2026-01-02' })]), mkLeaf('engagement', undefined, { engType: 'likes', min: 5 })]);
  const sh = Q.buildShadow(t);
  assert('buildShadow: type+value で重複排除', sh.filter((f) => f.type === 'tag').length === 1);
  assert('buildShadow: label 保持', sh.find((f) => f.type === 'tag').label === 'ラベル');
  const dt = sh.find((f) => f.type === 'date');
  assert('buildShadow: date は kind/neg を落として素通し', dt && dt.from === '2026-01-01' && dt.kind === undefined && dt.neg === undefined);
  assert(
    'buildShadow: engagement も素通し',
    sh.some((f) => f.type === 'engagement' && f.min === 5),
  );
}

// dropNode: pair（親の逆演算子でペア化）/ inside / root・自己・子孫拒否
{
  const a = mkLeaf('tag', 'a');
  const b = mkLeaf('tag', 'b');
  const c = mkLeaf('tag', 'c');
  const t = mkGrp('and', [a, b, c]);
  assert('dropNode: pair はターゲット位置に逆 op のペアグループ', Q.dropNode(t, c, a, 'pair') === true && t.children[0].kind === 'group' && t.children[0].op === 'or' && t.children[0].children[0] === a && t.children[0].children[1] === c);
  const pairGrp = t.children[0];
  assert('dropNode: inside はグループ末尾へ追加', Q.dropNode(t, b, pairGrp, 'inside') === true && pairGrp.children[2] === b);
  assert('dropNode: root へ移動（2人残の元グループは折り畳まれず存続）', Q.dropNode(t, b, t, 'root') === true && t.children[t.children.length - 1] === b && pairGrp.children.length === 2);
  assert('dropNode: 自分自身へは拒否', Q.dropNode(t, a, a, 'pair') === false);
  assert('dropNode: 自分の子孫へは拒否', Q.dropNode(t, pairGrp, a, 'inside') === false);
  assert('dropNode: target null は拒否', Q.dropNode(t, a, null, 'pair') === false);
}

// wrapAllInGroup: 全体を一段括る（新 root を返す）・単独は折り畳み・空は null
{
  const t = mkGrp('or', [mkLeaf('tag', 'a'), mkLeaf('tag', 'b')]);
  const w = Q.wrapAllInGroup(t);
  assert('wrapAllInGroup: 旧 root が op ごと1グループに包まれ新 root は and', w.op === 'and' && w.children.length === 1 && w.children[0].kind === 'group' && w.children[0].op === 'or' && w.children[0].children.length === 2);
  const single = mkGrp('and', [mkLeaf('tag', 'a')]);
  const ws = Q.wrapAllInGroup(single);
  assert('wrapAllInGroup: 単独条件の括りは折り畳みで実質 no-op', ws.children.length === 1 && ws.children[0].kind === 'cond');
  assert('wrapAllInGroup: 空 tree は null', Q.wrapAllInGroup(Q.emptyTree()) === null);
}

if (failed) {
  console.error(`FAIL test-query-unit: ${failed} assertion(s) red`);
  process.exit(1);
}
console.log('PASS test-query-unit');
