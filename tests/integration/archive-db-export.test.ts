// app/src/main/lib-archive.ts の #300 (St7) の仕事のうち、DB を軸にしたエクスポートの側の
// 単体テスト。writeCompleteZip が作る ZIP の中身を JSZip で読み戻し、投稿のサイドカー、
// 組織レイヤー、tag-parents.json、includeTrash を付けた時の .trash/ の置かれ方を見る。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { openDatabase } from '../../app/src/main/lib-db';
import { hasExportableFiles, prepareCompleteExport, writeCompleteZip, writeImagesZip } from '../../app/src/main/lib-archive';
import { createDbWriter } from '../../app/src/main/lib-db-write';
import { makeTagResolver, preparePostStmts, writePost } from '../../app/src/main/lib-db-record-writer';

const dirs: string[] = [];
function mkTempDir(prefix: string) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}

let handle: any;
let srcFolder: string;
let trashDir: string;
let outPath: string;

beforeEach(() => {
  handle = openDatabase(path.join(mkTempDir('hologram-archive-export-db-'), 'test.db'));
  srcFolder = mkTempDir('hologram-archive-export-lib-');
  trashDir = mkTempDir('hologram-archive-export-trash-');
  outPath = path.join(mkTempDir('hologram-archive-export-out-'), 'export.zip');

  const { sqlite } = handle;
  const stmts = preparePostStmts(sqlite);
  const resolveTagId = makeTagResolver(sqlite);
  writePost(
    stmts,
    resolveTagId,
    {
      captureId: 'cap-1',
      image: 'items/cap-1/cap-1.jpg',
      text: 'hello',
      capturedAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      capturedVia: 'bulk-bookmark',
      tags: ['character:alice'],
      media: [],
      hashtags: [],
    } as any,
    null,
  );
  fs.mkdirSync(path.join(srcFolder, 'items', 'cap-1'), { recursive: true });
  fs.writeFileSync(path.join(srcFolder, 'items', 'cap-1', 'cap-1.jpg'), 'JPEGDATA');

  const dbw = createDbWriter(sqlite);
  dbw.setFolders({ folders: [{ id: 'f1', name: 'Favorites', kind: 'static', items: ['cap-1'] }] });
  dbw.fillTagGroupsByName({ 'character:alice': 'character' }, null);

  const _characterId = resolveTagId('character');
  const _aliceId = resolveTagId('character:alice');
});

afterEach(() => {
  handle.sqlite.close();
});

async function loadZip(p: string) {
  return JSZip.loadAsync(await fs.promises.readFile(p));
}

describe('writeCompleteZip: 投稿サイドカーの再生成', () => {
  test('多数の既存項目の列挙では event loop に制御を戻す', async () => {
    for (let i = 0; i < 200; i++) {
      const dir = path.join(srcFolder, 'items', `orphan-${i}`);
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'media.jpg'), 'image');
    }
    let heartbeat = false;
    const beat = new Promise<void>((resolve) =>
      setImmediate(() => {
        heartbeat = true;
        resolve();
      }),
    );
    const copy = fs.promises.copyFile.bind(fs.promises);
    const hook = vi.spyOn(fs.promises, 'copyFile').mockImplementation(async (...args) => {
      expect(heartbeat).toBe(true);
      return copy(...args);
    });
    let snapshot: Awaited<ReturnType<typeof prepareCompleteExport>> | undefined;
    try {
      snapshot = await prepareCompleteExport(handle.sqlite, srcFolder, trashDir);
      await beat;
    } finally {
      hook.mockRestore();
      await snapshot?.dispose();
    }
  });

  test('新品の空 DB は空、ゴミ箱の採否は content 判定へ反映する', async () => {
    const empty = openDatabase(path.join(mkTempDir('hologram-empty-export-db-'), 'empty.db'));
    const dir = mkTempDir('hologram-empty-export-lib-');
    fs.writeFileSync(path.join(trashDir, 'old.json'), '{}');
    try {
      let snapshot = await prepareCompleteExport(empty.sqlite, dir, trashDir, { includeTrash: false });
      expect(snapshot.hasContent).toBe(false);
      await snapshot.dispose();
      snapshot = await prepareCompleteExport(empty.sqlite, dir, trashDir, { includeTrash: true });
      expect(snapshot.hasContent).toBe(true);
      await snapshot.dispose();
    } finally {
      empty.sqlite.close();
    }
  });
  test('コピー後の編集・削除・新規公開は DB / 整理 / メディア snapshot を変えない', async () => {
    const copy = fs.promises.copyFile.bind(fs.promises);
    const hook = vi.spyOn(fs.promises, 'copyFile').mockImplementation(async (...args) => {
      fs.mkdirSync(path.join(srcFolder, 'items', 'new-native'), { recursive: true });
      fs.writeFileSync(path.join(srcFolder, 'items', 'new-native', 'new.jpg'), 'NEW');
      return copy(...args);
    });
    let snapshot: Awaited<ReturnType<typeof prepareCompleteExport>> | undefined;
    try {
      snapshot = await prepareCompleteExport(handle.sqlite, srcFolder, trashDir);
      hook.mockRestore();
      handle.sqlite.prepare("UPDATE posts SET text='changed', capturedVia='new' WHERE captureId='cap-1'").run();
      createDbWriter(handle.sqlite).setFolders({ folders: [] });
      fs.rmSync(path.join(srcFolder, 'items', 'cap-1'), { recursive: true });
      await snapshot.write(outPath);
      const zip = await loadZip(outPath);
      expect(JSON.parse(await zip.file('library/cap-1.json')!.async('string'))).toMatchObject({ text: 'hello', capturedVia: 'bulk-bookmark', tags: ['character:alice'] });
      expect(JSON.parse(await zip.file('library/folders.json')!.async('string')).folders).toHaveLength(1);
      expect(await zip.file('library/items/cap-1/cap-1.jpg')!.async('string')).toBe('JPEGDATA');
      expect(zip.file('library/items/new-native/new.jpg')).toBeNull();
    } finally {
      hook.mockRestore();
      await snapshot?.dispose();
    }
  });

  test('コピー失敗は私有 staging を掃除し、ZIP を作らない', async () => {
    const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('.hologram-complete-export-'));
    const hook = vi.spyOn(fs.promises, 'copyFile').mockRejectedValue(new Error('copy failed'));
    try {
      await expect(prepareCompleteExport(handle.sqlite, srcFolder, trashDir)).rejects.toThrow('copy failed');
    } finally {
      hook.mockRestore();
    }
    expect(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('.hologram-complete-export-'))).toEqual(before);
    expect(fs.existsSync(outPath)).toBe(false);
  });

  test('DB / WAL / SHM は書庫に含めない', async () => {
    for (const name of ['hologram.db', 'hologram.db-wal', 'hologram.db-shm']) fs.writeFileSync(path.join(srcFolder, name), 'SQL');
    await writeCompleteZip(handle.sqlite, srcFolder, trashDir, outPath);
    const zip = await loadZip(outPath);
    for (const name of ['hologram.db', 'hologram.db-wal', 'hologram.db-shm']) expect(zip.file('library/' + name)).toBeNull();
  });

  test('文字だけ・整理情報だけ・ゴミ箱だけを空と扱わない', async () => {
    fs.rmSync(path.join(srcFolder, 'items'), { recursive: true });
    handle.sqlite.prepare('UPDATE posts SET image=NULL').run();
    let snapshot = await prepareCompleteExport(handle.sqlite, srcFolder, trashDir);
    expect(snapshot.hasContent).toBe(true);
    await snapshot.dispose();
    handle.sqlite.prepare('DELETE FROM posts').run();
    snapshot = await prepareCompleteExport(handle.sqlite, srcFolder, trashDir);
    expect(snapshot.hasContent).toBe(true);
    await snapshot.dispose();
    createDbWriter(handle.sqlite).setFolders({ folders: [] });
    handle.sqlite.prepare('DELETE FROM post_tags').run();
    handle.sqlite.prepare('DELETE FROM tags').run();
    fs.writeFileSync(path.join(trashDir, 'old.json'), '{}');
    snapshot = await prepareCompleteExport(handle.sqlite, srcFolder, trashDir, { includeTrash: true });
    expect(snapshot.hasContent).toBe(true);
    await snapshot.dispose();
  });
  test('DBの投稿が library/<captureId>.json として書かれる（capturedVia込み）', async () => {
    await writeCompleteZip(handle.sqlite, srcFolder, trashDir, outPath, {});
    const zip = await loadZip(outPath);
    const raw = await zip.file('library/cap-1.json')?.async('string');
    const rec = JSON.parse(raw);
    expect(rec.captureId).toBe('cap-1');
    expect(rec.text).toBe('hello');
    expect(rec.capturedVia).toBe('bulk-bookmark');
    expect(rec.tags).toEqual(['character:alice']);
    expect(rec.tagIds).toBeUndefined(); // DB の中でしか使わない並列配列は落とす
  });

  test('投稿画像は項目フォルダーの階層を保ってコピーされる', async () => {
    await writeCompleteZip(handle.sqlite, srcFolder, trashDir, outPath, {});
    const zip = await loadZip(outPath);
    expect(await zip.file('library/items/cap-1/cap-1.jpg')?.async('string')).toBe('JPEGDATA');
  });

  test('項目フォルダーの実体は階層を保ってコピーされる', async () => {
    fs.mkdirSync(path.join(srcFolder, 'items', 'cap-2'), { recursive: true });
    fs.writeFileSync(path.join(srcFolder, 'items', 'cap-2', 'cap-2.jpg'), 'ITEMDATA');
    await writeCompleteZip(handle.sqlite, srcFolder, trashDir, outPath, {});
    const zip = await loadZip(outPath);
    expect(await zip.file('library/items/cap-2/cap-2.jpg')?.async('string')).toBe('ITEMDATA');
  });
});

describe('writeImagesZip: 項目フォルダー', () => {
  test('項目フォルダーの媒体を ZIP 直下へ書き出す', async () => {
    fs.mkdirSync(path.join(srcFolder, 'items', 'cap-images'), { recursive: true });
    fs.writeFileSync(path.join(srcFolder, 'items', 'cap-images', 'cap-images.png'), 'PNGDATA');
    fs.writeFileSync(path.join(srcFolder, 'items', 'cap-images', 'note.pdf'), 'PDFDATA');

    expect(await hasExportableFiles(srcFolder, true)).toBe(true);
    const result = await writeImagesZip(srcFolder, outPath);
    const zip = await loadZip(outPath);

    expect(result.fileCount).toBe(2);
    expect(await zip.file('cap-1.jpg')?.async('string')).toBe('JPEGDATA');
    expect(await zip.file('cap-images.png')?.async('string')).toBe('PNGDATA');
    expect(zip.file('note.pdf')).toBeNull();
  });
});

describe('writeCompleteZip: 組織レイヤーの再生成', () => {
  test('folders.json / tag-groups.json がDBから再生成される', async () => {
    await writeCompleteZip(handle.sqlite, srcFolder, trashDir, outPath, {});
    const zip = await loadZip(outPath);
    const folders = JSON.parse(await zip.file('library/folders.json')?.async('string'));
    expect(folders.folders.map((f: any) => f.id)).toEqual(['f1']);
    // #810: ZIP は名前をキーにしたままにする。タグの id は別のライブラリでは何の意味も持たない。
    const tagGroups = JSON.parse(await zip.file('library/tag-groups.json')?.async('string'));
    expect(tagGroups.memberships['character:alice']).toBe('character');
  });

  test('poster-favorites.json は退役済み機能なのでエクスポートされない', async () => {
    await writeCompleteZip(handle.sqlite, srcFolder, trashDir, outPath, {});
    const zip = await loadZip(outPath);
    expect(zip.file('library/poster-favorites.json')).toBeNull();
  });

  test('tabs.json はタブが無ければ含まれない', async () => {
    await writeCompleteZip(handle.sqlite, srcFolder, trashDir, outPath, {});
    const zip = await loadZip(outPath);
    expect(zip.file('library/tabs.json')).toBeNull();
  });
});

describe('writeCompleteZip: includeTrash', () => {
  test('既定（includeTrash未指定）では .trash/ を同梱しない', async () => {
    fs.writeFileSync(path.join(trashDir, 'cap-2.json'), JSON.stringify({ captureId: 'cap-2' }));
    await writeCompleteZip(handle.sqlite, srcFolder, trashDir, outPath, {});
    const zip = await loadZip(outPath);
    expect(zip.file('.trash/cap-2.json')).toBeNull();
  });

  test('includeTrash:true で .trash/ 配下がプレフィックス付きで同梱される', async () => {
    fs.writeFileSync(path.join(trashDir, 'cap-2.json'), JSON.stringify({ captureId: 'cap-2' }));
    fs.writeFileSync(path.join(trashDir, 'cap-2.jpg'), 'TRASHED');
    await writeCompleteZip(handle.sqlite, srcFolder, trashDir, outPath, { includeTrash: true });
    const zip = await loadZip(outPath);
    expect(await zip.file('.trash/cap-2.json')?.async('string')).toContain('cap-2');
    expect(await zip.file('.trash/cap-2.jpg')?.async('string')).toBe('TRASHED');
    // ゴミ箱の中身は library/ の側へ漏れない
    expect(zip.file('library/cap-2.json')).toBeNull();
  });

  test('項目フォルダーごとのゴミ箱も階層を保つ', async () => {
    fs.mkdirSync(path.join(trashDir, 'cap-3'), { recursive: true });
    fs.writeFileSync(path.join(trashDir, 'cap-3.json'), JSON.stringify({ captureId: 'cap-3' }));
    fs.writeFileSync(path.join(trashDir, 'cap-3', 'cap-3.jpg'), 'TRASH-ITEM');
    await writeCompleteZip(handle.sqlite, srcFolder, trashDir, outPath, { includeTrash: true });
    const zip = await loadZip(outPath);
    expect(await zip.file('.trash/cap-3/cap-3.jpg')?.async('string')).toBe('TRASH-ITEM');
  });

  test('マニフェストの includesTrash がオプション値を反映する', async () => {
    await writeCompleteZip(handle.sqlite, srcFolder, trashDir, outPath, { includeTrash: true });
    const zip = await loadZip(outPath);
    const manifest = JSON.parse(await zip.file('hologram-export.json')?.async('string'));
    expect(manifest.includesTrash).toBe(true);
    expect(manifest.version).toBe(2);
    expect(manifest.source).toBe('db');
  });
});
