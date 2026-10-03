// 検証用のサンドボックスに実データを流し込む側 (#286)＝scripts/lib-sandbox-real-seed.cts。
//
// ここでは合成した「実」ライブラリから代役のライブラリを組み立て、設計が乗っている2つの
// 不変条件を、前提にせず実際に見る:
//   1. 実ライブラリには一切書き込まない（前後でハッシュを取って確かめる）。
//   2. 種を蒔いたサンドボックスは実パスを1つも知らず、生成した画像はどれも DB が記録した
//      縦横比を持つ（この比率こそ、代役という手法が主張するレイアウトの忠実さそのもの）。

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { assertRealSeedPublishComplete, assertSandboxSeedProvenance, copyRealMedia, makePng, planStandins, recoverRealSeedAttempt, scaleDims, seedRealSandbox, verifyIsolation } from '../../scripts/lib-sandbox-real-seed.cts';
import { seedLibrary } from '../../scripts/lib-seed-library.cts';
import { openDatabase } from '../../app/src/main/lib-db';

const dirs: string[] = [];
function mkdir(prefix: string) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}

afterAll(() => {
  for (const d of dirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* できる範囲での片付け */
    }
  }
});

// PNG の IHDR: 8バイトのシグネチャ・4バイトの長さ・'IHDR'・そのあとに width/height。
function pngDims(file: string): { width: number; height: number } {
  const b = fs.readFileSync(file);
  expect(b.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

// -wal/-shm を外すのは意図してそうしている。WAL の DB を読むと、他に開いている者が居ない
// とき、SQLite の読み手用の帳簿がその隣に実体化する。.db 自身とすべてのメディアファイルは
// ハッシュの中に入っており、「読むだけ」が意味しなければいけないのはそこ。
function hashTree(dir: string): string {
  const h = crypto.createHash('sha256');
  const walk = (d: string, rel: string) => {
    for (const name of fs.readdirSync(d).sort()) {
      if (/\.db-(wal|shm)$/.test(name)) continue;
      const full = path.join(d, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full, `${rel}${name}/`);
      else {
        h.update(`${rel}${name}:${st.size}:`);
        h.update(fs.readFileSync(full));
      }
    }
  };
  walk(dir, '');
  return h.digest('hex');
}

// このマシンの実ライブラリを合成で置き換えたもの。マシン固有の設定を持つ config ディレクトリと、
// hologram.db（#176）とレコードが参照するメディアを持つ保存フォルダから成る。
function buildRealLibrary() {
  const root = mkdir('hologram-real-');
  const configDir = path.join(root, 'config');
  const saveFolder = path.join(root, 'library');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(path.join(saveFolder, 'avatars'), { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder }));

  const records: any[] = [];
  // p0: スクショだけ＝カードの画像は posts.image で、大きさは shotW/shotH。
  records.push({
    captureId: '1780000000000-a001',
    image: '1780000000000-a001.jpg',
    avatarFile: 'avatars/deadbeef.jpg',
    url: 'https://x.com/u/status/1',
    platform: 'x',
    text: '実データ本文0',
    displayName: '人0',
    screenName: 'u0',
    shotW: 800,
    shotH: 1200,
    capturedAt: '2026-04-01T12:00:00Z',
    media: [],
    tags: ['test'],
    hashtags: [],
  });
  // p1: 落としたメディアあり＝カードの画像は media[0]。posts.image（スクショ）は大きさが
  // 記録されていないので、代わりにプレースホルダを使う。
  records.push({
    captureId: '1780000000001-a002',
    image: '1780000000001-a002.jpg',
    avatarFile: 'avatars/deadbeef.jpg', // 共有のアバター。2つの投稿から参照される
    url: 'https://x.com/u/status/2',
    platform: 'x',
    text: '実データ本文1',
    displayName: '人1',
    screenName: 'u1',
    shotW: 1200,
    shotH: 900,
    capturedAt: '2026-04-02T12:00:00Z',
    media: [{ file: '1780000000001-a002-media-0.jpg', width: 4000, height: 3000, url: 'https://pbs.twimg.com/media/x.jpg' }],
    tags: [],
    hashtags: [],
  });
  // p2: ポスターフレーム付きの動画＝動画ファイル自身には代役を作らない。
  records.push({
    captureId: '1780000000002-a003',
    image: '1780000000002-a003.jpg',
    url: 'https://x.com/u/status/3',
    platform: 'x',
    text: '実データ本文2',
    displayName: '人2',
    screenName: 'u2',
    shotW: 640,
    shotH: 360,
    capturedAt: '2026-04-03T12:00:00Z',
    media: [{ file: '1780000000002-a003-media-0.mp4', type: 'video', posterFile: '1780000000002-a003-poster.jpg', width: 640, height: 360 }],
    tags: [],
    hashtags: [],
  });

  // どの代役とも見分けのつく実バイト＝どの名前にも 3x2 の赤い PNG を置く。
  const realBytes = makePng(3, 2, [255, 0, 0]);
  for (const name of ['1780000000000-a001.jpg', '1780000000001-a002.jpg', '1780000000001-a002-media-0.jpg', '1780000000002-a003.jpg', '1780000000002-a003-poster.jpg', '1780000000002-a003-media-0.mp4', 'avatars/deadbeef.jpg']) {
    fs.writeFileSync(path.join(saveFolder, name), realBytes);
  }
  seedLibrary(configDir, records);
  return { root, configDir, saveFolder, records, realBytes };
}

function expectFailedSeedWasRemoved(sandboxRoot: string) {
  expect(fs.existsSync(path.join(sandboxRoot, 'library'))).toBe(false);
  expect(fs.existsSync(path.join(sandboxRoot, 'config', 'config.json'))).toBe(false);
  expect(fs.readdirSync(sandboxRoot).filter((name) => name.startsWith('.hologram-real-seed-'))).toEqual([]);
  if (fs.existsSync(path.join(sandboxRoot, 'config'))) {
    expect(fs.readdirSync(path.join(sandboxRoot, 'config')).filter((name) => name.startsWith('.config.real-seed-'))).toEqual([]);
  }
}

async function seedInto(real: ReturnType<typeof buildRealLibrary>, sandboxRoot: string, captureIds: string[] = []) {
  return seedRealSandbox({
    realConfigDir: real.configDir,
    realSaveFolder: real.saveFolder,
    sandboxConfigDir: path.join(sandboxRoot, 'config'),
    sandboxLibrary: path.join(sandboxRoot, 'library'),
    captureIds,
  });
}

describe('scaleDims: 長辺を maxDim へ収め、比率は保つ', () => {
  test('上限以下はそのまま', () => {
    expect(scaleDims(400, 300, 512)).toEqual([400, 300]);
  });
  test('縦長・横長とも長辺が maxDim になる', () => {
    expect(scaleDims(4000, 3000, 512)).toEqual([512, 384]);
    expect(scaleDims(1000, 4000, 512)).toEqual([128, 512]);
  });
  test('つぶれない（最小1px）', () => {
    expect(scaleDims(10000, 3, 512)).toEqual([512, 1]);
  });
});

describe('実ライブラリからのシード', () => {
  let real: ReturnType<typeof buildRealLibrary>;
  let sandboxRoot: string;
  let sandboxConfig: string;
  let sandboxLibrary: string;
  let report: any;
  let realHashBefore: string;

  beforeAll(async () => {
    real = buildRealLibrary();
    realHashBefore = hashTree(real.root);
    sandboxRoot = mkdir('hologram-sandbox-');
    sandboxConfig = path.join(sandboxRoot, 'config');
    sandboxLibrary = path.join(sandboxRoot, 'library');
    report = await seedRealSandbox({
      realConfigDir: real.configDir,
      realSaveFolder: real.saveFolder,
      sandboxConfigDir: sandboxConfig,
      sandboxLibrary,
    });
  });

  test('スナップショットが全投稿を持つ（backup API 経由）', () => {
    const dbFile = path.join(sandboxLibrary, 'hologram.db');
    expect(fs.existsSync(dbFile)).toBe(true);
    const { sqlite } = openDatabase(dbFile, { readonly: true });
    expect((sqlite.prepare('SELECT count(*) c FROM posts').get() as any).c).toBe(3);
    sqlite.close();
    expect(report.db.posts).toBe(3);
  });

  test('実ライブラリは一切書き換わらない', () => {
    expect(hashTree(real.root)).toBe(realHashBefore);
  });

  test('スタンドインは DB が持つ縦横比で生成される', () => {
    // スクショがカードの画像＝shotW/shotH がそのまま比率になる。
    expect(pngDims(path.join(sandboxLibrary, '1780000000000-a001.jpg'))).toEqual({ width: 341, height: 512 });
    // 落としたメディア＝media.width/height（4000x3000 → 512x384）。
    expect(pngDims(path.join(sandboxLibrary, '1780000000001-a002-media-0.jpg'))).toEqual({ width: 512, height: 384 });
    // 動画のポスターは media の行の寸法を使う（動画そのものは生成できない）。
    expect(pngDims(path.join(sandboxLibrary, '1780000000002-a003-poster.jpg'))).toEqual({ width: 512, height: 288 });
  });

  test('寸法が無い参照は共通プレースホルダになる', () => {
    // カードの画像がメディア側にある投稿（a002・a003）のスクショと、共有のアバター＝
    // DB が大きさを持っていない3件。
    expect(pngDims(path.join(sandboxLibrary, '1780000000001-a002.jpg'))).toEqual({ width: 400, height: 400 });
    expect(pngDims(path.join(sandboxLibrary, 'avatars', 'deadbeef.jpg'))).toEqual({ width: 400, height: 400 });
    expect(report.standins.placeholders).toBe(3);
  });

  test('動画ファイルはスタンドインを持たない（再生は再現しない）', () => {
    expect(fs.existsSync(path.join(sandboxLibrary, '1780000000002-a003-media-0.mp4'))).toBe(false);
    expect(report.standins.videosAbsent).toBe(1);
  });

  test('実メディアは1枚も入らない（既定）', () => {
    for (const name of fs.readdirSync(sandboxLibrary)) {
      const full = path.join(sandboxLibrary, name);
      if (fs.statSync(full).isDirectory()) continue;
      expect(fs.readFileSync(full).equals(real.realBytes)).toBe(false);
    }
    expect(report.realMedia.files).toEqual([]);
  });

  test('config はサンドボックスだけを指す', () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(sandboxConfig, 'config.json'), 'utf8'));
    expect(cfg.saveFolder).toBe(sandboxLibrary);
  });

  test('隔離チェックが通る', () => {
    const res = verifyIsolation({
      dbFile: path.join(sandboxLibrary, 'hologram.db'),
      configPath: path.join(sandboxConfig, 'config.json'),
      sandboxLibrary,
      realConfigDir: real.configDir,
      realSaveFolder: real.saveFolder,
    });
    expect(res.problems).toEqual([]);
    expect(res.ok).toBe(true);
    expect(res.checked.mediaRefs).toBeGreaterThan(0);
  });
});

describe('生成 staging の durable flush', () => {
  test('生成物だけを書き込み可能 handle で開き、実 source は変更しない', async () => {
    const real = buildRealLibrary();
    const realHashBefore = hashTree(real.root);
    const sandboxRoot = mkdir('hologram-sandbox-flush-');
    const opened: Array<{ file: string; flags: string }> = [];
    const originalOpen = fs.openSync;
    vi.spyOn(fs, 'openSync').mockImplementation(((file: fs.PathLike, flags: fs.OpenMode, ...args: any[]) => {
      opened.push({ file: String(file), flags: String(flags) });
      return originalOpen(file, flags, ...(args as any));
    }) as typeof fs.openSync);
    try {
      await seedRealSandbox({
        realConfigDir: real.configDir,
        realSaveFolder: real.saveFolder,
        sandboxConfigDir: path.join(sandboxRoot, 'config'),
        sandboxLibrary: path.join(sandboxRoot, 'library'),
        successMarkerPath: path.join(sandboxRoot, 'seed.json'),
        publishReceiptPath: path.join(sandboxRoot, 'receipt.json'),
      });
    } finally {
      vi.restoreAllMocks();
    }

    const writableFlushes = opened.filter(({ flags }) => flags === 'r+');
    expect(writableFlushes.length).toBeGreaterThan(0);
    expect(writableFlushes.every(({ file }) => file.startsWith(sandboxRoot))).toBe(true);
    expect(opened.some(({ file, flags }) => file.startsWith(real.root) && flags === 'r+')).toBe(false);
    expect(hashTree(real.root)).toBe(realHashBefore);
  });
});

describe('隔離チェックは実パスの残留を捕まえる', () => {
  test('config が実ライブラリを指していれば落ちる', async () => {
    const real = buildRealLibrary();
    const sandboxRoot = mkdir('hologram-sandbox-bad-');
    const sandboxConfig = path.join(sandboxRoot, 'config');
    const sandboxLibrary = path.join(sandboxRoot, 'library');
    await seedRealSandbox({ realConfigDir: real.configDir, realSaveFolder: real.saveFolder, sandboxConfigDir: sandboxConfig, sandboxLibrary });

    // 種を蒔いたあとで config を実ライブラリへ向け直す＝この状態で起動すると実ライブラリへ書く。
    fs.writeFileSync(path.join(sandboxConfig, 'config.json'), JSON.stringify({ saveFolder: real.saveFolder }));
    const res = verifyIsolation({
      dbFile: path.join(sandboxLibrary, 'hologram.db'),
      configPath: path.join(sandboxConfig, 'config.json'),
      sandboxLibrary,
      realConfigDir: real.configDir,
      realSaveFolder: real.saveFolder,
    });
    expect(res.ok).toBe(false);
    expect(res.problems.join('\n')).toMatch(/saveFolder がサンドボックスのライブラリになっていない/);
  });

  test('スナップショットに絶対パスが入っていれば落ちる', async () => {
    const real = buildRealLibrary();
    const sandboxRoot = mkdir('hologram-sandbox-abs-');
    const sandboxConfig = path.join(sandboxRoot, 'config');
    const sandboxLibrary = path.join(sandboxRoot, 'library');
    await seedRealSandbox({ realConfigDir: real.configDir, realSaveFolder: real.saveFolder, sandboxConfigDir: sandboxConfig, sandboxLibrary });

    const dbFile = path.join(sandboxLibrary, 'hologram.db');
    const { sqlite } = openDatabase(dbFile);
    // 実ライブラリの絶対パスを DB へ忍び込ませる（将来そういう列が足されても捕まえられる）。
    sqlite.prepare('UPDATE posts SET text = ? WHERE captureId = ?').run(path.join(real.saveFolder, 'x.jpg'), '1780000000000-a001');
    sqlite.close();

    const res = verifyIsolation({ dbFile, configPath: path.join(sandboxConfig, 'config.json'), sandboxLibrary, realConfigDir: real.configDir, realSaveFolder: real.saveFolder });
    expect(res.ok).toBe(false);
    expect(res.problems.join('\n')).toMatch(/絶対パス/);
  });
});

describe('失敗した実データシードを次回の sandbox から隔離する', () => {
  test('隔離検査 ok:false なら生成途中の snapshot/config/メディアをすべて撤去する', async () => {
    const real = buildRealLibrary();
    const { sqlite } = openDatabase(path.join(real.saveFolder, 'hologram.db'));
    sqlite.prepare('UPDATE posts SET text = ? WHERE captureId = ?').run(real.saveFolder, '1780000000000-a001');
    sqlite.close();
    const sandboxRoot = mkdir('hologram-seed-false-');

    await expect(seedInto(real, sandboxRoot)).rejects.toThrow(/分離検証に失敗/);
    expectFailedSeedWasRemoved(sandboxRoot);
  });

  test('DB snapshot 作成失敗でも生成物を残さない', async () => {
    const real = buildRealLibrary();
    fs.rmSync(path.join(real.saveFolder, 'hologram.db'));
    const sandboxRoot = mkdir('hologram-seed-db-');

    await expect(seedInto(real, sandboxRoot)).rejects.toThrow(/データベースが見つからない/);
    expectFailedSeedWasRemoved(sandboxRoot);
  });

  test('DB 読み取り失敗でも生成物を残さない', async () => {
    const real = buildRealLibrary();
    const sandboxRoot = mkdir('hologram-seed-read-');
    const originalRead = fs.readFileSync;
    vi.spyOn(fs, 'readFileSync').mockImplementation(((file: fs.PathOrFileDescriptor, ...args: any[]) => {
      if (String(file).includes('.hologram-real-seed-') && String(file).endsWith('hologram.db')) throw new Error('injected read failure');
      return originalRead(file, ...(args as any));
    }) as typeof fs.readFileSync);
    try {
      await expect(seedInto(real, sandboxRoot)).rejects.toThrow('injected read failure');
    } finally {
      vi.restoreAllMocks();
    }
    expectFailedSeedWasRemoved(sandboxRoot);
  });

  test('DB query throw でも生成物を残さない', async () => {
    const real = buildRealLibrary();
    const { sqlite } = openDatabase(path.join(real.saveFolder, 'hologram.db'));
    sqlite.exec('DROP TABLE media');
    sqlite.close();
    const sandboxRoot = mkdir('hologram-seed-query-');

    await expect(seedInto(real, sandboxRoot)).rejects.toThrow(/media/);
    expectFailedSeedWasRemoved(sandboxRoot);
  });

  test('実メディア copy 失敗でも生成物と source を消さない', async () => {
    const real = buildRealLibrary();
    const realHashBefore = hashTree(real.root);
    const sandboxRoot = mkdir('hologram-seed-copy-');
    vi.spyOn(fs, 'copyFileSync').mockImplementation(() => {
      throw new Error('injected copy failure');
    });
    try {
      await expect(seedInto(real, sandboxRoot, ['1780000000001-a002'])).rejects.toThrow('injected copy failure');
    } finally {
      vi.restoreAllMocks();
    }
    expectFailedSeedWasRemoved(sandboxRoot);
    expect(hashTree(real.root)).toBe(realHashBefore);
  });

  test('config 書き込み失敗でも生成物を残さない', async () => {
    const real = buildRealLibrary();
    const sandboxRoot = mkdir('hologram-seed-config-');
    const originalWrite = fs.writeFileSync;
    vi.spyOn(fs, 'writeFileSync').mockImplementation(((file: fs.PathOrFileDescriptor, ...args: any[]) => {
      if (String(file).includes('.config.real-seed-')) throw new Error('injected config failure');
      return originalWrite(file, ...(args as any));
    }) as typeof fs.writeFileSync);
    try {
      await expect(seedInto(real, sandboxRoot)).rejects.toThrow('injected config failure');
    } finally {
      vi.restoreAllMocks();
    }
    expectFailedSeedWasRemoved(sandboxRoot);
  });

  test('source と同一・包含関係の生成先は書き込み前に拒否する', async () => {
    const real = buildRealLibrary();
    await expect(
      seedRealSandbox({
        realConfigDir: real.configDir,
        realSaveFolder: real.saveFolder,
        sandboxConfigDir: path.join(real.saveFolder, 'sandbox-config'),
        sandboxLibrary: path.join(real.saveFolder, 'sandbox-library'),
      }),
    ).rejects.toThrow(/包含しない実パス/);
    expect(fs.existsSync(path.join(real.saveFolder, 'sandbox-config'))).toBe(false);
    expect(fs.existsSync(path.join(real.saveFolder, 'sandbox-library'))).toBe(false);
  });

  test('marker rename と config cleanup が失敗しても receipt を残して fail closed にする', async () => {
    const real = buildRealLibrary();
    const sandboxRoot = mkdir('hologram-seed-config-publish-');
    const configPath = path.join(sandboxRoot, 'config', 'config.json');
    const markerPath = path.join(sandboxRoot, 'seed.json');
    const receiptPath = path.join(sandboxRoot, 'receipt.json');
    const originalRename = fs.renameSync;
    const originalRm = fs.rmSync;
    vi.spyOn(fs, 'renameSync').mockImplementation(((oldPath: fs.PathLike, newPath: fs.PathLike) => {
      if (String(newPath) === markerPath) throw new Error('injected marker rename failure');
      return originalRename(oldPath, newPath);
    }) as typeof fs.renameSync);
    vi.spyOn(fs, 'rmSync').mockImplementation(((target: fs.PathLike, options?: fs.RmDirOptions) => {
      if (String(target) === configPath) throw new Error('injected config cleanup failure');
      return originalRm(target, options);
    }) as typeof fs.rmSync);
    try {
      await expect(
        seedRealSandbox({
          realConfigDir: real.configDir,
          realSaveFolder: real.saveFolder,
          sandboxConfigDir: path.join(sandboxRoot, 'config'),
          sandboxLibrary: path.join(sandboxRoot, 'library'),
          successMarkerPath: markerPath,
          publishReceiptPath: receiptPath,
        }),
      ).rejects.toThrow(/cleanup/);
    } finally {
      vi.restoreAllMocks();
    }
    expect(fs.existsSync(receiptPath)).toBe(true);
    expect(() => assertRealSeedPublishComplete(receiptPath)).toThrow(/起動を拒否/);
    expect(fs.existsSync(path.join(sandboxRoot, 'library'))).toBe(false);
  });

  test('公開 library の逆 rename が失敗したら実DBと receipt を保持して fail closed にする', async () => {
    const real = buildRealLibrary();
    const sandboxRoot = mkdir('hologram-seed-library-publish-');
    const library = path.join(sandboxRoot, 'library');
    const configPath = path.join(sandboxRoot, 'config', 'config.json');
    const receiptPath = path.join(sandboxRoot, 'receipt.json');
    const originalRename = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation(((oldPath: fs.PathLike, newPath: fs.PathLike) => {
      if (String(newPath) === configPath) throw new Error('injected config rename failure');
      if (String(oldPath) === library) throw new Error('injected library rollback failure');
      return originalRename(oldPath, newPath);
    }) as typeof fs.renameSync);
    try {
      await expect(
        seedRealSandbox({
          realConfigDir: real.configDir,
          realSaveFolder: real.saveFolder,
          sandboxConfigDir: path.join(sandboxRoot, 'config'),
          sandboxLibrary: library,
          successMarkerPath: path.join(sandboxRoot, 'seed.json'),
          publishReceiptPath: receiptPath,
        }),
      ).rejects.toThrow(/cleanup/);
    } finally {
      vi.restoreAllMocks();
    }
    expect(fs.existsSync(path.join(library, 'hologram.db'))).toBe(true);
    expect(fs.existsSync(receiptPath)).toBe(true);
    expect(() => assertRealSeedPublishComplete(receiptPath)).toThrow(/起動を拒否/);
  });

  test('公開途中の中断 receipt は次回起動を拒否し、成功 marker 完成後は許可する', async () => {
    const interruptedRoot = mkdir('hologram-seed-interrupted-');
    const interruptedReceipt = path.join(interruptedRoot, 'receipt.json');
    fs.writeFileSync(interruptedReceipt, JSON.stringify({ state: 'publishing' }));
    fs.mkdirSync(path.join(interruptedRoot, 'library'));
    fs.writeFileSync(path.join(interruptedRoot, 'library', 'hologram.db'), 'fake private db');
    expect(() => assertRealSeedPublishComplete(interruptedReceipt)).toThrow(/起動を拒否/);

    const real = buildRealLibrary();
    const successRoot = mkdir('hologram-seed-success-receipt-');
    const successReceipt = path.join(successRoot, 'receipt.json');
    const marker = path.join(successRoot, 'seed.json');
    await seedRealSandbox({
      realConfigDir: real.configDir,
      realSaveFolder: real.saveFolder,
      sandboxConfigDir: path.join(successRoot, 'config'),
      sandboxLibrary: path.join(successRoot, 'library'),
      successMarkerPath: marker,
      publishReceiptPath: successReceipt,
    });
    expect(fs.existsSync(marker)).toBe(true);
    expect(fs.existsSync(successReceipt)).toBe(false);
    expect(() => assertRealSeedPublishComplete(successReceipt)).not.toThrow();
  });

  test('junction 相当の生成先でも source を保持する', async () => {
    const real = buildRealLibrary();
    const sandboxRoot = mkdir('hologram-seed-link-');
    const linkedLibrary = path.join(sandboxRoot, 'linked-library');
    fs.symlinkSync(real.saveFolder, linkedLibrary, process.platform === 'win32' ? 'junction' : 'dir');
    const before = hashTree(real.root);

    await expect(
      seedRealSandbox({
        realConfigDir: real.configDir,
        realSaveFolder: real.saveFolder,
        sandboxConfigDir: path.join(sandboxRoot, 'config'),
        sandboxLibrary: linkedLibrary,
      }),
    ).rejects.toThrow(/包含しない実パス/);
    expect(hashTree(real.root)).toBe(before);
    expect(fs.existsSync(linkedLibrary)).toBe(true);
  });

  test('receipt に所有記録された staging だけを reseed 回復で撤去する', () => {
    const root = mkdir('hologram-seed-recover-');
    const attemptId = 'a'.repeat(32);
    const library = path.join(root, 'library');
    const config = path.join(root, 'config', 'config.json');
    const marker = path.join(root, 'seed.json');
    const receipt = path.join(root, 'receipt.json');
    const stagingLibrary = path.join(root, `.hologram-real-seed-${attemptId}`);
    const stagingConfig = path.join(root, 'config', `.config.real-seed-${attemptId}.json`);
    const stagingMarker = `${marker}.real-seed-${attemptId}`;
    const unrelated = path.join(root, '.hologram-real-seed-unrelated');
    fs.mkdirSync(stagingLibrary);
    fs.mkdirSync(path.dirname(stagingConfig));
    fs.mkdirSync(unrelated);
    fs.writeFileSync(stagingConfig, 'staging');
    fs.writeFileSync(stagingMarker, 'staging');
    fs.writeFileSync(receipt, JSON.stringify({ version: 1, state: 'preparing', attemptId, library, config, marker, stagingLibrary, stagingConfig, stagingMarker }));

    recoverRealSeedAttempt(receipt, { library, config, marker });
    expect(fs.existsSync(stagingLibrary)).toBe(false);
    expect(fs.existsSync(stagingConfig)).toBe(false);
    expect(fs.existsSync(stagingMarker)).toBe(false);
    expect(fs.existsSync(receipt)).toBe(false);
    expect(fs.existsSync(unrelated)).toBe(true);
  });

  test('reseed の staging cleanup は独立して試し、失敗時は receipt を保持する', () => {
    const root = mkdir('hologram-seed-recover-failure-');
    const attemptId = 'c'.repeat(32);
    const library = path.join(root, 'library');
    const config = path.join(root, 'config', 'config.json');
    const marker = path.join(root, 'seed.json');
    const receipt = path.join(root, 'receipt.json');
    const stagingLibrary = path.join(root, `.hologram-real-seed-${attemptId}`);
    const stagingConfig = path.join(root, 'config', `.config.real-seed-${attemptId}.json`);
    const stagingMarker = `${marker}.real-seed-${attemptId}`;
    fs.mkdirSync(stagingLibrary);
    fs.mkdirSync(path.dirname(stagingConfig));
    fs.writeFileSync(stagingConfig, 'locked');
    fs.writeFileSync(stagingMarker, 'remove me');
    fs.writeFileSync(receipt, JSON.stringify({ version: 1, state: 'preparing', attemptId, library, config, marker, stagingLibrary, stagingConfig, stagingMarker }));
    const originalRm = fs.rmSync;
    vi.spyOn(fs, 'rmSync').mockImplementation(((target: fs.PathLike, options?: fs.RmDirOptions) => {
      if (String(target) === stagingConfig) throw new Error('injected staging cleanup lock');
      return originalRm(target, options);
    }) as typeof fs.rmSync);
    try {
      expect(() => recoverRealSeedAttempt(receipt, { library, config, marker })).toThrow(/receipt を保持/);
    } finally {
      vi.restoreAllMocks();
    }
    expect(fs.existsSync(stagingLibrary)).toBe(false);
    expect(fs.existsSync(stagingMarker)).toBe(false);
    expect(fs.existsSync(stagingConfig)).toBe(true);
    expect(fs.existsSync(receipt)).toBe(true);
  });

  test('不正 receipt の任意 staging path と既存データは削除しない', () => {
    const root = mkdir('hologram-seed-invalid-receipt-');
    const library = path.join(root, 'library');
    const config = path.join(root, 'config.json');
    const marker = path.join(root, 'seed.json');
    const receipt = path.join(root, 'receipt.json');
    const existing = path.join(root, 'existing');
    fs.mkdirSync(existing);
    fs.writeFileSync(path.join(existing, 'keep.txt'), 'keep');
    fs.writeFileSync(receipt, JSON.stringify({ version: 1, state: 'preparing', attemptId: 'b'.repeat(32), library, config, marker, stagingLibrary: existing, stagingConfig: path.join(root, 'x'), stagingMarker: path.join(root, 'y') }));

    expect(() => recoverRealSeedAttempt(receipt, { library, config, marker })).toThrow(/自動削除しません|任意パスを削除しません/);
    expect(fs.readFileSync(path.join(existing, 'keep.txt'), 'utf8')).toBe('keep');
    expect(fs.existsSync(receipt)).toBe(true);
  });

  test('receipt なしDBは provenance 不明として通常起動を拒否し既存データを保持する', () => {
    const root = mkdir('hologram-seed-unmarked-');
    const library = path.join(root, 'library');
    fs.mkdirSync(library);
    fs.writeFileSync(path.join(library, 'hologram.db'), 'unknown existing db');
    const before = fs.readFileSync(path.join(library, 'hologram.db'));

    expect(() => assertSandboxSeedProvenance({ receiptPath: path.join(root, 'receipt.json'), markerPath: path.join(root, 'seed.json'), library })).toThrow(/provenance/);
    expect(fs.readFileSync(path.join(library, 'hologram.db')).equals(before)).toBe(true);
  });

  test.each(['real', 'fixture'])('正常な %s 成功 metadata は通常起動を許可する', (mode) => {
    const root = mkdir(`hologram-seed-${mode}-`);
    const library = path.join(root, 'library');
    fs.mkdirSync(library);
    fs.writeFileSync(path.join(library, 'hologram.db'), 'known db');
    const marker = path.join(root, 'seed.json');
    fs.writeFileSync(marker, JSON.stringify({ mode }));
    expect(() => assertSandboxSeedProvenance({ receiptPath: path.join(root, 'receipt.json'), markerPath: marker, library })).not.toThrow();
  });

  test('missing parent を持つ別々の nested roots に正常シードできる', async () => {
    const real = buildRealLibrary();
    const root = mkdir('hologram-seed-missing-parents-');
    const sandboxConfigDir = path.join(root, 'state', 'deep', 'config');
    const sandboxLibrary = path.join(root, 'data', 'deep', 'library');
    await seedRealSandbox({ realConfigDir: real.configDir, realSaveFolder: real.saveFolder, sandboxConfigDir, sandboxLibrary });
    expect(fs.existsSync(path.join(sandboxLibrary, 'hologram.db'))).toBe(true);
    expect(fs.existsSync(path.join(sandboxConfigDir, 'config.json'))).toBe(true);
  });

  test('library/config/marker/receipt の pairwise 衝突を staging 前に拒否する', async () => {
    const real = buildRealLibrary();
    const root = mkdir('hologram-seed-collision-');
    const library = path.join(root, 'output');
    await expect(
      seedRealSandbox({
        realConfigDir: real.configDir,
        realSaveFolder: real.saveFolder,
        sandboxConfigDir: path.join(root, 'config'),
        sandboxLibrary: library,
        successMarkerPath: path.join(library, 'seed.json'),
        publishReceiptPath: path.join(root, 'receipt.json'),
      }),
    ).rejects.toThrow(/相互に同一でも包含関係でもない/);
    expect(fs.existsSync(library)).toBe(false);
  });
});

describe('特定投稿だけ実物をピンポイントコピー', () => {
  test('指定した captureId のファイルだけ実バイトに置き換わる', async () => {
    const real = buildRealLibrary();
    const realHashBefore = hashTree(real.root);
    const sandboxRoot = mkdir('hologram-sandbox-pin-');
    const sandboxConfig = path.join(sandboxRoot, 'config');
    const sandboxLibrary = path.join(sandboxRoot, 'library');
    const report = await seedRealSandbox({
      realConfigDir: real.configDir,
      realSaveFolder: real.saveFolder,
      sandboxConfigDir: sandboxConfig,
      sandboxLibrary,
      captureIds: ['1780000000001-a002'],
    });

    expect(report.realMedia.files.sort()).toEqual(['1780000000001-a002-media-0.jpg', '1780000000001-a002.jpg', 'avatars/deadbeef.jpg']);
    expect(fs.readFileSync(path.join(sandboxLibrary, '1780000000001-a002-media-0.jpg')).equals(real.realBytes)).toBe(true);
    // 指定しなかった投稿は、生成した画像のまま。
    expect(fs.readFileSync(path.join(sandboxLibrary, '1780000000000-a001.jpg')).equals(real.realBytes)).toBe(false);
    expect(hashTree(real.root)).toBe(realHashBefore); // 複製元は読むだけ
  });

  test('存在しない captureId は黙って通さず報告する', async () => {
    const real = buildRealLibrary();
    const sandboxRoot = mkdir('hologram-sandbox-unknown-');
    const sandboxConfig = path.join(sandboxRoot, 'config');
    const sandboxLibrary = path.join(sandboxRoot, 'library');
    const report = await seedRealSandbox({
      realConfigDir: real.configDir,
      realSaveFolder: real.saveFolder,
      sandboxConfigDir: sandboxConfig,
      sandboxLibrary,
      captureIds: ['nope-0000'],
    });
    expect(report.realMedia.unknownIds).toEqual(['nope-0000']);
    expect(report.realMedia.files).toEqual([]);
  });
});

describe('planStandins: DB の参照だけを対象にする', () => {
  test('ゴミ箱の投稿は飛ばす（.trash 側の JSON レコードは複製できない）', () => {
    const real = buildRealLibrary();
    const dbFile = path.join(real.saveFolder, 'hologram.db');
    const { sqlite } = openDatabase(dbFile);
    sqlite.prepare('UPDATE posts SET trashedAt = ? WHERE captureId = ?').run('2026-04-05T00:00:00Z', '1780000000000-a001');
    const plan = planStandins(sqlite);
    sqlite.close();
    expect(plan.trashedPosts).toBe(1);
    expect(plan.postCount).toBe(3);
    expect([...plan.files.keys()]).not.toContain('1780000000000-a001.jpg');
  });

  test('copyRealMedia は保存フォルダの外へ出ない', () => {
    const real = buildRealLibrary();
    const dbFile = path.join(real.saveFolder, 'hologram.db');
    const sandboxLibrary = mkdir('hologram-sandbox-escape-');
    const { sqlite } = openDatabase(dbFile);
    sqlite.prepare('UPDATE posts SET image = ? WHERE captureId = ?').run('../escaped.jpg', '1780000000000-a001');
    const res = copyRealMedia(sqlite, ['1780000000000-a001'], real.saveFolder, sandboxLibrary);
    sqlite.close();
    // basename へ畳まれ、そこに実ファイルは無い＝欠落として扱う。親ディレクトリには何も書かない。
    expect(res.copied).not.toContain('../escaped.jpg');
    expect(fs.existsSync(path.join(path.dirname(sandboxLibrary), 'escaped.jpg'))).toBe(false);
  });
});
