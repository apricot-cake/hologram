// Regression test for #565. Connects the tab save path end-to-end on one line = the
// renderer's serializeTabs → main's setTabs → real SQLite → getTabs → the renderer's
// sanitizeSavedTabs. What we want to survive the round trip equal, beyond tab count,
// order, and title, are the 3 fields ahead of them = **the back/forward history inside a
// tab (#144), scroll position, and the image tab's heading**.
//
// Watching just one end can't catch this, so both ends are connected: #565 was an
// incident where main's INSERT silently dropped 3 fields out of what the renderer handed
// over, while the renderer alone (tabstate.test.ts) and the DB alone (db-write.test.ts)
// both stayed green — it was silently lost only across a restart. This shape "passes
// however either end is fixed" = even if either end's shape changes in the future, it
// only fails when something is actually lost.

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

// On the renderer, the nav stack is an "array of JSON strings" (the actual shape from makeNavHistory).
const entry = (kind: HologramNavEntry['kind'], state: any) => JSON.stringify({ u: navEntryUrl(kind, state), kind, state });

// Two live tabs: a grid tab (3-frame history = one step back, mid-scroll), and
// a tab left with an image open whose heading has been baked in.
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
    _navIdx: 1, // a position after going back once = not the end
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

// Save → restore → save the restored tabs again as-is must return the same result.
// The app cycles through this shape every time (tabs restored at launch get written back
// on the next action), so this catches a one-way-only shape (e.g. only the read side being new).
test('復元したタブを保存し直しても同じものが返る', () => {
  const once = roundTrip();
  writer.setTabs(serializeTabs(once.tabs, once.activeTabId));
  const twice = sanitizeSavedTabs(writer.getTabs(), () => 'gen');

  expect(twice).toEqual(once);
});
