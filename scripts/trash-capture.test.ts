// lib-trash-capture.ts の #236 追加分の単体テスト。収蔵ファイル（assetClass:'file'）の
// レコードが持つ `file` は、image/video と同じように .trash/ へ入って戻ってくる。
// ownedFiles() がそれを見つけること（LIBRARY_MEDIA_EXTS に無いので、新しい
// `record.file` の枝だけが拾う）と、rebaseOntoTrash() がゴミ箱の一覧を新しい
// .trash/ 相対のパスへ向けることを見る。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { listTrashRecords, trashCapture } from '../app/src/main/lib-trash-capture';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-trash-capture-'));
const folder = path.join(dir, 'library');
const trashDir = path.join(folder, '.trash');
fs.mkdirSync(folder, { recursive: true });

afterEach(() => {
  for (const f of fs.readdirSync(folder)) fs.rmSync(path.join(folder, f), { recursive: true, force: true });
});

describe('収蔵ファイル（assetClass:file）の trashCapture / listTrashRecords', () => {
  test('posts.file の実体がゴミ箱へ移り、record.file にも残る', async () => {
    const captureId = 'drag-1-0000';
    fs.writeFileSync(path.join(folder, `${captureId}.pdf`), '%PDF-1.4\n%fake');
    const record = {
      captureId,
      assetClass: 'file',
      mediaType: null,
      image: null,
      video: null,
      file: `${captureId}.pdf`,
      media: [],
    };

    await trashCapture({ folder, trashDir, mediaExts: ['jpg', 'png', 'mp4'], captureId, record, flags: null });

    expect(fs.existsSync(path.join(folder, `${captureId}.pdf`))).toBe(false);
    expect(fs.existsSync(path.join(trashDir, `${captureId}.pdf`))).toBe(true);
    const json = JSON.parse(fs.readFileSync(path.join(trashDir, `${captureId}.json`), 'utf8'));
    expect(json.file).toBe(`${captureId}.pdf`);
    expect(json.trashedAt).toBeTruthy();
  });

  test('listTrashRecords は file を .trash/ 相対へ書き換えて返す', async () => {
    const captureId = 'drag-2-0000';
    fs.writeFileSync(path.join(folder, `${captureId}.zip`), 'PKfake');
    const record = { captureId, assetClass: 'file', image: null, video: null, file: `${captureId}.zip`, media: [] };
    await trashCapture({ folder, trashDir, mediaExts: ['jpg', 'png', 'mp4'], captureId, record, flags: null });

    const records = await listTrashRecords(trashDir);
    const rec = records.find((r) => r.captureId === captureId);
    expect(rec).toBeTruthy();
    expect(rec?.file).toBe(`.trash/${captureId}.zip`);
    // image/video は null のまま＝収蔵ファイルが assetClass を混ぜることはない。
    expect(rec?.image).toBeNull();
    expect(rec?.video).toBeNull();
  });
});
