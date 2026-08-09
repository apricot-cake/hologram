// app/src/main/lib-archive.ts にある2つの取り込み経路（完全形式の importCompleteZipToDb と
// 旧形式の readLegacyZipPosts）に対する、zip bomb・展開量の歯止め無しへの回帰テスト。
//   (a) 普通の完全書き出しの ZIP（capture + folders.json）が問題なく取り込める
//   (b) 展開後の合計サイズの申告が上限を超える書庫は拒む
//   (c) エントリ数を多く申告した書庫は拒む
//   (d) 1エントリの申告サイズだけで1エントリ上限を超えるものは拒む
//   (e) 実際の出力バイト数が1エントリぶんの予算を超えたら、ストリーム書き込みを中断する
//       （中央ディレクトリがサイズを過少申告してくる攻撃への防御）
//   (f) 整理用の JSON（folders.json など）には専用の上限がある（#382）＝専用上限を超える
//       申告は展開する前に拒み、上限内なら従来どおり合流できる
//   (g) 整理用 JSON の専用上限は、実際の出力バイト数でも打ち切る（申告値の偽装への防御）
//   (i) 旧形式（metadata.json + images/）の入口も同じ申告サイズのガードを通り、さらに
//       メモリ上への展開に専用の上限がある（#322）
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

// #322 までの旧形式（#300 より前の metadata.json + images/）は別経路で、申告サイズのガードを
// 1つも通っていなかった＝レンダラーが自分で JSZip を使って開き、参照している画像をすべて
// メモリ上で base64 へ展開していた。main の readLegacyZipPosts へ移した今は、完全形式と同じ
// 申告サイズの集計（件数／1エントリ／合計）を通り、さらにメモリ上への展開に専用の上限が
// 2つある。
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
    expect(oversize).toBeLessThan(MAX_ZIP_ENTRY_BYTES); // 共有のガードではなく専用のガードが発火する位置に置く
    const zipPath = zipFileOf(forgeDeclaredSizes(await buildLegacyZipBytes(2), (name) => (name === 'images/p1.jpg' ? oversize : null)));

    await expect(readLegacyZipPosts(zipPath)).rejects.toThrow(ZipLimitError);
  });

  test('metadata.json 自身が旧形式専用の単体上限を超えていれば、1バイトも読まずに拒否する', async () => {
    const zipPath = zipFileOf(forgeDeclaredSizes(await buildLegacyZipBytes(2), (name) => (name === 'metadata.json' ? MAX_LEGACY_ENTRY_BYTES + 1 : null)));

    await expect(readLegacyZipPosts(zipPath)).rejects.toThrow(ZipLimitError);
  });

  test('参照画像の申告合計が展開上限（1 GiB）を超えれば拒否する', async () => {
    const each = 60 * 1024 * 1024; // 1エントリ上限（64 MiB）より下＝発火しうるのは合計のガードだけ
    const n = 20;
    expect(n * each).toBeGreaterThan(MAX_LEGACY_TOTAL_BYTES);
    expect(n * each).toBeLessThan(MAX_ZIP_TOTAL_BYTES); // 共有の合計ガードは発火しない
    const zipPath = zipFileOf(forgeDeclaredSizes(await buildLegacyZipBytes(n), (name) => (name === 'metadata.json' ? null : each)));

    await expect(readLegacyZipPosts(zipPath)).rejects.toThrow(ZipLimitError);
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
});
