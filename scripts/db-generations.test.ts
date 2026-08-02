// Unit tests for the DB lane's generation store (app/src/main/lib-db-generations.ts).
// The naming/retention half is pure; the store half only needs a filesystem, so
// both run without Electron and without a real database.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { GENERATIONS_DIRNAME, generationName, generationsDir, latestGeneration, listGenerations, parseGenerationName, pruneGenerations, selectGenerations } from '../app/src/main/lib-db-generations';

const made: string[] = [];
function tempLibrary(names: string[] = []): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-gen-'));
  made.push(dir);
  if (names.length) {
    fs.mkdirSync(path.join(dir, GENERATIONS_DIRNAME), { recursive: true });
    for (const n of names) fs.writeFileSync(path.join(dir, GENERATIONS_DIRNAME, n), 'x');
  }
  return dir;
}
afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

// Local wall-clock names, one per day at noon, newest last.
const nameFor = (y: number, m: number, d: number, h = 12) => generationName(new Date(y, m - 1, d, h, 0, 0));

describe('世代の名前', () => {
  test('名前と時刻は往復する', () => {
    const at = new Date(2026, 7, 2, 9, 5, 30);
    expect(generationName(at)).toBe('hologram-20260802-090530.db');
    expect(parseGenerationName('hologram-20260802-090530.db')?.getTime()).toBe(at.getTime());
  });

  test('自分のものでない名前は読まない', () => {
    expect(parseGenerationName('hologram.db')).toBeNull();
    expect(parseGenerationName('hologram-20260802-090530.db.tmp-1')).toBeNull();
    expect(parseGenerationName('notes.txt')).toBeNull();
  });
});

describe('selectGenerations（日次7・週次4・月次6）', () => {
  test('同じ日に何度撮っても日次枠は1つだけ使う', () => {
    const names = [nameFor(2026, 8, 2, 9), nameFor(2026, 8, 2, 12), nameFor(2026, 8, 2, 18)];
    const { keep, drop } = selectGenerations(names, { daily: 7, weekly: 0, monthly: 0 });
    expect(keep).toEqual([nameFor(2026, 8, 2, 18)]); // newest wins its bucket
    expect(drop.sort()).toEqual([nameFor(2026, 8, 2, 9), nameFor(2026, 8, 2, 12)].sort());
  });

  test('日次枠を超えた分は週次・月次へ落ちていく', () => {
    // One a day for 40 days, ending 2026-08-02.
    const names: string[] = [];
    for (let i = 0; i < 40; i++) {
      const d = new Date(2026, 7, 2);
      d.setDate(d.getDate() - i);
      names.push(generationName(d));
    }
    const { keep, drop } = selectGenerations(names);
    // 7 daily + 4 weekly + monthly buckets available in the span (Aug, Jul, Jun).
    expect(keep.length).toBeLessThanOrEqual(7 + 4 + 6);
    expect(keep.length).toBeGreaterThanOrEqual(7 + 4);
    expect(keep.length + drop.length).toBe(names.length);
    // The newest is always kept — a rollback point that exists must never be
    // the one thinning throws away.
    expect(keep).toContain(generationName(new Date(2026, 7, 2)));
  });

  test('保持数に届かないうちは何も捨てない', () => {
    const names = [nameFor(2026, 8, 1), nameFor(2026, 8, 2)];
    expect(selectGenerations(names).drop).toEqual([]);
  });

  test('読めない名前は keep にも drop にも出さない（消す提案をしない）', () => {
    const { keep, drop } = selectGenerations(['README.txt', nameFor(2026, 8, 2)]);
    expect(keep).toEqual([nameFor(2026, 8, 2)]);
    expect(drop).toEqual([]);
  });
});

describe('置き場の読み書き', () => {
  test('新しい順に並び、置き場が無ければ空', () => {
    expect(listGenerations(tempLibrary())).toEqual([]);
    const lib = tempLibrary([nameFor(2026, 8, 1), nameFor(2026, 8, 3), nameFor(2026, 8, 2)]);
    expect(listGenerations(lib).map((g) => g.name)).toEqual([nameFor(2026, 8, 3), nameFor(2026, 8, 2), nameFor(2026, 8, 1)]);
    expect(latestGeneration(lib)).toBe(path.join(generationsDir(lib), nameFor(2026, 8, 3)));
  });

  test('自分のものでないファイルは列挙にも間引きにも出てこない', async () => {
    const lib = tempLibrary([nameFor(2026, 8, 2), 'README.txt']);
    expect(listGenerations(lib).map((g) => g.name)).toEqual([nameFor(2026, 8, 2)]);
    await pruneGenerations(lib);
    expect(fs.existsSync(path.join(generationsDir(lib), 'README.txt'))).toBe(true);
  });

  test('間引きは古い世代だけを消す', async () => {
    const names: string[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(2026, 7, 2);
      d.setDate(d.getDate() - i);
      names.push(generationName(d));
    }
    const lib = tempLibrary(names);
    const removed = await pruneGenerations(lib, { daily: 3, weekly: 0, monthly: 0 });
    expect(removed.length).toBe(9);
    expect(listGenerations(lib).map((g) => g.name)).toEqual([generationName(new Date(2026, 7, 2)), generationName(new Date(2026, 7, 1)), generationName(new Date(2026, 6, 31))]);
  });

  test('全部消える結果になる方針は実行しない（安全弁）', async () => {
    const lib = tempLibrary([nameFor(2026, 8, 1), nameFor(2026, 8, 2)]);
    const removed = await pruneGenerations(lib, { daily: 0, weekly: 0, monthly: 0 });
    expect(removed).toEqual([]);
    expect(listGenerations(lib).length).toBe(2);
  });
});
