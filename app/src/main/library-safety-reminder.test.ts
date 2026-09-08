import { beforeEach, describe, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  reminder: { enabled: true, threshold: 100, changesSinceExport: 0, lastExportAt: null as string | null },
}));

vi.mock('electron-log/main', () => ({ default: { info: vi.fn(), error: vi.fn() } }));
vi.mock('./native-host.ts', () => ({ configDir: () => 'C:\\hologram-config' }));
vi.mock('./lib-config.ts', () => ({
  getSaveFolder: () => '',
  readLibraryExportReminderConfig: () => ({ ...state.reminder }),
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
vi.mock('./lib-db-rollback.ts', () => ({ listRestorableGenerations: () => [], rollbackToGeneration: vi.fn() }));
vi.mock('./lib-db-integrity.ts', () => ({ checkOrphans: () => ({ orphanMedia: [], missingMedia: [] }), recoverOrphanRecords: () => [] }));

import { createLibrarySafety } from './lib-library-safety.ts';

function createSafety() {
  return createLibrarySafety({
    ensurePostsSynced: () => null,
    scheduleSavedIndexWrite: vi.fn(),
    send: vi.fn(),
    dbFile: () => '',
    closeDb: vi.fn(),
  });
}

beforeEach(() => {
  state.reminder = { enabled: true, threshold: 100, changesSinceExport: 0, lastExportAt: null };
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

  test('完全エクスポート後は件数をリセットする', () => {
    const safety = createSafety();
    safety.notePostsSaved(100);

    const result = safety.markExported();

    expect(result).toMatchObject({ changesSinceExport: 0, due: false });
    expect(result.lastExportAt).toEqual(expect.any(String));
  });

  test('通知を無効にすると件数にかかわらず通知対象にならない', () => {
    const safety = createSafety();
    safety.notePostsSaved(250);

    const result = safety.setExportReminderEnabled(false);

    expect(result).toMatchObject({ changesSinceExport: 250, enabled: false, due: false });
  });
});
