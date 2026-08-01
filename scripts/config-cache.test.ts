// Unit tests for the in-memory cache of config.json (app/src/main/lib-config.ts, #61).
//
// What's scary about adding a cache isn't speed, it's **continuing to return a stale value**,
// so this suite isn't about "is it fast" but "does it lie". In particular, every writer in
// lib-config.ts does read-modify-write — if a read is stale, the next write writes that stale
// value back to disk and **erases the outside change** (the same failure mode as the
// 2026-06-23 incident where the save location was lost). So we pin down these four things:
//   1. Reading right after a write returns the new value (write-through)
//   2. Reading the same value repeatedly doesn't reopen the file (the cache is actually working)
//   3. If the file is rewritten outside the app, the next read picks it up
//      = both when it's replaced via rename (editors, atomic writes)
//        and when it's overwritten in place with the same byte count
//   4. If a write fails, the cache doesn't move (never returns a value that isn't on disk)
//
// We don't use Electron, but lib-config.ts pulls it in via native-host.ts, so only that gets
// swapped out (it also doubles as pointing configDir at a temp folder for the test). Since
// CONFIG_PATH is fixed at module load time, each test creates a "fresh boot" via
// vi.resetModules() + dynamic import.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const env = vi.hoisted(() => ({ dir: '' }));

vi.mock('../app/src/main/native-host.ts', async () => {
  // Use the real save-folder resolution logic (we want to exercise getSaveFolder's recovery path too).
  const { resolveSaveFolder } = await import('../native-host/config-recovery.cts');
  return {
    configDir: () => env.dir,
    defaultLibraryDir: () => path.join(env.dir, 'default-library'),
    resolveSaveFolder,
  };
});

type LibConfig = typeof import('../app/src/main/lib-config');

let dir: string;
let configPath: string;
let reads: number;

// Count only how many times config.json was "opened" (ignore reads of other files like saveFolder.path).
function countConfigReads() {
  reads = 0;
  const real = fs.readFileSync;
  vi.spyOn(fs, 'readFileSync').mockImplementation((file: any, ...rest: any[]) => {
    if (file === configPath) reads++;
    return (real as any)(file, ...rest);
  });
}

async function freshModule(): Promise<LibConfig> {
  vi.resetModules();
  return import('../app/src/main/lib-config');
}

/** A rewrite from outside the app. rename = the path taken by editors or atomic writes. */
function writeOutside(text: string, { viaRename = false } = {}) {
  if (viaRename) {
    const tmp = `${configPath}.outside`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, configPath);
  } else {
    fs.writeFileSync(configPath, text);
  }
}

/** Advance only the file's mtime = deterministically simulate "manually fixed a while later". */
function ageMtime(ms: number) {
  const when = new Date(Date.now() + ms);
  fs.utimesSync(configPath, when, when);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-cfgcache-'));
  env.dir = dir;
  configPath = path.join(dir, 'config.json');
  reads = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('書いた直後に読む', () => {
  test('writeConfig の値がそのまま readConfig に出る', async () => {
    const { readConfig, writeConfig } = await freshModule();
    writeConfig({ saveFolder: 'D:\\lib', theme: 'dark' });
    expect(readConfig()).toEqual({ saveFolder: 'D:\\lib', theme: 'dark' });
  });

  test('書き換えるたびに最新が出る（前の値が居座らない）', async () => {
    const { readConfig, writeConfig, getSaveFolder } = await freshModule();
    writeConfig({ saveFolder: 'D:\\one' });
    expect(getSaveFolder()).toBe('D:\\one');
    writeConfig({ saveFolder: 'D:\\two' });
    expect(getSaveFolder()).toBe('D:\\two');
    expect(readConfig().saveFolder).toBe('D:\\two');
    // The same value is on disk too = it's not just the cache moving ahead on its own.
    expect(JSON.parse(fs.readFileSync(configPath, 'utf8')).saveFolder).toBe('D:\\two');
  });

  test('別々のキーを続けて書いても取りこぼさない（read-modify-write の往復）', async () => {
    const { readConfig, writeConfig } = await freshModule();
    writeConfig({ saveFolder: 'D:\\lib' });
    const a = readConfig();
    a.theme = 'dark';
    writeConfig(a);
    const b = readConfig();
    b.language = 'ja';
    writeConfig(b);
    expect(readConfig()).toEqual({ saveFolder: 'D:\\lib', theme: 'dark', language: 'ja' });
  });
});

describe('キャッシュが実際に効いている', () => {
  test('書いたあとは何度読んでも config.json を開き直さない', async () => {
    const { readConfig, getSaveFolder, writeConfig } = await freshModule();
    writeConfig({ saveFolder: 'D:\\lib' });
    countConfigReads();
    for (let i = 0; i < 5; i++) {
      expect(readConfig().saveFolder).toBe('D:\\lib');
      expect(getSaveFolder()).toBe('D:\\lib');
    }
    expect(reads).toBe(0);
  });

  test('起動直後の読みは1回だけディスクへ行く', async () => {
    writeOutside(JSON.stringify({ saveFolder: 'D:\\lib' }));
    const { readConfig } = await freshModule();
    countConfigReads();
    for (let i = 0; i < 5; i++) expect(readConfig().saveFolder).toBe('D:\\lib');
    expect(reads).toBe(1);
  });

  test('ファイルが無い状態（新規インストール）もキャッシュする', async () => {
    const { readConfig } = await freshModule();
    countConfigReads();
    for (let i = 0; i < 5; i++) expect(readConfig()).toEqual({});
    expect(reads).toBe(1); // "Doesn't exist" is also settled in one read, and never opened again after that
  });
});

describe('アプリの外で書き換わったら次の読みで反映される', () => {
  test('バイト数が変わる書き換え', async () => {
    const { readConfig, writeConfig } = await freshModule();
    writeConfig({ saveFolder: 'D:\\lib' });
    const before = fs.statSync(configPath).size;
    writeOutside(JSON.stringify({ saveFolder: 'E:\\moved-somewhere-else', theme: 'dark' }));
    // This test is checking detection via a size difference, so first pin down that the size
    // really is different. The moment it's the same, we'd be relying solely on the clock with an
    // in-place rewrite and the same ino, and the test would start failing depending on NTFS's
    // timestamp granularity (this is the actual failure mode that occurred in #625).
    expect(fs.statSync(configPath).size).not.toBe(before);
    expect(readConfig()).toEqual({ saveFolder: 'E:\\moved-somewhere-else', theme: 'dark' });
  });

  test('同じバイト数でも rename で置き換われば気づく', async () => {
    const { readConfig, writeConfig } = await freshModule();
    writeConfig({ theme: 'dark' });
    const before = fs.readFileSync(configPath, 'utf8');
    const after = before.replace('dark', 'auto'); // Same length
    expect(after.length).toBe(before.length);
    writeOutside(after, { viaRename: true });
    expect(readConfig().theme).toBe('auto');
  });

  // The test above alone can't distinguish "it was detected because the clock happened to
  // advance" from real detection. NTFS ticks mtime at roughly a 15ms system-clock granularity
  // (measured: 112 of 199 back-to-back writes shared the same mtime), so repeating same-length
  // rewrites quickly is almost certain to produce pairs that the clock can't tell apart. Pin down
  // in one test that everything still gets caught anyway = what backs this is file identity
  // (ino), not the clock.
  test('立て続けの外部書き換えを1つも取りこぼさない（時刻の粒度より速い連続書き換え）', async () => {
    const { readConfig, writeConfig } = await freshModule();
    writeConfig({ marker: '0000' });
    for (let i = 1; i <= 30; i++) {
      const want = String(i).padStart(4, '0'); // Always the same byte count
      writeOutside(JSON.stringify({ marker: want }), { viaRename: true });
      expect(readConfig().marker).toBe(want);
    }
  });

  test('同じバイト数の上書きでも、時刻が進んでいれば気づく（手で直した場合）', async () => {
    const { readConfig, writeConfig } = await freshModule();
    writeConfig({ theme: 'dark' });
    const after = fs.readFileSync(configPath, 'utf8').replace('dark', 'auto');
    writeOutside(after);
    ageMtime(5000); // Well past NTFS's timestamp granularity (roughly 15ms)
    expect(readConfig().theme).toBe('auto');
  });

  test('外で消されたら空に戻る（消える前の値を返し続けない）', async () => {
    const { readConfig, writeConfig } = await freshModule();
    writeConfig({ saveFolder: 'D:\\lib' });
    fs.rmSync(configPath);
    expect(readConfig()).toEqual({});
  });

  test('getSaveFolder も外の書き換えに追従する', async () => {
    const { getSaveFolder, writeConfig } = await freshModule();
    writeConfig({ saveFolder: 'D:\\lib' });
    expect(getSaveFolder()).toBe('D:\\lib');
    const before = fs.statSync(configPath).size;
    writeOutside(JSON.stringify({ saveFolder: 'E:\\elsewhere' }));
    // Same reason as above: explicitly pin down the size difference (a same-size in-place
    // rewrite would fall back on the clock and bring back the #625 flakiness).
    expect(fs.statSync(configPath).size).not.toBe(before);
    expect(getSaveFolder()).toBe('E:\\elsewhere');
  });
});

describe('キャッシュはディスクより先に進まない', () => {
  test('書き込みに失敗したらキャッシュは動かない', async () => {
    const { readConfig, writeConfig } = await freshModule();
    writeConfig({ saveFolder: 'D:\\lib' });
    const circular: any = { saveFolder: 'D:\\lib' };
    circular.self = circular; // JSON.stringify throws = the file is never written
    expect(() => writeConfig(circular)).toThrow();
    expect(readConfig()).toEqual({ saveFolder: 'D:\\lib' });
    expect(JSON.parse(fs.readFileSync(configPath, 'utf8'))).toEqual({ saveFolder: 'D:\\lib' });
  });

  test('readConfig の返り値を書き換えてもキャッシュは汚れない', async () => {
    const { readConfig, writeConfig, getSaveFolder } = await freshModule();
    writeConfig({ saveFolder: 'D:\\lib', backup: { dir: 'E:\\mirror' } });
    const mine = readConfig();
    mine.saveFolder = 'Z:\\typo'; // Discarded without ever being passed to writeConfig
    mine.backup.dir = 'Z:\\typo'; // Same goes for nested values
    expect(readConfig()).toEqual({ saveFolder: 'D:\\lib', backup: { dir: 'E:\\mirror' } });
    expect(getSaveFolder()).toBe('D:\\lib');
  });

  test('writeConfig に渡したオブジェクトを後から触ってもキャッシュは追従しない', async () => {
    const { readConfig, writeConfig } = await freshModule();
    const cfg: any = { saveFolder: 'D:\\lib' };
    writeConfig(cfg);
    cfg.saveFolder = 'Z:\\after-the-fact';
    expect(readConfig().saveFolder).toBe('D:\\lib');
  });
});

describe('invalidateConfigCache', () => {
  // Why this escape hatch exists: there are paths that write config.json without going through
  // writeConfig, such as registering the extension ID (native-host/install.cts).
  test('無効化したあとは外の書き換えが必ず出てくる', async () => {
    const { readConfig, writeConfig, invalidateConfigCache } = await freshModule();
    writeConfig({ theme: 'dark' });
    writeOutside(fs.readFileSync(configPath, 'utf8').replace('dark', 'auto'));
    invalidateConfigCache();
    expect(readConfig().theme).toBe('auto');
  });

  test('無効化した直後の読みはディスクへ行く', async () => {
    const { readConfig, writeConfig, invalidateConfigCache } = await freshModule();
    writeConfig({ saveFolder: 'D:\\lib' });
    countConfigReads();
    readConfig();
    expect(reads).toBe(0);
    invalidateConfigCache();
    readConfig();
    expect(reads).toBe(1);
  });
});

describe('壊れた config', () => {
  const GARBAGE = '{"saveFolder": "D:\\\\lib"'; // Cut off partway through

  test('壊れている間はその判定が保たれ、読み直しもしない', async () => {
    writeOutside(GARBAGE);
    const { readConfig, isConfigCorrupt } = await freshModule();
    countConfigReads();
    for (let i = 0; i < 5; i++) {
      expect(readConfig()).toEqual({});
      expect(isConfigCorrupt()).toBe(true);
    }
    expect(reads).toBe(1); // The quarantine copy is also made only once
    expect(fs.readdirSync(dir).filter((n) => n.includes('.corrupt-')).length).toBe(1);
  });

  test('直されたら判定も戻る', async () => {
    writeOutside(GARBAGE);
    const { readConfig, isConfigCorrupt } = await freshModule();
    expect(isConfigCorrupt()).toBe(true);
    // The fix is applied via rename = the same path as an editor's atomic save, which always
    // gets a fresh ino, so detection doesn't depend on the clock. Don't switch this back to an
    // in-place rewrite: GARBAGE and the fixed content happen to both be 24 bytes, so if the two
    // writes land within NTFS's roughly-15ms tick, all three of (size, mtimeNs, ino) end up
    // matching and the cache misses the fix (measured: 156 of 200 runs shared an identical
    // fingerprint = it would pass or fail depending on how fast the machine is — #625).
    // Detection of in-place rewrites itself is already covered by the two tests above under
    // "reflected on the next read when rewritten outside the app" (size change / clock advance),
    // so it's fine to pin down this path here.
    writeOutside(JSON.stringify({ saveFolder: 'D:\\lib' }), { viaRename: true });
    expect(isConfigCorrupt()).toBe(false);
    expect(readConfig().saveFolder).toBe('D:\\lib');
  });

  test('壊れた config を writeConfig で上書きすると判定が晴れる', async () => {
    writeOutside(GARBAGE);
    const { writeConfig, isConfigCorrupt } = await freshModule();
    expect(isConfigCorrupt()).toBe(true);
    writeConfig({ saveFolder: 'D:\\lib' });
    expect(isConfigCorrupt()).toBe(false);
  });
});

describe('保存先の復旧経路（キャッシュ後も変わらない）', () => {
  test('config に saveFolder が無ければ pointer から復旧する', async () => {
    const lib = fs.mkdirSync(path.join(dir, 'recovered-library'), { recursive: true }) as string;
    fs.writeFileSync(path.join(dir, 'saveFolder.path'), lib);
    writeOutside(JSON.stringify({ theme: 'dark' }));
    const { getSaveFolder } = await freshModule();
    expect(getSaveFolder()).toBe(lib);
  });

  test('config も pointer も無ければ既定の保存先', async () => {
    const { getSaveFolder } = await freshModule();
    expect(getSaveFolder()).toBe(path.join(dir, 'default-library'));
  });

  test('writeConfig は pointer も更新し続ける', async () => {
    const { writeConfig, readSavePointer } = await freshModule();
    writeConfig({ saveFolder: 'D:\\lib' });
    expect(readSavePointer()).toBe('D:\\lib');
  });

  test('initSaveFolderRedundancy は pointer を config へ書き戻す', async () => {
    const lib = fs.mkdirSync(path.join(dir, 'recovered-library'), { recursive: true }) as string;
    fs.writeFileSync(path.join(dir, 'saveFolder.path'), lib);
    writeOutside(JSON.stringify({ theme: 'dark' }));
    const { initSaveFolderRedundancy, readConfig } = await freshModule();
    initSaveFolderRedundancy();
    expect(readConfig()).toEqual({ theme: 'dark', saveFolder: lib });
    expect(JSON.parse(fs.readFileSync(configPath, 'utf8')).saveFolder).toBe(lib);
  });
});
