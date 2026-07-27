'use strict';

// query.ts のロジック単体テスト。query.ts は real ES module（named exports）なので
// 動的 import() で読み込む（かつての eval-shim — 型ストリップ後の source を
// window シム上で間接 eval していたやり方 — は export 文を含むソースを Script
// として実行できず破綻するため廃止。2026-07-09 の window.hologramXxx→export/import
// 変換の一環）。条件ツリー評価(evalNode)・各リーフ述語(makePostPredOf)・日付の
// ローカル日境界(localDayRange)・移行用 facetTreeFrom を直接検証する。
//
//   node scripts/test-query-unit.cts

const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function main() {
  const Q = await import(pathToFileURL(path.join(__dirname, '..', 'app', 'src', 'renderer', 'src', 'services', 'query.ts')).href);

  let failed = 0;
  function assert(name, cond) {
    if (cond) {
      console.log('ok  ', name);
    } else {
      console.log('FAIL', name);
      failed++;
    }
  }

  // --- 述語ファクトリ: 依存はスタブ注入（コレクション/スマート照合）---
  const collections = new Map([['col-1', new Set(['cap-in'])]]);
  const fuzzyCalls: any[] = []; // 注入された compile が「いつ・何で」呼ばれたかの記録
  const predOf = Q.makePostPredOf({
    isInFolder: (id, cap) => !!collections.get(id)?.has(cap),
    // 簡易スマートマッチのスタブ: 'ﾈｺ' だけ 'ネコ' へ正規化する部分一致＝素の
    // includes では当たらないクエリで、経路が本当に注入側を通った証明に使う。
    fuzzyCompile: (q) => {
      fuzzyCalls.push(q);
      const nq = q === 'ﾈｺ' ? 'ネコ' : q;
      return (s) => s.includes(nq);
    },
  });

  const post = (over?) =>
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
  assert('folder: 注入依存で判定', predOf({ type: 'folder', value: 'col-1' })(post({ captureId: 'cap-in' })));
  assert('folder: 非所属', !predOf({ type: 'folder', value: 'col-1' })(post()));

  // --- normalizeLeaf / normalizeTree: retired leaf-type self-heal (#42) ---
  assert('normalizeLeaf: collection→folder', Q.normalizeLeaf({ kind: 'cond', type: 'collection', value: 'x' }).type === 'folder');
  assert('normalizeLeaf: 未知型は素通し', Q.normalizeLeaf({ kind: 'cond', type: 'tag', value: 'x' }).type === 'tag');
  {
    const tree = {
      kind: 'group',
      op: 'and',
      neg: false,
      children: [
        { kind: 'cond', type: 'collection', value: 'a' },
        {
          kind: 'group',
          op: 'or',
          neg: false,
          children: [
            { kind: 'cond', type: 'collection', value: 'b' },
            { kind: 'cond', type: 'tag', value: 't' },
          ],
        },
      ],
    };
    Q.normalizeTree(tree);
    const types: string[] = [];
    (function walk(n: any) {
      if (n.kind === 'group') n.children.forEach(walk);
      else types.push(n.type);
    })(tree);
    assert('normalizeTree: 全深さの collection→folder', types.filter((t) => t === 'folder').length === 2 && types.includes('tag') && !types.includes('collection'));
  }

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

  // --- text: 単一スマートマッチ（P2④＝mode 撤去・常に注入 compile 経由）＋メモ化 ---
  assert('text: 本文一致（注入 matcher 経由）', predOf({ type: 'text', value: 'こんにちは' })(post()) && fuzzyCalls.includes('こんにちは'));
  assert('text: タグにも当たる', predOf({ type: 'text', value: '作画' })(post({ text: '' })));
  assert('text: 不一致', !predOf({ type: 'text', value: '存在しない語' })(post()));
  assert('text: 空値は素通し（compile 不要）', predOf({ type: 'text', value: '  ' })(post()));
  assert('text: description（Eagle 注釈）にも当たる', predOf({ type: 'text', value: '注釈テキスト' })(post({ description: 'ここに注釈テキストがある' })));
  const tKana: any = { type: 'text', value: 'ﾈｺ' };
  const callsBefore = fuzzyCalls.length;
  assert('text: 半角カナが matcher の正規化で当たる（注入経路の証明）', predOf(tKana)(post({ text: 'ネコ' })) && fuzzyCalls.length === callsBefore + 1 && fuzzyCalls[fuzzyCalls.length - 1] === 'ﾈｺ');
  const memoBefore = tKana._compiled;
  predOf(tKana)(post());
  assert('text: _compiled はノードにメモ化される(再 compile なし)', tKana._compiled === memoBefore && typeof memoBefore === 'function' && fuzzyCalls.length === callsBefore + 1);
  tKana._compiled = null; // JSON 往復（保存/タブ復元）で関数だけ落ちた状態を再現
  assert('text: _compiledKey が残っても _compiled 欠落なら再コンパイル', predOf(tKana)(post({ text: 'ネコ' })) && fuzzyCalls.length === callsBefore + 2);

  // --- text: URL 照合（URL 形クエリのみ・postKeyOf 正規化・quotedUrl・smart matcher 不適用）---
  const R = await import(pathToFileURL(path.join(__dirname, '..', 'app', 'src', 'renderer', 'src', 'services', 'records.ts')).href);
  const predOfU = Q.makePostPredOf({
    isInFolder: () => false,
    // 絶対に当たらない matcher スタブ＝URL ヒットが（本文照合でなく）OR 経路である証明に使う
    fuzzyCompile: () => () => false,
    postKeyOf: R.postKeyOf,
  });
  const xPost = R.stampPost(post({ url: 'https://x.com/foo/status/123', platform: 'x' }));
  assert('text(url): フル URL 貼り付けが部分一致で当たる', predOfU({ type: 'text', value: 'https://x.com/foo/status/123' })(xPost));
  assert('text(url): twitter.com 貼り付けが x.com 保存分に postKey で当たる', predOfU({ type: 'text', value: 'https://twitter.com/foo/status/123' })(xPost));
  assert('text(url): ドメイン断片（misskey.io）も URL に当たる', predOfU({ type: 'text', value: 'misskey.io' })(R.stampPost(post())));
  const quoter = R.stampPost(post({ quotedUrl: 'https://x.com/bar/status/999' }));
  assert('text(url): 引用元 URL の貼り付けが引用した投稿に当たる', predOfU({ type: 'text', value: 'https://twitter.com/bar/status/999' })(quoter));
  assert('text(url): 非URL形の語（notes）は URL だけの一致では当たらない', !predOfU({ type: 'text', value: 'notes' })(R.stampPost(post())));
  assert('text(url): URL 貼り付けは smart matcher を経由せず exact 経路で当たる', predOfU({ type: 'text', value: 'https://misskey.io/notes/abc' })(R.stampPost(post())));

  // --- makePosterPredOf: poster フィルタ述語（post 側 makePostPredOf の対称）---
  // deps=posterTagsOf（key→タグ配列・tags.js）/ folderById（id→{items}・pfStore）を注入。
  const posterTags = new Map([['x:@aaa', ['作画', 'Ave Mujica']]]);
  const posterFolders = new Map([['fo-1', { items: ['x:@aaa', 'x:@bbb'] }]]);
  const posterPredOf = Q.makePosterPredOf({
    posterTagsOf: (key) => posterTags.get(key) || [],
    folderById: (id) => posterFolders.get(id) || null,
  });
  const poster = (over?) => Object.assign({ key: 'x:@aaa', platform: 'x', instance: '', latest: '2026-05-10T12:00:00Z', lastCapture: '2026-06-01T00:00:00Z', authorCreatedAt: '2020-01-01T00:00:00Z' }, over || {});
  assert('poster platform: 一致', posterPredOf({ type: 'platform', value: 'x' })(poster()));
  assert('poster platform: 不一致', !posterPredOf({ type: 'platform', value: 'misskey' })(poster()));
  assert('poster instance: 一致', posterPredOf({ type: 'instance', value: 'misskey.io' })(poster({ instance: 'misskey.io' })));
  assert('poster tag: 注入 posterTagsOf 経由で含む', posterPredOf({ type: 'tag', value: 'Ave Mujica' })(poster()));
  assert('poster tag: タグ無しポスターは不一致(クラッシュしない)', !posterPredOf({ type: 'tag', value: '作画' })(poster({ key: 'x:@none' })));
  assert('poster folder: メンバーは一致', posterPredOf({ type: 'folder', value: 'fo-1' })(poster()));
  assert('poster folder: 非メンバーは不一致', !posterPredOf({ type: 'folder', value: 'fo-1' })(poster({ key: 'x:@zzz' })));
  assert('poster folder: 未知フォルダは空集合＝不一致', !posterPredOf({ type: 'folder', value: 'fo-none' })(poster()));
  // date: 既定フィールド=latest、to は翌日 0時未満（post 側と同じ localDayRange 規約）
  const pMay10 = { type: 'date', from: '2026-05-10', to: '2026-05-10' };
  assert('poster date: 既定 latest がその日のローカル 23:59 を含む', posterPredOf(pMay10)(poster({ latest: dLocal('2026-05-10T23:59:00').toISOString() })));
  assert('poster date: 翌日ローカル 00:00 は含まない', !posterPredOf(pMay10)(poster({ latest: dLocal('2026-05-11T00:00:00').toISOString() })));
  assert('poster date: dateField=lastCapture を参照', posterPredOf({ type: 'date', dateField: 'lastCapture', from: '2026-06-01', to: '2026-06-01' })(poster({ lastCapture: dLocal('2026-06-01T10:00:00').toISOString() })));
  assert('poster date: フィールド欠損は不一致', !posterPredOf(pMay10)(poster({ latest: '' })));
  assert('poster: 未知タイプは素通し(true)', posterPredOf({ type: 'workspace' })(poster()));

  // --- evalNode: AND/OR/否定/入れ子 ---
  const leaf = (type, value, neg?) => ({ kind: 'cond', type, value, neg: !!neg });
  const group = (op, children, neg?) => ({ kind: 'group', op, neg: !!neg, children });
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
  const mig = Q.facetTreeFrom([{ type: 'platform', value: 'x' }, { type: 'platform', value: 'misskey' }, { type: 'tag', value: '作画' }, { type: 'engagement' }], { platform: 'or', tag: 'not' });
  assert(
    'facetTreeFrom: 型ごとにグループ化(platform=or 2葉)',
    mig.children.some((c) => c.kind === 'group' && c.op === 'or' && !c.neg && c.children.length === 2),
  );
  assert(
    'facetTreeFrom: not は neg グループ',
    mig.children.some((c) => c.kind === 'group' && c.neg && c.children[0].type === 'tag'),
  );
  assert(
    'facetTreeFrom: NO_OP 型(engagement)は直下リーフ',
    mig.children.some((c) => c.kind === 'cond' && c.type === 'engagement'),
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
  const mkLeaf = (type, value, extra?) => Object.assign({ kind: 'cond', type, value }, extra);
  const mkGrp = (op, children, neg?) => ({ kind: 'group', op, neg: !!neg, children });

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

  // --- ファセット・ドメイン（改訂④: UI が作る形をファセットCNFに固定する純ロジック）---
  const OPTS = { multiValueTypes: ['tag'], standaloneTypes: ['date', 'text'] };
  assert('facetDefaultOp: 多値=and / 他=or', Q.facetDefaultOp('tag', OPTS) === 'and' && Q.facetDefaultOp('platform', OPTS) === 'or');

  // facetViewOf: 正準形をクラスタ/単独/除外へ分解
  {
    const t = mkGrp('and', [mkGrp('or', [mkLeaf('platform', 'x'), mkLeaf('platform', 'misskey')]), mkLeaf('tag', 'a'), mkLeaf('date', undefined, { from: '2026-01-01' }), mkLeaf('tag', 'b', { neg: true })]);
    const v = Q.facetViewOf(t, OPTS);
    assert('facetViewOf: クラスタ/単独/除外へ分解', !!v && v.clusters.length === 2 && v.singles.length === 1 && v.excl.length === 1);
    assert('facetViewOf: platform グループは or', v.clusters[0].type === 'platform' && v.clusters[0].op === 'or');
  }
  {
    const v = Q.facetViewOf(mkGrp('and', [mkLeaf('platform', 'x'), mkLeaf('platform', 'misskey')]), OPTS);
    assert('facetViewOf: 単一値型の裸2葉(恒偽AND)は or に修復', !!v && v.clusters[0].op === 'or' && v.clusters[0].leaves.length === 2);
  }
  {
    const v = Q.facetViewOf(mkGrp('and', [mkLeaf('tag', 'a'), mkLeaf('tag', 'b')]), OPTS);
    assert('facetViewOf: 多値型の裸2葉は and（root AND の意味保存）', !!v && v.clusters[0].op === 'and');
  }
  assert('facetViewOf: OR ルートは null', Q.facetViewOf(mkGrp('or', [mkLeaf('tag', 'a'), mkLeaf('tag', 'b')]), OPTS) === null);
  assert('facetViewOf: 入れ子グループは null', Q.facetViewOf(mkGrp('and', [mkGrp('or', [mkLeaf('tag', 'a'), mkGrp('and', [mkLeaf('tag', 'b'), mkLeaf('tag', 'c')])])]), OPTS) === null);
  assert('facetViewOf: neg グループは null', Q.facetViewOf(mkGrp('and', [mkGrp('or', [mkLeaf('tag', 'a'), mkLeaf('tag', 'b')], true)]), OPTS) === null);
  assert('facetViewOf: 型混在グループは null', Q.facetViewOf(mkGrp('and', [mkGrp('or', [mkLeaf('tag', 'a'), mkLeaf('platform', 'x')])]), OPTS) === null);
  assert('facetViewOf: グループ+同型の裸葉は null（クラスタ∧葉は別物）', Q.facetViewOf(mkGrp('and', [mkGrp('or', [mkLeaf('tag', 'a'), mkLeaf('tag', 'b')]), mkLeaf('tag', 'c')]), OPTS) === null);
  assert('facetViewOf: 単独型(text)のグループは null', Q.facetViewOf(mkGrp('and', [mkGrp('or', [mkLeaf('text', 'a'), mkLeaf('text', 'b')])]), OPTS) === null);

  // canonicalizeFacet: 裸2葉→実グループ化・並べ替え（クラスタ→単独→除外）
  {
    const t = mkGrp('and', [mkLeaf('tag', 'x', { neg: true }), mkLeaf('date', undefined, { from: '2026-01-01' }), mkLeaf('tag', 'a'), mkLeaf('tag', 'b')]);
    assert('canonicalizeFacet: 変換成功', Q.canonicalizeFacet(t, OPTS) === true);
    assert('canonicalizeFacet: 2葉クラスタが実グループ(and)に', t.children[0].kind === 'group' && t.children[0].op === 'and' && t.children[0].children.length === 2);
    assert('canonicalizeFacet: 並び=クラスタ→単独→除外', t.children[1].type === 'date' && t.children[2].neg === true);
  }
  {
    const t = mkGrp('or', [mkLeaf('tag', 'a'), mkLeaf('tag', 'b')]);
    const before = JSON.stringify(t);
    assert('canonicalizeFacet: 非ファセット形は false・非破壊', Q.canonicalizeFacet(t, OPTS) === false && JSON.stringify(t) === before);
  }

  // facetAdd: 裸葉→2値目でグループ化（既定 op）→以降は合流・単独型はトップへ
  {
    const t = mkGrp('and', []);
    Q.facetAdd(t, mkLeaf('tag', 'a'), OPTS);
    assert('facetAdd: 最初の値は裸葉', t.children.length === 1 && t.children[0].kind === 'cond');
    Q.facetAdd(t, mkLeaf('tag', 'b'), OPTS);
    assert('facetAdd: 2値目で既定 op のグループ化(tag=and)', t.children[0].kind === 'group' && t.children[0].op === 'and' && t.children[0].children.length === 2);
    t.children[0].op = 'or'; // ユーザーが「どれか」へ切替
    Q.facetAdd(t, mkLeaf('tag', 'c'), OPTS);
    assert('facetAdd: 3値目は既存グループへ合流(op 維持)', t.children[0].children.length === 3 && t.children[0].op === 'or');
    Q.facetAdd(t, mkLeaf('platform', 'x'), OPTS);
    Q.facetAdd(t, mkLeaf('platform', 'misskey'), OPTS);
    assert('facetAdd: platform は既定 or でグループ化', t.children[1].kind === 'group' && t.children[1].op === 'or');
    Q.facetAdd(t, mkLeaf('text', 'hey'), OPTS);
    Q.facetAdd(t, mkLeaf('text', 'yo'), OPTS);
    assert('facetAdd: 単独型はグループ化せずトップへ', t.children.filter((c) => c.kind === 'cond' && c.type === 'text').length === 2);
  }

  // facetSetOp: すべて/どれか トグルの書き込み先
  {
    const t = mkGrp('and', [mkGrp('and', [mkLeaf('tag', 'a'), mkLeaf('tag', 'b')])]);
    assert('facetSetOp: op を書き換え', Q.facetSetOp(t, 'tag', 'or') === true && t.children[0].op === 'or');
    assert('facetSetOp: 該当グループ無しは false', Q.facetSetOp(t, 'platform', 'or') === false);
  }

  // facetSetNeg: 除くへ移動⇄クラスタへ復帰（op 維持・1値クラスタは折り畳み・冗長は消滅）
  {
    const a = mkLeaf('tag', 'a');
    const b = mkLeaf('tag', 'b');
    const c = mkLeaf('tag', 'c');
    const t = mkGrp('and', [mkGrp('or', [a, b, c])]);
    assert('facetSetNeg: 除外へ移動', Q.facetSetNeg(t, c, true, OPTS) === true && c.neg === true && t.children[t.children.length - 1] === c);
    assert('facetSetNeg: 残りクラスタは維持', t.children[0].kind === 'group' && t.children[0].children.length === 2);
    assert('facetSetNeg: 戻すと元クラスタへ合流(op 維持)', Q.facetSetNeg(t, c, false, OPTS) === true && c.neg === false && t.children[0].children.length === 3 && t.children[0].op === 'or');
    Q.facetSetNeg(t, b, true, OPTS);
    Q.facetSetNeg(t, a, true, OPTS);
    assert('facetSetNeg: 1値になったクラスタは折り畳み', t.children[0] === c && c.neg === false);
    assert('facetSetNeg: neg 不変は false', Q.facetSetNeg(t, a, true, OPTS) === false);
  }
  {
    const d1 = mkLeaf('tag', 'd');
    const d2 = mkLeaf('tag', 'd', { neg: true });
    const t = mkGrp('and', [d1, d2]);
    Q.facetSetNeg(t, d2, false, OPTS);
    assert('facetSetNeg: 戻し先に同値の陽性があれば冗長 leaf は消える', Q.treeLeaves(t).length === 1 && t.children[0] === d1);
  }
  {
    const dirty = { kind: 'group', op: 'and', neg: false, _compiled: () => 1, children: [{ kind: 'cond', type: 'text', value: 'q', _memo: { big: true } }] };
    const clean = Q.cloneTree(dirty);
    assert('cloneTree: 深いコピー', clean !== dirty && clean.children[0] !== dirty.children[0] && clean.children[0].value === 'q');
    assert('cloneTree: _ 始まりの一時フィールドを全階層で落とす', !('_compiled' in clean) && !('_memo' in clean.children[0]));
  }

  if (failed) {
    console.error(`FAIL test-query-unit: ${failed} assertion(s) red`);
    process.exit(1);
  }
  console.log('PASS test-query-unit');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
