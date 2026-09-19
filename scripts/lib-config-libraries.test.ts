import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const env = vi.hoisted(() => ({ dir: '' }));

vi.mock('../app/src/main/native-host.ts', async () => {
  const { resolveSaveFolder } = await import('../native-host/config-recovery.mts');
  return { configDir: () => env.dir, defaultLibraryDir: () => path.join(env.dir, 'default-library'), resolveSaveFolder };
});

type Config = typeof import('../app/src/main/lib-config');
let dir: string;

async function freshModule(): Promise<Config> {
  vi.resetModules();
  return import('../app/src/main/lib-config');
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-libconfig-'));
  env.dir = dir;
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('migrateLibrarySettings', () => {
  test('現在のライブラリの状態だけを引き継ぎ、履歴を削除する', async () => {
    const lib = await freshModule();
    const current = path.join(dir, 'current');
    const previous = path.join(dir, 'previous');
    fs.mkdirSync(current);
    fs.mkdirSync(previous);
    lib.writeConfig({
      saveFolder: current,
      backup: { legacy: true },
      libraries: [
        { path: previous, exportReminder: { threshold: 25 }, integrity: { orphanCount: 9 } },
        { path: current, exportReminder: { enabled: false, threshold: 250, changesSinceExport: 17 }, integrity: { dbOk: true, orphanCount: 3 } },
      ],
    });

    lib.migrateLibrarySettings();

    const cfg = lib.readConfig();
    expect(cfg.libraries).toBeUndefined();
    expect(cfg.backup).toBeUndefined();
    expect(lib.readLibraryExportReminderConfig()).toMatchObject({ enabled: false, threshold: 250, changesSinceExport: 17 });
    expect(lib.readLibraryIntegrityStatus()).toMatchObject({ dbOk: true, orphanCount: 3 });
  });
});

describe('現在のライブラリの設定', () => {
  test('エクスポート通知と整合性状態を config の現在値として更新する', async () => {
    const lib = await freshModule();
    const current = path.join(dir, 'current');
    fs.mkdirSync(current);
    lib.writeConfig({ saveFolder: current });

    lib.writeLibraryExportReminderConfig({ enabled: false, threshold: 25, changesSinceExport: 4 });
    lib.writeLibraryIntegrityStatus({ dbOk: false, orphanCount: 2 });

    const cfg = lib.readConfig();
    expect(cfg.libraries).toBeUndefined();
    expect(cfg.exportReminder).toMatchObject({ enabled: false, threshold: 25, changesSinceExport: 4 });
    expect(cfg.integrity).toMatchObject({ dbOk: false, orphanCount: 2 });
  });
});
