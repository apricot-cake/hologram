// setup.cts が持つ「その回避策はまだ必要か」の判定のテスト。
//
// ここを守る理由は、判定がインストーラの挙動をそのまま動かすから。誤って「もう要らない」と
// 答えれば次のインストールがそのまま失敗し、誤って「まだ必要」と答え続ければ回避策が恒久化
// する。どちらの向きの誤りも、誰かが目で判定を確かめるまで表に出ない。
//
// 本物の node_modules / package-lock.json ではなく、フィクスチャの木を読ませている（本物は
// 上流の更新で中身が変わる＝テストがひとりでに赤くなる）。どちらの判定も「ディスクから JSON
// を読むだけ」なので、フィクスチャで十分に再現できる。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

const { sqliteCheck, peerCheck, decideFlags, WORKAROUNDS } = require('./setup.cts');

let tmp: string;

// 判定は「ルートを受け取って node_modules を読む」形なので、フィクスチャのルートをそのまま
// 渡せば、本物の node_modules に触れずに確かめられる。
function writePkg(rel: string, pkg: Record<string, unknown>) {
  const dir = path.join(tmp, 'node_modules', rel);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
  return dir;
}

// sqliteCheck は package-lock.json の側を読む（理由は setup.cts のコメントを参照）ので、
// 要るのは node_modules ではなく package-lock.json のフィクスチャ。
function writeLockEntry(entry: Record<string, unknown> | undefined) {
  const packages = entry ? { 'node_modules/better-sqlite3': entry } : {};
  fs.writeFileSync(path.join(tmp, 'package-lock.json'), JSON.stringify({ packages }));
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-setup-probe-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('decideFlags', () => {
  test('必要な回避策のフラグだけを並べる', () => {
    const needed = { needed: true, reason: '' };
    const done = { needed: false, reason: '' };
    expect(decideFlags([needed, needed])).toEqual(WORKAROUNDS.map((w: { flag: string }) => w.flag));
    expect(decideFlags([done, done])).toEqual([]);
    expect(decideFlags([done, needed])).toEqual([WORKAROUNDS[1].flag]);
  });

  test('判定不能（null）は「まだ必要」と同じに倒す', () => {
    // 新規のクローンには読むものが何も無い。ここで「不要」に倒すと、そのインストールが
    // 失敗するか、中途半端な木を残す＝安全な側は常に「必要」。
    expect(decideFlags([null, null])).toEqual(WORKAROUNDS.map((w: { flag: string }) => w.flag));
  });
});

describe('sqliteCheck', () => {
  test('package-lock.json のエントリに gypfile が無ければ必要（ロックファイル駆動のインストールが node-gyp へ落ちる既定の状態）', () => {
    writeLockEntry({ version: '13.0.2', license: 'MIT' });
    expect(sqliteCheck(tmp)?.needed).toBe(true);
  });

  test('package-lock.json のエントリが gypfile:false を持てば不要（npm がロックファイル駆動でもこの項を読むようになった）', () => {
    writeLockEntry({ version: '13.0.2', license: 'MIT', gypfile: false });
    expect(sqliteCheck(tmp)?.needed).toBe(false);
  });

  test('展開済み node_modules 側の package.json は見ない＝それは --ignore-scripts で作られた可能性がある', () => {
    // 展開済みのパッケージに gypfile:false が正しく入っていても（better-sqlite3 は実際に
    // 宣言している）、それはこのインストールが --ignore-scripts で作った木かもしれない＝
    // 素のインストールが成功する証拠にはならない。
    writePkg('better-sqlite3', { version: '13.0.2', gypfile: false });
    writeLockEntry({ version: '13.0.2', license: 'MIT' });
    expect(sqliteCheck(tmp)?.needed).toBe(true);
  });

  test('package-lock.json が読めなければ判定不能（null）', () => {
    expect(sqliteCheck(tmp)).toBeNull();
  });
});

describe('peerCheck', () => {
  const cases: [string, string, boolean][] = [
    ['^5.0.0 || ^6.0.0 || ^7.0.0', '8.1.5', true], // 今の状態
    ['^5.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.0', '8.1.5', false], // 上流が vite 8 を受け入れた
    ['^8.0.0', '8.1.5', false],
    ['^7.0.0', '7.2.0', false], // vite を下げても解消する
  ];
  test.each(cases)('peer=%s / vite=%s → 回避策が必要=%s', (range, viteVersion, needed) => {
    writePkg('electron-vite', { version: '5.0.0', peerDependencies: { vite: range } });
    writePkg('vite', { version: viteVersion });
    expect(peerCheck(tmp)?.needed).toBe(needed);
  });

  test('範囲の書式を読めなければ「必要」を維持する', () => {
    // 外し忘れる害は、誤って「不要」と答える害より小さい。
    writePkg('electron-vite', { version: '9.9.9', peerDependencies: { vite: 'workspace:*' } });
    writePkg('vite', { version: '8.1.5' });
    expect(peerCheck(tmp)?.needed).toBe(true);
  });

  test('読むものが無ければ判定不能（null）', () => {
    expect(peerCheck(tmp)).toBeNull();
  });
});
