// app/src/main/lib-archive.ts#importCompleteZipToDb の Zip-Slip 回帰テスト。
// エントリ名で保存フォルダの外へ出ようとする悪意ある library ZIP を作る＝(a) Windows の
// バックスラッシュ区切り (b) POSIX の `../` (c) 絶対パス／ドライブレター。正当な capture と
// folders.json も同梱し、「宛先の外に何も書かれない」「宛先の中にも evil が落ちない」
// 「正当なエントリは従来どおり取り込まれ合流する」を見る。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildCompleteZip, importCompleteZipToDb } from '../app/src/main/lib-archive';
import { openDatabase } from '../app/src/main/lib-db';
import { createDbWriter } from '../app/src/main/lib-db-write';

// BOM 耐性（BACKLOG L3）をこの取り込みに相乗りさせる: 他ツールが書き出した zip の
// org-JSON エントリは BOM 付きで来る。解釈できないと合流で着信側が黙って落ちる。
const BOM = String.fromCharCode(0xfeff);

let root: string;
let dest: string;
let handle: any;
let res: { imported: number; skipped: number };

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-zipslip-'));
  dest = path.join(root, 'lib');
  fs.mkdirSync(dest, { recursive: true });
  handle = openDatabase(path.join(root, 'test.db'));
  createDbWriter(handle.sqlite).setFolders({ folders: [{ id: 'pre', name: 'P', kind: 'static', items: [] }] });

  const zip = new JSZip();
  // 正当なエントリ
  zip.file('library/cap1.jpg', Buffer.from('JPEGDATA1'));
  zip.file('library/cap2.jpg', Buffer.from('JPEGDATA2'));
  zip.file('library/avatars/abcd1234.png', Buffer.from('AVATARDATA')); // 共有アバターストア（許可された下位パス）
  zip.file('library/folders.json', BOM + JSON.stringify({ folders: [{ id: 'f1', name: 'X', items: ['cap1'] }] }));
  // 悪意あるエントリ — どれも拒否され、宛先の外へ書かれてはいけない
  zip.file('library/..\\..\\evil-back.txt', 'PWNED-BACK'); // Windows バックスラッシュ
  zip.file('library/../../evil-fwd.txt', 'PWNED-FWD'); // POSIX
  zip.file('library/C:\\Windows\\evil-abs.txt', 'PWNED-ABS'); // 絶対／ドライブレター
  // 許可された下位パスを通り抜けようとする形。JSZip は追加時に前方スラッシュの '..' を
  // 正規化してしまう（'avatars/../x' は zip.file() では作れない）が、手作りの書庫は生の名前を
  // 運べる＝バックスラッシュ形は JSZip を素通りするのでガードを実際に踏める。
  zip.file('library/avatars\\..\\evil-av.txt', 'PWNED-AV');
  zip.file('library/avatars/deep/evil-deep.txt', 'PWNED-DEEP'); // より深い入れ子は許可対象でない

  res = await importCompleteZipToDb(handle.sqlite, JSZip, dest, await zip.generateAsync({ type: 'nodebuffer' }));
});

afterAll(() => {
  handle.sqlite.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('正当なエントリ', () => {
  test('capture が取り込まれる', () => {
    expect(fs.existsSync(path.join(dest, 'cap1.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'cap2.jpg'))).toBe(true);
  });

  test('avatars/ は下位フォルダのまま取り込まれる', () => {
    expect(fs.existsSync(path.join(dest, 'avatars', 'abcd1234.png'))).toBe(true);
  });

  test('取り込まれたのは正当な3件だけ', () => {
    expect(res.imported).toBe(3);
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

describe('悪意あるエントリ', () => {
  test('宛先の外へは何も書かれない', () => {
    const escapeTargets = [path.resolve(dest, '..', '..', 'evil-back.txt'), path.resolve(dest, '..', '..', 'evil-fwd.txt'), path.resolve(root, 'evil-back.txt'), path.resolve(root, 'evil-fwd.txt'), path.resolve(dest, '..', 'evil-back.txt'), path.resolve(dest, '..', 'evil-fwd.txt')];
    expect(escapeTargets.filter((p) => fs.existsSync(p))).toEqual([]);
  });

  test('宛先の中にも evil は落ちない', () => {
    expect(fs.readdirSync(dest).filter((n) => /evil/i.test(n))).toEqual([]);
  });

  test('avatars/ の中にも落ちない（深い入れ子も含む）', () => {
    expect(fs.readdirSync(path.join(dest, 'avatars')).filter((n) => /evil|deep/i.test(n))).toEqual([]);
  });
});

describe('往復: buildCompleteZip が avatars/ を運び、import が戻す', () => {
  let built: { buffer: Buffer; fileCount: number };
  let dest2: string;
  let handle2: any;
  let res2: { imported: number };

  beforeAll(async () => {
    const srcLib = path.join(root, 'src');
    fs.mkdirSync(path.join(srcLib, 'avatars'), { recursive: true });
    fs.writeFileSync(path.join(srcLib, 'cap9.jpg'), 'JPEGDATA9');
    fs.writeFileSync(path.join(srcLib, 'avatars', 'ffff0000.webp'), 'AVDATA');

    built = await buildCompleteZip(JSZip, srcLib);
    dest2 = path.join(root, 'lib2');
    fs.mkdirSync(dest2, { recursive: true });
    handle2 = openDatabase(path.join(root, 'test2.db'));
    res2 = await importCompleteZipToDb(handle2.sqlite, JSZip, dest2, built.buffer);
  });

  afterAll(() => handle2.sqlite.close());

  test('書き出しはアバターファイルも数える', () => {
    expect(built.fileCount).toBe(2);
  });

  test('capture と avatars/ が復元される', () => {
    expect(fs.existsSync(path.join(dest2, 'cap9.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(dest2, 'avatars', 'ffff0000.webp'))).toBe(true);
  });

  test('2件とも取り込まれる', () => {
    expect(res2.imported).toBe(2);
  });
});
