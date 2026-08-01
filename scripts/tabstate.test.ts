// Unit tests for tab-state.ts. Covers the 4 extracted areas = makeTabLabels
// (filterLabel/tabTitleOf), makeNavHistory (push/back/forward/adopt/saveInto),
// serializeTabs, and sanitizeSavedTabs.

import { describe, expect, test } from 'vitest';
import { makeNavHistory, makeTabLabels, sanitizeSavedTabs, serializeTabs } from '../app/src/renderer/src/services/tab-state';

// --- makeTabLabels: a stub with only the keys filterLabel/tabTitleOf read ---
const STATIC_MSG: Record<string, string> = {
  kindPost: '投稿',
  kindImage: '画像',
  qfPlatformNone: 'PFなし',
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
  posterFolderName: (id: string) => (id === 'fo1' ? 'イラスト' : null),
});

describe('filterLabel（switch の枝ごとに1ケース）', () => {
  test.each([
    [{ type: 'kind', value: 'post' }, '投稿'],
    [{ type: 'kind', value: 'image' }, '画像'],
    [{ type: 'platform', value: '__none' }, 'PFなし'],
    [{ type: 'platform', value: 'x' }, 'X'], // via platformName
    [{ type: 'platform', value: 'threads' }, 'threads'], // unknown values pass through unchanged
    [{ type: 'postType', value: 'post' }, 'ポスト'],
    [{ type: 'postType', value: 'reply' }, 'リプライ'],
    [{ type: 'postType', value: 'quote' }, '引用'],
    [{ type: 'postType', value: 'thread' }, 'スレッド'],
    [{ type: 'date', from: '2026-01-01', to: '2026-02-01' }, '投稿日: D:2026-01-01〜D:2026-02-01'],
    [{ type: 'date', dateField: 'capturedAt', from: '2026-01-01' }, '取得日: D:2026-01-01〜'],
    [{ type: 'engagement', engType: 'likes', op: 'gte', min: 100 }, 'いいね ≥ C100'],
    [{ type: 'engagement', engType: 'quotes', op: 'lte', min: 5 }, 'quotes ≤ C5'], // unknown engType passes through unchanged
    [{ type: 'tag', value: '風景' }, '風景'],
    [{ type: 'tag', value: '__none' }, 'タグなし'], // the sentinel value still shows a name even as a chip (P2⑬)
    [{ type: 'hashtag', value: 'art' }, '#art'],
    [{ type: 'folder', value: 'c1' }, 'お気に入り'],
    [{ type: 'folder', value: 'c9' }, 'c9'], // unknown falls back to id
    [{ type: 'media', value: 'image' }, '画像のみ'],
    [{ type: 'media', value: 'video' }, '動画'],
    [{ type: 'media', value: 'gif' }, 'GIF'],
    [{ type: 'instance', value: 'misskey.io' }, 'misskey.io'],
    [{ type: 'user', value: 'x:u1', label: 'アリス' }, 'アリス'], // label takes priority
    [{ type: 'user', value: 'x:u1' }, 'x:u1'],
    [{ type: 'text', value: 'query' }, 'query'],
    [{ type: 'unknown' }, 'unknown'], // default is value||type
  ])('%j → %s', (leaf, expected) => {
    expect(filterLabel(leaf)).toBe(expected);
  });
});

describe('posterFilterLabel（folder / date は投稿者固有、他は filterLabel へ委譲）', () => {
  test.each([
    [{ type: 'folder', value: 'fo1' }, 'イラスト'],
    [{ type: 'folder', value: 'foX' }, 'foX'],
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

  test('text 葉は12文字で切り詰め、”で括る（アイコンは search）', () => {
    expect(tabTitleOf({ f: [{ type: 'text', value: 'あいうえおかきくけこさしす' }] }, { allCount: 1 })).toMatchObject({ text: '”あいうえおかきくけこさし…”', iconType: 'search' });
  });

  // Priority order is text → tag → user → platform → date. The kind added first gets the icon.
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
});

// #144: a history entry is the tagged union {u,kind,state}
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
    expect(applied).toHaveLength(1); // apply is not called
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

      nav2.adopt({ _navHist: saved._navHist }); // a non-numeric value is treated as the end
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

  // record: the same non-null key merges into one entry (pushes once, then replaces in place)
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

  // #565: everything other than the 3 columns the DB has is inside state = main saves
  // state as a single blob without looking inside it. If a sibling field is added, main's
  // INSERT silently drops it.
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
  let gen = 0;
  const genId = () => `gen_${++gen}`;

  test('null / 空 tabs は null', () => {
    expect(sanitizeSavedTabs(null, genId)).toBeNull();
    expect(sanitizeSavedTabs({ tabs: [] }, genId)).toBeNull();
  });

  describe('正規化', () => {
    const st = sanitizeSavedTabs(
      {
        activeTabId: 'c',
        tabs: [
          { pinned: 1, title: '', state: { view: { f: [] }, scrollTop: '9' } },
          // Persisted nav stack: a broken entry is dropped, and idx is remapped to the surviving entries
          {
            id: 'c',
            state: {
              scrollTop: 55,
              nav: {
                hist: [{ u: '/posts', kind: 'posts', state: { f: [] } }, { bogus: true }, { u: '/posters', kind: 'posters', state: { sort: 'count' } }, { u: '/image/x', kind: 'image', state: { recs: [], idx: 0 } }],
                idx: 2,
              },
            },
          },
        ],
      },
      genId,
    );

    test('id 欠落は genId で補う', () => {
      expect(st.tabs[0].id).toBe('gen_1');
    });

    test('pinned/title/scrollTop を正規化する（truthy 化・null 化・非数値→0）', () => {
      expect(st.tabs[0]).toMatchObject({ pinned: true, title: null, _scrollTop: 0 });
    });

    test('state は素通しで、スタックが無ければ _navHist も無い', () => {
      expect(st.tabs[0].state.f).toEqual([]);
      expect(st.tabs[0]._navHist).toBeUndefined();
    });

    test('nav スタックは不正なコマを捨て、idx を残存コマへ再マップする', () => {
      const c = st.tabs[1];

      expect(c._navHist.map((s: string) => JSON.parse(s).kind)).toEqual(['posts', 'posters']);
      expect(c._navIdx).toBe(1);
      expect(c._scrollTop).toBe(55);
    });

    test('保存された activeTabId が実在すれば採る', () => {
      expect(st.activeTabId).toBe('c');
    });
  });

  test('activeTabId が実在しなければ先頭タブへ落ちる', () => {
    expect(sanitizeSavedTabs({ activeTabId: 'ghost', tabs: [{ id: 'a' }] }, genId).activeTabId).toBe('a');
  });

  // #42: fix a retired leaf type on load = it still lingers in saved query trees and in
  // the title's shadow copy. Normalize the old 'collection' to 'folder'.
  test('廃止された collection 葉を folder へ正規化する（他の型は不変）', () => {
    const stMig = sanitizeSavedTabs(
      {
        tabs: [
          {
            id: 'm',
            state: {
              view: {
                f: [
                  { type: 'collection', value: 'x' },
                  { type: 'tag', value: 't' },
                ],
                tree: { kind: 'group', op: 'and', neg: false, children: [{ kind: 'cond', type: 'collection', value: 'x' }] },
              },
            },
          },
        ],
      },
      genId,
    );
    const mst = stMig.tabs[0].state;

    expect(mst.f.map((l: any) => l.type)).toEqual(['folder', 'tag']);
    expect(mst.tree.children[0].type).toBe('folder');
  });
});
