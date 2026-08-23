// app/src/main/lib-config.ts に加わった libraries[]（#176）の単体テスト。
//「最近使ったライブラリ」の一覧と、旧来の平たい config.backup / config.integrity キーを
// 整理したライブラリごとの backup/integrity 設定を対象にする。Electron を差し替える
// やり方は config-cache.test.ts と同じ（lib-config.ts が引き込む Electron 寄りの import は
// native-host.ts だけ）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const env = vi.hoisted(() => ({ dir: '' }));

vi.mock('../app/src/main/native-host.ts', async () => {
  const { resolveSaveFolder } = await import('../native-host/config-recovery.mts');
  return {
    configDir: () => env.dir,
    defaultLibraryDir: () => path.join(env.dir, 'default-library'),
    resolveSaveFolder,
  };
});

type LibConfig = typeof import('../app/src/main/lib-config');

let dir: string;
const libraryDirs: string[] = [];

async function freshModule(): Promise<LibConfig> {
  vi.resetModules();
  return import('../app/src/main/lib-config');
}

function mkLibraryDir(name: string) {
  const d = path.join(dir, name);
  fs.mkdirSync(d, { recursive: true });
  libraryDirs.push(d);
  return d;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-libconfig-'));
  env.dir = dir;
  libraryDirs.length = 0;
});

afterEach(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* 片付けはできる範囲で */
  }
});

describe('migrateToLibraries', () => {
  test('旧来の平たい backup を破棄し、integrity と saveFolder を libraries[] エントリ1件へ畳む', async () => {
    const lib = await freshModule();
    const a = mkLibraryDir('a');
    lib.writeConfig({ saveFolder: a, backup: { dir: '/old-local-backup', interval: true, lastRunAt: '2026-08-01T00:00:00.000Z' }, integrity: { dbOk: true, orphanCount: 3 } });

    lib.migrateToLibraries();

    const cfg = lib.readConfig();
    expect(Array.isArray(cfg.libraries)).toBe(true);
    expect(cfg.libraries).toHaveLength(1);
    expect(cfg.libraries[0].path).toBe(a);
    expect(cfg.libraries[0].backup).toEqual({ kind: 'google-drive', lastRunAt: null, lastResult: null });
    expect(cfg.libraries[0].integrity).toMatchObject({ dbOk: true, orphanCount: 3 });
    expect(cfg.backup).toBeUndefined();
    expect(cfg.integrity).toBeUndefined();
  });

  test('libraries[] が既にあれば何もしない（何度実行しても同じ＝起動ごとに呼んでよい）', async () => {
    const lib = await freshModule();
    const a = mkLibraryDir('a');
    lib.writeConfig({ saveFolder: a, libraries: [{ path: a, libraryId: 'x', lastOpenedAt: '2026-01-01T00:00:00.000Z' }] });

    lib.migrateToLibraries();

    const cfg = lib.readConfig();
    expect(cfg.libraries).toHaveLength(1);
    expect(cfg.libraries[0].libraryId).toBe('x'); // そのまま。導出し直さない
  });

  test('saveFolder の無い新規インストールは空配列へ移行する', async () => {
    const lib = await freshModule();
    lib.writeConfig({});
    lib.migrateToLibraries();
    expect(lib.readConfig().libraries).toEqual([]);
  });
});

describe('recordLibraryOpened / listRecentLibraries', () => {
  test('新しく開いたライブラリは最近使ったライブラリの先頭に出る', async () => {
    const lib = await freshModule();
    const a = mkLibraryDir('a');
    lib.writeConfig({ saveFolder: a, libraries: [] });

    lib.recordLibraryOpened(a, 'lib-a');

    const recent = lib.listRecentLibraries();
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ path: a, exists: true });
  });

  test('開き直すとエントリは重複せず先頭へ移る', async () => {
    const lib = await freshModule();
    const a = mkLibraryDir('a');
    const b = mkLibraryDir('b');
    lib.writeConfig({ saveFolder: a, libraries: [] });

    lib.recordLibraryOpened(a, 'lib-a');
    lib.recordLibraryOpened(b, 'lib-b');
    lib.recordLibraryOpened(a, 'lib-a');

    const recent = lib.listRecentLibraries();
    expect(recent.map((r) => r.path)).toEqual([a, b]);
  });

  test('5件で打ち切り、いちばん古いものを落とす', async () => {
    const lib = await freshModule();
    lib.writeConfig({ saveFolder: mkLibraryDir('0'), libraries: [] });
    const made: string[] = [];
    for (let i = 0; i < 6; i++) {
      const d = mkLibraryDir(`lib-${i}`);
      made.push(d);
      lib.recordLibraryOpened(d, `id-${i}`);
    }
    const recent = lib.listRecentLibraries();
    expect(recent).toHaveLength(5);
    expect(recent.map((r) => r.path)).not.toContain(made[0]); // いちばん古い（最初に開いた）ものが落ちた
    expect(recent[0].path).toBe(made[5]); // いちばん新しいものが先頭
  });

  test('移動したフォルダは libraryId でその場を直す（重複させない）', async () => {
    const lib = await freshModule();
    const oldPath = mkLibraryDir('old-name');
    const newPath = path.join(dir, 'new-name'); // フォルダが改名された状況を模す
    lib.writeConfig({ saveFolder: oldPath, libraries: [] });

    lib.recordLibraryOpened(oldPath, 'stable-id');
    lib.recordLibraryOpened(newPath, 'stable-id'); // 同じ DB で別のパス（付け替え）

    const recent = lib.listRecentLibraries();
    expect(recent).toHaveLength(1);
    expect(recent[0].path).toBe(newPath);
  });

  test('死んだパスは自動で落とさず exists:false として報告する', async () => {
    const lib = await freshModule();
    const a = mkLibraryDir('a');
    lib.writeConfig({ saveFolder: a, libraries: [] });
    lib.recordLibraryOpened(a, 'lib-a');
    fs.rmSync(a, { recursive: true, force: true });

    const recent = lib.listRecentLibraries();
    expect(recent).toHaveLength(1);
    expect(recent[0].exists).toBe(false);
  });
});

describe('removeRecentLibrary', () => {
  test('パスを指定して1件だけ落とす。他のエントリとフォルダ自体はそのまま', async () => {
    const lib = await freshModule();
    const a = mkLibraryDir('a');
    const b = mkLibraryDir('b');
    lib.writeConfig({ saveFolder: a, libraries: [] });
    lib.recordLibraryOpened(a, 'lib-a');
    lib.recordLibraryOpened(b, 'lib-b');

    lib.removeRecentLibrary(a);

    expect(lib.listRecentLibraries().map((r) => r.path)).toEqual([b]);
    expect(fs.existsSync(a)).toBe(true); // フォルダ自体には一切触らない
  });
});

describe('ライブラリごとの backup/integrity 設定', () => {
  test('2つのライブラリが別々の Google Drive 実行状態を保つ', async () => {
    const lib = await freshModule();
    const a = mkLibraryDir('a');
    const b = mkLibraryDir('b');
    lib.writeConfig({ saveFolder: a, libraries: [] });

    lib.writeLibraryBackupConfig({ lastRunAt: '2026-08-01T00:00:00.000Z' });
    expect(lib.readLibraryBackupConfig()).toEqual({ kind: 'google-drive', lastRunAt: '2026-08-01T00:00:00.000Z', lastResult: null });

    // 今のライブラリを切り替える＝ switchLibrary がするのと同じ、ただの設定の書き込み。
    const cfg = lib.readConfig();
    cfg.saveFolder = b;
    lib.writeConfig(cfg);

    expect(lib.readLibraryBackupConfig()).toEqual({ kind: 'google-drive', lastRunAt: null, lastResult: null });

    lib.writeLibraryBackupConfig({ lastRunAt: '2026-08-02T00:00:00.000Z' });
    expect(lib.readLibraryBackupConfig()).toEqual({ kind: 'google-drive', lastRunAt: '2026-08-02T00:00:00.000Z', lastResult: null });

    // A へ戻すと A の実行状態がまた出る。B の書き込みには一切影響されていない。
    const cfg2 = lib.readConfig();
    cfg2.saveFolder = a;
    lib.writeConfig(cfg2);
    expect(lib.readLibraryBackupConfig()).toEqual({ kind: 'google-drive', lastRunAt: '2026-08-01T00:00:00.000Z', lastResult: null });
  });

  test('backup/integrity 設定を書くと libraries[] のエントリが必要に応じて作られる', async () => {
    const lib = await freshModule();
    const a = mkLibraryDir('a');
    lib.writeConfig({ saveFolder: a, libraries: [] });

    lib.writeLibraryIntegrityStatus({ dbOk: false, orphanCount: 2 });

    const cfg = lib.readConfig();
    expect(cfg.libraries).toHaveLength(1);
    expect(cfg.libraries[0].path).toBe(a);
    expect(lib.readLibraryIntegrityStatus()).toMatchObject({ dbOk: false, orphanCount: 2 });
  });
});
