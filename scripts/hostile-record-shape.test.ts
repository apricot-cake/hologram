// Test that pins where the boundary is for trusting the "shape" of records coming from outside (#324).
//
// Failure mode: the renderer reads `tags` as an array and `title` as a string. If even one
// record with a string or object mixed in arrives, it throws mid-render, and since React has a
// single root, the entire tree gets unmounted (the grid, sidebar, inspector, settings, and trash
// all disappear at once). If the offending file stays behind on disk, restarting doesn't fix it
// either, so the real-world damage is large.
//
// The three boundaries under test:
//   1) ZIP import → DB → read (the only entry point left after #302 removed scanning of the save
//      folder) = writePost always runs through normalizePostRecord, so this is already closed.
//      A regression test that pins that fact (fails if someone removes #295's normalization from writePost).
//   2) posts.hashtags on DB read (a JSON string column) = only writePost writes it, so a broken
//      value only comes from a corrupted/foreign DB, but this read covers the entire post list, so
//      a bare JSON.parse would make the whole library unreadable because of a single row's value.
//   3) `.trash/<captureId>.json` = the only place where the renderer receives disk JSON as-is.
//      A hostile complete-format ZIP can place arbitrary JSON here (the zip-slip check only looks
//      at entry names, not the shape of the contents). This is the boundary actually reproduced in this Issue.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, describe, expect, test } from 'vitest';
import { importCompleteZipToDb } from '../app/src/main/lib-archive';
import { openDatabase } from '../app/src/main/lib-db';
import { postsFromDb } from '../app/src/main/lib-db-query';
import { listTrashRecords } from '../app/src/main/lib-trash-capture';

const dirs: string[] = [];
function mkTempDir(prefix: string) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}

let handle: any = null;
afterEach(() => {
  handle?.sqlite.close();
  handle = null;
});

function openDb() {
  handle = openDatabase(path.join(mkTempDir('hologram-hostile-db-'), 'test.db'));
  return handle.sqlite;
}

async function buildZip(entries: Record<string, string>) {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) zip.file(name, content);
  const p = path.join(mkTempDir('hologram-hostile-zip-'), 'fixture.zip');
  fs.writeFileSync(p, Buffer.from(await zip.generateAsync({ type: 'nodebuffer' })));
  return p;
}

// Put one record with a broken shape and one sane record in the same ZIP. The broken one has
// both "a field that should be an array isn't an array" and "a field that should be a string
// is an object".
const HOSTILE_SIDECAR = {
  captureId: 'cap-hostile',
  tags: 'solo', // string (no .map)
  hashtags: { 0: 'a' }, // object
  media: 'not-an-array',
  title: { toString: 'nope' }, // throws if rendered as a React child
  image: 42,
  capturedAt: '2026-01-02T00:00:00Z',
};
const SANE_SIDECAR = {
  captureId: 'cap-sane',
  text: 'ok',
  tags: ['tag-a'],
  hashtags: ['h1'],
  capturedAt: '2026-01-01T00:00:00Z',
};

describe('ZIP インポート → DB → 読み出し', () => {
  test('壊れた形のフィールドは配列/文字列へ正規化され、まともなレコードも一緒に読める', async () => {
    const sqlite = openDb();
    const destFolder = mkTempDir('hologram-hostile-dest-');
    const zipPath = await buildZip({
      'hologram-export.json': JSON.stringify({ version: 1 }),
      'library/cap-hostile.json': JSON.stringify(HOSTILE_SIDECAR),
      'library/cap-sane.json': JSON.stringify(SANE_SIDECAR),
    });
    expect((await importCompleteZipToDb(sqlite, zipPath, destFolder)).ok).toBe(true);

    const posts = await postsFromDb(sqlite);
    expect(posts.map((p) => p.captureId).sort()).toEqual(['cap-hostile', 'cap-sane']); // one broken record doesn't wipe out the others
    const bad = posts.find((p) => p.captureId === 'cap-hostile');
    expect(Array.isArray(bad.tags)).toBe(true);
    expect(Array.isArray(bad.hashtags)).toBe(true);
    expect(Array.isArray(bad.media)).toBe(true);
    expect(typeof bad.title === 'string' || bad.title === null).toBe(true);
    expect(typeof bad.image === 'string' || bad.image === null).toBe(true);
    const good = posts.find((p) => p.captureId === 'cap-sane');
    expect(good.tags).toEqual(['tag-a']);
    expect(good.hashtags).toEqual(['h1']);
  });

  test('要素の型が混ざった tags は文字列だけが残る', async () => {
    const sqlite = openDb();
    const zipPath = await buildZip({
      'hologram-export.json': JSON.stringify({ version: 1 }),
      'library/cap-mixed.json': JSON.stringify({ captureId: 'cap-mixed', tags: ['ok', 7, { name: 'obj' }, null, 'ok2'], capturedAt: '2026-01-01T00:00:00Z' }),
    });
    await importCompleteZipToDb(sqlite, zipPath, mkTempDir('hologram-hostile-dest-'));
    const [post] = await postsFromDb(sqlite);
    expect(post.tags).toEqual(['ok', 'ok2']);
  });
});

describe('DB 読み出し: posts.hashtags カラムが壊れている', () => {
  // When opening a corrupted/foreign DB, a single row's value must not make reading the post list throw.
  // Back when this was a bare JSON.parse, it raised a SyntaxError here and the library showed zero records.
  test('JSON として読めない値でも例外にならず、その1件だけが空になる', async () => {
    const sqlite = openDb();
    const zipPath = await buildZip({
      'hologram-export.json': JSON.stringify({ version: 1 }),
      'library/cap-sane.json': JSON.stringify(SANE_SIDECAR),
      'library/cap-other.json': JSON.stringify({ captureId: 'cap-other', text: 'other', hashtags: ['keep'], capturedAt: '2026-01-03T00:00:00Z' }),
    });
    await importCompleteZipToDb(sqlite, zipPath, mkTempDir('hologram-hostile-dest-'));

    sqlite.prepare('UPDATE posts SET hashtags = ? WHERE captureId = ?').run('not json at all', 'cap-sane');
    const posts = await postsFromDb(sqlite);
    expect(posts.length).toBe(2);
    expect(posts.find((p) => p.captureId === 'cap-sane').hashtags).toEqual([]);
    expect(posts.find((p) => p.captureId === 'cap-other').hashtags).toEqual(['keep']); // its neighbor is untouched
  });

  test('配列でない JSON（オブジェクト）は配列として渡らない', async () => {
    const sqlite = openDb();
    const zipPath = await buildZip({
      'hologram-export.json': JSON.stringify({ version: 1 }),
      'library/cap-sane.json': JSON.stringify(SANE_SIDECAR),
    });
    await importCompleteZipToDb(sqlite, zipPath, mkTempDir('hologram-hostile-dest-'));

    sqlite.prepare('UPDATE posts SET hashtags = ? WHERE captureId = ?').run('{"a":1}', 'cap-sane');
    const [post] = await postsFromDb(sqlite);
    expect(Array.isArray(post.hashtags)).toBe(true);
    expect(post.hashtags).toEqual([]);
  });
});

describe('.trash/ の JSON（レンダラがディスクの形をそのまま受け取る唯一の場所）', () => {
  test('敵対的な完全形式 ZIP は .trash/*.json をそのままディスクへ置ける', async () => {
    const sqlite = openDb();
    const destFolder = mkTempDir('hologram-hostile-dest-');
    const zipPath = await buildZip({
      'hologram-export.json': JSON.stringify({ version: 1 }),
      '.trash/planted.json': JSON.stringify({ captureId: { nope: 1 }, tags: 'solo', title: { deep: 1 }, trashedAt: 5 }),
    });
    await importCompleteZipToDb(sqlite, zipPath, destFolder);
    // Landing on disk at all is by design (trash restore happens on the filesystem side).
    // That's exactly why the read side needs to validate the shape.
    expect(fs.existsSync(path.join(destFolder, '.trash', 'planted.json'))).toBe(true);
  });

  test('listTrashRecords は壊れた形を正規化し、まともなレコードも一緒に返す', async () => {
    const trashDir = mkTempDir('hologram-hostile-trash-');
    fs.writeFileSync(path.join(trashDir, 'planted.json'), JSON.stringify({ captureId: { nope: 1 }, tags: 'solo', hashtags: 3, media: 'x', title: { deep: 1 }, screenName: ['a'], platform: {}, image: { path: '../evil' }, trashedAt: 5 }));
    fs.writeFileSync(path.join(trashDir, 'cap-real.json').toString(), JSON.stringify({ captureId: 'cap-real', title: 'real', image: 'cap-real.jpg', platform: 'x', tags: ['t'], trashedAt: '2026-02-02T00:00:00Z' }));

    const records = await listTrashRecords(trashDir);
    expect(records.length).toBe(2);
    const planted = records.find((r) => r.captureId === 'planted'); // if captureId isn't a string, it falls back to the filename
    expect(planted).toBeTruthy();
    // Fields the renderer draws as strings are string or null; fields it iterates as arrays are arrays.
    for (const key of ['title', 'screenName', 'platform', 'image', 'video', 'trashedAt'] as const) {
      expect(typeof planted?.[key] === 'string' || planted?.[key] === null, `${key} は string|null`).toBe(true);
    }
    expect(Array.isArray(planted?.tags)).toBe(true);
    expect(Array.isArray(planted?.hashtags)).toBe(true);
    expect(Array.isArray(planted?.media)).toBe(true);

    const real = records.find((r) => r.captureId === 'cap-real');
    expect(real?.title).toBe('real');
    expect(real?.tags).toEqual(['t']);
    expect(real?.trashedAt).toBe('2026-02-02T00:00:00Z');
  });

  test('JSON として読めないファイル・オブジェクトでない JSON は飛ばす', async () => {
    const trashDir = mkTempDir('hologram-hostile-trash-');
    fs.writeFileSync(path.join(trashDir, 'broken.json'), '{ not json');
    fs.writeFileSync(path.join(trashDir, 'number.json'), '42');
    fs.writeFileSync(path.join(trashDir, 'array.json'), '["a"]');
    fs.writeFileSync(path.join(trashDir, 'cap-real.json'), JSON.stringify({ captureId: 'cap-real', trashedAt: '2026-02-02T00:00:00Z' }));
    fs.writeFileSync(path.join(trashDir, 'cap-real.jpg'), 'JPEGDATA'); // anything other than .json is out of scope

    const records = await listTrashRecords(trashDir);
    expect(records.map((r) => r.captureId)).toEqual(['cap-real']);
  });

  test('trashedAt の新しい順に並ぶ（値が壊れたものは末尾）', async () => {
    const trashDir = mkTempDir('hologram-hostile-trash-');
    fs.writeFileSync(path.join(trashDir, 'old.json'), JSON.stringify({ captureId: 'old', trashedAt: '2026-01-01T00:00:00Z' }));
    fs.writeFileSync(path.join(trashDir, 'new.json'), JSON.stringify({ captureId: 'new', trashedAt: '2026-03-01T00:00:00Z' }));
    fs.writeFileSync(path.join(trashDir, 'broken-date.json'), JSON.stringify({ captureId: 'broken-date', trashedAt: { when: 'now' } }));

    expect((await listTrashRecords(trashDir)).map((r) => r.captureId)).toEqual(['new', 'old', 'broken-date']);
  });

  test('ゴミ箱フォルダが無ければ空配列', async () => {
    expect(await listTrashRecords(path.join(mkTempDir('hologram-hostile-trash-'), 'missing'))).toEqual([]);
  });
});
