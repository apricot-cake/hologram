import { beforeEach, describe, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  reminder: { enabled: true, threshold: 100, changesSinceExport: 0, lastExportAt: null as string | null },
  folder: 'C:\\library-a',
  reads: 0,
}));

vi.mock('electron-log/main', () => ({ default: { info: vi.fn(), error: vi.fn() } }));
vi.mock('./native-host.ts', () => ({ configDir: () => 'C:\\hologram-config' }));
vi.mock('./lib-config.ts', () => ({
  getSaveFolder: () => state.folder,
  readLibraryExportReminderConfig: () => {
    state.reads++;
    return { ...state.reminder };
  },
  writeLibraryExportReminderConfig: (patch: Partial<typeof state.reminder>) => {
    state.reminder = { ...state.reminder, ...patch };
    return { ...state.reminder };
  },
  readLibraryIntegrityStatus: () => null,
  writeLibraryIntegrityStatus: vi.fn(),
}));
vi.mock('./lib-db-generations.ts', () => ({
  createGeneration: vi.fn(),
  latestGeneration: vi.fn(),
  listGenerations: () => [],
  pruneGenerations: vi.fn(),
}));
vi.mock('./lib-db-integrity.ts', () => ({ checkOrphans: () => ({ orphanMedia: [], missingMedia: [] }), recoverOrphanRecords: () => [] }));

import { createLibrarySafety } from './lib-library-safety.ts';

function createSafety() {
  return createLibrarySafety({
    ensurePostsSynced: () => null,
    scheduleSavedIndexWrite: vi.fn(),
    send: vi.fn(),
  });
}

beforeEach(() => {
  state.reminder = { enabled: true, threshold: 100, changesSinceExport: 0, lastExportAt: null };
  state.folder = 'C:\\library-a';
  state.reads = 0;
});

describe('エクスポート通知', () => {
  test('投稿の新規保存だけを数え、100件で通知対象になる', () => {
    const safety = createSafety();

    safety.noteLibraryMutation(250);
    expect(safety.getExportReminder()).toMatchObject({ changesSinceExport: 0, due: false });

    safety.notePostsSaved(99);
    expect(safety.getExportReminder()).toMatchObject({ changesSinceExport: 99, due: false });

    safety.notePostsSaved(1);
    expect(safety.getExportReminder()).toMatchObject({ changesSinceExport: 100, due: true });
  });

  test('完全エクスポート後は開始時点の件数だけを差し引く', () => {
    const safety = createSafety();
    safety.notePostsSaved(100);
    const watermark = safety.beginCompleteExport();
    safety.notePostsSaved(3);

    const result = safety.markExported(watermark);

    expect(result).toMatchObject({ changesSinceExport: 3, due: false });
    expect(result.lastExportAt).toEqual(expect.any(String));
  });

  test.each([
    ['A→B', [0, 1]],
    ['B→A', [1, 0]],
  ])('同じbaselineの同時exportを完了順%sでも二度差し引かない', (_label, order) => {
    const safety = createSafety();
    safety.notePostsSaved(100);
    const exports = [safety.beginCompleteExport(), safety.beginCompleteExport()];

    safety.markExported(exports[order[0]]);
    safety.notePostsSaved(3);
    safety.markExported(exports[order[1]]);

    expect(safety.getExportReminder()).toMatchObject({ changesSinceExport: 3 });
  });

  test.each([
    ['古い順', [0, 1]],
    ['新しい順', [1, 0]],
  ])('異なる世代の同時exportを%sに完了しても各世代を一度だけ差し引く', (_label, order) => {
    const safety = createSafety();
    safety.notePostsSaved(100);
    const first = safety.beginCompleteExport();
    safety.notePostsSaved(3);
    const second = safety.beginCompleteExport();
    const exports = [first, second];

    safety.markExported(exports[order[0]]);
    safety.markExported(exports[order[1]]);

    expect(safety.getExportReminder()).toMatchObject({ changesSinceExport: 0 });
  });

  test('同じ世代とzero changesの成功でも最終export日時を更新する', () => {
    const safety = createSafety();
    const zero = safety.beginCompleteExport();
    const first = safety.markExported(zero);
    state.reminder.lastExportAt = null;

    const second = safety.markExported(zero);

    expect(first.lastExportAt).toEqual(expect.any(String));
    expect(second).toMatchObject({ changesSinceExport: 0, lastExportAt: expect.any(String) });
  });

  test('移行前のmodule初期化では通知世代を読まず、最初の利用時に移行値を採用する', () => {
    const safety = createSafety();
    expect(state.reads).toBe(0);
    state.reminder.changesSinceExport = 42;

    const watermark = safety.beginCompleteExport();

    expect(watermark.generation).toBe(42);
    expect(state.reads).toBe(1);
  });

  test('ライブラリ切替後は古いexportの完了を無視する', () => {
    const safety = createSafety();
    safety.notePostsSaved(100);
    const oldExport = safety.beginCompleteExport();
    state.folder = 'C:\\library-b';
    state.reminder = { ...state.reminder, changesSinceExport: 7 };

    safety.markExported(oldExport);

    expect(safety.getExportReminder()).toMatchObject({ changesSinceExport: 7 });
  });

  test('通知を無効にすると件数にかかわらず通知対象にならない', () => {
    const safety = createSafety();
    safety.notePostsSaved(250);

    const result = safety.setExportReminderEnabled(false);

    expect(result).toMatchObject({ changesSinceExport: 250, enabled: false, due: false });
  });
});
