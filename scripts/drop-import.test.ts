// Window drop-to-import (#234) = dragging local files/folders from the OS onto
// the app window. Three layers, same split the module comments describe:
//   1. lib-drop-import.ts's collectDroppedPaths — pure fs walk, no electron.
//   2. ipc-transfer.ts's collect-dropped-paths / import-dropped-paths handlers —
//      the two-round-trip contract (count first, write only once confirmed).
//   3. services/drop-intake.ts's handleDroppedPaths — the renderer-side
//      collect -> confirm -> import -> report wiring.
//
// #234's acceptance conditions checked here: single file / multiple files /
// folder (recursive) / file+folder mixed all confirm as ONE combined count;
// hidden files and Thumbs.db/desktop.ini/.DS_Store never get in; a
// symlink/junction is never followed; nothing is written before the renderer's
// confirm is accepted.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { IpcContext } from '../app/src/main/ipc-context';

type Handler = (event: unknown, ...args: any[]) => any;

const stub = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: any[]) => any>(),
  toasts: [] as string[],
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      stub.handlers.set(channel, handler);
    },
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true }),
    showSaveDialog: async () => ({ canceled: true }),
  },
  clipboard: { availableFormats: () => [], readImage: () => ({ isEmpty: () => true, toPNG: () => Buffer.alloc(0) }) },
  app: { getVersion: () => '0.0.0-test' },
}));

vi.mock('sonner', () => ({
  toast: (msg: string) => {
    stub.toasts.push(String(msg));
  },
}));

import { collectDroppedPaths } from '../app/src/main/lib-drop-import';
import { openDatabase } from '../app/src/main/lib-db';
import { register as registerTransferIpc } from '../app/src/main/ipc-transfer';

// --- 1. lib-drop-import.ts: the pure recursive walk -----------------------------
describe('main: collectDroppedPaths（再帰ウォーク・電子非依存）', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-drop-'));

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('単一ファイルは1件・メディア判定される', async () => {
    const dir = fs.mkdtempSync(path.join(root, 'single-'));
    fs.writeFileSync(path.join(dir, 'a.png'), 'x');

    const res = await collectDroppedPaths([path.join(dir, 'a.png')]);

    expect(res.files.map((f) => f.ext)).toEqual(['png']);
    expect(res.mediaCount).toBe(1);
    expect(res.otherCount).toBe(0);
  });

  test('複数ファイル＋メディア以外の混在＝内訳つきで合算', async () => {
    const dir = fs.mkdtempSync(path.join(root, 'multi-'));
    fs.writeFileSync(path.join(dir, 'a.png'), 'x');
    fs.writeFileSync(path.join(dir, 'b.jpg'), 'x');
    fs.writeFileSync(path.join(dir, 'c.pdf'), 'x');

    const res = await collectDroppedPaths([path.join(dir, 'a.png'), path.join(dir, 'b.jpg'), path.join(dir, 'c.pdf')]);

    expect(res.files).toHaveLength(3);
    expect(res.mediaCount).toBe(2);
    expect(res.otherCount).toBe(1);
  });

  test('フォルダは再帰で辿る', async () => {
    const dir = fs.mkdtempSync(path.join(root, 'folder-'));
    fs.writeFileSync(path.join(dir, 'top.png'), 'x');
    fs.mkdirSync(path.join(dir, 'sub', 'deeper'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'sub', 'mid.jpg'), 'x');
    fs.writeFileSync(path.join(dir, 'sub', 'deeper', 'bottom.png'), 'x');

    const res = await collectDroppedPaths([dir]);

    expect(res.files.map((f) => path.basename(f.path)).sort()).toEqual(['bottom.png', 'mid.jpg', 'top.png']);
    expect(res.mediaCount).toBe(3);
  });

  test('ファイル＋フォルダ混在は合算して1回分のカウントになる', async () => {
    const dir = fs.mkdtempSync(path.join(root, 'mixed-'));
    const loneFile = path.join(dir, 'lone.png');
    fs.writeFileSync(loneFile, 'x');
    const folder = path.join(dir, 'sub');
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'inside.jpg'), 'x');

    const res = await collectDroppedPaths([loneFile, folder]);

    expect(res.files).toHaveLength(2);
    expect(res.mediaCount).toBe(2);
  });

  test('隠しファイルと OS のゴミは除外される', async () => {
    const dir = fs.mkdtempSync(path.join(root, 'junk-'));
    fs.writeFileSync(path.join(dir, 'keep.png'), 'x');
    fs.writeFileSync(path.join(dir, '.hidden.png'), 'x');
    fs.writeFileSync(path.join(dir, 'Thumbs.db'), 'x');
    fs.writeFileSync(path.join(dir, 'desktop.ini'), 'x');
    fs.writeFileSync(path.join(dir, '.DS_Store'), 'x');

    const res = await collectDroppedPaths([dir]);

    expect(res.files.map((f) => path.basename(f.path))).toEqual(['keep.png']);
  });

  test('隠しフォルダはサブツリーごと除外される', async () => {
    const dir = fs.mkdtempSync(path.join(root, 'hiddendir-'));
    fs.writeFileSync(path.join(dir, 'keep.png'), 'x');
    fs.mkdirSync(path.join(dir, '.git'));
    fs.writeFileSync(path.join(dir, '.git', 'config.png'), 'x');

    const res = await collectDroppedPaths([dir]);

    expect(res.files.map((f) => path.basename(f.path))).toEqual(['keep.png']);
  });

  test('ジャンクション（ディレクトリのシンボリックリンク）は辿らない', async () => {
    const dir = fs.mkdtempSync(path.join(root, 'link-'));
    fs.writeFileSync(path.join(dir, 'real.png'), 'x');
    const elsewhere = fs.mkdtempSync(path.join(root, 'elsewhere-'));
    fs.writeFileSync(path.join(elsewhere, 'other.png'), 'x');
    // 'junction' works on Windows without elevation (unlike a file symlink) —
    // this is the exact case #234's design calls out (loop/escape prevention).
    fs.symlinkSync(elsewhere, path.join(dir, 'linked'), 'junction');

    const res = await collectDroppedPaths([dir]);

    expect(res.files.map((f) => path.basename(f.path))).toEqual(['real.png']);
  });

  test('存在しないパスは静かに無視される（ドロップ後に消えた等）', async () => {
    const res = await collectDroppedPaths([path.join(root, 'does-not-exist')]);
    expect(res.files).toHaveLength(0);
  });
});

// --- 2. ipc-transfer.ts: the two IPC handlers ------------------------------------
describe('main: collect-dropped-paths / import-dropped-paths（IPC）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-drop-ipc-'));
  const folder = path.join(dir, 'library');
  fs.mkdirSync(folder, { recursive: true });
  const { sqlite } = openDatabase(path.join(dir, 'test.db'));

  let saveFolder: string | null = folder;
  let libraryMissing = false;

  const ctx = {
    getSaveFolder: () => saveFolder,
    getTrashDir: () => null,
    getLibraryStatus: () => ({ missing: libraryMissing, path: saveFolder }),
    ensurePostsSynced: () => (saveFolder ? { db: null, sqlite } : null),
    send: () => {},
    getWin: () => null,
  } as unknown as IpcContext;

  registerTransferIpc(ctx);

  const collect = (paths: string[]) => stub.handlers.get('collect-dropped-paths')?.(null, paths);
  const doImport = (files: { path: string; ext: string }[]) => stub.handlers.get('import-dropped-paths')?.(null, files);
  const rows = () => sqlite.prepare('SELECT captureId, source, url, title, image, video, file, assetClass, mediaType FROM posts').all() as any[];

  function reset() {
    saveFolder = folder;
    libraryMissing = false;
    sqlite.exec('DELETE FROM posts');
    for (const f of fs.readdirSync(folder)) fs.rmSync(path.join(folder, f), { recursive: true, force: true });
  }

  afterAll(() => {
    sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(reset);

  test('collect は書き込まず件数だけ返す', async () => {
    const src = fs.mkdtempSync(path.join(dir, 'drop-src-'));
    fs.writeFileSync(path.join(src, 'a.png'), 'x');
    fs.writeFileSync(path.join(src, 'b.pdf'), 'x');

    const res = await collect([src]);

    expect(res).toMatchObject({ mediaCount: 1, otherCount: 1 });
    expect(res.files).toHaveLength(2);
    expect(rows()).toHaveLength(0);
    expect(fs.readdirSync(folder)).toHaveLength(0);
  });

  test('collect → import で1件ずつ増え、source/idPrefix は drag を踏襲する', async () => {
    const src = fs.mkdtempSync(path.join(dir, 'drop-src-'));
    fs.writeFileSync(path.join(src, 'photo.png'), 'x');
    fs.writeFileSync(path.join(src, 'doc.pdf'), 'x');

    const collected = await collect([src]);
    const res = await doImport(collected.files);

    expect(res).toEqual({ imported: 2, skipped: 0 });
    const all = rows();
    expect(all).toHaveLength(2);
    for (const rec of all) {
      expect(rec.captureId).toMatch(/^drag-\d+-\d{4}$/);
      expect(rec.source).toBe('drag');
      expect(rec.url).toBeNull();
    }
    const media = all.find((r) => r.assetClass === 'media');
    const file = all.find((r) => r.assetClass === 'file');
    expect(media.image).toMatch(/\.png$/);
    expect(file.file).toMatch(/\.pdf$/);
    expect(fs.readdirSync(folder)).toHaveLength(2);
  });

  test('「いいえ」＝import を呼ばない想定どおり、collect だけでは何も残らない', async () => {
    const src = fs.mkdtempSync(path.join(dir, 'drop-src-'));
    fs.writeFileSync(path.join(src, 'a.png'), 'x');
    await collect([src]);
    // renderer never calls import-dropped-paths when the user answers no —
    // nothing here simulates that call, so the assertion is just that collect
    // alone left the library untouched (already covered above) plus that an
    // EMPTY files array (the shape a no-op caller might send) is also a safe no-op.
    expect(await doImport([])).toEqual({ imported: 0, skipped: 0 });
    expect(rows()).toHaveLength(0);
  });

  test('保存先が無ければ collect も import も書かずに no-folder', async () => {
    saveFolder = null;
    expect(await collect(['/whatever'])).toEqual({ files: [], mediaCount: 0, otherCount: 0, error: 'no-folder' });
    expect(await doImport([{ path: '/whatever', ext: 'png' }])).toEqual({ imported: 0, skipped: 0, error: 'no-folder' });
  });

  test('ライブラリが missing なら collect も import も library-missing', async () => {
    libraryMissing = true;
    expect(await collect(['/whatever'])).toEqual({ files: [], mediaCount: 0, otherCount: 0, error: 'library-missing' });
    expect(await doImport([{ path: '/whatever', ext: 'png' }])).toEqual({ imported: 0, skipped: 0, error: 'library-missing' });
  });

  test('ドロップ後にファイルが消えていても例外を投げず skipped で数える', async () => {
    const res = await doImport([{ path: path.join(dir, 'vanished.png'), ext: 'png' }]);
    expect(res).toEqual({ imported: 0, skipped: 1 });
    expect(rows()).toHaveLength(0);
  });
});

// --- 3. services/drop-intake.ts: the renderer-side collect→confirm→import flow --
describe('renderer: handleDroppedPaths（collect→confirm→import）', () => {
  let calls: { collect: string[][]; import: any[][] };
  let collectAnswer: any;
  let importAnswer: any;

  beforeEach(async () => {
    calls = { collect: [], import: [] };
    collectAnswer = { files: [{ path: '/a.png', ext: 'png' }], mediaCount: 1, otherCount: 0 };
    importAnswer = { imported: 1, skipped: 0 };
    stub.toasts.length = 0;
    (globalThis as any).window = {
      hologram: {
        getPrefs: async () => ({ language: 'ja' }),
        collectDroppedPaths: async (paths: string[]) => {
          calls.collect.push(paths);
          return collectAnswer;
        },
        importDroppedPaths: async (files: any[]) => {
          calls.import.push(files);
          return importAnswer;
        },
        getPathForFile: (f: any) => f.__path,
      },
    };
    vi.resetModules();
  });

  afterEach(() => {
    (globalThis as any).window = undefined;
  });

  type DropIntakeModule = typeof import('../app/src/renderer/src/services/drop-intake');
  const freshDropIntake = async (): Promise<DropIntakeModule> => {
    const i18n = await import('../app/src/renderer/src/_shared/i18n');
    await i18n.initI18n();
    return import('../app/src/renderer/src/services/drop-intake');
  };

  test('pathsFromFileList は getPathForFile を1件ずつ呼んで並べる', async () => {
    const drop = await freshDropIntake();
    const list = [{ __path: '/a.png' }, { __path: '/b.png' }];
    const fileList = { length: list.length, 0: list[0], 1: list[1] } as unknown as FileList;

    expect(drop.pathsFromFileList(fileList)).toEqual(['/a.png', '/b.png']);
  });

  test('パス解決に失敗した項目はスキップする（例外を投げない）', async () => {
    const drop = await freshDropIntake();
    const list = [{ __path: '/a.png' }, {}];
    (globalThis as any).window.hologram.getPathForFile = (f: any) => {
      if (!f.__path) throw new Error('no path');
      return f.__path;
    };
    const fileList = { length: list.length, 0: list[0], 1: list[1] } as unknown as FileList;

    expect(drop.pathsFromFileList(fileList)).toEqual(['/a.png']);
  });

  test('空配列は collect すら呼ばない', async () => {
    const drop = await freshDropIntake();
    await drop.handleDroppedPaths([]);
    expect(calls.collect).toHaveLength(0);
  });

  test('確定した件数を確認し、OK で import が呼ばれ完了トーストが出る', async () => {
    const drop = await freshDropIntake();
    const confirm = await import('../app/src/renderer/src/services/confirm');

    await drop.handleDroppedPaths(['/a.png']);
    expect(calls.collect).toEqual([['/a.png']]);

    const model = confirm.get();
    expect(model).not.toBeNull();
    expect(model?.message).toBe('1 件を取り込みますか？（メディア 1 件・その他 0 件）');
    expect(model?.okDestructive).toBe(false);

    await model?.onOk({ skip: false });
    expect(calls.import).toEqual([collectAnswer.files]);
    expect(stub.toasts).toEqual(['1 件インポートしました']);
  });

  test('取り込めるファイルが無ければ確認を出さず案内トースト', async () => {
    collectAnswer = { files: [], mediaCount: 0, otherCount: 0 };
    const drop = await freshDropIntake();
    const confirm = await import('../app/src/renderer/src/services/confirm');

    await drop.handleDroppedPaths(['/empty']);

    expect(confirm.get()).toBeNull();
    expect(calls.import).toHaveLength(0);
    expect(stub.toasts).toEqual(['取り込めるファイルがありませんでした']);
  });

  test('保存先が無ければ確認を出さずエラートースト', async () => {
    collectAnswer = { files: [], mediaCount: 0, otherCount: 0, error: 'no-folder' };
    const drop = await freshDropIntake();
    const confirm = await import('../app/src/renderer/src/services/confirm');

    await drop.handleDroppedPaths(['/whatever']);

    expect(confirm.get()).toBeNull();
    expect(stub.toasts).toEqual(['インポートに失敗しました']);
  });

  test('一部失敗すると内訳つきトースト', async () => {
    importAnswer = { imported: 1, skipped: 2 };
    const drop = await freshDropIntake();
    const confirm = await import('../app/src/renderer/src/services/confirm');

    await drop.handleDroppedPaths(['/a.png']);
    await confirm.get()?.onOk({ skip: false });

    expect(stub.toasts).toEqual(['1 件インポート（2 件は既存のためスキップ）']);
  });
});
