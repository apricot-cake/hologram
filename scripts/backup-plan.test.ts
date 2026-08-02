// Unit tests for the backup engine's decision step (app/src/main/lib-backup-plan.ts).
// This is where #233 decides what gets copied, relocated and DELETED at a
// destination, so it is tested as pure logic — no Electron, no filesystem.

import { describe, expect, test } from 'vitest';
import { groupOf, planBackup } from '../app/src/main/lib-backup-plan';
import type { DestinationFile, SourceFile } from '../app/src/main/lib-backup-plan';

const INBOX = '.hologram-inbox';
const GENS = '.db-generations';

const src = (entries: Record<string, Partial<SourceFile> & { size?: number }>): Map<string, SourceFile> => new Map(Object.entries(entries).map(([rel, f]) => [rel, { abs: `/lib/${rel}`, size: f.size ?? 10, mtimeMs: f.mtimeMs ?? 1000, mutable: f.mutable }]));
const dest = (entries: Record<string, Partial<DestinationFile>>): Map<string, DestinationFile> => new Map(Object.entries(entries).map(([rel, f]) => [rel, { size: f.size ?? 10, mtimeMs: f.mtimeMs ?? 1000 }]));
const rels = (list: Array<{ rel: string }>) => list.map((c) => c.rel).sort();

describe('groupOf', () => {
  test('ライブラリ本体・共有ストア・ゴミ箱はメディア車線', () => {
    expect(groupOf('1700-aa.jpg')).toBe('media');
    expect(groupOf('avatars/x.png')).toBe('media');
    expect(groupOf('emoji/y.png')).toBe('media');
    expect(groupOf('.trash/1700-aa.jpg')).toBe('media');
  });
  test('受信箱と世代置き場はそれぞれ別の車線', () => {
    expect(groupOf(`${INBOX}/new/e1.json`)).toBe('inbox-new');
    expect(groupOf(`${INBOX}/segments/s1.jsonl`)).toBe('inbox-segments');
    expect(groupOf(`${GENS}/hologram-20260801-010203.db`)).toBe('db');
  });
});

describe('planBackup: メディア車線', () => {
  test('宛先に無いものだけコピーする（write-once なので存在＝最新）', () => {
    const plan = planBackup(src({ 'a.jpg': {}, 'b.jpg': {} }), dest({ 'a.jpg': {} }), 2);
    expect(rels(plan.copy)).toEqual(['b.jpg']);
    expect(plan.prune).toEqual([]);
    expect(plan.mediaCount).toBe(2);
  });

  test('ゴミ箱の sidecar だけは書き換わる＝差があれば再コピー', () => {
    const plan = planBackup(src({ '.trash/a.json': { mutable: true, size: 20, mtimeMs: 5000 } }), dest({ '.trash/a.json': { size: 10, mtimeMs: 1000 } }), 1);
    expect(rels(plan.copy)).toEqual(['.trash/a.json']);
  });

  test('同一なら再コピーしない', () => {
    const plan = planBackup(src({ '.trash/a.json': { mutable: true, size: 10, mtimeMs: 1000 } }), dest({ '.trash/a.json': { size: 10, mtimeMs: 1000 } }), 1);
    expect(plan.copy).toEqual([]);
  });

  test('ライブラリから消えたものは宛先からも消す', () => {
    const plan = planBackup(src({ 'a.jpg': {} }), dest({ 'a.jpg': {}, 'gone.jpg': {} }), 2);
    expect(plan.prune).toEqual(['gone.jpg']);
  });

  test('ゴミ箱入りは削除＋再アップロードでなく move になる', () => {
    const plan = planBackup(src({ '.trash/a.jpg': {} }), dest({ 'a.jpg': {} }), 1);
    expect(plan.move).toEqual([{ from: 'a.jpg', to: '.trash/a.jpg' }]);
    expect(plan.copy).toEqual([]);
    expect(plan.prune).toEqual([]);
  });

  test('ゴミ箱からの復元も同じ経路で move になる', () => {
    const plan = planBackup(src({ 'a.jpg': {} }), dest({ '.trash/a.jpg': {} }), 1);
    expect(plan.move).toEqual([{ from: '.trash/a.jpg', to: 'a.jpg' }]);
  });

  test('名前が同じでも中身の大きさが違えば move とみなさない', () => {
    const plan = planBackup(src({ '.trash/a.jpg': { size: 99 } }), dest({ 'a.jpg': { size: 10 } }), 1);
    expect(plan.move).toEqual([]);
    expect(rels(plan.copy)).toEqual(['.trash/a.jpg']);
    expect(plan.prune).toEqual(['a.jpg']);
  });

  test('src が急減したら削除も move も止める（コピーは続ける）', () => {
    // 1 of 100 remain — backup-guard's shrink verdict.
    const plan = planBackup(src({ '.trash/a.jpg': {}, 'new.jpg': {} }), dest({ 'a.jpg': {}, 'b.jpg': {}, 'c.jpg': {} }), 100);
    expect(plan.pruneSkipped).toBe('shrink');
    expect(plan.prune).toEqual([]);
    expect(plan.move).toEqual([]);
    expect(rels(plan.copy)).toEqual(['.trash/a.jpg', 'new.jpg']);
    // The baseline is carried forward, not replaced by the suspicious count.
    expect(plan.lastGoodCount).toBe(100);
  });
});

describe('planBackup: 受信箱', () => {
  test('segment は決して消さない', () => {
    const plan = planBackup(src({}), dest({ [`${INBOX}/segments/s1.jsonl`]: {} }), 0);
    expect(plan.prune).toEqual([]);
    expect(plan.pruneLoose).toEqual([]);
  });

  test('圧縮で消えた loose は条件付きの掃除リストに入る（無条件の prune ではない）', () => {
    const plan = planBackup(src({ [`${INBOX}/segments/s1.jsonl`]: {} }), dest({ [`${INBOX}/new/e1.json`]: {} }), 0);
    expect(rels(plan.copy)).toEqual([`${INBOX}/segments/s1.jsonl`]);
    // The engine only executes pruneLoose once every segment copy succeeded —
    // a loose event must never lose its mirror before its segment has one.
    expect(plan.prune).toEqual([]);
    expect(plan.pruneLoose).toEqual([`${INBOX}/new/e1.json`]);
  });

  test('ライブラリにまだある loose は残す', () => {
    const plan = planBackup(src({ [`${INBOX}/new/e1.json`]: {} }), dest({ [`${INBOX}/new/e1.json`]: {} }), 0);
    expect(plan.pruneLoose).toEqual([]);
    expect(plan.copy).toEqual([]);
  });
});

describe('planBackup: DB 世代', () => {
  test('ローカル置き場の間引きに宛先も追随する', () => {
    const plan = planBackup(src({ [`${GENS}/hologram-20260802-000000.db`]: {} }), dest({ [`${GENS}/hologram-20260101-000000.db`]: {} }), 0);
    expect(rels(plan.copy)).toEqual([`${GENS}/hologram-20260802-000000.db`]);
    expect(plan.prune).toEqual([`${GENS}/hologram-20260101-000000.db`]);
  });

  test('ローカル置き場が空に見えるときは宛先の世代を消さない', () => {
    const plan = planBackup(src({}), dest({ [`${GENS}/hologram-20260101-000000.db`]: {} }), 0);
    expect(plan.prune).toEqual([]);
  });
});
