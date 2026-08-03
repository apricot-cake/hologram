// The rules the toolbar popup's "recent saves" list rests on (#124 —
// extension/utils/save-history.ts). All three are pure and none of them can be
// read off the list by eye once it is wrong:
//   - the ring turns over at twenty and keeps the newest;
//   - one bulk-intake run (#362) folds into ONE row, so a run cannot evict an
//     evening of ordinary saves — but an ordinary save in between ends the run;
//   - "saved today" counts what the folded rows stand for, not the rows.

import { describe, expect, test } from 'vitest';
import { SAVE_HISTORY_MAX, countOf, foldInto, rowsOf, savedOn } from '../extension/utils/save-history.ts';
import type { SaveHistoryEntry } from '../extension/utils/save-history.ts';

const at = (ts: number, over: Partial<SaveHistoryEntry> = {}): SaveHistoryEntry => ({ ts, ok: true, type: 'save', platform: 'x', url: `https://x.com/a/status/${ts}`, tabId: 7, ...over });
const intake = (ts: number, over: Partial<SaveHistoryEntry> = {}): SaveHistoryEntry => at(ts, { type: 'savePost', capturedVia: 'bookmarks', ...over });

// A fixed clock: "today" has to be decided from a passed-in Date, or this suite
// would pass or fail depending on the hour it runs at.
const NOON = new Date(2026, 7, 3, 12, 0, 0);
const todayAt = (hour: number) => new Date(2026, 7, 3, hour, 0, 0).getTime();
const yesterdayAt = (hour: number) => new Date(2026, 7, 2, hour, 0, 0).getTime();

describe('リングバッファ', () => {
  test('新しいものが先頭・20件で回る', () => {
    let rows: SaveHistoryEntry[] = [];
    for (let i = 0; i < 25; i++) rows = foldInto(rows, at(i));
    expect(rows).toHaveLength(SAVE_HISTORY_MAX);
    expect(rows[0].ts).toBe(24);
    expect(rows.at(-1)?.ts).toBe(5);
  });

  test('壊れた保存内容は読み飛ばす（storage は書き換えられうる）', () => {
    expect(rowsOf([at(1), null, 'nope', { ok: true }])).toHaveLength(1);
    expect(rowsOf(undefined)).toEqual([]);
  });
});

describe('一括取込の畳み込み', () => {
  test('同じ取込・同じタブの連続は1行になり件数が増える', () => {
    let rows: SaveHistoryEntry[] = [];
    for (let i = 0; i < 30; i++) rows = foldInto(rows, intake(i));
    expect(rows).toHaveLength(1);
    expect(countOf(rows[0])).toBe(30);
    expect(rows[0].ts).toBe(29); // the row's time follows the run
  });

  test('普通の保存が挟まったら次の取込は新しい行（起きた順が読める）', () => {
    let rows = foldInto([], intake(1));
    rows = foldInto(rows, at(2));
    rows = foldInto(rows, intake(3));
    expect(rows.map(countOf)).toEqual([1, 1, 1]);
    expect(rows).toHaveLength(3);
  });

  test('別タブの取込は別の行（同時に走る2つの取込が混ざらない）', () => {
    let rows = foldInto([], intake(1, { tabId: 7 }));
    rows = foldInto(rows, intake(2, { tabId: 8 }));
    expect(rows).toHaveLength(2);
  });

  test('失敗は成功の件数に飲み込まれない（入らなかったことが同じ強さで見える）', () => {
    let rows = foldInto([], intake(1));
    rows = foldInto(rows, intake(2, { ok: false, error: 'host unreachable' }));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ ok: false, error: 'host unreachable' });
  });

  test('取込でない保存は連続しても畳まれない', () => {
    let rows = foldInto([], at(1));
    rows = foldInto(rows, at(2));
    expect(rows).toHaveLength(2);
  });
});

describe('今日の保存数', () => {
  test('畳んだ行はその件数ぶん数える', () => {
    const rows = [{ ...intake(todayAt(10)), count: 24 }, at(todayAt(9))];
    expect(savedOn(rows, NOON)).toBe(25);
  });

  test('昨日の分と失敗は数えない', () => {
    const rows = [at(todayAt(10)), at(todayAt(9), { ok: false }), at(yesterdayAt(23))];
    expect(savedOn(rows, NOON)).toBe(1);
  });
});
