// #565 の回帰テスト。タブの保存経路を1本の線でつないで見る＝レンダラーの
// serializeTabs → main の setTabs → 実 SQLite → getTabs → レンダラーの
// sanitizeSavedTabs。往復して等しくあってほしいのは、タブの本数・順序・タイトルの
// 先にある3つ＝**タブ内の戻る/進むの履歴（#144）・スクロール位置・画像タブの見出し**。
//
// 片端だけ見ても捕まらないから両端をつなぐ: #565 は main の INSERT が
// レンダラーの払い出しのうち3フィールドを読まずに捨てていた事故で、
// レンダラー単体（tabstate.test.ts）も DB 単体（db-write.test.ts）も緑のまま、
// 再起動をまたいだ時だけ静かに失われていた。この形は「どちらの端を直しても
// 通る」＝将来どちらかの端の形が変わっても、落ちるのは実際に失われた時だけ。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { openDatabase } from '../app/src/main/lib-db';
import { createDbWriter } from '../app/src/main/lib-db-write';
import { navEntryUrl, sanitizeSavedTabs, serializeTabs } from '../app/src/renderer/src/services/tab-state';

let dir: string;
let sqlite: any;
let writer: ReturnType<typeof createDbWriter>;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-tabs-roundtrip-'));
  ({ sqlite } = openDatabase(path.join(dir, 'test.db')));
  writer = createDbWriter(sqlite);
});

afterAll(() => {
  sqlite.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// nav スタックはレンダラー上では「JSON 文字列の配列」（makeNavHistory の実体）。
const entry = (kind: HologramNavEntry['kind'], state: any) => JSON.stringify({ u: navEntryUrl(kind, state), kind, state });

// 生きているタブ2本: グリッドタブ（履歴3コマ＝1つ戻った位置・スクロール中）と、
// 画像を開いたまま見出しが焼かれたタブ。
const gridHist = [entry('posts', { f: [], tree: null, search: '', sort: 'date-desc' }), entry('posts', { f: [{ type: 'tag', value: 'alpha' }], tree: null, search: '', sort: 'date-desc' }), entry('posters', { tree: null, sort: 'count', search: '' })];
const imageHist = [entry('image', { recs: ['cap-1', 'cap-2'], idx: 1 })];
const liveTabs: HologramTab[] = [
  {
    id: 'tab-grid',
    pinned: true,
    title: 'メモ',
    state: { f: [{ type: 'tag', value: 'alpha' }], tree: null, search: '', sort: 'date-desc', multi: false },
    _scrollTop: 1234,
    _navHist: gridHist,
    _navIdx: 1, // 一度戻った位置＝末尾ではない
  },
  { id: 'tab-image', pinned: false, title: '猫の写真', _autoTitle: true, state: null, _navHist: imageHist, _navIdx: 0 },
];

const roundTrip = () => {
  writer.setTabs(serializeTabs(liveTabs, 'tab-image'));
  const restored = sanitizeSavedTabs(writer.getTabs(), () => 'gen');
  if (!restored) throw new Error('sanitizeSavedTabs returned null');
  return restored;
};

test('戻る/進むの履歴が、コマの中身も現在位置も往復する', () => {
  const t = roundTrip().tabs[0];

  expect(t._navHist?.map((s) => JSON.parse(s))).toEqual(gridHist.map((s) => JSON.parse(s)));
  expect(t._navIdx).toBe(1);
});

test('スクロール位置が往復する', () => {
  expect(roundTrip().tabs[0]._scrollTop).toBe(1234);
});

test('画像タブの見出し（autoTitle）と画像履歴が往復する', () => {
  const t = roundTrip().tabs[1];

  expect(t._autoTitle).toBe(true);
  expect(t.title).toBe('猫の写真');
  expect(t._navHist?.map((s) => JSON.parse(s))).toEqual(imageHist.map((s) => JSON.parse(s)));
});

test('タブの並び・ピン・クエリ状態・アクティブタブも往復する', () => {
  const st = roundTrip();

  expect(st.tabs.map((t) => t.id)).toEqual(['tab-grid', 'tab-image']);
  expect(st.tabs[0].pinned).toBe(true);
  expect(st.tabs[0].state).toEqual(liveTabs[0].state);
  expect(st.activeTabId).toBe('tab-image');
});

// 保存 → 復元 → その復元済みタブをそのまま再保存、が同じ結果を返すこと。
// アプリは毎回この形で回る（起動時に復元したタブを次の操作でまた書き戻す）ので、
// 片道だけ通る形（読み側だけ新しい、など）をここで落とす。
test('復元したタブを保存し直しても同じものが返る', () => {
  const once = roundTrip();
  writer.setTabs(serializeTabs(once.tabs, once.activeTabId));
  const twice = sanitizeSavedTabs(writer.getTabs(), () => 'gen');

  expect(twice).toEqual(once);
});
