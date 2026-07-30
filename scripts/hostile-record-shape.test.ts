// 外から来たレコードの「形」を信じてよい境界がどこかを固定するテスト（#324）。
//
// 落ち方の型＝レンダラは `tags` を配列、`title` を文字列として読む。文字列やオブジェクトが
// 混ざったレコードが1件でも届くと描画の途中で例外になり、React のルートは1本なので
// ツリー全体がアンマウントされる（グリッド・サイドバー・インスペクタ・設定・ゴミ箱が同時に消える）。
// 原因のファイルがディスクに残る経路だと再起動しても直らないので実害が大きい。
//
// 見るのは3つの境界:
//   1) ZIP インポート → DB → 読み出し（#302 で保存フォルダの走査が無くなった後の唯一の入口）
//      ＝ writePost が normalizePostRecord を必ず通すので、ここは既に閉じている。
//        そのことを固定する退行テスト（#295 の正規化を誰かが writePost から外したら落ちる）。
//   2) DB 読み出しの posts.hashtags（JSON 文字列カラム）＝ writePost しか書かないので壊れた値は
//      壊れた/よそのDBだけだが、この読みは投稿一覧の全件なので、素の JSON.parse だと1行の値で
//      ライブラリ全体が読めなくなる。
//   3) `.trash/<captureId>.json` ＝ レンダラがディスクの JSON をそのまま受け取る唯一の場所。
//      敵対的な完全形式 ZIP はここへ任意の JSON を置ける（zip-slip の検査はエントリ名だけで、
//      中身の形は見ていない）。ここが本 Issue で実際に再現した境界。

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

// 1件だけ形が壊れたレコードと、まともなレコードを同じ ZIP に入れる。壊れた側は
// 「配列であるはずのフィールドが配列でない」「文字列であるはずのフィールドがオブジェクト」の
// 両方を持つ。
const HOSTILE_SIDECAR = {
  captureId: 'cap-hostile',
  tags: 'solo', // 文字列（.map が無い）
  hashtags: { 0: 'a' }, // オブジェクト
  media: 'not-an-array',
  title: { toString: 'nope' }, // React の子として描くと例外
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
    expect(posts.map((p) => p.captureId).sort()).toEqual(['cap-hostile', 'cap-sane']); // 1件の破損で他が消えない
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
  // 壊れた/よそのDBを開いた時に、1行の値で投稿一覧の読みが例外にならないこと。
  // 素の JSON.parse だった頃はここで SyntaxError が上がり、ライブラリが1件も出なかった。
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
    expect(posts.find((p) => p.captureId === 'cap-other').hashtags).toEqual(['keep']); // 隣は無傷
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
    // ディスクに落ちること自体は仕様（ゴミ箱はファイルシステム側で復元する）。
    // だからこそ読み出し側が形を検査する必要がある。
    expect(fs.existsSync(path.join(destFolder, '.trash', 'planted.json'))).toBe(true);
  });

  test('listTrashRecords は壊れた形を正規化し、まともなレコードも一緒に返す', async () => {
    const trashDir = mkTempDir('hologram-hostile-trash-');
    fs.writeFileSync(path.join(trashDir, 'planted.json'), JSON.stringify({ captureId: { nope: 1 }, tags: 'solo', hashtags: 3, media: 'x', title: { deep: 1 }, screenName: ['a'], platform: {}, image: { path: '../evil' }, trashedAt: 5 }));
    fs.writeFileSync(path.join(trashDir, 'cap-real.json').toString(), JSON.stringify({ captureId: 'cap-real', title: 'real', image: 'cap-real.jpg', platform: 'x', tags: ['t'], trashedAt: '2026-02-02T00:00:00Z' }));

    const records = await listTrashRecords(trashDir);
    expect(records.length).toBe(2);
    const planted = records.find((r) => r.captureId === 'planted'); // captureId が文字列でなければファイル名で並ぶ
    expect(planted).toBeTruthy();
    // レンダラが文字列として描くフィールドは文字列か null、配列として回すものは配列。
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
    fs.writeFileSync(path.join(trashDir, 'cap-real.jpg'), 'JPEGDATA'); // .json 以外は対象外

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
