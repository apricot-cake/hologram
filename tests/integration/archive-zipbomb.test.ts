// 完全バックアップZIPとうごイラZIPの展開量制限の回帰テスト。
//   (a) 普通の完全書き出しの ZIP（capture + folders.json）が問題なく取り込める
//   (b) 展開後の合計サイズの申告が上限を超える書庫は拒む
//   (c) エントリ数を多く申告した書庫は拒む
//   (d) 1エントリの申告サイズだけで1エントリ上限を超えるものは拒む
//   (e) 実際の出力バイト数が1エントリぶんの予算を超えたら、ストリーム書き込みを中断する
//       （中央ディレクトリがサイズを過少申告してくる攻撃への防御）
//   (f) 整理用の JSON（folders.json など）には専用の上限がある（#382）＝専用上限を超える
//       申告は展開する前に拒み、上限内なら従来どおり合流できる
//   (g) 整理用 JSON の専用上限は、実際の出力バイト数でも打ち切る（申告値の偽装への防御）
//   (i) 投稿サイドカー JSON は専用の小さな上限を申告値と実バイト数に掛ける
//   (j) うごイラのコマ読み（#506）も同じ申告サイズのガードを通り、さらに1コマ専用の上限がある
// どの拒否でも、悪意あるペイロードや .tmp-import ファイルをディスクに残してはいけない。
//
// 実際の上限は GiB 単位で、その大きさの本物の圧縮データからフィクスチャを作るのは現実的では
// ない。そこで (b)〜(d),(f) は本物の ZIP バイト列の中央ディレクトリを書き換える＝申告
// uncompressedSize を偽装した書庫をディスクへ置き、本番と同じ yauzl.open(path) の経路で読む
// （#485 より前は JSZip のエントリオブジェクトを差し替えるラッパーを使っていたが、読み手が
// 変わったので偽装もバイトの層まで下りた）。偽装するエントリは DEFLATE で作る＝STORED だと
// yauzl 自身の validateEntrySizes が、エントリが渡される前に弾いてしまい、このテストが見たい
// ガードまで届かない。(e) と (g) は、小さな予算と複数チャンクに分かれる本物のデータを使って、
// ストリーム側の上限に直接当てる。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import {
  MAX_UGOIRA_FRAME_BYTES,
  MAX_ZIP_CAPTURE_JSON_BYTES,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_ENTRY_BYTES,
  MAX_ZIP_ORG_BYTES,
  MAX_ZIP_TOTAL_BYTES,
  ZipLimitError,
  clearUgoiraArchiveIndexes,
  importCompleteZipToDb,
  readStreamCapped,
  readUgoiraFrame,
  ugoiraArchiveIndexStats,
  ugoiraFramesPresent,
  writeStreamCapped,
} from '../../app/src/main/lib-archive';
import { openDatabase } from '../../app/src/main/lib-db';
import { createDbWriter } from '../../app/src/main/lib-db-write';

const CENTRAL_HEADER_SIG = 0x02014b50;
const CENTRAL_HEADER_FIXED = 46;
const EOCD_SIG = 0x06054b50;

// 中央ディレクトリの各レコードの申告 uncompressedSize（レコード先頭 +24）を、sizeFor が
// 返す値に書き換える（null ならそのまま）。開始位置と件数は末尾の
// end-of-central-directory レコードから取る＝圧縮データの中にたまたま現れた署名を
// 拾ってしまわないため。
function forgeDeclaredSizes(buf: Buffer, sizeFor: (name: string, i: number) => number | null) {
  const eocd = buf.length - 22; // JSZip はコメントを書かないので EOCD は末尾 22 バイトに固定
  if (buf.readUInt32LE(eocd) !== EOCD_SIG) throw new Error('フィクスチャ: EOCD が想定の位置に無い');
  const count = buf.readUInt16LE(eocd + 10);
  let i = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(i) !== CENTRAL_HEADER_SIG) throw new Error('フィクスチャ: 中央ディレクトリのヘッダが想定の位置に無い');
    const nameLen = buf.readUInt16LE(i + 28);
    const extraLen = buf.readUInt16LE(i + 30);
    const commentLen = buf.readUInt16LE(i + 32);
    const name = buf.subarray(i + CENTRAL_HEADER_FIXED, i + CENTRAL_HEADER_FIXED + nameLen).toString('utf8');
    // ディレクトリのレコードは 0 バイトの STORED エントリ＝その申告サイズを触ると、
    // ここで見たいガードへ届く前に yauzl 自身の validateEntrySizes が先に弾いてしまう。
    const forged = name.endsWith('/') ? null : sizeFor(name, n);
    if (forged != null) buf.writeUInt32LE(forged, i + 24);
    i += CENTRAL_HEADER_FIXED + nameLen + extraLen + commentLen;
  }
  return buf;
}

// エントリ数の申告だけを持つ書庫。ZIP64 の end-of-central-directory レコードは 64 ビットの
// エントリ数を持ち、yauzl はロケータの署名を見つけた時点でそれを正としてしまう＝だから
// 中央ディレクトリのレコードを実際に 200,000 件並べなくても、「20万件あると名乗る書庫」を
// 組める。本物の bomb と同じ経路に当たる（申告値をもとに入口で拒むので、レコードは1件も
// 読まれない）。
function craftArchiveDeclaring(entryCount: number) {
  const zip64Eocd = Buffer.alloc(56);
  zip64Eocd.writeUInt32LE(0x06064b50, 0); // 署名
  zip64Eocd.writeBigUInt64LE(44n, 4); // このレコードのサイズ - 12
  zip64Eocd.writeUInt16LE(45, 12); // 作成したバージョン
  zip64Eocd.writeUInt16LE(45, 14); // 必要なバージョン
  zip64Eocd.writeBigUInt64LE(BigInt(entryCount), 24); // このディスク上のエントリ数
  zip64Eocd.writeBigUInt64LE(BigInt(entryCount), 32); // エントリ数の合計
  zip64Eocd.writeBigUInt64LE(0n, 40); // 中央ディレクトリのサイズ
  zip64Eocd.writeBigUInt64LE(0n, 48); // 中央ディレクトリの位置

  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  locator.writeBigUInt64LE(0n, 8); // zip64 eocd レコードの位置（ファイル先頭）
  locator.writeUInt32LE(1, 16); // ディスクの総数

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0xffff, 8); // zip64 の場所取り
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

// 偽装を使う例で使い回す、小さな本物の ZIP バイト列。n=80（>64）＝1エントリ上限のすぐ下の
// エントリを 80 個並べれば、合計の上限を超える。DEFLATE を指定する理由はファイル冒頭の注記
// を参照。
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
  clearUgoiraArchiveIndexes();
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
  const each = MAX_ZIP_ENTRY_BYTES - 1024; // 1エントリ上限のすぐ下＝発火しうるのは合計のガードだけ

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

    // 中央ディレクトリの中身が実際には無いので、読み進めると yauzl 側で別のエラーになる。
    // ZipLimitError が出ないことが、件数のガードが 200000 では発火しない証拠になる。
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
  const payload = Buffer.alloc(256 * 1024, 7); // 256 KiB ＝複数チャンクに分かれてストリームを通る
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
    const oversize = MAX_ZIP_ORG_BYTES + 1; // MAX_ZIP_ENTRY_BYTES よりはるかに下＝発火すべきは整理用 JSON 専用のガードだけ
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
  const payload = Buffer.alloc(256 * 1024, 7); // 256 KiB ＝複数チャンクに分かれてストリームを通る
  const source = () => Readable.from([payload.subarray(0, 128 * 1024), payload.subarray(128 * 1024)]);

  test('予算超過（64 KiB 予算 < 256 KiB 実データ）で中断する', async () => {
    await expect(readStreamCapped(source(), 64 * 1024)).rejects.toThrow(ZipLimitError);
  });

  test('予算内（1 MiB 予算）なら最後まで読み切る', async () => {
    const buf = await readStreamCapped(source(), 1024 * 1024);
    expect(buf.length).toBe(payload.length);
  });
});

// 申告サイズのガードをすり抜けた「過少申告」も、展開の途中で止まり、ディスクに残らなければ
// ならない。(e)/(g) は上限の関数へ直接当てているが、こちらは本物の importCompleteZipToDb の
// 経路を通る。ここで実際に引っかかるのは yauzl の validateEntrySizes（申告と実際のバイト数の
// 食い違いを読み取ってストリームのエラーにする）。writeStreamCapped の予算は外側の受け皿＝
// 読み手が検証しなくなっても 1 GiB で頭打ちにする二重の層になっている。
describe('(h) 過少申告した capture は、書き出し中に打ち切られてディスクに残らない', () => {
  test('.tmp-import も本体も残らず、正当なエントリだけが残る', async () => {
    const dest = freshDest('understated');
    const { sqlite } = freshDb('understated');
    // 2 MiB のエントリが自分を 1 バイトだと申告する。申告サイズのガード（1 GiB / 64 GiB /
    // 16 MiB）はどれも通してしまう。
    const big = Buffer.alloc(2 * 1024 * 1024, 9);
    const zipPath = zipFileOf(forgeDeclaredSizes(await buildZipBytes({ 'library/cap1.jpg': 'JPEGDATA1', 'library/liar.bin': big }), (name) => (name === 'library/liar.bin' ? 1 : null)));

    const res = await importCompleteZipToDb(sqlite, zipPath, dest);

    // 正当な capture は入り、嘘をついたエントリは飛ばされる
    expect(fs.existsSync(path.join(dest, 'cap1.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'liar.bin'))).toBe(false);
    expect(fs.readdirSync(dest).filter((n) => n.includes('.tmp-import'))).toEqual([]);
    expect(res.skipped).toBeGreaterThan(0);
  });
});

describe('(i) 投稿サイドカー JSON の専用上限', () => {
  test('申告サイズが JSON 専用上限を超えれば展開前に拒否する', async () => {
    const dest = freshDest('capture-json-declared-bomb');
    const { sqlite } = freshDb('capture-json-declared-bomb');
    const bytes = await buildZipBytes({ 'library/cap.json': '{"captureId":"cap"}' });
    const zipPath = zipFileOf(forgeDeclaredSizes(bytes, (name) => (name === 'library/cap.json' ? MAX_ZIP_CAPTURE_JSON_BYTES + 1 : null)));

    await expect(importCompleteZipToDb(sqlite, zipPath, dest)).rejects.toThrow(ZipLimitError);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM posts').get()).toEqual({ n: 0 });
  });

  test('実際の展開バイト数も JSON 専用上限で打ち切る', async () => {
    const chunk = Buffer.alloc(MAX_ZIP_CAPTURE_JSON_BYTES / 2 + 1, 7);
    const source = Readable.from([chunk, chunk]);

    await expect(readStreamCapped(source, MAX_ZIP_CAPTURE_JSON_BYTES)).rejects.toThrow(ZipLimitError);
  });
});

// うごイラの再生（#506）は、書庫を開く3つ目の読み手＝レンダラーでの JSZip の利用を外へ出した
// 先。pixiv が配っている zip をそのまま持つ＝出所が第三者なので、他の2経路と同じ申告サイズの
// 集計を通り、さらに「1コマ＝静止画1枚」という専用の上限を持つ。書庫あたりの合計の上限は
// 無い（一度に1コマしか持たないので、抑える対象が無い）。
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
    expect(oversize).toBeLessThan(MAX_ZIP_ENTRY_BYTES); // 共有のガードではなく専用のガードが発火する位置に置く
    const zipPath = zipFileOf(forgeDeclaredSizes(await buildUgoiraZipBytes(), (name) => (name === '000001.jpg' ? oversize : null)));

    await expect(readUgoiraFrame(zipPath, '000001.jpg')).rejects.toThrow(ZipLimitError);
  });

  test('共有の件数ガードも効く（申告が多すぎる書庫）', async () => {
    const zipPath = zipFileOf(craftArchiveDeclaring(MAX_ZIP_ENTRIES + 5));

    await expect(ugoiraFramesPresent(zipPath, ['000000.jpg'])).rejects.toThrow(ZipLimitError);
  });

  test('1001コマを超えても順序どおり読め、中央ディレクトリの訪問は1周だけ', async () => {
    clearUgoiraArchiveIndexes();
    const files: Record<string, string> = {};
    const names = Array.from({ length: 1002 }, (_, i) => `${String(i).padStart(6, '0')}.jpg`);
    for (let i = 0; i < names.length; i++) files[names[i]] = `FRAME${i}`;
    const zipPath = zipFileOf(await buildZipBytes(files));

    expect(await ugoiraFramesPresent(zipPath, names)).toBe(true);
    const frames = await Promise.all(names.map((name) => readUgoiraFrame(zipPath, name)));

    expect(frames.map((frame) => frame?.toString('utf8'))).toEqual(names.map((_, i) => `FRAME${i}`));
    expect(ugoiraArchiveIndexStats()).toMatchObject({ cachedArchives: 1, indexedEntries: names.length, entryVisits: names.length, openHandles: 0, peakOpenHandles: 4 });
  });

  test('同時要求は同じ索引を共有する', async () => {
    clearUgoiraArchiveIndexes();
    const zipPath = zipFileOf(await buildUgoiraZipBytes());

    const frames = await Promise.all(Array.from({ length: 20 }, (_, i) => readUgoiraFrame(zipPath, `${String(i % 3).padStart(6, '0')}.jpg`)));

    expect(frames.map((frame) => frame?.toString('utf8'))).toEqual(Array.from({ length: 20 }, (_, i) => `FRAME${i % 3}`));
    expect(ugoiraArchiveIndexStats().entryVisits).toBe(3);
  });

  test('保持する索引と同時FDを上限内に抑え、読み取り終了時にハンドルを解放する', async () => {
    clearUgoiraArchiveIndexes();
    const paths = await Promise.all(Array.from({ length: 6 }, async (_, i) => zipFileOf(await buildZipBytes({ '000000.jpg': Buffer.alloc(256 * 1024, i) }))));

    const frames = await Promise.all(paths.map((zipPath) => readUgoiraFrame(zipPath, '000000.jpg')));
    expect(frames.every((frame) => frame?.length === 256 * 1024)).toBe(true);
    const stats = ugoiraArchiveIndexStats();
    expect(stats).toMatchObject({
      peakResidentArchives: 4,
      peakResidentEntries: 4,
      entryVisits: 6,
      openHandles: 0,
      peakOpenHandles: 4,
    });
    expect(stats.residentArchives).toBeLessThanOrEqual(4);
    expect(stats.residentEntries).toBeLessThanOrEqual(4);

    clearUgoiraArchiveIndexes();
    expect(ugoiraArchiveIndexStats()).toMatchObject({ cachedArchives: 0, indexedEntries: 0, residentArchives: 0, residentEntries: 0, openHandles: 0 });
  });

  test('stat 待機中に LRU から失効した索引を再登録せず、現在の索引を取り直す', async () => {
    clearUgoiraArchiveIndexes();
    const first = zipFileOf(await buildZipBytes({ '000000.jpg': 'FIRST' }));
    expect(await ugoiraFramesPresent(first, ['000000.jpg'])).toBe(true);

    const originalStat = fs.promises.stat.bind(fs.promises);
    let resumeStat: (() => void) | undefined;
    const statStopped = new Promise<void>((resolveStopped) => {
      vi.spyOn(fs.promises, 'stat').mockImplementation(async (filePath, options) => {
        if (filePath === first && !resumeStat) {
          await new Promise<void>((resolve) => {
            resumeStat = resolve;
            resolveStopped();
          });
        }
        return originalStat(filePath, options as never);
      });
    });

    try {
      const pending = ugoiraFramesPresent(first, ['000000.jpg']);
      await statStopped;
      const others = await Promise.all(Array.from({ length: 4 }, async (_, i) => zipFileOf(await buildZipBytes({ '000000.jpg': `OTHER${i}` }))));
      for (const zipPath of others) expect(await ugoiraFramesPresent(zipPath, ['000000.jpg'])).toBe(true);
      resumeStat?.();

      expect(await pending).toBe(true);
      expect(ugoiraArchiveIndexStats()).toMatchObject({ cachedArchives: 4, indexedEntries: 4, residentArchives: 4, residentEntries: 4, entryVisits: 6 });
    } finally {
      resumeStat?.();
      vi.restoreAllMocks();
    }
  });

  test('同じパスのファイルが置き換われば古い索引を失効する', async () => {
    clearUgoiraArchiveIndexes();
    const zipPath = zipFileOf(await buildZipBytes({ '000000.jpg': 'OLD' }));
    expect((await readUgoiraFrame(zipPath, '000000.jpg'))?.toString('utf8')).toBe('OLD');

    const replacement = `${zipPath}.replacement`;
    fs.writeFileSync(replacement, await buildZipBytes({ '000000.jpg': 'NEW', '000001.jpg': 'ADDED' }));
    fs.renameSync(replacement, zipPath);

    expect((await readUgoiraFrame(zipPath, '000001.jpg'))?.toString('utf8')).toBe('ADDED');
    expect(ugoiraArchiveIndexStats().entryVisits).toBe(3);
    fs.rmSync(zipPath);
    expect(fs.existsSync(zipPath)).toBe(false);
  });

  test('壊れたZIPを索引として残さず拒否する', async () => {
    clearUgoiraArchiveIndexes();
    const zipPath = zipFileOf(Buffer.from('not a zip'));

    await expect(readUgoiraFrame(zipPath, '000000.jpg')).rejects.toThrow();
    expect(ugoiraArchiveIndexStats()).toMatchObject({ cachedArchives: 0, indexedEntries: 0, openHandles: 0 });
  });
});
