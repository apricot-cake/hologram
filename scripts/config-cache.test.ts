// config.json のメモリ上のキャッシュ（app/src/main/lib-config.ts, #61）の単体テスト。
//
// キャッシュを足して怖いのは速さではなく、古くなった値を返し続けること。だからこのスイートが
// 見るのは「速いか」ではなく「嘘をつくか」。とくに lib-config.ts の書き手はどれも
// read-modify-write をする＝読みが古いと、次の書き込みがその古い値をディスクへ書き戻し、外で
// 起きた変更を消してしまう（保存先が失われた 2026-06-23 の事故と同じ壊れ方）。そこで次の4つを
// 固定する:
//   1. 書いた直後の読みが新しい値を返す（write-through）
//   2. 同じ値を何度読んでもファイルを開き直さない（キャッシュが実際に効いている）
//   3. アプリの外でファイルが書き換わったら、次の読みで拾う
//      ＝rename で置き換わった場合（エディタ・アトミックな書き込み）と、
//        同じバイト数でその場を上書きされた場合の両方
//   4. 書き込みに失敗したらキャッシュは動かない（ディスクに無い値は決して返さない）
//
// Electron は使わないが、lib-config.ts が native-host.ts 経由で引き込むので、そこだけ差し替える
// （テスト用に configDir を一時フォルダへ向ける役目も兼ねる）。CONFIG_PATH はモジュールの
// 読み込み時に固まるので、各テストは vi.resetModules() と動的 import で「起動し直した状態」を
// 作る。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const env = vi.hoisted(() => ({ dir: '' }));

vi.mock('../app/src/main/native-host.ts', async () => {
  // 保存先の解決のロジックは本物を使う（getSaveFolder の復旧経路も通したい）。
  const { resolveSaveFolder } = await import('../native-host/config-recovery.mts');
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

// config.json を「開いた」回数だけ数える（saveFolder.path など他のファイルの読みは数えない）。
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

/** アプリの外からの書き換え。rename はエディタやアトミックな書き込みが通る経路。 */
function writeOutside(text: string, { viaRename = false } = {}) {
  if (viaRename) {
    const tmp = `${configPath}.outside`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, configPath);
  } else {
    fs.writeFileSync(configPath, text);
  }
}

/** ファイルの mtime だけ進める＝「しばらく経ってから手で直した」を決定的に再現する。 */
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
    // ディスクにも同じ値が乗っている＝キャッシュだけが勝手に先へ進んでいるのではない。
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
    expect(reads).toBe(1); // 「無い」も1回の読みで決まり、以降は開き直さない
  });
});

describe('アプリの外で書き換わったら次の読みで反映される', () => {
  test('バイト数が変わる書き換え', async () => {
    const { readConfig, writeConfig } = await freshModule();
    writeConfig({ saveFolder: 'D:\\lib' });
    const before = fs.statSync(configPath).size;
    writeOutside(JSON.stringify({ saveFolder: 'E:\\moved-somewhere-else', theme: 'dark' }));
    // このテストはサイズの違いによる検知を見るので、まずサイズが本当に違うことを固定する。
    // 同じになった瞬間、その場の上書きで ino も同じになり時刻だけに頼ることになって、NTFS の
    // 時刻の粒度しだいでテストが落ち始める（#625 で実際に起きた壊れ方がこれ）。
    expect(fs.statSync(configPath).size).not.toBe(before);
    expect(readConfig()).toEqual({ saveFolder: 'E:\\moved-somewhere-else', theme: 'dark' });
  });

  test('同じバイト数でも rename で置き換われば気づく', async () => {
    const { readConfig, writeConfig } = await freshModule();
    writeConfig({ theme: 'dark' });
    const before = fs.readFileSync(configPath, 'utf8');
    const after = before.replace('dark', 'auto'); // 長さは同じ
    expect(after.length).toBe(before.length);
    writeOutside(after, { viaRename: true });
    expect(readConfig().theme).toBe('auto');
  });

  // 上のテストだけでは「たまたま時刻が進んだから検知できた」と本当の検知を見分けられない。
  // NTFS の mtime はシステムクロックのおよそ 15ms の粒度で刻む（実測で、連続した書き込み
  // 199 回のうち 112 回が同じ mtime だった）ので、同じ長さの書き換えを速く繰り返すと、時刻では
  // 見分けられない対がまず確実に出る。それでも1つも取りこぼさないことを1つのテストで固定する＝
  // これを支えているのは時刻ではなく、ファイルの同一性 (ino)。
  test('立て続けの外部書き換えを1つも取りこぼさない（時刻の粒度より速い連続書き換え）', async () => {
    const { readConfig, writeConfig } = await freshModule();
    writeConfig({ marker: '0000' });
    for (let i = 1; i <= 30; i++) {
      const want = String(i).padStart(4, '0'); // バイト数は常に同じ
      writeOutside(JSON.stringify({ marker: want }), { viaRename: true });
      expect(readConfig().marker).toBe(want);
    }
  });

  test('同じバイト数の上書きでも、時刻が進んでいれば気づく（手で直した場合）', async () => {
    const { readConfig, writeConfig } = await freshModule();
    writeConfig({ theme: 'dark' });
    const after = fs.readFileSync(configPath, 'utf8').replace('dark', 'auto');
    writeOutside(after);
    ageMtime(5000); // NTFS の時刻の粒度（およそ 15ms）を十分に超える
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
    // 理由は上と同じ。サイズの違いを明示して固定する（同じサイズでその場を上書きすると
    // 時刻頼みになり、#625 の不安定さが戻ってくる）。
    expect(fs.statSync(configPath).size).not.toBe(before);
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
    writeConfig({ saveFolder: 'D:\\lib', preferences: { locale: 'ja' } });
    const mine = readConfig();
    mine.saveFolder = 'Z:\\typo'; // writeConfig へ渡さないまま捨てる
    mine.preferences.locale = 'en'; // 入れ子の値も同じ
    expect(readConfig()).toEqual({ saveFolder: 'D:\\lib', preferences: { locale: 'ja' } });
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
  // この抜け道がある理由: 拡張機能 ID の登録（native-host/install.mts）のように、writeConfig を
  // 通さず config.json を書く経路がある。
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
    expect(reads).toBe(1); // 隔離用の複製も1回だけ作られる
    expect(fs.readdirSync(dir).filter((n) => n.includes('.corrupt-')).length).toBe(1);
  });

  test('直されたら判定も戻る', async () => {
    writeOutside(GARBAGE);
    const { readConfig, isConfigCorrupt } = await freshModule();
    expect(isConfigCorrupt()).toBe(true);
    // 直しは rename で当てる＝エディタのアトミックな保存と同じ経路で、ino が必ず新しくなる
    // ので、検知が時刻に依存しない。これをその場の上書きに戻してはいけない。GARBAGE と直した
    // 内容はたまたまどちらも 24 バイトで、2回の書き込みが NTFS のおよそ 15ms の刻みに収まると、
    // (size, mtimeNs, ino) の3つとも一致し、キャッシュが直しを見落とす（実測で、200 回のうち
    // 156 回が同一の指紋になった＝マシンの速さしだいで通ったり落ちたりする・#625）。
    // その場の上書きの検知そのものは、上の「アプリの外で書き換わったら次の読みで反映される」の
    // 2つのテスト（サイズの変化・時刻の前進）が既に覆っているので、ここはこの経路を固定すれば
    // 足りる。
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
