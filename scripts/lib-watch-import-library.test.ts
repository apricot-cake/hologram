// Unit test for app/src/main/lib-watch-import.ts's #176 addition: the
// "already imported" ledger (watch-import-state.json) is scoped per LIBRARY
// now, not just per watched folder. Without this, a file collected while
// library A was open would never be collectable again after switching to
// library B (and, worse, switching back to A would silently skip it forever).
//
// importLocalFile and ensureLibraryId are mocked so this stays a focused unit
// test of lib-watch-import.ts's own bookkeeping — importLocalFile's actual
// record-writing and ensureLibraryId's actual DB-identity minting have their
// own coverage elsewhere (lib-local-intake / backup-destination.test.ts).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const imported: Array<{ libraryId: string; file: string }> = [];

vi.mock('../app/src/main/native-host.ts', () => ({
  configDir: () => stateDir,
}));

vi.mock('../app/src/main/lib-local-intake.ts', () => ({
  importLocalFile: vi.fn(async ({ sqlite, srcPath }: any) => {
    imported.push({ libraryId: sqlite.__libraryId, file: path.basename(srcPath) });
    return { captureId: 'watch-test' };
  }),
}));

vi.mock('../app/src/main/lib-db-write.ts', () => ({
  ensureLibraryId: (sqlite: any) => sqlite.__libraryId,
}));

let stateDir: string;
let watchDir: string;

beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-watch-config-'));
  watchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-watch-folder-'));
  imported.length = 0;
});

afterEach(() => {
  for (const d of [stateDir, watchDir]) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
  vi.resetModules();
});

// Waits for the manager's internal enqueue chain to settle, using the same
// 'intake-imported' push the real caller (index.ts) listens for.
function waitForImport(deps: { send: any }) {
  return new Promise<void>((resolve) => {
    deps.send.mockImplementationOnce(() => resolve());
  });
}

describe('#176: watch-import "already seen" is scoped per library', () => {
  test('the same file re-imports once per distinct library, and does not re-import within one', async () => {
    const { createWatchImportManager } = await import('../app/src/main/lib-watch-import');
    const file = path.join(watchDir, 'photo.jpg');
    fs.writeFileSync(file, 'not real image bytes, only existence/size matter here');

    let currentLibrary = { __libraryId: 'library-a' };
    const send = vi.fn();
    const manager = createWatchImportManager({
      readConfig: () => ({ watchImport: { folders: [{ path: watchDir, enabled: true }] } }),
      writeConfig: () => {},
      getSaveFolder: () => '/fake/save-folder',
      isLibraryMissing: () => false,
      ensurePostsSynced: () => ({ sqlite: currentLibrary }) as any,
      send,
    });

    // First refresh (library A): the file is new, imports once.
    let done = waitForImport({ send });
    await manager.refresh();
    await done;
    expect(imported).toEqual([{ libraryId: 'library-a', file: 'photo.jpg' }]);

    // A second refresh against the SAME library must NOT re-import — this is
    // the ordinary (pre-#176) "already seen" behavior, still intact.
    send.mockClear();
    await manager.refresh();
    await new Promise((r) => setTimeout(r, 50)); // let any (unwanted) enqueue settle
    expect(imported).toHaveLength(1);
    expect(send).not.toHaveBeenCalledWith('intake-imported', expect.anything());

    // Switch to library B (#176: a different DB, different libraryId) — the
    // SAME file must be collectable again, because "already imported" means
    // "already imported into the library that is open right now".
    currentLibrary = { __libraryId: 'library-b' };
    done = waitForImport({ send });
    await manager.refresh();
    await done;
    expect(imported).toEqual([
      { libraryId: 'library-a', file: 'photo.jpg' },
      { libraryId: 'library-b', file: 'photo.jpg' },
    ]);

    // Switching BACK to library A must not re-import either — A's own ledger
    // entry survived the round trip through B untouched.
    currentLibrary = { __libraryId: 'library-a' };
    send.mockClear();
    await manager.refresh();
    await new Promise((r) => setTimeout(r, 50));
    expect(imported).toHaveLength(2);
  });

  test('markExisting (setFolders) marks a file as already-imported for the CURRENT library only', async () => {
    const { createWatchImportManager } = await import('../app/src/main/lib-watch-import');
    const file = path.join(watchDir, 'existing.jpg');
    fs.writeFileSync(file, 'pre-existing file the user says is already accounted for');

    let currentLibrary = { __libraryId: 'library-a' };
    let cfg: any = { watchImport: { folders: [] } };
    const send = vi.fn();
    const manager = createWatchImportManager({
      readConfig: () => cfg,
      writeConfig: (next: any) => {
        cfg = next;
      },
      getSaveFolder: () => '/fake/save-folder',
      isLibraryMissing: () => false,
      ensurePostsSynced: () => ({ sqlite: currentLibrary }) as any,
      send,
    });

    await manager.setFolders([{ path: watchDir, enabled: true }], [watchDir]);
    expect(imported).toHaveLength(0); // markExisting never imports

    // Library A now treats it as known — a refresh must not import it.
    await manager.refresh();
    await new Promise((r) => setTimeout(r, 50));
    expect(imported).toHaveLength(0);

    // Library B has no such record — the same file is new to it.
    currentLibrary = { __libraryId: 'library-b' };
    const done = waitForImport({ send });
    await manager.refresh();
    await done;
    expect(imported).toEqual([{ libraryId: 'library-b', file: 'existing.jpg' }]);
  });
});
