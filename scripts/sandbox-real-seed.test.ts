// Real-data seeding for the sandbox verify instance (#286): scripts/lib-sandbox-real-seed.cts.
//
// A stand-in library is built here from a synthetic "real" library, so the two
// invariants the design rests on are checked rather than assumed:
//   1. the real library is never written to (checked by hashing it before and after);
//   2. the seeded sandbox knows no real path, and every generated image carries
//      the aspect ratio the database recorded (that ratio IS the layout fidelity
//      the stand-in method claims).

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { copyRealMedia, makePng, planStandins, scaleDims, seedRealSandbox, verifyIsolation } from './lib-sandbox-real-seed.cts';
import { seedLibrary } from './lib-seed-library.cts';
import { openDatabase } from '../app/src/main/lib-db';

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
      /* best-effort cleanup */
    }
  }
});

// PNG IHDR: 8-byte signature, 4-byte length, 'IHDR', then width/height.
function pngDims(file: string): { width: number; height: number } {
  const b = fs.readFileSync(file);
  expect(b.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

// -wal/-shm are excluded on purpose: reading a WAL database materializes SQLite's
// reader bookkeeping beside it when nothing else has it open. The .db itself and
// every media file are inside the hash, which is what "read-only" has to mean.
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

// A synthetic stand-in for the machine's real library: a config dir holding
// hologram.db, and a save folder holding the media the records reference.
function buildRealLibrary() {
  const root = mkdir('hologram-real-');
  const configDir = path.join(root, 'config');
  const saveFolder = path.join(root, 'library');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(path.join(saveFolder, 'avatars'), { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, backup: { dir: path.join(root, 'mirror'), interval: 3600 } }));

  const records: any[] = [];
  // p0: screenshot only — the card image is posts.image, sized by shotW/shotH.
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
  // p1: downloaded media — the card image is media[0], and posts.image (the
  // screenshot) has no recorded size, so it falls back to the placeholder.
  records.push({
    captureId: '1780000000001-a002',
    image: '1780000000001-a002.jpg',
    avatarFile: 'avatars/deadbeef.jpg', // shared avatar: referenced by both posts
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
  // p2: a video with a poster frame — the video file itself gets no stand-in.
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

  // Real bytes, distinguishable from any stand-in: a 3x2 red PNG under each name.
  const realBytes = makePng(3, 2, [255, 0, 0]);
  for (const name of ['1780000000000-a001.jpg', '1780000000001-a002.jpg', '1780000000001-a002-media-0.jpg', '1780000000002-a003.jpg', '1780000000002-a003-poster.jpg', '1780000000002-a003-media-0.mp4', 'avatars/deadbeef.jpg']) {
    fs.writeFileSync(path.join(saveFolder, name), realBytes);
  }
  seedLibrary(configDir, records);
  return { root, configDir, saveFolder, records, realBytes };
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
    const dbFile = path.join(sandboxConfig, 'hologram.db');
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
    // 画面キャプチャがカード画像＝shotW/shotH がそのまま比率になる。
    expect(pngDims(path.join(sandboxLibrary, '1780000000000-a001.jpg'))).toEqual({ width: 341, height: 512 });
    // ダウンロード済みメディア＝media.width/height（4000x3000 → 512x384）。
    expect(pngDims(path.join(sandboxLibrary, '1780000000001-a002-media-0.jpg'))).toEqual({ width: 512, height: 384 });
    // 動画のポスターはメディア行の寸法を使う（動画自体は生成できない）。
    expect(pngDims(path.join(sandboxLibrary, '1780000000002-a003-poster.jpg'))).toEqual({ width: 512, height: 288 });
  });

  test('寸法が無い参照は共通プレースホルダになる', () => {
    // カード画像が media 側にある投稿の画面キャプチャ（a002・a003）と、共有アバター
    // ＝DB がサイズを持たない3件。
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

  test('config はサンドボックスを指し、バックアップ先を引き継がない', () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(sandboxConfig, 'config.json'), 'utf8'));
    expect(cfg.saveFolder).toBe(sandboxLibrary);
    expect(cfg.backup).toBeUndefined();
  });

  test('隔離チェックが通る', () => {
    const res = verifyIsolation({
      dbFile: path.join(sandboxConfig, 'hologram.db'),
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

describe('隔離チェックは実パスの残留を捕まえる', () => {
  test('config が実ライブラリを指していれば落ちる', async () => {
    const real = buildRealLibrary();
    const sandboxRoot = mkdir('hologram-sandbox-bad-');
    const sandboxConfig = path.join(sandboxRoot, 'config');
    const sandboxLibrary = path.join(sandboxRoot, 'library');
    await seedRealSandbox({ realConfigDir: real.configDir, realSaveFolder: real.saveFolder, sandboxConfigDir: sandboxConfig, sandboxLibrary });

    // シード後に config を実ライブラリへ向け直す＝起動すれば実ライブラリへ書く。
    fs.writeFileSync(path.join(sandboxConfig, 'config.json'), JSON.stringify({ saveFolder: real.saveFolder, backup: { dir: path.join(real.root, 'mirror') } }));
    const res = verifyIsolation({
      dbFile: path.join(sandboxConfig, 'hologram.db'),
      configPath: path.join(sandboxConfig, 'config.json'),
      sandboxLibrary,
      realConfigDir: real.configDir,
      realSaveFolder: real.saveFolder,
    });
    expect(res.ok).toBe(false);
    expect(res.problems.join('\n')).toMatch(/saveFolder is not the sandbox library/);
    expect(res.problems.join('\n')).toMatch(/backup destination/);
  });

  test('スナップショットに絶対パスが入っていれば落ちる', async () => {
    const real = buildRealLibrary();
    const sandboxRoot = mkdir('hologram-sandbox-abs-');
    const sandboxConfig = path.join(sandboxRoot, 'config');
    const sandboxLibrary = path.join(sandboxRoot, 'library');
    await seedRealSandbox({ realConfigDir: real.configDir, realSaveFolder: real.saveFolder, sandboxConfigDir: sandboxConfig, sandboxLibrary });

    const dbFile = path.join(sandboxConfig, 'hologram.db');
    const { sqlite } = openDatabase(dbFile);
    // 実ライブラリの絶対パスを DB 内に持ち込む（将来そういう列が生えた時の検知）。
    sqlite.prepare('UPDATE posts SET description = ? WHERE captureId = ?').run(path.join(real.saveFolder, 'x.jpg'), '1780000000000-a001');
    sqlite.close();

    const res = verifyIsolation({ dbFile, configPath: path.join(sandboxConfig, 'config.json'), sandboxLibrary, realConfigDir: real.configDir, realSaveFolder: real.saveFolder });
    expect(res.ok).toBe(false);
    expect(res.problems.join('\n')).toMatch(/absolute path/);
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
    // 指定していない投稿は生成画像のまま。
    expect(fs.readFileSync(path.join(sandboxLibrary, '1780000000000-a001.jpg')).equals(real.realBytes)).toBe(false);
    expect(hashTree(real.root)).toBe(realHashBefore); // コピー元は読むだけ
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
    const dbFile = path.join(real.configDir, 'hologram.db');
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
    const dbFile = path.join(real.configDir, 'hologram.db');
    const sandboxLibrary = mkdir('hologram-sandbox-escape-');
    const { sqlite } = openDatabase(dbFile);
    sqlite.prepare('UPDATE posts SET image = ? WHERE captureId = ?').run('../escaped.jpg', '1780000000000-a001');
    const res = copyRealMedia(sqlite, ['1780000000000-a001'], real.saveFolder, sandboxLibrary);
    sqlite.close();
    // basename へ畳まれた上で実ファイルが無い＝missing 扱い。親ディレクトリには何も書かれない。
    expect(res.copied).not.toContain('../escaped.jpg');
    expect(fs.existsSync(path.join(path.dirname(sandboxLibrary), 'escaped.jpg'))).toBe(false);
  });
});
