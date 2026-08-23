// app/src/main/lib-archive.ts#importCompleteZipToDb に対する Zip-Slip の退行テスト。
// エントリ名で保存フォルダの外へ出ようとする悪意ある library ZIP を組み立てる＝Windows の
// バックスラッシュ区切り、POSIX の `../`、絶対パス／ドライブレター、許していない入れ子の
// 深さ。
//
// #485 で読み取り側を JSZip から yauzl へ替え、防御が2層になった。層ごとに落ち方が違う:
//
//   1層目 (yauzl.validateFileName)＝バックスラッシュを `/` へ畳んでから、絶対パス・
//     ドライブレターで始まるエントリ・`..` の区間を弾く。エントリを0件にして書庫ごと
//     落とす＝fail-closed であり、1バイトも書かれない。
//   2層目 (lib-archive の isSafeLibraryPath / isSafeTrashPath)＝yauzl が通してしまう
//     名前を止める。`library/C:/Windows/…`（畳んだ後は絶対パスではない）や
//     `library/sub/dir/…` は traversal ではないので、1層目は通す。この層はエントリ単位で
//     skip するので、同じ書庫の中の正当なエントリはいつもどおり取り込まれる。
//
// 層を分けて試すことに意味がある。防ぎを片方落としても、切り分けて見ていなければ緑のまま
// になりうる。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { importCompleteZipToDb, writeCompleteZip } from '../app/src/main/lib-archive';
import { openDatabase } from '../app/src/main/lib-db';
import { createDbWriter } from '../app/src/main/lib-db-write';

// この取り込みに BOM の許容 (BACKLOG L3) を相乗りさせる。他のツールが書いた整理用 JSON の
// エントリには BOM が付いてくる。それを解析できないと、入ってくる側が合流の途中で黙って
// 落ちる。
const BOM = String.fromCharCode(0xfeff);

let root: string;
let seq = 0;
// JSZip はフィクスチャを組み立てる側でだけ使う（読むのは yauzl）。中央ディレクトリへ生の
// 名前をそのまま入れられるので、実際の攻撃と同じ形を作れる。
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
  zip.file('library/avatars/abcd1234.png', Buffer.from('AVATARDATA')); // 共有のアバター置き場（許している下位パス）
  zip.file('library/emoji/eeee5678.png', Buffer.from('EMOJIDATA')); // #290: 共有のカスタム絵文字の置き場（これも許している下位パス）
  zip.file('library/folders.json', BOM + JSON.stringify({ folders: [{ id: 'f1', name: 'X', items: ['cap1'] }] }));
};

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-zipslip-'));
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

// --- 1層目: 名前そのものが不正な書庫は、丸ごと拒否される ------------------------
describe('traversal / 絶対パスを含む書庫は、1バイトも書かずに拒否される', () => {
  const cases: Array<[string, string]> = [
    ['Windows バックスラッシュ traversal', 'library/..\\..\\evil-back.txt'],
    ['POSIX traversal', 'library/../../evil-fwd.txt'],
    ['許可された下位パスを抜けようとする形', 'library/avatars\\..\\evil-av.txt'],
    ['許可された下位パス(emoji)を抜けようとする形', 'library/emoji\\..\\evil-em.txt'],
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

      // fail-closed＝宛先の中にも外にも何も落ちない
      expect(fs.readdirSync(dest)).toEqual([]);
      expect(fs.readdirSync(root).filter((n) => /evil/i.test(n))).toEqual([]);
    });
  }
});

// --- 2層目: yauzl が通す名前は、lib-archive 自身の規則が止める ----------------------
describe('yauzl が通す形は、エントリ単位で skip される', () => {
  let dest: string;
  let handle: any;
  let res: { imported: number; skipped: number };

  beforeAll(async () => {
    dest = path.join(root, 'lib');
    fs.mkdirSync(dest, { recursive: true });
    // 実際のライブラリでは .trash/ は存在する。「たまたま無いので ENOENT で失敗する」に
    // 頼ると、防ぎを外しても緑のままになる＝だから本物の宛先を1つ用意し、
    // isSafeLibraryPath を外せば実際に書き込みが通ってしまう状況を作る。
    fs.mkdirSync(path.join(dest, '.trash'), { recursive: true });
    handle = openDatabase(path.join(root, 'test.db'));
    createDbWriter(handle.sqlite).setFolders({ folders: [{ id: 'pre', name: 'P', kind: 'static', items: [] }] });

    const zipPath = await zipToFile((zip) => {
      legitEntries(zip);
      // どれも yauzl の validateFileName は通る（`..` が無く、畳んだ後も絶対パスの形で
      // 始まっていない）＝ここで止めているのは isSafeLibraryPath だけ。
      zip.file('library/.trash/evil-trash.jpg', 'PWNED-TRASH'); // library/ の名義でゴミ箱へ潜り込む
      zip.file('library/C:\\Windows\\evil-abs.txt', 'PWNED-ABS');
      zip.file('library/avatars/deep/evil-deep.txt', 'PWNED-DEEP');
      zip.file('library/emoji/deep/evil-deep-em.txt', 'PWNED-DEEP-EM'); // #290: emoji/ の下位パスに対する、同じ入れ子の攻撃
      zip.file('library/sub/dir/evil-nested.jpg', 'PWNED-NESTED');
    });
    res = (await importCompleteZipToDb(handle.sqlite, zipPath, dest)) as any;
  });

  afterAll(() => handle.sqlite.close());

  test('正当な capture / avatars / emoji は取り込まれる', () => {
    expect(fs.existsSync(path.join(dest, 'cap1.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'cap2.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'avatars', 'abcd1234.png'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'emoji', 'eeee5678.png'))).toBe(true);
  });

  test('取り込まれたのは正当な4件だけ', () => {
    expect(res.imported).toBe(4);
  });

  test('library/ 名義で .trash/ へ潜り込むエントリは書かれない', () => {
    expect(fs.readdirSync(path.join(dest, '.trash'))).toEqual([]);
  });

  test('宛先の中にも外にも evil は落ちない', () => {
    expect(fs.readdirSync(dest).filter((n) => /evil|sub|Windows/i.test(n))).toEqual([]);
    expect(fs.readdirSync(path.join(dest, 'avatars')).filter((n) => /evil|deep/i.test(n))).toEqual([]);
    expect(fs.readdirSync(path.join(dest, 'emoji')).filter((n) => /evil|deep/i.test(n))).toEqual([]);
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

describe('往復: writeCompleteZip が avatars/ / emoji/ を運び、import が戻す（#290）', () => {
  let dest2: string;
  let handle2: any;
  let res2: { imported: number };

  beforeAll(async () => {
    const srcLib = path.join(root, 'src');
    fs.mkdirSync(path.join(srcLib, 'avatars'), { recursive: true });
    fs.mkdirSync(path.join(srcLib, 'emoji'), { recursive: true });
    fs.mkdirSync(path.join(srcLib, 'items', 'cap10'), { recursive: true });
    fs.writeFileSync(path.join(srcLib, 'cap9.jpg'), 'JPEGDATA9');
    fs.writeFileSync(path.join(srcLib, 'avatars', 'ffff0000.webp'), 'AVDATA');
    fs.writeFileSync(path.join(srcLib, 'emoji', 'eeee9999.png'), 'EMDATA');
    fs.writeFileSync(path.join(srcLib, 'items', 'cap10', 'cap10.jpg'), 'ITEMDATA');

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

  test('capture と avatars/ / emoji/ が復元される', () => {
    expect(fs.existsSync(path.join(dest2, 'cap9.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(dest2, 'avatars', 'ffff0000.webp'))).toBe(true);
    expect(fs.existsSync(path.join(dest2, 'emoji', 'eeee9999.png'))).toBe(true);
    expect(fs.existsSync(path.join(dest2, 'items', 'cap10', 'cap10.jpg'))).toBe(true);
  });

  test('4件とも取り込まれる', () => {
    expect(res2.imported).toBe(4);
  });
});
