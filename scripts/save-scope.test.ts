import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { openDatabase } from '../app/src/main/lib-db.ts';
import { drainInbox } from '../app/src/main/lib-db-inbox.ts';
import { postsByIds } from '../app/src/main/lib-db-query.ts';
import { buildSavedIndex } from '../app/src/main/lib-saved-index.ts';
import { trashCapture, listTrashRecords } from '../app/src/main/lib-trash-capture.ts';
import { writeCompleteZip, importCompleteZipToDb } from '../app/src/main/lib-archive.ts';
import { makeGroupRecords, stampPost } from '../app/src/renderer/src/services/records.ts';
import { normalizePostRecord } from '../native-host/post-record.mts';
import { buildEnvelope, writeInboxEvent } from '../native-host/inbox.mts';
import { itemDirectoryAbsolute, itemFileRelative } from '../native-host/item-storage.mts';
import { postKeyOf } from '../native-host/post-key.mts';
import { readSavedPictures, postSavedState } from '../extension/utils/overlay/saved-state.ts';

const roots: string[] = [];
const handles: ReturnType<typeof openDatabase>[] = [];
function library() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-save-scope-'));
  roots.push(folder);
  const handle = openDatabase(path.join(folder, 'test.db'));
  handles.push(handle);
  return { folder, sqlite: handle.sqlite };
}
afterEach(() => {
  for (const handle of handles.splice(0)) handle.sqlite.close();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
const url = 'https://x.com/u/status/99123';
const photo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z9QAAAABJRU5ErkJggg==', 'base64');
async function capture(folder: string, captureId: string, saveScope: 'post' | 'media', images: number[]) {
  fs.mkdirSync(itemDirectoryAbsolute(folder, captureId), { recursive: true });
  const media = images.map((image, seq) => {
    const file = itemFileRelative(captureId, `${captureId}-media-${seq}.png`);
    fs.writeFileSync(path.join(folder, file), Buffer.concat([photo, Buffer.from([image])]));
    return { url: `https://pbs.twimg.com/media/image${image}.png`, file };
  });
  const record = normalizePostRecord({ captureId, url, saveScope, media, imageCount: 2 });
  await writeInboxEvent(folder, buildEnvelope(record));
  return record;
}

test('個別保存した後の一括保存は画像ファイルも別のカードになり、削除と復元が独立する', async () => {
  const { folder, sqlite } = library();
  const individual = await capture(folder, '1700000000001-aa', 'media', [1]);
  expect(drainInbox(folder, sqlite).applied).toEqual([individual.captureId]);
  const key = postKeyOf(url)!;
  expect(buildSavedIndex(sqlite).entries[key]).toMatchObject({ post: false, individualMedia: [individual.media[0].url] });
  const whole = await capture(folder, '1700000000002-aa', 'post', [0, 1]);
  expect(drainInbox(folder, sqlite).applied).toEqual([whole.captureId]);
  const posts = (await postsByIds(sqlite, [individual.captureId, whole.captureId])).map((post) => stampPost(post));
  const groups = makeGroupRecords({ manualGroups: () => [], ungrouped: () => new Set() })(posts);
  expect(groups).toHaveLength(2);
  expect(groups.map((group) => group.rep.media.length).sort()).toEqual([1, 2]);
  const first = path.join(folder, individual.media[0].file);
  const second = path.join(folder, whole.media[1].file);
  expect(fs.statSync(first).ino).not.toBe(fs.statSync(second).ino);
  expect(fs.statSync(first).nlink).toBe(1);
  expect(buildSavedIndex(sqlite).entries[key]).toMatchObject({ post: true, individualMedia: [individual.media[0].url] });

  const trashDir = path.join(folder, '.trash');
  await trashCapture({ folder, trashDir, captureId: individual.captureId, record: individual, mediaExts: ['png'] });
  sqlite.prepare('DELETE FROM posts WHERE captureId = ?').run(individual.captureId);
  expect(fs.readFileSync(second)).toEqual(Buffer.concat([photo, Buffer.from([1])]));
  const [trashed] = await listTrashRecords(trashDir);
  expect(trashed.saveScope).toBe('media');
  expect(fs.statSync(path.join(folder, trashed.media[0].file)).ino).not.toBe(fs.statSync(second).ino);
  fs.renameSync(path.join(trashDir, individual.captureId), itemDirectoryAbsolute(folder, individual.captureId));
  expect(fs.statSync(first).ino).not.toBe(fs.statSync(second).ino);
  fs.rmSync(itemDirectoryAbsolute(folder, whole.captureId), { recursive: true });
  expect(fs.readFileSync(first)).toEqual(Buffer.concat([photo, Buffer.from([1])]));
  expect(fs.statSync(first).nlink).toBe(1);
});

test('完全ZIPの取り込みでも保存の種類と各カードの画像を復元する', async () => {
  const source = library();
  const a = await capture(source.folder, '1700000000003-aa', 'media', [1]);
  const b = await capture(source.folder, '1700000000004-aa', 'post', [0, 1]);
  drainInbox(source.folder, source.sqlite);
  const zip = path.join(source.folder, 'backup.zip');
  await writeCompleteZip(source.sqlite, source.folder, null, zip);
  const dest = library();
  expect((await importCompleteZipToDb(dest.sqlite, zip, dest.folder)).ok).toBe(true);
  expect((await postsByIds(dest.sqlite, [a.captureId, b.captureId])).map((record) => record.saveScope).sort()).toEqual(['media', 'post']);
  expect(fs.readFileSync(path.join(dest.folder, a.media[0].file))).toEqual(fs.readFileSync(path.join(dest.folder, b.media[1].file)));
  expect(fs.statSync(path.join(dest.folder, a.media[0].file)).ino).not.toBe(fs.statSync(path.join(dest.folder, b.media[1].file)).ino);
});

test('全画像を個別に保存しても投稿全体の保存済みとは扱わない', () => {
  const saved = readSavedPictures({ id: 'one', post: false, media: ['a', 'b'], total: 2 }, null);
  expect(postSavedState({ url, saved, anchors: new Map() })).toBe('partial');
});
