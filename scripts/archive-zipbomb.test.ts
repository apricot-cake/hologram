// app/src/main/lib-archive.ts#importCompleteZipToDb の zip 爆弾／無制限展開の回帰テスト。
//   (a) 普通の完全書き出し ZIP（capture + folders.json）は取り込める
//   (b) 展開後サイズの申告合計が上限を超える書庫は拒否する
//   (c) エントリ数が多すぎる書庫は拒否する
//   (d) 単一エントリの申告サイズが上限を超えるものは拒否する
//   (e) ストリーム書き込みは、実際の出力バイト数が1エントリ分の予算を超えたら中断する
//       （中央ディレクトリが過少申告してくる攻撃への防御）
//   (f) 整理用 JSON（folders.json 等）専用の上限（#382）: 申告サイズが専用上限を超える
//       ものは展開前に拒否し、上限内なら従来どおりマージできる
//   (g) 整理用 JSON 専用上限は、実際の出力バイト数でも打ち切る（申告値の偽装への防御）
// どの拒否でも、悪意あるペイロードや .tmp-import をディスクに残してはいけない。
//
// 補足: 実際の上限は GiB 級で、ユニットテストで本物の圧縮から作るのは非現実的。(b)-(d),(f) は
// 読み込んだエントリの申告 `uncompressedSize`（展開前ガードが ZIP 中央ディレクトリから読む値）
// を偽装して、解凍前にガードが発火する経路＝巨大サイズを申告する爆弾の本番経路そのものを踏む。
// (e),(g) だけは小さい予算と本物の複数チャンクのデータでストリーム側の上限を直接踏む。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { MAX_ZIP_ENTRIES, MAX_ZIP_ENTRY_BYTES, MAX_ZIP_ORG_BYTES, MAX_ZIP_TOTAL_BYTES, ZipLimitError, importCompleteZipToDb, readEntryCapped, writeEntryStreamed } from '../app/src/main/lib-archive';
import { openDatabase } from '../app/src/main/lib-db';
import { createDbWriter } from '../app/src/main/lib-db-write';

// loadAsync が各非ディレクトリエントリの申告サイズを上書きする JSZip コンストラクタの
// ラッパ。GiB のデータを実体化せずに爆弾を模せる。sizeFor(relPath, index) が偽装値を返す。
function ForgingJSZip(sizeFor: (rel: string, i: number) => number) {
  const Wrap = function () {
    return new JSZip();
  };
  Wrap.loadAsync = async (buf: Buffer) => {
    const z = await JSZip.loadAsync(buf);
    let i = 0;
    z.forEach((rel, e: any) => {
      if (!e.dir && e._data) e._data.uncompressedSize = sizeFor(rel, i++);
    });
    return z;
  };
  return Wrap;
}

let root: string;
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

// 下の偽装ケースが使い回す小さな実 ZIP。
// n=80（>64）＝1エントリ上限すれすれを80個並べると合計上限を超える。
let small: { buf: Buffer; n: number };

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-zipbomb-'));

  const zip = new JSZip();
  const n = 80;
  for (let i = 0; i < n; i++) zip.file(`library/z${i}.bin`, Buffer.from(`tiny${i}`));
  small = { buf: await zip.generateAsync({ type: 'nodebuffer' }), n };
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
    const zip = new JSZip();
    zip.file('library/cap1.jpg', Buffer.from('JPEGDATA1'));
    zip.file('library/cap2.jpg', Buffer.from('JPEGDATA2'));
    zip.file('library/folders.json', JSON.stringify({ folders: [{ id: 'f1', name: 'X', items: ['cap1'] }] }));

    handle = freshDb('normal');
    res = await importCompleteZipToDb(handle.sqlite, JSZip, dest, await zip.generateAsync({ type: 'nodebuffer' }));
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
    expect(small.n * each).toBeGreaterThan(MAX_ZIP_TOTAL_BYTES);
  });

  test('ZipLimitError で拒否し、何も書かない', async () => {
    const dest = freshDest('total-bomb');
    const { sqlite } = freshDb('total-bomb');

    await expect(
      importCompleteZipToDb(
        sqlite,
        ForgingJSZip(() => each),
        dest,
        small.buf,
      ),
    ).rejects.toThrow(ZipLimitError);
    expect(fs.readdirSync(dest)).toEqual([]);
  });
});

// MAX_ZIP_ENTRIES 個の実エントリを generateAsync で作ると分単位かかるので、forEach が
// MAX_ZIP_ENTRIES+5 個の極小エントリを流す合成 loadAsync を使う＝本物の爆弾と同じように
// importCompleteZipToDb の件数集計を駆動できる。
describe('(c) エントリ数が多すぎる', () => {
  test('ZipLimitError で拒否し、何も書かない', async () => {
    const dest = freshDest('count-bomb');
    const { sqlite } = freshDb('count-bomb');
    const count = MAX_ZIP_ENTRIES + 5;
    const SyntheticJSZip = function () {
      return new JSZip();
    };
    SyntheticJSZip.loadAsync = async () => ({
      forEach(cb: (rel: string, e: any) => void) {
        for (let i = 0; i < count; i++) cb(`library/e${i}.txt`, { dir: false, _data: { uncompressedSize: 1 } });
      },
      file: () => null,
    });

    await expect(importCompleteZipToDb(sqlite, SyntheticJSZip, dest, Buffer.alloc(0))).rejects.toThrow(ZipLimitError);
    expect(fs.readdirSync(dest)).toEqual([]);
  });
});

describe('(d) 単一エントリが1エントリ上限超え', () => {
  test('先頭1件だけ偽装しても ZipLimitError で拒否し、何も書かない', async () => {
    const dest = freshDest('entry-bomb');
    const { sqlite } = freshDb('entry-bomb');
    const oversize = MAX_ZIP_ENTRY_BYTES + 1;

    await expect(
      importCompleteZipToDb(
        sqlite,
        ForgingJSZip((_rel, i) => (i === 0 ? oversize : 4)),
        dest,
        small.buf,
      ),
    ).rejects.toThrow(ZipLimitError);
    expect(fs.readdirSync(dest)).toEqual([]);
  });
});

describe('(e) ストリーム書き込みの予算', () => {
  let entry: any;
  let dest: string;
  const payload = Buffer.alloc(256 * 1024, 7); // 256 KiB＝ストリームを複数チャンクで通る

  beforeAll(async () => {
    dest = freshDest('stream-cap');
    const zip = new JSZip();
    zip.file('library/big.bin', payload);
    const z = await JSZip.loadAsync(await zip.generateAsync({ type: 'nodebuffer' }));
    entry = z.file('library/big.bin');
  });

  test('予算超過（64 KiB 予算 < 256 KiB ペイロード）で中断する', async () => {
    await expect(writeEntryStreamed(entry, path.join(dest, 'big.bin.tmp-import'), 64 * 1024)).rejects.toThrow(ZipLimitError);
  });

  test('予算内（1 MiB 予算）なら最後まで書く', async () => {
    const tmp = path.join(dest, 'ok.bin.tmp-import');
    await writeEntryStreamed(entry, tmp, 1024 * 1024);

    expect(fs.statSync(tmp).size).toBe(payload.length);
  });
});

describe('(f) 整理用JSONの専用上限（#382）', () => {
  const buildNormalZip = async () => {
    const zip = new JSZip();
    zip.file('library/cap1.jpg', Buffer.from('JPEGDATA1'));
    zip.file('library/folders.json', JSON.stringify({ folders: [{ id: 'f1', name: 'X', items: ['cap1'] }] }));
    return zip.generateAsync({ type: 'nodebuffer' });
  };

  test('folders.json の申告サイズが専用上限（16 MiB）超え → ZipLimitError で拒否し、何も書かない', async () => {
    const dest = freshDest('org-declared-bomb');
    const { sqlite } = freshDb('org-declared-bomb');
    const buf = await buildNormalZip();
    const oversize = MAX_ZIP_ORG_BYTES + 1; // still well under MAX_ZIP_ENTRY_BYTES — only the org-specific guard should fire

    await expect(
      importCompleteZipToDb(
        sqlite,
        ForgingJSZip((rel) => (rel === 'library/folders.json' ? oversize : 4)),
        dest,
        buf,
      ),
    ).rejects.toThrow(ZipLimitError);
    expect(fs.readdirSync(dest)).toEqual([]);
  });

  test('folders.json が専用上限内なら従来どおりマージできる（回帰）', async () => {
    const dest = freshDest('org-normal');
    const { sqlite } = freshDb('org-normal');
    const buf = await buildNormalZip();

    const res = await importCompleteZipToDb(sqlite, JSZip, dest, buf);
    expect(res.imported).toBeGreaterThan(0);
    expect(
      createDbWriter(sqlite)
        .getFolders()
        .folders.map((f: any) => f.id),
    ).toEqual(['f1']);
  });
});

describe('(g) 整理用JSON専用上限は実際の出力バイト数でも打ち切る（申告値偽装への防御）', () => {
  let entry: any;
  const payload = Buffer.alloc(256 * 1024, 7); // 256 KiB＝ストリームを複数チャンクで通る

  beforeAll(async () => {
    const zip = new JSZip();
    zip.file('library/folders.json', payload);
    const z = await JSZip.loadAsync(await zip.generateAsync({ type: 'nodebuffer' }));
    entry = z.file('library/folders.json');
  });

  test('予算超過（64 KiB 予算 < 256 KiB 実データ）で中断する', async () => {
    await expect(readEntryCapped(entry, 64 * 1024)).rejects.toThrow(ZipLimitError);
  });

  test('予算内（1 MiB 予算）なら最後まで読み切る', async () => {
    const buf = await readEntryCapped(entry, 1024 * 1024);
    expect(buf.length).toBe(payload.length);
  });
});
