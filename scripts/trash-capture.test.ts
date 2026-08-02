// Unit tests for lib-trash-capture.ts's #236 addition: a collected (assetClass:'file')
// record's own `file` travels into .trash/ and back out exactly like image/video already
// do — ownedFiles() has to find it (it isn't in LIBRARY_MEDIA_EXTS, so only the new
// `record.file` branch picks it up) and rebaseOntoTrash() has to point the trash listing
// at its new .trash/-relative path.

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
    // image/video stay null — a collected item never mixes assetClasses.
    expect(rec?.image).toBeNull();
    expect(rec?.video).toBeNull();
  });
});
