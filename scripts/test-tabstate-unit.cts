'use strict';

// Unit tests for tab-state.ts. A real ES module (named exports), loaded via
// dynamic import(). Covers the four extracted areas: makeTabLabels (filterLabel/
// tabTitleOf), makeNavHistory (push/back/forward/adopt/saveInto), serializeTabs,
// and sanitizeSavedTabs.
//
//   node scripts/test-tabstate-unit.cts

const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function main() {
  const T = await import(pathToFileURL(path.join(__dirname, '..', 'app', 'renderer', 'tab-state.ts')).href);

  let failed = 0;
  function assert(name, cond) {
    if (cond) {
      console.log('ok  ', name);
    } else {
      console.log('FAIL', name);
      failed++;
    }
  }

  // --- makeTabLabels: stub deps (only the keys filterLabel/tabTitleOf read) ---
  const STATIC_MSG = {
    kindPost: '投稿',
    kindImage: '画像',
    qfPlatformNone: 'PFなし',
    qfPost: 'ポスト',
    qfReply: 'リプライ',
    qfQuote: '引用',
    qfThread: 'スレッド',
    qfDateCaptured: '取得日',
    qfDatePost: '投稿日',
    clipTitle: 'クリップ',
    qfImage: '画像のみ',
    qfVideo: '動画',
    qfGif: 'GIF',
    filterAll: 'すべて',
    qfMultiImage: '複数画像',
    posterDateLastPost: '最終投稿',
    posterDateLastCapture: '最終取得',
    posterDateCreated: 'アカウント作成',
  };
  const t = (key) => STATIC_MSG[key];
  const { filterLabel, tabTitleOf, posterFilterLabel } = T.makeTabLabels({
    t,
    engTypeLabels: { likes: 'いいね' },
    platformName: (v) => ({ x: 'X', pixiv: 'pixiv' })[v] || v,
    formatShortDate: (s) => 'D:' + s,
    formatCount: (n) => 'C' + n,
    collectionName: (id) => (id === 'c1' ? 'お気に入り' : null),
    posterFolderName: (id) => (id === 'fo1' ? 'イラスト' : null),
  });

  // --- filterLabel: one case per switch branch ---
  assert('kind post/image', filterLabel({ type: 'kind', value: 'post' }) === '投稿' && filterLabel({ type: 'kind', value: 'image' }) === '画像');
  assert('platform __none → 専用ラベル', filterLabel({ type: 'platform', value: '__none' }) === 'PFなし');
  assert('platform 既知は platformName 経由', filterLabel({ type: 'platform', value: 'x' }) === 'X');
  assert('platform 未知は素通し', filterLabel({ type: 'platform', value: 'threads' }) === 'threads');
  assert('postType 4分岐', filterLabel({ type: 'postType', value: 'post' }) === 'ポスト' && filterLabel({ type: 'postType', value: 'reply' }) === 'リプライ' && filterLabel({ type: 'postType', value: 'quote' }) === '引用' && filterLabel({ type: 'postType', value: 'thread' }) === 'スレッド');
  assert('date: 投稿日＋from/to 整形', filterLabel({ type: 'date', from: '2026-01-01', to: '2026-02-01' }) === '投稿日: D:2026-01-01〜D:2026-02-01');
  assert('date: capturedAt は取得日・to 無しは空', filterLabel({ type: 'date', dateField: 'capturedAt', from: '2026-01-01' }) === '取得日: D:2026-01-01〜');
  assert('engagement gte', filterLabel({ type: 'engagement', engType: 'likes', op: 'gte', min: 100 }) === 'いいね ≥ C100');
  assert('engagement lte＋未知 engType は素通し', filterLabel({ type: 'engagement', engType: 'quotes', op: 'lte', min: 5 }) === 'quotes ≤ C5');
  assert('tag は値そのまま・hashtag は # 付与', filterLabel({ type: 'tag', value: '風景' }) === '風景' && filterLabel({ type: 'hashtag', value: 'art' }) === '#art');
  assert('collection 解決', filterLabel({ type: 'collection', value: 'c1' }) === 'お気に入り');
  assert('collection 未知は id フォールバック', filterLabel({ type: 'collection', value: 'c9' }) === 'c9');
  assert('clip', filterLabel({ type: 'clip' }) === 'クリップ');
  assert('media 3分岐', filterLabel({ type: 'media', value: 'image' }) === '画像のみ' && filterLabel({ type: 'media', value: 'video' }) === '動画' && filterLabel({ type: 'media', value: 'gif' }) === 'GIF');
  assert('instance は値・user は label 優先', filterLabel({ type: 'instance', value: 'misskey.io' }) === 'misskey.io' && filterLabel({ type: 'user', value: 'x:u1', label: 'アリス' }) === 'アリス');
  assert('user label 無しは value', filterLabel({ type: 'user', value: 'x:u1' }) === 'x:u1');
  assert('text は値・default は value||type', filterLabel({ type: 'text', value: 'query' }) === 'query' && filterLabel({ type: 'unknown' }) === 'unknown');

  // --- posterFilterLabel: folder / date は poster 固有、他は filterLabel へ委譲 ---
  assert('poster folder: 名前解決', posterFilterLabel({ type: 'folder', value: 'fo1' }) === 'イラスト');
  assert('poster folder: 未知は id フォールバック', posterFilterLabel({ type: 'folder', value: 'foX' }) === 'foX');
  assert('poster date: 既定 dim=最終投稿＋from/to 整形', posterFilterLabel({ type: 'date', from: '2026-01-01', to: '2026-02-01' }) === '最終投稿: D:2026-01-01〜D:2026-02-01');
  assert('poster date: lastCapture/authorCreatedAt の dim 切替', posterFilterLabel({ type: 'date', dateField: 'lastCapture', from: '2026-01-01' }) === '最終取得: D:2026-01-01〜' && posterFilterLabel({ type: 'date', dateField: 'authorCreatedAt', to: '2026-02-01' }) === 'アカウント作成: 〜D:2026-02-01');
  assert('poster その他型は filterLabel へ委譲', posterFilterLabel({ type: 'platform', value: 'x' }) === 'X' && posterFilterLabel({ type: 'tag', value: '風景' }) === '風景');

  // --- tabTitleOf ---
  {
    const empty = tabTitleOf({ f: [], search: '', multi: false }, { allCount: 7600 });
    assert('空状態＝すべて(件数)・icon all', empty.text === 'すべて(C7600)' && empty.iconType === 'all');
    assert('ctx 無しは 0 件', tabTitleOf(null, null).text === 'すべて(C0)');

    const txt = tabTitleOf({ f: [{ type: 'text', value: 'あいうえおかきくけこさしす' }] }, { allCount: 1 });
    assert('text 葉は 12 文字で切り詰め＋”で括る・icon search', txt.text === '”あいうえおかきくけこさし…”' && txt.iconType === 'search');

    // Priority order: text → tag → user → platform → date; first added wins the icon.
    const multi = tabTitleOf(
      {
        f: [
          { type: 'date', from: '2026-01-01', to: '' },
          { type: 'platform', value: 'x' },
          { type: 'tag', value: '風景' },
          { type: 'text', value: 'q' },
          { type: 'user', value: 'x:u1', label: 'アリス' },
        ],
      },
      { allCount: 1 },
    );
    assert('優先順で結合（text→tag→user→platform→date）', multi.text === '”q”・風景・アリス・X・投稿日: D:2026-01-01〜');
    assert('primaryIconType＝最初に足した種別', multi.iconType === 'search');

    const mOnly = tabTitleOf({ f: [], multi: true }, { allCount: 1 });
    assert('multi 単独＝複数画像ラベル・icon media', mOnly.text === '複数画像' && mOnly.iconType === 'media');
    const mWithMedia = tabTitleOf({ f: [{ type: 'media', value: 'image' }], multi: true }, { allCount: 1 });
    assert('media フィルタがあれば multi ラベルは重ねない', mWithMedia.text === '画像のみ');
  }

  // --- makeNavHistory ---
  {
    let enabled = false;
    const applied: any[] = [];
    let changes = 0;
    const nav = T.makeNavHistory({
      cap: 3,
      enabled: () => enabled,
      snapshot: () => ({ seed: true }),
      apply: (s) => applied.push(s),
      onChange: () => changes++,
    });

    nav.push({ v: 0 });
    assert('enabled=false 中の push は無視', !nav.canBack() && !nav.canForward() && changes === 0);

    enabled = true;
    nav.adopt(null);
    assert('adopt(履歴なし)＝snapshot で種まき・onChange 発火', !nav.canBack() && !nav.canForward() && changes === 1);
    nav.push({ v: 1 });
    nav.push({ v: 1 });
    assert('同一状態の連続 push は積まない（dedupe）', nav.canBack() && changes === 2);
    assert('back は apply に復元状態を渡し true', nav.back() === true && applied.length === 1 && applied[0].seed === true);
    assert('端では back は false（apply されない）', nav.back() === false && applied.length === 1);
    assert('forward で戻れる', nav.forward() === true && applied[1].v === 1);
    assert('端では forward は false', nav.forward() === false);

    // Back then a fresh push drops the forward branch.
    nav.back();
    nav.push({ v: 2 });
    assert('back 後の push は前方枝を破棄', nav.canBack() && !nav.canForward());
    assert('破棄後の back 先は起点', nav.back() === true && applied[applied.length - 1].seed === true);
    nav.forward();

    // Cap: pushing past cap=3 trims the oldest entries.
    nav.push({ v: 3 });
    nav.push({ v: 4 });
    nav.push({ v: 5 });
    let steps = 0;
    while (nav.back()) steps++;
    assert('cap=3 で古い履歴が刈られる（戻れるのは2段）', steps === 2);

    // saveInto / adopt round-trip, including idx clamp.
    const t: Record<string, any> = {};
    nav.saveInto(t);
    assert('saveInto が _navHist/_navIdx を書く', Array.isArray(t._navHist) && t._navHist.length === 3 && t._navIdx === 0);
    const nav2 = T.makeNavHistory({ cap: 3, enabled: () => true, snapshot: () => ({}), apply: () => {}, onChange: () => {} });
    nav2.adopt({ _navHist: t._navHist, _navIdx: 99 });
    assert('adopt は _navIdx を範囲内へクランプ（末尾）', !nav2.canForward() && nav2.canBack());
    nav2.adopt({ _navHist: t._navHist, _navIdx: -5 });
    assert('adopt は負の _navIdx を 0 へクランプ', !nav2.canBack() && nav2.canForward());
    nav2.adopt({ _navHist: t._navHist });
    assert('_navIdx 非数値は末尾採用', !nav2.canForward());
  }

  // --- serializeTabs ---
  {
    const tabs = [
      { id: 'a', pinned: true, title: 'メモ', state: { f: [] }, _scrollTop: 120, _navHist: ['x'], _g: { runtime: 1 } },
      { id: 'b', pinned: false, title: null, state: null, type: 'image', img: { recs: ['cap1'], idx: 2 } },
    ];
    const p = T.serializeTabs(tabs, 'b');
    assert('activeTabId を保持', p.activeTabId === 'b');
    assert('フィルタタブ: id/pinned/title/state/scrollTop', p.tabs[0].id === 'a' && p.tabs[0].pinned === true && p.tabs[0].title === 'メモ' && p.tabs[0].state.f.length === 0 && p.tabs[0].scrollTop === 120);
    assert('ランタイム専用フィールド（_navHist/_g）は載らない', !('_navHist' in p.tabs[0]) && !('_g' in p.tabs[0]));
    assert('画像タブ: type/img が素通し', p.tabs[1].type === 'image' && p.tabs[1].img.recs[0] === 'cap1' && p.tabs[1].img.idx === 2);
    assert('フィルタタブの type/img は undefined（JSON で消える）', p.tabs[0].type === undefined && p.tabs[0].img === undefined);
  }

  // --- sanitizeSavedTabs ---
  {
    let gen = 0;
    const genId = () => 'gen_' + ++gen;
    assert('null/空 tabs は null', T.sanitizeSavedTabs(null, genId) === null && T.sanitizeSavedTabs({ tabs: [] }, genId) === null);

    const st = T.sanitizeSavedTabs(
      {
        activeTabId: 'b',
        tabs: [
          { pinned: 1, title: '', state: { f: [] }, scrollTop: '9' },
          { id: 'b', type: 'image', img: { recs: ['ok', 42, null, 'ok2'], idx: '3' } },
          { id: 'c', type: 'weird', img: { recs: ['x'] }, scrollTop: 55 },
        ],
      },
      genId,
    );
    assert('id 欠落は genId 補完', st.tabs[0].id === 'gen_1');
    assert('pinned/title/scrollTop の正規化（truthy化・null化・非数値→0）', st.tabs[0].pinned === true && st.tabs[0].title === null && st.tabs[0]._scrollTop === 0);
    assert('state は素通し', st.tabs[0].state.f.length === 0);
    assert('画像タブ: recs は文字列のみ・idx 非数値→0', st.tabs[1].type === 'image' && st.tabs[1].img.recs.length === 2 && st.tabs[1].img.idx === 0);
    assert('未知 type はフィルタタブ化（img も落ちる）', st.tabs[2].type === undefined && st.tabs[2].img === undefined && st.tabs[2]._scrollTop === 55);
    assert('保存 activeTabId が実在すれば採用', st.activeTabId === 'b');

    const st2 = T.sanitizeSavedTabs({ activeTabId: 'ghost', tabs: [{ id: 'a' }] }, genId);
    assert('activeTabId 不在は先頭タブへフォールバック', st2.activeTabId === 'a');
    const st3 = T.sanitizeSavedTabs({ tabs: [{ id: 'a', type: 'image', img: { idx: 1 } }] }, genId);
    assert('recs 非配列は img を落とす（画像タブのまま missing 表示へ）', st3.tabs[0].type === 'image' && st3.tabs[0].img === undefined);
  }

  if (failed) {
    console.error(`FAIL test-tabstate-unit: ${failed} assertion(s) red`);
    process.exit(1);
  }
  console.log('PASS test-tabstate-unit: makeTabLabels / makeNavHistory / serializeTabs / sanitizeSavedTabs all green');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
