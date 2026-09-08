// tab-state.ts の単体テスト。切り出した4つの領域＝makeTabLabels
// (filterLabel/tabTitleOf)、makeNavHistory (push/back/forward/adopt/saveInto)、
// serializeTabs、sanitizeSavedTabs を見る。

import { describe, expect, test } from 'vitest';
import { makeNavHistory, makeTabLabels, sanitizeSavedTabs, serializeTabs } from '../app/src/renderer/src/services/tab-state';

// --- makeTabLabels: filterLabel/tabTitleOf が読むキーだけを持つスタブ ---
const STATIC_MSG: Record<string, string> = {
  kindPost: '投稿',
  kindImage: '画像',
  qfSiteNone: 'PFなし',
  qfTagNone: 'タグなし',
  qfPost: 'ポスト',
  qfReply: 'リプライ',
  qfQuote: '引用',
  qfThread: 'スレッド',
  qfDateCaptured: '取得日',
  qfDatePost: '投稿日',
  qfImage: '画像のみ',
  qfVideo: '動画',
  qfGif: 'GIF',
  filterAll: 'すべて',
  qfMultiImage: '複数画像',
  posterDateLastPost: '最終投稿',
  posterDateLastCapture: '最終取得',
  posterDateCreated: 'アカウント作成',
};

const { filterLabel, tabTitleOf, posterFilterLabel } = makeTabLabels({
  t: (key: string) => STATIC_MSG[key],
  engTypeLabels: { likes: 'いいね' },
  platformName: (v: string) => ({ x: 'X', pixiv: 'pixiv' })[v] || v,
  formatShortDate: (s: string) => `D:${s}`,
  formatCount: (n: number) => `C${n}`,
  folderName: (id: string) => (id === 'c1' ? 'お気に入り' : null),
});

describe('filterLabel（switch の枝ごとに1ケース）', () => {
  test.each([
    [{ type: 'kind', value: 'post' }, '投稿'],
    [{ type: 'kind', value: 'image' }, '画像'],
    [{ type: 'platform', value: '__none' }, 'PFなし'],
    // #253: 対応外ドメインの行の葉＝ラベルはホストそのもの。
    [{ type: 'domain', value: 'youtube.com' }, 'youtube.com'],
    [{ type: 'platform', value: 'x' }, 'X'], // platformName 経由
    [{ type: 'platform', value: 'threads' }, 'threads'], // 未知の値はそのまま素通し
    [{ type: 'postType', value: 'post' }, 'ポスト'],
    [{ type: 'postType', value: 'reply' }, 'リプライ'],
    [{ type: 'postType', value: 'quote' }, '引用'],
    [{ type: 'postType', value: 'thread' }, 'スレッド'],
    [{ type: 'date', from: '2026-01-01', to: '2026-02-01' }, '投稿日: D:2026-01-01〜D:2026-02-01'],
    [{ type: 'date', dateField: 'capturedAt', from: '2026-01-01' }, '取得日: D:2026-01-01〜'],
    [{ type: 'engagement', engType: 'likes', op: 'gte', min: 100 }, 'いいね ≥ C100'],
    [{ type: 'engagement', engType: 'quotes', op: 'lte', min: 5 }, 'quotes ≤ C5'], // 未知の engType はそのまま素通し
    [{ type: 'tag', value: '風景' }, '風景'],
    [{ type: 'tag', value: '__none' }, 'タグなし'], // 番兵の値もチップとして名前を出す (P2⑬)
    [{ type: 'hashtag', value: 'art' }, '#art'],
    [{ type: 'media', value: 'image' }, '画像のみ'],
    [{ type: 'media', value: 'video' }, '動画'],
    [{ type: 'media', value: 'gif' }, 'GIF'],
    [{ type: 'user', value: 'x:u1', label: 'アリス' }, 'アリス'], // label が優先
    [{ type: 'user', value: 'x:u1' }, 'x:u1'],
    [{ type: 'text', value: 'query' }, 'query'],
    [{ type: 'unknown' }, 'unknown'], // 既定は value||type
  ])('%j → %s', (leaf, expected) => {
    expect(filterLabel(leaf)).toBe(expected);
  });
});

describe('posterFilterLabel（folder / date は投稿者固有、他は filterLabel へ委譲）', () => {
  test.each([
    [{ type: 'date', from: '2026-01-01', to: '2026-02-01' }, '最終投稿: D:2026-01-01〜D:2026-02-01'],
    [{ type: 'date', dateField: 'lastCapture', from: '2026-01-01' }, '最終取得: D:2026-01-01〜'],
    [{ type: 'date', dateField: 'authorCreatedAt', to: '2026-02-01' }, 'アカウント作成: 〜D:2026-02-01'],
    [{ type: 'platform', value: 'x' }, 'X'],
    [{ type: 'tag', value: '風景' }, '風景'],
  ])('%j → %s', (leaf, expected) => {
    expect(posterFilterLabel(leaf)).toBe(expected);
  });
});

describe('tabTitleOf', () => {
  test('空状態は「すべて(件数)」でアイコンは all', () => {
    expect(tabTitleOf({ f: [], search: '', multi: false }, { allCount: 7600 })).toMatchObject({ text: 'すべて(C7600)', iconType: 'all' });
  });

  test('文脈が無ければ 0 件', () => {
    expect(tabTitleOf(null, null).text).toBe('すべて(C0)');
  });

  test('フォルダの現在地はフィルタの葉にせず、タブ名の場所として示す', () => {
    expect(tabTitleOf({ f: [], folderId: 'c1' }, { allCount: 1 })).toMatchObject({ text: 'お気に入り', iconType: 'folder' });
  });

  test('text 葉は12文字で切り詰め、”で括る（アイコンは search）', () => {
    expect(tabTitleOf({ f: [{ type: 'text', value: 'あいうえおかきくけこさしす' }] }, { allCount: 1 })).toMatchObject({ text: '”あいうえおかきくけこさし…”', iconType: 'search' });
  });

  // 優先順は text → tag → user → platform → date。アイコンは最初に足した種別のもの。
  test('優先順で結合し、アイコンは最初に足した種別', () => {
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

    expect(multi).toMatchObject({ text: '”q”・風景・アリス・X・投稿日: D:2026-01-01〜', iconType: 'search' });
  });

  test('multi 単独は複数画像ラベル（アイコンは media）', () => {
    expect(tabTitleOf({ f: [], multi: true }, { allCount: 1 })).toMatchObject({ text: '複数画像', iconType: 'media' });
  });

  test('media フィルタがあれば multi ラベルを重ねない', () => {
    expect(tabTitleOf({ f: [{ type: 'media', value: 'image' }], multi: true }, { allCount: 1 }).text).toBe('画像のみ');
  });

  // #253: 'domain'（対応外サイトの行）は 'platform' と同じグループでタイトルへ入る。
  test('domain も platform と同じグループで結合される', () => {
    expect(tabTitleOf({ f: [{ type: 'domain', value: 'youtube.com' }] }, { allCount: 1 })).toMatchObject({ text: 'youtube.com', iconType: 'domain' });
  });
});

// #144: 履歴のエントリはタグ付き共用体 {u,kind,state}
const E = (v: unknown) => ({ u: '/posts', kind: 'posts', state: { v } });

describe('makeNavHistory（1つの履歴を順に育てるので宣言順に意味がある）', () => {
  let enabled = false;
  const applied: any[] = [];
  let changes = 0;
  const nav = makeNavHistory({
    cap: 3,
    enabled: () => enabled,
    snapshot: () => E('seed'),
    apply: (e: any) => applied.push(e),
    onChange: () => changes++,
  });

  test('enabled=false の間の push は無視される', () => {
    nav.push(E(0));
    expect(nav.canBack()).toBe(false);
    expect(nav.canForward()).toBe(false);
    expect(changes).toBe(0);
  });

  test('adopt(履歴なし) は snapshot で種をまき onChange を発火する', () => {
    enabled = true;
    nav.adopt(null);

    expect(nav.canBack()).toBe(false);
    expect(nav.canForward()).toBe(false);
    expect(changes).toBe(1);
    expect(nav.current()).toMatchObject({ kind: 'posts', state: { v: 'seed' } });
  });

  test('同一状態の連続 push は積まない', () => {
    nav.push(E(1));
    nav.push(E(1));

    expect(nav.canBack()).toBe(true);
    expect(changes).toBe(2);
  });

  test('back は復元エントリを apply へ渡し、端では false', () => {
    expect(nav.back()).toBe(true);
    expect(applied).toHaveLength(1);
    expect(applied[0].state.v).toBe('seed');

    expect(nav.back()).toBe(false);
    expect(applied).toHaveLength(1); // apply は呼ばれない
  });

  test('forward で戻れて、端では false', () => {
    expect(nav.forward()).toBe(true);
    expect(applied[1].state.v).toBe(1);
    expect(nav.forward()).toBe(false);
  });

  test('applyCurrent は現在エントリを再適用する', () => {
    applied.length = 0;
    nav.applyCurrent();

    expect(applied).toHaveLength(1);
    expect(applied[0].state.v).toBe(1);
  });

  test('back の後の push は前方枝を破棄する', () => {
    nav.back();
    nav.push(E(2));

    expect(nav.canBack()).toBe(true);
    expect(nav.canForward()).toBe(false);
    expect(nav.back()).toBe(true);
    expect(applied.at(-1).state.v).toBe('seed');
    nav.forward();
  });

  test('cap=3 を超えると古い履歴が刈られる', () => {
    nav.push(E(3));
    nav.push(E(4));
    nav.push(E(5));

    let steps = 0;
    while (nav.back()) steps++;
    expect(steps).toBe(2);
  });

  describe('saveInto / adopt の往復', () => {
    const saved: Record<string, any> = {};

    test('saveInto が _navHist/_navIdx を書く', () => {
      nav.saveInto(saved);

      expect(Array.isArray(saved._navHist)).toBe(true);
      expect(saved._navHist).toHaveLength(3);
      expect(saved._navIdx).toBe(0);
    });

    test('adopt は _navIdx を範囲内へクランプする', () => {
      const nav2 = makeNavHistory({ cap: 3, enabled: () => true, snapshot: () => E(null), apply: () => {}, onChange: () => {} });

      nav2.adopt({ _navHist: saved._navHist, _navIdx: 99 });
      expect(nav2.canForward()).toBe(false);
      expect(nav2.canBack()).toBe(true);

      nav2.adopt({ _navHist: saved._navHist, _navIdx: -5 });
      expect(nav2.canBack()).toBe(false);
      expect(nav2.canForward()).toBe(true);

      nav2.adopt({ _navHist: saved._navHist }); // 数値でない値は末尾として扱う
      expect(nav2.canForward()).toBe(false);
    });
  });
});

describe('makeNavHistory: replace / record（バーストの合流）', () => {
  const nav = makeNavHistory({ cap: 10, enabled: () => true, snapshot: () => E('seed'), apply: () => {}, onChange: () => {} });
  nav.adopt(null);

  test('replace は現在エントリを書き換える（積まない）', () => {
    nav.replace(E('r1'));

    expect(nav.canBack()).toBe(false);
    expect(nav.current().state.v).toBe('r1');
  });

  test('replace 後も深さは変わらない', () => {
    nav.push(E('p1'));
    nav.replace(E('r2'));

    expect(nav.canBack()).toBe(true);
    expect(nav.current().state.v).toBe('r2');
  });

  test('replace の結果が直前と同一になったら重複を落とす', () => {
    nav.replace(E('r1'));

    expect(nav.canBack()).toBe(false);
    expect(nav.current().state.v).toBe('r1');
  });

  // record: null でない同じキーは1エントリへ合流する（1回だけ push し、以後はその場で replace）
  test('同一キーの record はバーストを1エントリへ合流する', () => {
    const key = {};
    nav.record(E('t1'), key);
    nav.record(E('t12'), key);
    nav.record(E('t123'), key);

    expect(nav.canBack()).toBe(true);
    expect(nav.current().state.v).toBe('t123');
  });

  test('合流したバーストの back 先はタイプ前の状態', () => {
    nav.back();
    expect(nav.current().state.v).toBe('r1');
    nav.forward();
  });

  test('キーが変われば別エントリとして push される', () => {
    nav.record(E('x1'), {});

    expect(nav.current().state.v).toBe('x1');
    expect(nav.back()).toBe(true);
    expect(nav.current().state.v).toBe('t123');
    nav.forward();
  });

  test('キー無しの record は常に push', () => {
    nav.record(E('x2'));
    expect(nav.current().state.v).toBe('x2');
  });
});

describe('serializeTabs', () => {
  const imgEntry = JSON.stringify({ u: '/image/cap1', kind: 'image', state: { recs: ['cap1'], idx: 2 } });
  const p = serializeTabs(
    [
      { id: 'a', pinned: true, title: 'メモ', state: { f: [] }, _scrollTop: 120, _navHist: ['{"u":"/posts","kind":"posts","state":{}}'], _navIdx: 0, _g: { runtime: 1 } },
      { id: 'b', pinned: false, title: '画像', _autoTitle: true, state: null, _navHist: [imgEntry], _navIdx: 0 },
      { id: 'c', pinned: false, title: null, state: null },
    ],
    'b',
  );

  test('activeTabId を保持する', () => {
    expect(p.activeTabId).toBe('b');
  });

  // #565: DB が持つ3列以外はすべて state の中にある＝main は state を、中を見ない1つの塊として
  // 保存する。兄弟の欄を足すと、main の INSERT が黙ってそれを落とす。
  test('タブ直下は id/pinned/title/state の4つだけ', () => {
    expect(Object.keys(p.tabs[0]).sort()).toEqual(['id', 'pinned', 'state', 'title']);
  });

  test('フィルタタブの id/pinned/title と、塊の中の view/scrollTop が載る', () => {
    expect(p.tabs[0]).toMatchObject({ id: 'a', pinned: true, title: 'メモ' });
    expect(p.tabs[0].state.scrollTop).toBe(120);
    expect(p.tabs[0].state.view?.f).toEqual([]);
  });

  test('nav スタックはパース済みオブジェクトとして永続化する', () => {
    expect(p.tabs[0].state.nav?.hist).toHaveLength(1);
    expect(p.tabs[0].state.nav?.hist[0].kind).toBe('posts');
    expect(p.tabs[0].state.nav?.idx).toBe(0);
  });

  test('ランタイム専用フィールドは生では載せない', () => {
    expect(p.tabs[0]).not.toHaveProperty('_navHist');
    expect(p.tabs[0]).not.toHaveProperty('_g');
    expect(p.tabs[0].state).not.toHaveProperty('_g');
  });

  test('画像エントリの nav と autoTitle が載る', () => {
    expect(p.tabs[1].state.nav?.hist[0].kind).toBe('image');
    expect(p.tabs[1].state.autoTitle).toBe(true);
  });

  test('スタックの無いタブは nav/autoTitle が undefined（JSON で消える）', () => {
    expect(p.tabs[2].state.nav).toBeUndefined();
    expect(p.tabs[2].state.autoTitle).toBeUndefined();
  });
});

describe('sanitizeSavedTabs', () => {
  const genId = () => 'generated';
  test('未保存と空タブは null', () => {
    expect(sanitizeSavedTabs(null, genId)).toBeNull();
    expect(sanitizeSavedTabs({ tabs: [] }, genId)).toBeNull();
  });
  test('不正な項目を既定値へ変えず拒否する', () => {
    for (const tab of [{ pinned: true }, { id: 'a', pinned: 1 }, { id: 'a', state: { scrollTop: '9' } }, { id: 'a', state: { nav: { hist: [{ bogus: true }] } } }]) expect(() => sanitizeSavedTabs({ tabs: [tab] }, genId)).toThrow();
  });
  test('現在の保存形式を復元し、存在しない activeTabId は先頭へ戻す', () => {
    const restored = sanitizeSavedTabs({ activeTabId: 'missing', tabs: [{ id: 'a', pinned: true, state: { view: { search: '猫' }, scrollTop: 55, nav: { hist: [{ kind: 'posts', state: { search: '猫' } }], idx: 0 } } }] }, genId)!;
    expect(restored.activeTabId).toBe('a');
    expect(restored.tabs[0].state?.search).toBe('猫');
    expect(restored.tabs[0]._scrollTop).toBe(55);
    expect(JSON.parse(restored.tabs[0]._navHist![0]).kind).toBe('posts');
  });
});
