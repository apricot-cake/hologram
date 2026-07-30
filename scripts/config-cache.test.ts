// config.json のメモリキャッシュ（app/src/main/lib-config.ts, #61）のユニットテスト。
//
// キャッシュを入れる変更で怖いのは速度ではなく**古い値を返し続けること**なので、
// このスイートが押さえるのは「速いこと」ではなく「嘘をつかないこと」。とくに
// lib-config.ts の書き手はすべて read-modify-write ＝ 読みが古いと、次の書き込みが
// その古い値をディスクへ書き戻して**外の変更を消す**（保存先を失った 2026-06-23 の
// 事故と同じ壊れ方）。だから次の4つを固定する。
//   ① 書いた直後に読むと新しい値が返る（write-through）
//   ② 同じ値を何度読んでもファイルを開き直さない（キャッシュが実際に効いている）
//   ③ アプリの外でファイルが書き換わったら、次の読みで反映される
//      ＝rename で置き換えられた場合（エディタ・原子的書き込み）と、
//        同じバイト数で上書きされた場合の両方
//   ④ 書き込みに失敗したらキャッシュは動かない（ディスクに無い値を返さない）
//
// Electron は使わないが lib-config.ts は native-host.ts 経由で electron を引くので、
// そこだけ差し替える（configDir をテスト用の一時フォルダに向ける役目も兼ねる）。
// CONFIG_PATH はモジュール読み込み時に確定するため、テストごとに
// vi.resetModules() + 動的 import で「起動し直し」を作る。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const env = vi.hoisted(() => ({ dir: '' }));

vi.mock('../app/src/main/native-host.ts', async () => {
  // 保存先の解決ロジックは本物を使う（getSaveFolder の復旧経路まで通したい）。
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

// config.json を「開いた」回数だけ数える（saveFolder.path など他のファイル読みは無視）。
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

/** アプリの外からの書き換え。rename＝エディタや原子的書き込みが取る経路。 */
function writeOutside(text: string, { viaRename = false } = {}) {
  if (viaRename) {
    const tmp = `${configPath}.outside`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, configPath);
  } else {
    fs.writeFileSync(configPath, text);
  }
}

/** ファイルの mtime だけを進める＝「しばらく後に手で直した」を決定的に作る。 */
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
    // ディスクにも同じものが載っている＝キャッシュだけが進んでいるのではない。
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
    expect(reads).toBe(1); // 「無い」も1回で確定し、以後は開きにいかない
  });
});

describe('アプリの外で書き換わったら次の読みで反映される', () => {
  test('バイト数が変わる書き換え', async () => {
    const { readConfig, writeConfig } = await freshModule();
    writeConfig({ saveFolder: 'D:\\lib' });
    writeOutside(JSON.stringify({ saveFolder: 'E:\\moved-somewhere-else', theme: 'dark' }));
    expect(readConfig()).toEqual({ saveFolder: 'E:\\moved-somewhere-else', theme: 'dark' });
  });

  test('同じバイト数でも rename で置き換われば気づく', async () => {
    const { readConfig, writeConfig } = await freshModule();
    writeConfig({ theme: 'dark' });
    const before = fs.readFileSync(configPath, 'utf8');
    const after = before.replace('dark', 'auto'); // 同じ長さ
    expect(after.length).toBe(before.length);
    writeOutside(after, { viaRename: true });
    expect(readConfig().theme).toBe('auto');
  });

  // 上のテストだけでは「たまたま時計が進んだから気づけた」のか区別できない。NTFS が
  // mtime を刻むのは約15ms のシステムクロック単位（実測: 立て続けの書き込み199組のうち
  // 112組が同一 mtime）なので、同じ長さの書き換えを速く繰り返すと時刻では見分けられない
  // 組がほぼ確実に混ざる。それでも全部拾えることを見る＝支えているのはファイルの同一性
  // （ino）であって時計ではない、を1本で固定する。
  test('立て続けの外部書き換えを1つも取りこぼさない（時刻の粒度より速い連続書き換え）', async () => {
    const { readConfig, writeConfig } = await freshModule();
    writeConfig({ marker: '0000' });
    for (let i = 1; i <= 30; i++) {
      const want = String(i).padStart(4, '0'); // 常に同じバイト数
      writeOutside(JSON.stringify({ marker: want }), { viaRename: true });
      expect(readConfig().marker).toBe(want);
    }
  });

  test('同じバイト数の上書きでも、時刻が進んでいれば気づく（手で直した場合）', async () => {
    const { readConfig, writeConfig } = await freshModule();
    writeConfig({ theme: 'dark' });
    const after = fs.readFileSync(configPath, 'utf8').replace('dark', 'auto');
    writeOutside(after);
    ageMtime(5000); // NTFS の時刻の粒度（約15ms）より確実に先へ
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
    writeOutside(JSON.stringify({ saveFolder: 'E:\\elsewhere' }));
    expect(getSaveFolder()).toBe('E:\\elsewhere');
  });
});

describe('キャッシュはディスクより先に進まない', () => {
  test('書き込みに失敗したらキャッシュは動かない', async () => {
    const { readConfig, writeConfig } = await freshModule();
    writeConfig({ saveFolder: 'D:\\lib' });
    const circular: any = { saveFolder: 'D:\\lib' };
    circular.self = circular; // JSON.stringify が投げる＝ファイルは書かれない
    expect(() => writeConfig(circular)).toThrow();
    expect(readConfig()).toEqual({ saveFolder: 'D:\\lib' });
    expect(JSON.parse(fs.readFileSync(configPath, 'utf8'))).toEqual({ saveFolder: 'D:\\lib' });
  });

  test('readConfig の返り値を書き換えてもキャッシュは汚れない', async () => {
    const { readConfig, writeConfig, getSaveFolder } = await freshModule();
    writeConfig({ saveFolder: 'D:\\lib', backup: { dir: 'E:\\mirror' } });
    const mine = readConfig();
    mine.saveFolder = 'Z:\\typo'; // writeConfig へ渡さないまま捨てる
    mine.backup.dir = 'Z:\\typo'; // 入れ子も同じこと
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
  // 逃げ道の存在意義: 拡張機能IDの登録（native-host/install.cts）のように、
  // writeConfig を通らずに config.json を書く経路があるため。
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
  const GARBAGE = '{"saveFolder": "D:\\\\lib"'; // 途中で切れている

  test('壊れている間はその判定が保たれ、読み直しもしない', async () => {
    writeOutside(GARBAGE);
    const { readConfig, isConfigCorrupt } = await freshModule();
    countConfigReads();
    for (let i = 0; i < 5; i++) {
      expect(readConfig()).toEqual({});
      expect(isConfigCorrupt()).toBe(true);
    }
    expect(reads).toBe(1); // 退避コピーも1回きり
    expect(fs.readdirSync(dir).filter((n) => n.includes('.corrupt-')).length).toBe(1);
  });

  test('直されたら判定も戻る', async () => {
    writeOutside(GARBAGE);
    const { readConfig, isConfigCorrupt } = await freshModule();
    expect(isConfigCorrupt()).toBe(true);
    writeOutside(JSON.stringify({ saveFolder: 'D:\\lib' }));
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
