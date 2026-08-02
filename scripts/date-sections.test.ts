// Pure unit tests for date-sections.ts (#47) — dateFieldForSort's sort→field
// mapping and buildSections' contiguous month-bucketing over a pre-sorted array.
import { describe, expect, test } from 'vitest';
import { buildSections, dateFieldForSort } from '../app/src/renderer/src/services/date-sections';

describe('dateFieldForSort', () => {
  test('日付系ソートだけ軸を持つ', () => {
    expect(dateFieldForSort('date-desc')).toBe('dateMs');
    expect(dateFieldForSort('date-asc')).toBe('dateMs');
    expect(dateFieldForSort('captured-desc')).toBe('capturedMs');
  });

  test('反応・ランダム・名前順は軸なし', () => {
    for (const s of ['likes-desc', 'reposts-desc', 'replies-desc', 'likes-pct', 'random']) {
      expect(dateFieldForSort(s)).toBeNull();
    }
  });
});

// ms for the 1st of a given (year, month0) — month0 is 0-indexed like Date#getMonth.
const ms = (y: number, month0: number, day = 15) => +new Date(y, month0, day);

describe('buildSections', () => {
  test('連続する同じ月は1バケットにまとまる', () => {
    const items = [ms(2026, 6, 1), ms(2026, 6, 15), ms(2026, 6, 30)];
    const out = buildSections(items, (x) => x);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ key: '2026-6', startIndex: 0, count: 3 });
  });

  test('月が変わるたびに新しいバケット、startIndex は元配列の位置', () => {
    const items = [ms(2026, 6, 1), ms(2026, 6, 2), ms(2026, 5, 1), ms(2026, 4, 1), ms(2026, 4, 2)];
    const out = buildSections(items, (x) => x);
    expect(out.map((s) => [s.key, s.startIndex, s.count])).toEqual([
      ['2026-6', 0, 2],
      ['2026-5', 2, 1],
      ['2026-4', 3, 2],
    ]);
  });

  test('0（日付なし）は unknown バケットへ — 末尾に連続していれば1つにまとまる', () => {
    const items = [ms(2026, 6, 1), 0, 0];
    const out = buildSections(items, (x) => x);
    expect(out).toEqual([
      { key: '2026-6', ms: items[0], startIndex: 0, count: 1 },
      { key: 'unknown', ms: 0, startIndex: 1, count: 2 },
    ]);
  });

  test('unknown が非連続なら別バケットになる（呼び出し側の並びを信頼するだけで、ここでは並べ替えない）', () => {
    const items = [0, ms(2026, 6, 1), 0];
    const out = buildSections(items, (x) => x);
    expect(out.map((s) => s.key)).toEqual(['unknown', '2026-6', 'unknown']);
  });

  test('年をまたぐと別バケット', () => {
    const items = [ms(2026, 0, 5), ms(2025, 11, 20)];
    const out = buildSections(items, (x) => x);
    expect(out.map((s) => s.key)).toEqual(['2026-0', '2025-11']);
  });

  test('空配列は空配列', () => {
    expect(buildSections([], () => 0)).toEqual([]);
  });
});
