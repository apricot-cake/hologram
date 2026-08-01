// Zip bomb / unbounded-expansion regression tests for the two import paths in
// app/src/main/lib-archive.ts (the complete-format importCompleteZipToDb and the legacy
// readLegacyZipPosts).
//   (a) a normal complete-export ZIP (capture + folders.json) imports fine
//   (b) an archive whose declared total expanded size exceeds the limit is rejected
//   (c) an archive that declares too many entries is rejected
//   (d) an entry whose declared size alone exceeds the per-entry limit is rejected
//   (e) stream writing aborts once actual output bytes exceed the per-entry budget
//       (defense against an attack where the central directory understates its size)
//   (f) organizational JSON (folders.json etc.) has its own dedicated limit (#382):
//       a declared size over the dedicated limit is rejected before expansion, and
//       merging still works as before when within the limit
//   (g) the organizational-JSON dedicated limit also cuts off based on actual output
//       bytes (defense against a forged declared size)
//   (i) the legacy-format (metadata.json + images/) entry point goes through the same
//       declared-size guards, plus a dedicated limit for in-memory expansion (#322)
//   (j) ugoira frame reads (#506) also go through the same declared-size guards, plus
//       a dedicated per-frame limit
// For every rejection, no malicious payload or .tmp-import file may be left on disk.
//
// The real limits are GiB-scale, and building fixtures out of genuinely compressed data
// of that size isn't practical. So (b)-(d),(f) **rewrite the central directory of real
// ZIP bytes** = they put an archive with a forged declared uncompressedSize on disk and
// read it through the same yauzl.open(path) path as production (before #485 we used a
// wrapper that swapped out JSZip's entry objects, but since the reader changed, the
// forgery moved down to the byte level too). Forged entries are built with DEFLATE =
// with STORED, yauzl's own validateEntrySizes would reject the entry before it's ever
// yielded, so it would never reach this test's own guard. (e) and (g) use a small budget
// with real multi-chunk data to hit the stream-side limit directly.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  MAX_LEGACY_ENTRY_BYTES,
  MAX_LEGACY_TOTAL_BYTES,
  MAX_UGOIRA_FRAME_BYTES,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_ENTRY_BYTES,
  MAX_ZIP_ORG_BYTES,
  MAX_ZIP_TOTAL_BYTES,
  ZipLimitError,
  importCompleteZipToDb,
  readLegacyZipPosts,
  readStreamCapped,
  readUgoiraFrame,
  ugoiraFramesPresent,
  writeStreamCapped,
} from '../app/src/main/lib-archive';
import { openDatabase } from '../app/src/main/lib-db';
import { createDbWriter } from '../app/src/main/lib-db-write';

const CENTRAL_HEADER_SIG = 0x02014b50;
const CENTRAL_HEADER_FIXED = 46;
const EOCD_SIG = 0x06054b50;

// Rewrites each central directory record's declared uncompressedSize (record start +24)
// to the value sizeFor returns (null leaves it unchanged). The start offset and count
// come from the trailing end-of-central-directory record = so we don't accidentally
// pick up a signature that happens to occur inside the compressed data.
function forgeDeclaredSizes(buf: Buffer, sizeFor: (name: string, i: number) => number | null) {
  const eocd = buf.length - 22; // JSZip writes no comment, so the EOCD is fixed at the trailing 22 bytes
  if (buf.readUInt32LE(eocd) !== EOCD_SIG) throw new Error('fixture: EOCD not where expected');
  const count = buf.readUInt16LE(eocd + 10);
  let i = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(i) !== CENTRAL_HEADER_SIG) throw new Error('fixture: central directory header not where expected');
    const nameLen = buf.readUInt16LE(i + 28);
    const extraLen = buf.readUInt16LE(i + 30);
    const commentLen = buf.readUInt16LE(i + 32);
    const name = buf.subarray(i + CENTRAL_HEADER_FIXED, i + CENTRAL_HEADER_FIXED + nameLen).toString('utf8');
    // Directory records are 0-byte STORED entries = touching their declared size would
    // make yauzl's own validateEntrySizes reject them first, before this guard is
    // reached.
    const forged = name.endsWith('/') ? null : sizeFor(name, n);
    if (forged != null) buf.writeUInt32LE(forged, i + 24);
    i += CENTRAL_HEADER_FIXED + nameLen + extraLen + commentLen;
  }
  return buf;
}

// An archive that carries only a declared entry count. The ZIP64
// end-of-central-directory record holds a 64-bit entry count, and yauzl treats that as
// authoritative as soon as it finds the locator signature = so we can build "an archive
// that claims to have 200,000 entries" without actually laying out 200,000 central
// directory records. This hits the same path a real bomb would (rejected at the door
// based on the declared value, so not a single record is ever read).
function craftArchiveDeclaring(entryCount: number) {
  const zip64Eocd = Buffer.alloc(56);
  zip64Eocd.writeUInt32LE(0x06064b50, 0); // signature
  zip64Eocd.writeBigUInt64LE(44n, 4); // size of this record - 12
  zip64Eocd.writeUInt16LE(45, 12); // version made by
  zip64Eocd.writeUInt16LE(45, 14); // version needed
  zip64Eocd.writeBigUInt64LE(BigInt(entryCount), 24); // entries on this disk
  zip64Eocd.writeBigUInt64LE(BigInt(entryCount), 32); // entries total
  zip64Eocd.writeBigUInt64LE(0n, 40); // central directory size
  zip64Eocd.writeBigUInt64LE(0n, 48); // central directory offset

  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  locator.writeBigUInt64LE(0n, 8); // offset of the zip64 eocd record (start of file)
  locator.writeUInt32LE(1, 16); // total number of disks

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0xffff, 8); // zip64 placeholders
  eocd.writeUInt16LE(0xffff, 10);
  eocd.writeUInt32LE(0xffffffff, 12);
  eocd.writeUInt32LE(0xffffffff, 16);

  return Buffer.concat([zip64Eocd, locator, eocd]);
}

let root: string;
let seq = 0;
const handles: any[] = [];
const freshDest = (tag: string) => {
  const dest = path.join(root, tag);
  fs.mkdirSync(dest, { recursive: true });
  return dest;
};
const freshDb = (tag: string) => {
  const handle = openDatabase(path.join(root, `${tag}.db`));
  handles.push(handle);
  return handle;
};
const zipFileOf = (buf: Buffer) => {
  const p = path.join(root, `fixture-${seq++}.zip`);
  fs.writeFileSync(p, buf);
  return p;
};

// Small real-ZIP bytes reused by the forgery cases. n=80 (>64) = lining up 80 entries
// each just under the per-entry limit still exceeds the total limit. See the note at
// the top of the file for why DEFLATE is specified.
let smallBytes: Buffer;
const SMALL_N = 80;

async function buildZipBytes(files: Record<string, string | Buffer>) {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content, { compression: 'DEFLATE' });
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-zipbomb-'));
  const files: Record<string, string> = {};
  for (let i = 0; i < SMALL_N; i++) files[`library/z${i}.bin`] = `tiny${i}`;
  smallBytes = await buildZipBytes(files);
});

afterAll(() => {
  for (const h of handles) h.sqlite.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('(a) 普通の書き出しは従来どおり取り込める', () => {
  let dest: string;
  let handle: any;
  let res: { imported: number };

  beforeAll(async () => {
    dest = freshDest('normal');
    handle = freshDb('normal');
    const zipPath = zipFileOf(
      await buildZipBytes({
        'library/cap1.jpg': 'JPEGDATA1',
        'library/cap2.jpg': 'JPEGDATA2',
        'library/folders.json': JSON.stringify({ folders: [{ id: 'f1', name: 'X', items: ['cap1'] }] }),
      }),
    );
    res = (await importCompleteZipToDb(handle.sqlite, zipPath, dest)) as any;
  });

  test('capture が2件取り込まれる', () => {
    expect(res.imported).toBe(2);
    expect(fs.existsSync(path.join(dest, 'cap1.jpg'))).toBe(true);
  });

  test('folders.json も取り込まれて合流する（合流先はDB）', () => {
    expect(
      createDbWriter(handle.sqlite)
        .getFolders()
        .folders.map((f: any) => f.id),
    ).toEqual(['f1']);
  });
});

describe('(b) 申告合計が上限超え', () => {
  const each = MAX_ZIP_ENTRY_BYTES - 1024; // just under the per-entry limit = only the total guard can fire

  test('作った書庫が合計上限を超えている（前提の確認）', () => {
    expect(SMALL_N * each).toBeGreaterThan(MAX_ZIP_TOTAL_BYTES);
  });

  test('ZipLimitError で拒否し、何も書かない', async () => {
    const dest = freshDest('total-bomb');
    const { sqlite } = freshDb('total-bomb');
    const zipPath = zipFileOf(forgeDeclaredSizes(Buffer.from(smallBytes), () => each));

    await expect(importCompleteZipToDb(sqlite, zipPath, dest)).rejects.toThrow(ZipLimitError);
    expect(fs.readdirSync(dest)).toEqual([]);
  });
});

describe('(c) エントリ数の申告が多すぎる', () => {
  test('ZipLimitError で拒否し、中央ディレクトリを1件も読まない', async () => {
    const dest = freshDest('count-bomb');
    const { sqlite } = freshDb('count-bomb');
    const zipPath = zipFileOf(craftArchiveDeclaring(MAX_ZIP_ENTRIES + 5));

    await expect(importCompleteZipToDb(sqlite, zipPath, dest)).rejects.toThrow(ZipLimitError);
    expect(fs.readdirSync(dest)).toEqual([]);
  });

  test('上限ちょうどの申告では件数ガードは発火しない（上限が効く位置の確認）', async () => {
    const dest = freshDest('count-edge');
    const { sqlite } = freshDb('count-edge');
    const zipPath = zipFileOf(craftArchiveDeclaring(MAX_ZIP_ENTRIES));

    // There's no actual central directory content, so reading further produces a
    // different error on yauzl's side. The absence of a ZipLimitError is the proof that
    // the entry-count guard doesn't fire at 200000.
    const err = await importCompleteZipToDb(sqlite, zipPath, dest).then(
      () => null,
      (e) => e,
    );
    expect(err).toBeTruthy();
    expect(err).not.toBeInstanceOf(ZipLimitError);
  });
});

describe('(d) 単一エントリが1エントリ上限超え', () => {
  test('先頭1件だけ偽装しても ZipLimitError で拒否し、何も書かない', async () => {
    const dest = freshDest('entry-bomb');
    const { sqlite } = freshDb('entry-bomb');
    const oversize = MAX_ZIP_ENTRY_BYTES + 1;
    const zipPath = zipFileOf(forgeDeclaredSizes(Buffer.from(smallBytes), (name) => (name === 'library/z0.bin' ? oversize : 4)));

    await expect(importCompleteZipToDb(sqlite, zipPath, dest)).rejects.toThrow(ZipLimitError);
    expect(fs.readdirSync(dest)).toEqual([]);
  });
});

describe('(e) ストリーム書き込みの予算', () => {
  let dest: string;
  const payload = Buffer.alloc(256 * 1024, 7); // 256 KiB = passes through the stream in multiple chunks
  const source = () => Readable.from([payload.subarray(0, 128 * 1024), payload.subarray(128 * 1024)]);

  beforeAll(() => {
    dest = freshDest('stream-cap');
  });

  test('予算超過（64 KiB 予算 < 256 KiB ペイロード）で中断する', async () => {
    await expect(writeStreamCapped(source(), path.join(dest, 'big.bin.tmp-import'), 64 * 1024)).rejects.toThrow(ZipLimitError);
  });

  test('予算内（1 MiB 予算）なら最後まで書く', async () => {
    const tmp = path.join(dest, 'ok.bin.tmp-import');
    await writeStreamCapped(source(), tmp, 1024 * 1024);

    expect(fs.statSync(tmp).size).toBe(payload.length);
  });
});

describe('(f) 整理用JSONの専用上限（#382）', () => {
  const buildNormalZip = () =>
    buildZipBytes({
      'library/cap1.jpg': 'JPEGDATA1',
      'library/folders.json': JSON.stringify({ folders: [{ id: 'f1', name: 'X', items: ['cap1'] }] }),
    });

  test('folders.json の申告サイズが専用上限（16 MiB）超え → ZipLimitError で拒否し、何も書かない', async () => {
    const dest = freshDest('org-declared-bomb');
    const { sqlite } = freshDb('org-declared-bomb');
    const oversize = MAX_ZIP_ORG_BYTES + 1; // still well under MAX_ZIP_ENTRY_BYTES — only the org-specific guard should fire
    const zipPath = zipFileOf(forgeDeclaredSizes(await buildNormalZip(), (name) => (name === 'library/folders.json' ? oversize : null)));

    await expect(importCompleteZipToDb(sqlite, zipPath, dest)).rejects.toThrow(ZipLimitError);
    expect(fs.readdirSync(dest)).toEqual([]);
  });

  test('folders.json が専用上限内なら従来どおりマージできる（回帰）', async () => {
    const dest = freshDest('org-normal');
    const { sqlite } = freshDb('org-normal');
    const zipPath = zipFileOf(await buildNormalZip());

    const res = await importCompleteZipToDb(sqlite, zipPath, dest);
    expect(res.imported).toBeGreaterThan(0);
    expect(
      createDbWriter(sqlite)
        .getFolders()
        .folders.map((f: any) => f.id),
    ).toEqual(['f1']);
  });
});

describe('(g) 整理用JSON専用上限は実際の出力バイト数でも打ち切る（申告値偽装への防御）', () => {
  const payload = Buffer.alloc(256 * 1024, 7); // 256 KiB = passes through the stream in multiple chunks
  const source = () => Readable.from([payload.subarray(0, 128 * 1024), payload.subarray(128 * 1024)]);

  test('予算超過（64 KiB 予算 < 256 KiB 実データ）で中断する', async () => {
    await expect(readStreamCapped(source(), 64 * 1024)).rejects.toThrow(ZipLimitError);
  });

  test('予算内（1 MiB 予算）なら最後まで読み切る', async () => {
    const buf = await readStreamCapped(source(), 1024 * 1024);
    expect(buf.length).toBe(payload.length);
  });
});

// An "understated declaration" that slips past the declared-size guards must still stop
// partway through expansion and not be left on disk. (e)/(g) hit the cap functions
// directly, but this one goes through the real importCompleteZipToDb path. What actually
// trips it here is yauzl's validateEntrySizes (which reads the mismatch between the
// declared and actual byte counts and turns it into a stream error); writeStreamCapped's
// budget is the outer-layer safety net = a double layer that still caps out at 1 GiB
// even if the reader stops validating.
describe('(h) 過少申告した capture は、書き出し中に打ち切られてディスクに残らない', () => {
  test('.tmp-import も本体も残らず、正当なエントリだけが残る', async () => {
    const dest = freshDest('understated');
    const { sqlite } = freshDb('understated');
    // A 2 MiB entry that declares itself as 1 byte. All of the declared-size guards
    // (1 GiB / 64 GiB / 16 MiB) let it through.
    const big = Buffer.alloc(2 * 1024 * 1024, 9);
    const zipPath = zipFileOf(forgeDeclaredSizes(await buildZipBytes({ 'library/cap1.jpg': 'JPEGDATA1', 'library/liar.bin': big }), (name) => (name === 'library/liar.bin' ? 1 : null)));

    const res = await importCompleteZipToDb(sqlite, zipPath, dest);

    // The legitimate capture goes in, and the lying entry gets skipped
    expect(fs.existsSync(path.join(dest, 'cap1.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'liar.bin'))).toBe(false);
    expect(fs.readdirSync(dest).filter((n) => n.includes('.tmp-import'))).toEqual([]);
    expect(res.skipped).toBeGreaterThan(0);
  });
});

// Until #322, the legacy format (pre-#300 metadata.json + images/) was a separate path
// that **went through none of the declared-size guards** = the renderer opened it itself
// with JSZip and expanded every referenced image to base64 fully in memory. Now that
// it's moved to main's readLegacyZipPosts, it goes through the same declared-size tally
// (count / per-entry / total) as the complete format, plus two dedicated limits for
// in-memory expansion.
const legacyImages = (n: number) => Array.from({ length: n }, (_, i) => `images/p${i}.jpg`);
async function buildLegacyZipBytes(n: number, extra: Record<string, string> = {}) {
  const files: Record<string, string> = Object.assign({}, extra);
  files['metadata.json'] = JSON.stringify(legacyImages(n).map((imageFile, i) => ({ imageFile, eagleName: `post ${i}`, capturedAt: '2026-01-01T00:00:00.000Z' })));
  for (const [i, name] of legacyImages(n).entries()) files[name] = `JPEGDATA${i}`;
  return buildZipBytes(files);
}

describe('(i) 旧形式の入口（#322）', () => {
  test('正常な旧形式は data URL つきのレコードとして読める', async () => {
    const posts = await readLegacyZipPosts(zipFileOf(await buildLegacyZipBytes(2)));

    expect(posts?.length).toBe(2);
    expect(posts?.[0].eagleName).toBe('post 0');
    expect(Buffer.from(posts?.[0].image.split(',')[1], 'base64').toString('utf8')).toBe('JPEGDATA0');
  });

  test('metadata.json が無い書庫は null（旧形式ですらない）', async () => {
    const zipPath = zipFileOf(await buildZipBytes({ 'library/cap1.jpg': 'JPEGDATA1' }));

    expect(await readLegacyZipPosts(zipPath)).toBeNull();
  });

  test('metadata.json が配列でなければ null', async () => {
    const zipPath = zipFileOf(await buildZipBytes({ 'metadata.json': '{"posts":1}' }));

    expect(await readLegacyZipPosts(zipPath)).toBeNull();
  });

  test('metadata.json が指す画像が書庫に無いレコードは落ちる', async () => {
    const zipPath = zipFileOf(await buildZipBytes({ 'metadata.json': JSON.stringify([{ imageFile: 'images/gone.jpg' }, { imageFile: 'images/here.jpg' }]), 'images/here.jpg': 'JPEGDATA' }));

    expect((await readLegacyZipPosts(zipPath))?.length).toBe(1);
  });

  test('共有の件数ガードが効く（申告が多すぎる書庫）', async () => {
    const zipPath = zipFileOf(craftArchiveDeclaring(MAX_ZIP_ENTRIES + 5));

    await expect(readLegacyZipPosts(zipPath)).rejects.toThrow(ZipLimitError);
  });

  test('共有の単体ガードが効く（1エントリの申告が 1 GiB 超え）', async () => {
    const zipPath = zipFileOf(forgeDeclaredSizes(await buildLegacyZipBytes(2), (name) => (name === 'images/p0.jpg' ? MAX_ZIP_ENTRY_BYTES + 1 : null)));

    await expect(readLegacyZipPosts(zipPath)).rejects.toThrow(ZipLimitError);
  });

  test('旧形式専用の単体上限（64 MiB）で拒否する', async () => {
    const oversize = MAX_LEGACY_ENTRY_BYTES + 1;
    expect(oversize).toBeLessThan(MAX_ZIP_ENTRY_BYTES); // positioned so the dedicated guard fires, not the shared one
    const zipPath = zipFileOf(forgeDeclaredSizes(await buildLegacyZipBytes(2), (name) => (name === 'images/p1.jpg' ? oversize : null)));

    await expect(readLegacyZipPosts(zipPath)).rejects.toThrow(ZipLimitError);
  });

  test('metadata.json 自身が旧形式専用の単体上限を超えていれば、1バイトも読まずに拒否する', async () => {
    const zipPath = zipFileOf(forgeDeclaredSizes(await buildLegacyZipBytes(2), (name) => (name === 'metadata.json' ? MAX_LEGACY_ENTRY_BYTES + 1 : null)));

    await expect(readLegacyZipPosts(zipPath)).rejects.toThrow(ZipLimitError);
  });

  test('参照画像の申告合計が展開上限（1 GiB）を超えれば拒否する', async () => {
    const each = 60 * 1024 * 1024; // under the per-entry limit (64 MiB) = only the total guard can fire
    const n = 20;
    expect(n * each).toBeGreaterThan(MAX_LEGACY_TOTAL_BYTES);
    expect(n * each).toBeLessThan(MAX_ZIP_TOTAL_BYTES); // the shared total guard doesn't fire
    const zipPath = zipFileOf(forgeDeclaredSizes(await buildLegacyZipBytes(n), (name) => (name === 'metadata.json' ? null : each)));

    await expect(readLegacyZipPosts(zipPath)).rejects.toThrow(ZipLimitError);
  });
});

// Ugoira playback (#506) is the third reader that opens an archive = where the
// renderer's JSZip usage was moved out to. It holds pixiv-distributed zips as-is = since
// they're third-party in origin, it goes through the same declared-size tally as the
// other two paths, plus its own dedicated limit of "one frame = one still image". There
// is no total per-archive limit (it only ever holds one frame at a time, so there's
// nothing to bound).
const buildUgoiraZipBytes = () => buildZipBytes({ '000000.jpg': 'FRAME0', '000001.jpg': 'FRAME1', '000002.jpg': 'FRAME2' });

describe('(j) うごイラのコマ読み（#506）', () => {
  test('コマ表の名前が全部あれば true', async () => {
    const zipPath = zipFileOf(await buildUgoiraZipBytes());

    expect(await ugoiraFramesPresent(zipPath, ['000000.jpg', '000001.jpg', '000002.jpg'])).toBe(true);
  });

  test('1つでも欠けていれば false（全か無か＝コマ表と書庫が別物なら再生させない）', async () => {
    const zipPath = zipFileOf(await buildUgoiraZipBytes());

    expect(await ugoiraFramesPresent(zipPath, ['000000.jpg', 'gone.jpg'])).toBe(false);
  });

  test('コマ表が空なら false', async () => {
    const zipPath = zipFileOf(await buildUgoiraZipBytes());

    expect(await ugoiraFramesPresent(zipPath, [])).toBe(false);
  });

  test('要求した1コマのバイト列だけを返す', async () => {
    const zipPath = zipFileOf(await buildUgoiraZipBytes());

    expect((await readUgoiraFrame(zipPath, '000001.jpg'))?.toString('utf8')).toBe('FRAME1');
  });

  test('書庫に無い名前は null（例外にしない＝プレイヤーはポスターへ落ちる）', async () => {
    const zipPath = zipFileOf(await buildUgoiraZipBytes());

    expect(await readUgoiraFrame(zipPath, 'gone.jpg')).toBeNull();
  });

  test('1コマ専用の上限（64 MiB）を申告が超えていれば、1バイトも読まずに拒否する', async () => {
    const oversize = MAX_UGOIRA_FRAME_BYTES + 1;
    expect(oversize).toBeLessThan(MAX_ZIP_ENTRY_BYTES); // positioned so the dedicated guard fires, not the shared one
    const zipPath = zipFileOf(forgeDeclaredSizes(await buildUgoiraZipBytes(), (name) => (name === '000001.jpg' ? oversize : null)));

    await expect(readUgoiraFrame(zipPath, '000001.jpg')).rejects.toThrow(ZipLimitError);
  });

  test('共有の件数ガードも効く（申告が多すぎる書庫）', async () => {
    const zipPath = zipFileOf(craftArchiveDeclaring(MAX_ZIP_ENTRIES + 5));

    await expect(ugoiraFramesPresent(zipPath, ['000000.jpg'])).rejects.toThrow(ZipLimitError);
  });
});
