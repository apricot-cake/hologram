// ウィンドウへのドロップによる取り込み (#234)＝OS からローカルのファイルやフォルダを
// アプリのウィンドウへドラッグする経路。層は3つで、モジュール側のコメントと同じ分け方:
//   1. lib-drop-import.ts の collectDroppedPaths＝純粋な fs の走査。electron を使わない。
//   2. ipc-transfer.ts の collect-dropped-paths / import-dropped-paths のハンドラ＝
//      2往復の取り決め（先に数え、確認が取れてから初めて書く）。
//   3. services/drop-intake.ts の handleDroppedPaths＝レンダラー側の
//      collect → confirm → import → 報告の配線。
//
// ここで見る受け入れ条件: 単一ファイル・複数ファイル・フォルダ（再帰）・ファイルと
// フォルダの混在が、どれも合算した1つの件数として確認に出ること。隠しファイルと
// Thumbs.db/desktop.ini/.DS_Store と画像・動画以外は入らないこと。シンボリックリンクや
// ジャンクションを辿らないこと。レンダラーの確認が通るより前には何も書かないこと。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { IpcContext } from '../../app/src/main/ipc-context';

type Handler = (event: unknown, ...args: any[]) => any;

const stub = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: any[]) => any>(),
  toasts: [] as string[],
  createFromPath: vi.fn(() => ({ isEmpty: () => true })),
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
  clipboard: { read: async () => [] },
  nativeImage: { createFromPath: stub.createFromPath },
  app: { getVersion: () => '0.0.0-test' },
}));

vi.mock('sonner', () => ({
  toast: Object.assign(
    (msg: string) => {
      stub.toasts.push(String(msg));
    },
    { loading: () => {}, dismiss: () => {} },
  ),
}));

import { collectDroppedPaths } from '../../app/src/main/lib-drop-import';
import { openDatabase } from '../../app/src/main/lib-db';
import { register as registerTransferIpc } from '../../app/src/main/ipc-transfer';

// --- 1. lib-drop-import.ts: 純粋な再帰の走査 -----------------------------------
describe('main: collectDroppedPaths（再帰の走査・electron 非依存）', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-drop-'));

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    stub.createFromPath.mockClear();
  });

  function pngHeader(width: number, height: number): Buffer {
    const header = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header);
    header.writeUInt32BE(13, 8);
    header.write('IHDR', 12, 'ascii');
    header.writeUInt32BE(width, 16);
    header.writeUInt32BE(height, 20);
    return header;
  }

  test('単一ファイルは1件・メディア判定される', async () => {
    const dir = fs.mkdtempSync(path.join(root, 'single-'));
    fs.writeFileSync(path.join(dir, 'a.png'), 'x');

    const res = await collectDroppedPaths([path.join(dir, 'a.png')]);

    expect(res.files.map((f) => f.ext)).toEqual(['png']);
    expect(res.mediaCount).toBe(1);
  });

  test('画像・動画以外を除外して件数を数える', async () => {
    const dir = fs.mkdtempSync(path.join(root, 'multi-'));
    fs.writeFileSync(path.join(dir, 'a.png'), 'x');
    fs.writeFileSync(path.join(dir, 'b.jpg'), 'x');
    fs.writeFileSync(path.join(dir, 'c.pdf'), 'x');

    const res = await collectDroppedPaths([path.join(dir, 'a.png'), path.join(dir, 'b.jpg'), path.join(dir, 'c.pdf')]);

    expect(res.files).toHaveLength(2);
    expect(res.files.map((f) => f.ext).sort()).toEqual(['jpg', 'png']);
    expect(res.mediaCount).toBe(2);
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
    expect(res.hasFolder).toBe(true);
    expect(new Set(res.files.map((f) => f.folderGroup))).toEqual(new Set([0, 1]));
    expect(res.groups).toEqual([
      { id: 0, name: path.basename(dir), mediaCount: 1, rootName: path.basename(dir), isRoot: true },
      { id: 1, name: 'sub', mediaCount: 2, rootName: path.basename(dir) },
    ]);
    expect(res.files.find((file) => path.basename(file.path) === 'top.png')).toMatchObject({ folderRoot: 0, folderRootTitle: path.basename(dir), folderIsRoot: true });
    expect(res.files.find((file) => path.basename(file.path) === 'mid.jpg')).toMatchObject({ folderRoot: 0, folderRootTitle: path.basename(dir) });
  });

  test('確認前のプレビューでは巨大画像を nativeImage で復号しない', async () => {
    const dir = fs.mkdtempSync(path.join(root, 'large-preview-'));
    const large = path.join(dir, 'large.png');
    fs.writeFileSync(large, pngHeader(8192, 8192));

    const res = await collectDroppedPaths([dir]);

    expect(res.mediaCount).toBe(1);
    expect(res.groups[0]).not.toHaveProperty('previewDataUrl');
    expect(stub.createFromPath).not.toHaveBeenCalled();
  });

  test('上限内の画像は従来どおり確認用プレビューを生成する', async () => {
    const dir = fs.mkdtempSync(path.join(root, 'safe-preview-'));
    const safe = path.join(dir, 'safe.png');
    fs.writeFileSync(safe, pngHeader(1920, 1080));

    await collectDroppedPaths([dir]);

    expect(stub.createFromPath).toHaveBeenCalledWith(safe);
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
    // 'junction' は（ファイルのシンボリックリンクと違い）Windows で昇格なしに作れる＝
    // #234 の設計が名指ししているのがまさにこのケース（ループと脱出の防止）。
    fs.symlinkSync(elsewhere, path.join(dir, 'linked'), 'junction');

    const res = await collectDroppedPaths([dir]);

    expect(res.files.map((f) => path.basename(f.path))).toEqual(['real.png']);
  });

  test('存在しないパスは静かに無視される（ドロップ後に消えた等）', async () => {
    const res = await collectDroppedPaths([path.join(root, 'does-not-exist')]);
    expect(res.files).toHaveLength(0);
  });

  test('走査上限を超えるフォルダは部分的な一覧を返さない', async () => {
    const dir = fs.mkdtempSync(path.join(root, 'limited-'));
    for (let i = 0; i < 4; i++) fs.writeFileSync(path.join(dir, `${i}.png`), 'x');

    const res = await collectDroppedPaths([dir], { maxEntries: 3 });

    expect(res).toEqual({ files: [], mediaCount: 0, groups: [], error: 'scan-limit' });
  });
});

// --- 2. ipc-transfer.ts: 2つの IPC ハンドラ ---------------------------------------
describe('main: collect-dropped-paths / import-dropped-paths（IPC）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-drop-ipc-'));
  const folder = path.join(dir, 'library');
  fs.mkdirSync(folder, { recursive: true });
  const { sqlite } = openDatabase(path.join(dir, 'test.db'));

  let saveFolder: string | null = folder;
  let libraryMissing = false;
  const notePostsSaved = vi.fn();

  const ctx = {
    getSaveFolder: () => saveFolder,
    getTrashDir: () => null,
    getLibraryStatus: () => ({ missing: libraryMissing, path: saveFolder }),
    ensurePostsSynced: () => (saveFolder ? { db: null, sqlite } : null),
    send: () => {},
    notePostsSaved,
    getWin: () => null,
  } as unknown as IpcContext;

  registerTransferIpc(ctx);

  const collect = (paths: string[]) => stub.handlers.get('collect-dropped-paths')?.(trustedIpcEvent(), paths);
  const doImport = (files: { path: string; ext: string; folderGroup?: number; folderTitle?: string; folderRoot?: number; folderRootTitle?: string; folderIsRoot?: boolean }[], stackFolders = false) => stub.handlers.get('import-dropped-paths')?.(trustedIpcEvent(), files, stackFolders);
  const rows = () => sqlite.prepare('SELECT captureId, source, url, title, image, video, mediaType FROM posts').all() as any[];

  function reset() {
    saveFolder = folder;
    libraryMissing = false;
    notePostsSaved.mockClear();
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

    expect(res).toMatchObject({ mediaCount: 1, groups: [{ id: 0, name: path.basename(src), mediaCount: 1, rootName: path.basename(src), isRoot: true }] });
    expect(res.files).toHaveLength(1);
    expect(rows()).toHaveLength(0);
    expect(fs.readdirSync(folder)).toHaveLength(0);
  });

  test('collect → import で1件ずつ増え、source/idPrefix は drag を踏襲する', async () => {
    const src = fs.mkdtempSync(path.join(dir, 'drop-src-'));
    fs.writeFileSync(path.join(src, 'photo.png'), 'x');
    fs.writeFileSync(path.join(src, 'clip.mp4'), 'x');

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
    expect(all.find((r) => r.image)?.image).toMatch(/\.png$/);
    expect(all.find((r) => r.video)?.video).toMatch(/\.mp4$/);
    expect(fs.readdirSync(path.join(folder, 'items'))).toHaveLength(2);
  });

  test('サブフォルダをグループ化する選択では、同じフォルダの2件以上だけを手動グループへ入れる', async () => {
    const src = fs.mkdtempSync(path.join(dir, 'drop-stack-'));
    const a = path.join(src, 'a.png');
    const b = path.join(src, 'b.png');
    fs.writeFileSync(a, 'a');
    fs.writeFileSync(b, 'b');

    await doImport(
      [
        { path: a, ext: 'png', folderGroup: 0, folderTitle: '作品 A' },
        { path: b, ext: 'png', folderGroup: 0, folderTitle: '作品 A' },
      ],
      true,
    );

    const groups = sqlite.prepare('SELECT groupId, postId FROM manual_group_items ORDER BY groupId, seq').all() as Array<{ groupId: number; postId: string }>;
    expect(groups).toHaveLength(2);
    expect(new Set(groups.map((item) => item.groupId)).size).toBe(1);
    expect(rows().map((row) => row.title)).toEqual(['作品 A', '作品 A']);
  });

  test('「いいえ」＝import を呼ばない想定どおり、collect だけでは何も残らない', async () => {
    const src = fs.mkdtempSync(path.join(dir, 'drop-src-'));
    fs.writeFileSync(path.join(src, 'a.png'), 'x');
    await collect([src]);
    // 利用者が「いいえ」と答えたとき、レンダラーは import-dropped-paths を呼ばない＝
    // ここではその呼び出しを再現していない。だから見ているのは、collect だけでライブラリが
    // 手つかずのままであること（上で既に覆っている）と、空の files 配列（何もしない呼び出し側が
    // 送りうる形）もまた安全に何もしないこと。
    expect(await doImport([])).toEqual({ imported: 0, skipped: 0 });
    expect(rows()).toHaveLength(0);
  });

  test('保存先が無ければ collect も import も書かずに no-folder', async () => {
    saveFolder = null;
    expect(await collect(['/whatever'])).toEqual({ files: [], mediaCount: 0, groups: [], error: 'no-folder' });
    expect(await doImport([{ path: '/whatever', ext: 'png' }])).toEqual({ imported: 0, skipped: 0, error: 'no-folder' });
  });

  test('ライブラリが missing なら collect も import も library-missing', async () => {
    libraryMissing = true;
    expect(await collect(['/whatever'])).toEqual({ files: [], mediaCount: 0, groups: [], error: 'library-missing' });
    expect(await doImport([{ path: '/whatever', ext: 'png' }])).toEqual({ imported: 0, skipped: 0, error: 'library-missing' });
  });

  test('ドロップ後にファイルが消えていても例外を投げず skipped で数える', async () => {
    const res = await doImport([{ path: path.join(dir, 'vanished.png'), ext: 'png' }]);
    expect(res).toEqual({ imported: 0, skipped: 1 });
    expect(rows()).toHaveLength(0);
  });

  test('レンダラーから対象外の拡張子を直接渡しても取り込まない', async () => {
    const src = path.join(dir, 'direct.pdf');
    fs.writeFileSync(src, '%PDF-1.4');

    expect(await doImport([{ path: src, ext: 'pdf' }])).toEqual({ imported: 0, skipped: 1 });
    expect(rows()).toHaveLength(0);
    expect(fs.readdirSync(folder)).toHaveLength(0);
  });
});

// --- 3. services/drop-intake.ts: レンダラー側の collect→confirm→import の流れ ------
describe('renderer: handleDroppedPaths（collect→confirm→import）', () => {
  let calls: { collect: string[][]; import: any[][] };
  let collectAnswer: any;
  let importAnswer: any;

  beforeEach(async () => {
    calls = { collect: [], import: [] };
    collectAnswer = { files: [{ path: '/a.png', ext: 'png' }], mediaCount: 1 };
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

  type DropIntakeModule = typeof import('../../app/src/renderer/src/services/drop-intake');
  const freshDropIntake = async (): Promise<DropIntakeModule> => {
    const i18n = await import('../../app/src/renderer/src/_shared/i18n');
    await i18n.initI18n();
    return import('../../app/src/renderer/src/services/drop-intake');
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

  test('走査中は確認ダイアログを先に開き、キャンセル後は結果を反映しない', async () => {
    let resolveCollect: ((value: any) => void) | undefined;
    collectAnswer = new Promise((resolve) => {
      resolveCollect = resolve;
    });
    const drop = await freshDropIntake();
    const confirm = await import('../../app/src/renderer/src/services/confirm');

    const pending = drop.handleDroppedPaths(['/folder']);
    await Promise.resolve();
    expect(confirm.get()).toMatchObject({ loading: true, message: '取り込み内容を確認しています…' });

    confirm.close();
    resolveCollect?.({ files: [{ path: '/a.png', ext: 'png' }], mediaCount: 1 });
    await pending;
    expect(calls.import).toHaveLength(0);
  });

  test('1件なら確認せずに import し、完了トーストを出す', async () => {
    const drop = await freshDropIntake();
    const confirm = await import('../../app/src/renderer/src/services/confirm');

    await drop.handleDroppedPaths(['/a.png']);
    expect(calls.collect).toEqual([['/a.png']]);
    expect(confirm.get()).toBeNull();
    expect(calls.import).toEqual([collectAnswer.files]);
    expect(stub.toasts).toEqual(['1 件インポートしました']);
  });

  test.each(['success', 'empty', 'scan-limit', 'failure'] as const)('キャンセルした走査の%sが次の確認を変更しない', async (outcome) => {
    let resolveFirst!: (value: any) => void;
    let rejectFirst!: (reason: Error) => void;
    let resolveSecond!: (value: any) => void;
    const firstAnswer = new Promise((resolve, reject) => {
      resolveFirst = resolve;
      rejectFirst = reject;
    });
    const secondAnswer = new Promise((resolve) => {
      resolveSecond = resolve;
    });
    const answers = [firstAnswer, secondAnswer];
    (globalThis as any).window.hologram.collectDroppedPaths = async () => answers.shift();
    const drop = await freshDropIntake();
    const confirm = await import('../../app/src/renderer/src/services/confirm');

    const first = drop.handleDroppedPaths(['/first']);
    confirm.close();
    const second = drop.handleDroppedPaths(['/second']);
    const secondModel = confirm.get();
    if (outcome === 'failure') rejectFirst(new Error('scan failed'));
    else if (outcome === 'scan-limit') resolveFirst({ files: [], mediaCount: 0, groups: [], error: 'scan-limit' });
    else if (outcome === 'empty') resolveFirst({ files: [], mediaCount: 0, groups: [] });
    else resolveFirst({ files: [{ path: '/first.png', ext: 'png' }], mediaCount: 1, groups: [] });
    await first;
    expect(confirm.get()).toBe(secondModel);
    expect(confirm.get()).toMatchObject({ loading: true });
    expect(calls.import).toEqual([]);
    expect(stub.toasts).toEqual([]);

    const secondFiles = [
      { path: '/second-a.png', ext: 'png' },
      { path: '/second-b.png', ext: 'png' },
    ];
    resolveSecond({ files: secondFiles, mediaCount: 2, groups: [] });
    await second;
    expect(confirm.get()).toMatchObject({ openId: secondModel?.openId, loading: false, message: '2 件の画像・動画を取り込みますか？' });
    confirm.get()?.onOk({ skip: false });
    await vi.waitFor(() => expect(calls.import).toEqual([secondFiles]));
  });

  test('2件以上なら確定した件数を確認し、OK で import が呼ばれる', async () => {
    collectAnswer = {
      files: [
        { path: '/a.png', ext: 'png' },
        { path: '/b.png', ext: 'png' },
      ],
      mediaCount: 2,
    };
    importAnswer = { imported: 2, skipped: 0 };
    const drop = await freshDropIntake();
    const confirm = await import('../../app/src/renderer/src/services/confirm');

    await drop.handleDroppedPaths(['/a.png', '/b.png']);
    expect(calls.collect).toEqual([['/a.png', '/b.png']]);

    const model = confirm.get();
    expect(model).not.toBeNull();
    expect(model?.message).toBe('2 件の画像・動画を取り込みますか？');
    expect(model?.okDestructive).toBe(false);

    await model?.onOk({ skip: false });
    expect(calls.import).toEqual([collectAnswer.files]);
    await vi.waitFor(() => expect(stub.toasts).toEqual(['2 件インポートしました']));
  });

  test('取り込めるファイルが無ければ確認を出さず案内トースト', async () => {
    collectAnswer = { files: [], mediaCount: 0, groups: [] };
    const drop = await freshDropIntake();
    const confirm = await import('../../app/src/renderer/src/services/confirm');

    await drop.handleDroppedPaths(['/empty']);

    expect(confirm.get()).toBeNull();
    expect(calls.import).toHaveLength(0);
    expect(stub.toasts).toEqual(['取り込めるファイルがありませんでした']);
  });

  test('保存先が無ければ確認を出さずエラートースト', async () => {
    collectAnswer = { files: [], mediaCount: 0, groups: [], error: 'no-folder' };
    const drop = await freshDropIntake();
    const confirm = await import('../../app/src/renderer/src/services/confirm');

    await drop.handleDroppedPaths(['/whatever']);

    expect(confirm.get()).toBeNull();
    expect(stub.toasts).toEqual(['インポートに失敗しました']);
  });

  test('一部失敗すると内訳つきトースト', async () => {
    importAnswer = { imported: 1, skipped: 2 };
    const drop = await freshDropIntake();
    const confirm = await import('../../app/src/renderer/src/services/confirm');

    await drop.handleDroppedPaths(['/a.png']);
    await confirm.get()?.onOk({ skip: false });

    expect(stub.toasts).toEqual(['1 件インポート（2 件は既存のためスキップ）']);
  });
});
import { trustedIpcEvent } from '../helpers/test-ipc-event';
