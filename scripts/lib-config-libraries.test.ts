// Unit tests for app/src/main/lib-config.ts's libraries[] additions (#176):
// the "recent libraries" list, and the per-library backup/integrity settings
// that replaced the old flat config.backup/config.integrity keys. Same
// Electron-swap pattern as config-cache.test.ts (native-host.ts is the only
// Electron-adjacent import lib-config.ts pulls in).

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
    /* best-effort cleanup */
  }
});

describe('migrateToLibraries', () => {
  test('folds the old flat backup/integrity keys into one libraries[] entry for the current saveFolder', async () => {
    const lib = await freshModule();
    const a = mkLibraryDir('a');
    lib.writeConfig({ saveFolder: a, backup: { dir: '/mirror', interval: true }, integrity: { dbOk: true, orphanCount: 3 } });

    lib.migrateToLibraries();

    const cfg = lib.readConfig();
    expect(Array.isArray(cfg.libraries)).toBe(true);
    expect(cfg.libraries).toHaveLength(1);
    expect(cfg.libraries[0].path).toBe(a);
    expect(cfg.libraries[0].backup).toMatchObject({ dir: '/mirror', interval: true });
    expect(cfg.libraries[0].integrity).toMatchObject({ dbOk: true, orphanCount: 3 });
    expect(cfg.backup).toBeUndefined();
    expect(cfg.integrity).toBeUndefined();
  });

  test('is a no-op once libraries[] already exists (idempotent — safe to call every startup)', async () => {
    const lib = await freshModule();
    const a = mkLibraryDir('a');
    lib.writeConfig({ saveFolder: a, libraries: [{ path: a, libraryId: 'x', lastOpenedAt: '2026-01-01T00:00:00.000Z' }] });

    lib.migrateToLibraries();

    const cfg = lib.readConfig();
    expect(cfg.libraries).toHaveLength(1);
    expect(cfg.libraries[0].libraryId).toBe('x'); // untouched, not re-derived
  });

  test('a fresh install with no saveFolder migrates to an empty array', async () => {
    const lib = await freshModule();
    lib.writeConfig({});
    lib.migrateToLibraries();
    expect(lib.readConfig().libraries).toEqual([]);
  });
});

describe('recordLibraryOpened / listRecentLibraries', () => {
  test('a newly opened library appears at the front of the recent list', async () => {
    const lib = await freshModule();
    const a = mkLibraryDir('a');
    lib.writeConfig({ saveFolder: a, libraries: [] });

    lib.recordLibraryOpened(a, 'lib-a');

    const recent = lib.listRecentLibraries();
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ path: a, exists: true });
  });

  test('re-opening moves the entry to the front instead of duplicating it', async () => {
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

  test('caps at 5 entries, dropping the oldest', async () => {
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
    expect(recent.map((r) => r.path)).not.toContain(made[0]); // the oldest (first opened) fell off
    expect(recent[0].path).toBe(made[5]); // the newest is first
  });

  test('a folder that moved is repaired in place via libraryId, not duplicated', async () => {
    const lib = await freshModule();
    const oldPath = mkLibraryDir('old-name');
    const newPath = path.join(dir, 'new-name'); // simulates the folder having been renamed
    lib.writeConfig({ saveFolder: oldPath, libraries: [] });

    lib.recordLibraryOpened(oldPath, 'stable-id');
    lib.recordLibraryOpened(newPath, 'stable-id'); // same DB, different path (repoint)

    const recent = lib.listRecentLibraries();
    expect(recent).toHaveLength(1);
    expect(recent[0].path).toBe(newPath);
  });

  test('a dead path reports exists:false without being dropped automatically', async () => {
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
  test('drops one entry by path, leaving the others and the folder itself untouched', async () => {
    const lib = await freshModule();
    const a = mkLibraryDir('a');
    const b = mkLibraryDir('b');
    lib.writeConfig({ saveFolder: a, libraries: [] });
    lib.recordLibraryOpened(a, 'lib-a');
    lib.recordLibraryOpened(b, 'lib-b');

    lib.removeRecentLibrary(a);

    expect(lib.listRecentLibraries().map((r) => r.path)).toEqual([b]);
    expect(fs.existsSync(a)).toBe(true); // the folder itself is never touched
  });
});

describe('per-library backup/integrity settings', () => {
  test('two libraries keep independent backup destinations under the same no-argument call shape', async () => {
    const lib = await freshModule();
    const a = mkLibraryDir('a');
    const b = mkLibraryDir('b');
    lib.writeConfig({ saveFolder: a, libraries: [] });

    lib.writeLibraryBackupConfig({ dir: '/mirror-a', interval: true });
    expect(lib.readLibraryBackupConfig()).toMatchObject({ dir: '/mirror-a', interval: true });

    // Switch the current library — a plain config write, same as switchLibrary does.
    const cfg = lib.readConfig();
    cfg.saveFolder = b;
    lib.writeConfig(cfg);

    // Library B has never had a destination configured — reads as the defaults,
    // NOT library A's — this is the #176 requirement that a switch never
    // carries one library's backup destination onto another.
    expect(lib.readLibraryBackupConfig()).toMatchObject({ dir: null });

    lib.writeLibraryBackupConfig({ dir: '/mirror-b' });
    expect(lib.readLibraryBackupConfig()).toMatchObject({ dir: '/mirror-b' });

    // Switching back to A shows A's destination again, untouched by B's write.
    const cfg2 = lib.readConfig();
    cfg2.saveFolder = a;
    lib.writeConfig(cfg2);
    expect(lib.readLibraryBackupConfig()).toMatchObject({ dir: '/mirror-a' });
  });

  test('writing backup/integrity settings creates the libraries[] entry on demand', async () => {
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
