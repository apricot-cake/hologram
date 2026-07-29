// app/src/main/lib-archive.ts#importCompleteZipToDb の zip 爆弾／無制限展開の回帰テスト。
//   (a) 普通の完全書き出し ZIP（capture + folders.json）は取り込める
//   (b) 展開後サイズの申告合計が上限を超える書庫は拒否する
//   (c) エントリ数の申告が多すぎる書庫は拒否する
//   (d) 単一エントリの申告サイズが上限を超えるものは拒否する
//   (e) ストリーム書き込みは、実際の出力バイト数が1エントリ分の予算を超えたら中断する
//       （中央ディレクトリが過少申告してくる攻撃への防御）
//   (f) 整理用 JSON（folders.json 等）専用の上限（#382）: 申告サイズが専用上限を超える
//       ものは展開前に拒否し、上限内なら従来どおりマージできる
//   (g) 整理用 JSON 専用上限は、実際の出力バイト数でも打ち切る（申告値の偽装への防御）
// どの拒否でも、悪意あるペイロードや .tmp-import をディスクに残してはいけない。
//
// 実際の上限は GiB 級で、本物の圧縮データから作るのは非現実的。そこで (b)-(d),(f) は
// **本物の ZIP バイト列の中央ディレクトリを書き換える**＝申告 uncompressedSize を偽装した
// 書庫をディスクへ置き、production と同じ yauzl.open(path) 経路で読ませる（#485 以前は
// JSZip のエントリオブジェクトを差し替えるラッパを使っていたが、読み手が変わったので
// 偽装もバイト列側へ降ろした）。偽装エントリは DEFLATE で作る＝STORED だと yauzl 自身の
// validateEntrySizes が entry を yield する前に落としてしまい、こちらのガードまで届かない。
// (e),(g) は小さい予算と本物の複数チャンクのデータでストリーム側の上限を直接踏む。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { MAX_ZIP_ENTRIES, MAX_ZIP_ENTRY_BYTES, MAX_ZIP_ORG_BYTES, MAX_ZIP_TOTAL_BYTES, ZipLimitError, importCompleteZipToDb, readStreamCapped, writeStreamCapped } from '../app/src/main/lib-archive';
import { openDatabase } from '../app/src/main/lib-db';
import { createDbWriter } from '../app/src/main/lib-db-write';

const CENTRAL_HEADER_SIG = 0x02014b50;
const CENTRAL_HEADER_FIXED = 46;
const EOCD_SIG = 0x06054b50;

// 中央ディレクトリの各レコードの申告 uncompressedSize（レコード先頭 +24）を sizeFor が
// 返す値へ書き換える（null はそのまま）。開始位置と件数は末尾の end-of-central-directory
// レコードから取る＝圧縮データの中に偶然現れるシグネチャを拾わない。
function forgeDeclaredSizes(buf: Buffer, sizeFor: (name: string, i: number) => number | null) {
  const eocd = buf.length - 22; // JSZip はコメントを書かないので EOCD は末尾22バイト固定
  if (buf.readUInt32LE(eocd) !== EOCD_SIG) throw new Error('fixture: EOCD not where expected');
  const count = buf.readUInt16LE(eocd + 10);
  let i = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(i) !== CENTRAL_HEADER_SIG) throw new Error('fixture: central directory header not where expected');
    const nameLen = buf.readUInt16LE(i + 28);
    const extraLen = buf.readUInt16LE(i + 30);
    const commentLen = buf.readUInt16LE(i + 32);
    const name = buf.subarray(i + CENTRAL_HEADER_FIXED, i + CENTRAL_HEADER_FIXED + nameLen).toString('utf8');
    // ディレクトリレコードは 0 バイトの STORED＝申告を触ると yauzl 自身の
    // validateEntrySizes が先に落ちてしまい、こちらのガードまで届かない。
    const forged = name.endsWith('/') ? null : sizeFor(name, n);
    if (forged != null) buf.writeUInt32LE(forged, i + 24);
    i += CENTRAL_HEADER_FIXED + nameLen + extraLen + commentLen;
  }
  return buf;
}

// エントリ数の申告だけを持つ書庫。ZIP64 の end-of-central-directory レコードは 64bit の
// エントリ数を持ち、yauzl は locator シグネチャを見つけた時点でそちらを正とする＝
// 20万件の中央ディレクトリを実際に並べなくても「20万件だと名乗る書庫」が作れる。
// 本物の爆弾と踏む経路は同じ（申告値で門前払いするので、レコードは1件も読まれない）。
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

// 偽装ケースが使い回す小さな実 ZIP のバイト列。n=80（>64）＝1エントリ上限すれすれを
// 80個並べると合計上限を超える。DEFLATE 指定の理由はファイル冒頭の注記のとおり。
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
  const each = MAX_ZIP_ENTRY_BYTES - 1024; // 1エントリ上限のすぐ下＝合計ガードだけが発火しうる

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

    // 中央ディレクトリの実体は無いので、読み進めば yauzl 側の別のエラーになる。
    // ZipLimitError で「ない」ことが、件数ガードが 200000 では発火しない証拠。
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
  const payload = Buffer.alloc(256 * 1024, 7); // 256 KiB＝ストリームを複数チャンクで通る
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
  const payload = Buffer.alloc(256 * 1024, 7); // 256 KiB＝ストリームを複数チャンクで通る
  const source = () => Readable.from([payload.subarray(0, 128 * 1024), payload.subarray(128 * 1024)]);

  test('予算超過（64 KiB 予算 < 256 KiB 実データ）で中断する', async () => {
    await expect(readStreamCapped(source(), 64 * 1024)).rejects.toThrow(ZipLimitError);
  });

  test('予算内（1 MiB 予算）なら最後まで読み切る', async () => {
    const buf = await readStreamCapped(source(), 1024 * 1024);
    expect(buf.length).toBe(payload.length);
  });
});

// 申告ガードを通り抜ける「過少申告」が、展開の途中で止まってディスクに残らないこと。
// (e)/(g) は cap 関数を直接叩くが、こちらは importCompleteZipToDb の実経路。ここで
// 実際に落とすのは yauzl の validateEntrySizes（申告と実バイト数の不一致を読み取り
// ストリームのエラーにする）で、writeStreamCapped の予算はその外側の保険＝読み手が
// 検証しなくなっても 1 GiB で頭打ちになる、という二重化になっている。
describe('(h) 過少申告した capture は、書き出し中に打ち切られてディスクに残らない', () => {
  test('.tmp-import も本体も残らず、正当なエントリだけが残る', async () => {
    const dest = freshDest('understated');
    const { sqlite } = freshDb('understated');
    // 1 バイトと申告する 2 MiB のエントリ。申告ガード（1 GiB / 64 GiB / 16 MiB）は
    // すべて通る。
    const big = Buffer.alloc(2 * 1024 * 1024, 9);
    const zipPath = zipFileOf(forgeDeclaredSizes(await buildZipBytes({ 'library/cap1.jpg': 'JPEGDATA1', 'library/liar.bin': big }), (name) => (name === 'library/liar.bin' ? 1 : null)));

    const res = await importCompleteZipToDb(sqlite, zipPath, dest);

    // 正当な capture は入り、嘘つきエントリは skip される
    expect(fs.existsSync(path.join(dest, 'cap1.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'liar.bin'))).toBe(false);
    expect(fs.readdirSync(dest).filter((n) => n.includes('.tmp-import'))).toEqual([]);
    expect(res.skipped).toBeGreaterThan(0);
  });
});
