// setup.cts が持つ「回避策はまだ必要か」判定のテスト。
//
// ここを守る理由は、判定が installer の挙動を直接動かすため。誤って「もう不要」と
// 答えると次の install がそのまま失敗し、誤って「まだ必要」と答え続けると回避策が
// 恒久化する。どちらの向きの誤りも、判定を目視で確かめるまで表に出ない。
//
// 実物の node_modules / package-lock.json ではなく fixture のツリーを読ませる
// （本物は上流の更新で中身が変わる＝テストが勝手に赤くなる）。判定はどちらも
// 「ディスクの JSON を読むだけ」なので、fixture で十分に再現できる。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

const { sqliteCheck, peerCheck, decideFlags, WORKAROUNDS } = require('./setup.cts');

let tmp: string;

// 判定は「ルートを受け取って node_modules を読む」形なので、fixture のルートを
// そのまま渡せば実物の node_modules に触れずに検証できる。
function writePkg(rel: string, pkg: Record<string, unknown>) {
  const dir = path.join(tmp, 'node_modules', rel);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
  return dir;
}

// sqliteCheck は package-lock.json 側を読む（why は setup.cts のコメント）ので、
// node_modules の fixture でなく package-lock.json の fixture が要る。
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
    // まっさらな clone では読むものが無い。ここで「不要」に倒すと、その install が
    // 失敗するか半端なツリーを残す＝安全側は必ず「必要」。
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
    // 展開物には gypfile:false が正しく入っていても（現に better-sqlite3 は
    // それを宣言している）、それはこのインストールが --ignore-scripts で作った
    // ツリーかもしれない＝プレーンな install が通る証拠にはならない。
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
    ['^5.0.0 || ^6.0.0 || ^7.0.0', '8.1.5', true], // 現状
    ['^5.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.0', '8.1.5', false], // 上流が vite 8 を受けた
    ['^8.0.0', '8.1.5', false],
    ['^7.0.0', '7.2.0', false], // vite 側を下げても解消する
  ];
  test.each(cases)('peer=%s / vite=%s → 回避策が必要=%s', (range, viteVersion, needed) => {
    writePkg('electron-vite', { version: '5.0.0', peerDependencies: { vite: range } });
    writePkg('vite', { version: viteVersion });
    expect(peerCheck(tmp)?.needed).toBe(needed);
  });

  test('範囲の書式を読めなければ「必要」を維持する', () => {
    // 勝手に「不要」と答えるより、外し忘れる方が害が小さい。
    writePkg('electron-vite', { version: '9.9.9', peerDependencies: { vite: 'workspace:*' } });
    writePkg('vite', { version: '8.1.5' });
    expect(peerCheck(tmp)?.needed).toBe(true);
  });

  test('読むものが無ければ判定不能（null）', () => {
    expect(peerCheck(tmp)).toBeNull();
  });
});
