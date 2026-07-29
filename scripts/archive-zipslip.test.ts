// app/src/main/lib-archive.ts#importCompleteZipToDb の Zip-Slip 回帰テスト。
// エントリ名で保存フォルダの外へ出ようとする悪意ある library ZIP を作る＝Windows の
// バックスラッシュ区切り・POSIX の `../`・絶対パス／ドライブレター・許可されていない
// 深さの入れ子。
//
// #485 で読み手が JSZip から yauzl に替わり、防御が2層になった。層ごとに結末が違う:
//
//   層1（yauzl.validateFileName）— バックスラッシュを `/` に畳んでから、絶対パス・
//     ドライブレター始まり・`..` セグメントを拒否する。エントリを1件も yield せずに
//     書庫まるごと落ちる＝1バイトも書かれない fail-closed。
//   層2（lib-archive の isSafeLibraryPath / isSafeTrashPath）— yauzl が通す名前を
//     止める。`library/C:/Windows/…`（畳まれた後は絶対パスでない）や
//     `library/sub/dir/…` は traversal ではないので層1は素通りする。こちらは
//     エントリ単位の skip で、同じ書庫の正当なエントリは従来どおり取り込まれる。
//
// 層を分けて見ないと、片方のガードを外しても緑のままになりうる。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { importCompleteZipToDb, writeCompleteZip } from '../app/src/main/lib-archive';
import { openDatabase } from '../app/src/main/lib-db';
import { createDbWriter } from '../app/src/main/lib-db-write';

// BOM 耐性（BACKLOG L3）をこの取り込みに相乗りさせる: 他ツールが書き出した zip の
// org-JSON エントリは BOM 付きで来る。解釈できないと合流で着信側が黙って落ちる。
const BOM = String.fromCharCode(0xfeff);

let root: string;
let seq = 0;
// JSZip は fixture を組む側だけで使う（読むのは yauzl）。中央ディレクトリに生の名前を
// 載せられるので、実際の攻撃と同じ形が作れる。
async function zipToFile(build: (zip: JSZip) => void) {
  const zip = new JSZip();
  build(zip);
  const p = path.join(root, `fixture-${seq++}.zip`);
  fs.writeFileSync(p, Buffer.from(await zip.generateAsync({ type: 'nodebuffer' })));
  return p;
}

const legitEntries = (zip: JSZip) => {
  zip.file('library/cap1.jpg', Buffer.from('JPEGDATA1'));
  zip.file('library/cap2.jpg', Buffer.from('JPEGDATA2'));
  zip.file('library/avatars/abcd1234.png', Buffer.from('AVATARDATA')); // 共有アバターストア（許可された下位パス）
  zip.file('library/folders.json', BOM + JSON.stringify({ folders: [{ id: 'f1', name: 'X', items: ['cap1'] }] }));
};

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-zipslip-'));
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

// --- 層1: 名前そのものが不正な書庫は、まるごと拒否される ------------------------
describe('traversal / 絶対パスを含む書庫は、1バイトも書かずに拒否される', () => {
  const cases: Array<[string, string]> = [
    ['Windows バックスラッシュ traversal', 'library/..\\..\\evil-back.txt'],
    ['POSIX traversal', 'library/../../evil-fwd.txt'],
    ['許可された下位パスを抜けようとする形', 'library/avatars\\..\\evil-av.txt'],
    ['ドライブレター始まり', 'C:\\Windows\\evil-root.txt'],
    ['ルート始まり', '/tmp/evil-slash.txt'],
  ];

  for (const [label, name] of cases) {
    test(`${label} — 拒否され、正当なエントリも1件も書かれない`, async () => {
      const tag = `slip-${seq}`;
      const dest = path.join(root, tag);
      fs.mkdirSync(dest, { recursive: true });
      const handle = openDatabase(path.join(root, `${tag}.db`));
      const zipPath = await zipToFile((zip) => {
        legitEntries(zip);
        zip.file(name, 'PWNED');
      });

      await expect(importCompleteZipToDb(handle.sqlite, zipPath, dest)).rejects.toThrow();
      handle.sqlite.close();

      // fail-closed: 宛先の中にも外にも何も落ちていない
      expect(fs.readdirSync(dest)).toEqual([]);
      expect(fs.readdirSync(root).filter((n) => /evil/i.test(n))).toEqual([]);
    });
  }
});

// --- 層2: yauzl が通す名前を lib-archive 側のルールが止める ----------------------
describe('yauzl が通す形は、エントリ単位で skip される', () => {
  let dest: string;
  let handle: any;
  let res: { imported: number; skipped: number };

  beforeAll(async () => {
    dest = path.join(root, 'lib');
    fs.mkdirSync(dest, { recursive: true });
    // 実ライブラリには .trash/ が実在する。中間フォルダが「たまたま無いから ENOENT で
    // 落ちる」に頼ると、ガードを外しても緑のままになる＝実在する行き先を1つ用意して、
    // isSafeLibraryPath が外れたら本当に書けてしまう状況を作る。
    fs.mkdirSync(path.join(dest, '.trash'), { recursive: true });
    handle = openDatabase(path.join(root, 'test.db'));
    createDbWriter(handle.sqlite).setFolders({ folders: [{ id: 'pre', name: 'P', kind: 'static', items: [] }] });

    const zipPath = await zipToFile((zip) => {
      legitEntries(zip);
      // どれも yauzl の validateFileName は通る（畳んだ後に `..` も先頭の絶対形も
      // 無い）＝ここで止めているのは isSafeLibraryPath だけ。
      zip.file('library/.trash/evil-trash.jpg', 'PWNED-TRASH'); // library/ の名前でゴミ箱へ潜り込む
      zip.file('library/C:\\Windows\\evil-abs.txt', 'PWNED-ABS');
      zip.file('library/avatars/deep/evil-deep.txt', 'PWNED-DEEP');
      zip.file('library/sub/dir/evil-nested.jpg', 'PWNED-NESTED');
    });
    res = (await importCompleteZipToDb(handle.sqlite, zipPath, dest)) as any;
  });

  afterAll(() => handle.sqlite.close());

  test('正当な capture / avatars は取り込まれる', () => {
    expect(fs.existsSync(path.join(dest, 'cap1.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'cap2.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'avatars', 'abcd1234.png'))).toBe(true);
  });

  test('取り込まれたのは正当な3件だけ', () => {
    expect(res.imported).toBe(3);
  });

  test('library/ 名義で .trash/ へ潜り込むエントリは書かれない', () => {
    expect(fs.readdirSync(path.join(dest, '.trash'))).toEqual([]);
  });

  test('宛先の中にも外にも evil は落ちない', () => {
    expect(fs.readdirSync(dest).filter((n) => /evil|sub|Windows/i.test(n))).toEqual([]);
    expect(fs.readdirSync(path.join(dest, 'avatars')).filter((n) => /evil|deep/i.test(n))).toEqual([]);
    expect(fs.readdirSync(root).filter((n) => /evil/i.test(n))).toEqual([]);
  });

  test('folders.json が合流する（zip 側の BOM を許容）', () => {
    expect(
      createDbWriter(handle.sqlite)
        .getFolders()
        .folders.map((c: any) => c.id)
        .sort(),
    ).toEqual(['f1', 'pre']);
  });
});

describe('往復: writeCompleteZip が avatars/ を運び、import が戻す', () => {
  let dest2: string;
  let handle2: any;
  let res2: { imported: number };

  beforeAll(async () => {
    const srcLib = path.join(root, 'src');
    fs.mkdirSync(path.join(srcLib, 'avatars'), { recursive: true });
    fs.writeFileSync(path.join(srcLib, 'cap9.jpg'), 'JPEGDATA9');
    fs.writeFileSync(path.join(srcLib, 'avatars', 'ffff0000.webp'), 'AVDATA');

    const srcHandle = openDatabase(path.join(root, 'src.db'));
    const out = path.join(root, 'roundtrip.zip');
    await writeCompleteZip(srcHandle.sqlite, srcLib, null, out, {});
    srcHandle.sqlite.close();

    dest2 = path.join(root, 'lib2');
    fs.mkdirSync(dest2, { recursive: true });
    handle2 = openDatabase(path.join(root, 'test2.db'));
    res2 = (await importCompleteZipToDb(handle2.sqlite, out, dest2)) as any;
  });

  afterAll(() => handle2.sqlite.close());

  test('capture と avatars/ が復元される', () => {
    expect(fs.existsSync(path.join(dest2, 'cap9.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(dest2, 'avatars', 'ffff0000.webp'))).toBe(true);
  });

  test('2件とも取り込まれる', () => {
    expect(res2.imported).toBe(2);
  });
});
