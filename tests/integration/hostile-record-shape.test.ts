// 外から来るレコードの「形」をどこまで信じるか、その境界を留めるテスト（#324）。
//
// 壊れ方: レンダラーは `tags` を配列、`title` を文字列として読む。文字列やオブジェクトの
// 混じったレコードが1件でも届くと描画の途中で例外になり、React のルートは1つしかないので
// 木ごと外れる（グリッド・サイドバー・インスペクタ・設定・ゴミ箱が一斉に消える）。その
// ファイルがディスクに残っていれば起動し直しても直らないので、実害は大きい。
//
// 見る境界は3つ。
//   1) ZIP の取り込み → DB → 読み出し（#302 が保存フォルダの走査を外した後に残った唯一の
//      入口）＝writePost は必ず normalizePostRecord を通るので、ここはすでに塞がっている。
//      その事実を留める回帰テスト（誰かが writePost から #295 の正規化を外したら落ちる）。
//   2) DB 読み出し時の posts.hashtags（JSON 文字列のカラム）＝書くのは writePost だけなので、
//      壊れた値は壊れた DB・よそから来た DB からしか来ない。ただしこの読み出しは投稿一覧
//      全体にかかるので、素の JSON.parse だと1行の値のせいでライブラリ全体が読めなくなる。
//   3) `.trash/<captureId>.json` ＝レンダラーがディスクの JSON をそのまま受け取る唯一の場所。
//      敵対的な完全形式の ZIP はここへ任意の JSON を置ける（zip-slip の検査はエントリ名しか
//      見ず、中身の形は見ない）。この Issue で実際に再現した境界がここ。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, describe, expect, test } from 'vitest';
import { importCompleteZipToDb } from '../../app/src/main/lib-archive';
import { openDatabase } from '../../app/src/main/lib-db';
import { postsFromDb } from '../../app/src/main/lib-db-query';
import { listTrashIndexRecords, listTrashRecords } from '../../app/src/main/lib-trash-capture';

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

// 形の壊れたレコードと、まともなレコードを同じ ZIP に入れる。壊れた方は「配列のはずの欄が
// 配列でない」と「文字列のはずの欄がオブジェクト」の両方を持つ。
const HOSTILE_SIDECAR = {
  captureId: 'cap-hostile',
  tags: 'solo', // 文字列（.map が無い）
  hashtags: { 0: 'a' }, // オブジェクト
  media: 'not-an-array',
  title: { toString: 'nope' }, // React の子として描くと例外になる
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
  test('不正な投稿が含まれる ZIP では DB の変更を戻す', async () => {
    const sqlite = openDb();
    const destFolder = mkTempDir('hologram-hostile-dest-');
    const zipPath = await buildZip({
      'hologram-export.json': JSON.stringify({ version: 1 }),
      'library/cap-hostile.json': JSON.stringify(HOSTILE_SIDECAR),
      'library/cap-sane.json': JSON.stringify(SANE_SIDECAR),
    });
    await expect(importCompleteZipToDb(sqlite, zipPath, destFolder)).rejects.toThrow();
    expect(await postsFromDb(sqlite)).toEqual([]);
  });

  test('要素の型が混ざった tags は取り込みを拒否する', async () => {
    const sqlite = openDb();
    const zipPath = await buildZip({
      'hologram-export.json': JSON.stringify({ version: 1 }),
      'library/cap-mixed.json': JSON.stringify({ captureId: 'cap-mixed', tags: ['ok', 7, { name: 'obj' }, null, 'ok2'], capturedAt: '2026-01-01T00:00:00Z' }),
    });
    await expect(importCompleteZipToDb(sqlite, zipPath, mkTempDir('hologram-hostile-dest-'))).rejects.toThrow();
    expect(await postsFromDb(sqlite)).toEqual([]);
  });
});

describe('DB 読み出し: posts.hashtags カラムが壊れている', () => {
  // 壊れた DB・よそから来た DB を開いたとき、1行の値のせいで投稿一覧の読み出しが例外に
  // なってはいけない。素の JSON.parse だった頃はここで SyntaxError が上がり、ライブラリは
  // 0件になった。
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
    expect(posts.find((p) => p.captureId === 'cap-sane')!.hashtags).toEqual([]);
    expect(posts.find((p) => p.captureId === 'cap-other')!.hashtags).toEqual(['keep']); // 隣は手つかず
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

describe('.trash/ の JSON（レンダラーがディスクの形をそのまま受け取る唯一の場所）', () => {
  test('敵対的な完全形式 ZIP は .trash/*.json をそのままディスクへ置ける', async () => {
    const sqlite = openDb();
    const destFolder = mkTempDir('hologram-hostile-dest-');
    const zipPath = await buildZip({
      'hologram-export.json': JSON.stringify({ version: 1 }),
      '.trash/planted.json': JSON.stringify({ captureId: { nope: 1 }, tags: 'solo', title: { deep: 1 }, trashedAt: 5 }),
    });
    await importCompleteZipToDb(sqlite, zipPath, destFolder);
    // ディスクに置かれること自体は意図してそうしている（ゴミ箱からの復元はファイルシステム
    // 側で起きる）。だからこそ読む側で形を検査する必要がある。
    expect(fs.existsSync(path.join(destFolder, '.trash', 'planted.json'))).toBe(true);
  });

  test('listTrashRecords は不正な投稿を除外して正常な投稿を返す', async () => {
    const trashDir = mkTempDir('hologram-hostile-trash-');
    fs.writeFileSync(path.join(trashDir, 'planted.json'), JSON.stringify({ captureId: { nope: 1 }, tags: 'solo', hashtags: 3, media: 'x', title: { deep: 1 }, screenName: ['a'], platform: {}, image: { path: '../evil' }, trashedAt: 5 }));
    fs.writeFileSync(path.join(trashDir, 'cap-real.json').toString(), JSON.stringify({ captureId: 'cap-real', title: 'real', image: 'cap-real.jpg', platform: 'x', tags: ['t'], trashedAt: '2026-02-02T00:00:00Z' }));

    const records = await listTrashRecords(trashDir);
    expect(records.map((r) => r.captureId)).toEqual(['cap-real']);
    const real = records.find((r) => r.captureId === 'cap-real')!;
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

  test('trashedAt の新しい順に並ぶ（値が壊れたものは除外）', async () => {
    const trashDir = mkTempDir('hologram-hostile-trash-');
    fs.writeFileSync(path.join(trashDir, 'old.json'), JSON.stringify({ captureId: 'old', trashedAt: '2026-01-01T00:00:00Z' }));
    fs.writeFileSync(path.join(trashDir, 'new.json'), JSON.stringify({ captureId: 'new', trashedAt: '2026-03-01T00:00:00Z' }));
    fs.writeFileSync(path.join(trashDir, 'broken-date.json'), JSON.stringify({ captureId: 'broken-date', trashedAt: { when: 'now' } }));

    expect((await listTrashRecords(trashDir)).map((r) => r.captureId)).toEqual(['new', 'old']);
  });

  test('ゴミ箱フォルダが無ければ空配列', async () => {
    expect(await listTrashRecords(path.join(mkTempDir('hologram-hostile-trash-'), 'missing'))).toEqual([]);
  });
});

describe('.trash/ の保存済み索引読み出し', () => {
  test('巨大なレコードを読まず、隣の通常レコードから必要な3欄だけを返す', async () => {
    const trashDir = mkTempDir('hologram-hostile-trash-index-');
    fs.writeFileSync(path.join(trashDir, 'huge.json'), JSON.stringify({ captureId: 'huge', url: 'https://x.com/a/status/1', raw: 'x'.repeat(1024 * 1024) }));
    fs.writeFileSync(path.join(trashDir, 'normal.json'), JSON.stringify({ captureId: 'normal', url: 'https://x.com/b/status/2', trashedAt: '2026-02-02T00:00:00Z', media: [{ file: 'normal.jpg' }] }));

    expect(await listTrashIndexRecords(trashDir)).toEqual([{ captureId: 'normal', url: 'https://x.com/b/status/2', trashedAt: '2026-02-02T00:00:00Z' }]);
  });

  test('ファイル名と captureId が違うレコードや必要欄の型が不正なレコードを除外する', async () => {
    const trashDir = mkTempDir('hologram-hostile-trash-index-');
    fs.writeFileSync(path.join(trashDir, 'mismatch.json'), JSON.stringify({ captureId: 'other', url: 'https://x.com/a/status/1' }));
    fs.writeFileSync(path.join(trashDir, 'bad-url.json'), JSON.stringify({ captureId: 'bad-url', url: { hostile: true } }));

    expect(await listTrashIndexRecords(trashDir)).toEqual([]);
  });
});
