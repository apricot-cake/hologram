// 投稿の所有ファイルを .trash/ へ移し、一覧用の参照を .trash/ 相対へ
// 張り替える処理の単体テスト。

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

describe('trashCapture / listTrashRecords', () => {
  test('現在の項目フォルダーは、投稿が所有する全ファイルをまとめてゴミ箱へ移す', async () => {
    const captureId = '1700000000000-aa01';
    const itemDir = path.join(folder, 'items', captureId);
    fs.mkdirSync(itemDir, { recursive: true });
    for (const file of [`${captureId}.jpg`, `${captureId}-media-0.png`, `${captureId}-linkcard.webp`]) fs.writeFileSync(path.join(itemDir, file), file);
    const record = {
      captureId,
      image: `items/${captureId}/${captureId}.jpg`,
      media: [{ file: `items/${captureId}/${captureId}-media-0.png` }],
      linkCard: { url: 'https://example.com', thumbnailFile: `items/${captureId}/${captureId}-linkcard.webp` },
    };

    await trashCapture({ folder, trashDir, mediaExts: ['jpg', 'png', 'webp'], captureId, record, flags: null });

    expect(fs.existsSync(itemDir)).toBe(false);
    expect(fs.readdirSync(path.join(trashDir, captureId)).sort()).toEqual([`${captureId}-linkcard.webp`, `${captureId}-media-0.png`, `${captureId}.jpg`].sort());
    const [listed] = await listTrashRecords(trashDir);
    expect(listed.image).toBe(`.trash/${captureId}/${captureId}.jpg`);
    expect(listed.media[0].file).toBe(`.trash/${captureId}/${captureId}-media-0.png`);
    expect(listed.linkCard?.thumbnailFile).toBe(`.trash/${captureId}/${captureId}-linkcard.webp`);
  });
});
