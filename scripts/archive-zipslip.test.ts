// Zip-Slip regression tests for app/src/main/lib-archive.ts#importCompleteZipToDb.
// Builds malicious library ZIPs whose entry names try to escape the save folder =
// Windows backslash separators, POSIX `../`, absolute paths / drive letters, and
// disallowed nesting depth.
//
// #485 swapped the reader from JSZip to yauzl, giving us two layers of defense. Each
// layer fails differently:
//
//   Layer 1 (yauzl.validateFileName) — collapses backslashes to `/`, then rejects
//     absolute paths, entries starting with a drive letter, and `..` segments. Yields
//     zero entries and drops the whole archive = fail-closed, not a single byte written.
//   Layer 2 (lib-archive's isSafeLibraryPath / isSafeTrashPath) — stops names that
//     yauzl lets through. `library/C:/Windows/…` (not absolute once collapsed) or
//     `library/sub/dir/…` aren't traversal, so layer 1 lets them pass. This layer skips
//     per entry, so legitimate entries in the same archive are still imported as usual.
//
// Testing the layers separately matters: dropping one guard could still stay green if
// they weren't checked in isolation.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { importCompleteZipToDb, writeCompleteZip } from '../app/src/main/lib-archive';
import { openDatabase } from '../app/src/main/lib-db';
import { createDbWriter } from '../app/src/main/lib-db-write';

// Piggyback BOM tolerance (BACKLOG L3) onto this import: org-JSON entries written by
// other tools come with a BOM. If it can't be parsed, the incoming side silently drops
// during the merge.
const BOM = String.fromCharCode(0xfeff);

let root: string;
let seq = 0;
// JSZip is only used on the side that assembles fixtures (yauzl does the reading). It
// lets us put raw names into the central directory, so we can build the same shape as
// a real attack.
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
  zip.file('library/avatars/abcd1234.png', Buffer.from('AVATARDATA')); // shared avatar store (an allowed sub-path)
  zip.file('library/folders.json', BOM + JSON.stringify({ folders: [{ id: 'f1', name: 'X', items: ['cap1'] }] }));
};

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-zipslip-'));
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

// --- Layer 1: an archive whose name itself is invalid is rejected wholesale ------------------------
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

      // fail-closed: nothing lands inside or outside the destination
      expect(fs.readdirSync(dest)).toEqual([]);
      expect(fs.readdirSync(root).filter((n) => /evil/i.test(n))).toEqual([]);
    });
  }
});

// --- Layer 2: names yauzl lets through get stopped by lib-archive's own rules ----------------------
describe('yauzl が通す形は、エントリ単位で skip される', () => {
  let dest: string;
  let handle: any;
  let res: { imported: number; skipped: number };

  beforeAll(async () => {
    dest = path.join(root, 'lib');
    fs.mkdirSync(dest, { recursive: true });
    // In a real library, .trash/ actually exists. Relying on "it happens to not exist so
    // it fails with ENOENT" would still stay green even with the guard removed = so set
    // up one real destination, creating a situation where removing isSafeLibraryPath
    // would actually let a write through.
    fs.mkdirSync(path.join(dest, '.trash'), { recursive: true });
    handle = openDatabase(path.join(root, 'test.db'));
    createDbWriter(handle.sqlite).setFolders({ folders: [{ id: 'pre', name: 'P', kind: 'static', items: [] }] });

    const zipPath = await zipToFile((zip) => {
      legitEntries(zip);
      // All of these pass yauzl's validateFileName (no `..` and no leading absolute form
      // once collapsed) = the only thing stopping them here is isSafeLibraryPath.
      zip.file('library/.trash/evil-trash.jpg', 'PWNED-TRASH'); // sneaks into the trash under a library/ name
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
