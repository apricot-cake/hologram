// setup.cts が持つ2つの「回避策はまだ必要か」判定のテスト。
//
// ここを守る理由は、判定が installer の挙動を直接動かすため。誤って「もう不要」と
// 答えると次の install がそのまま失敗し、誤って「まだ必要」と答え続けると回避策が
// 恒久化する。どちらの向きの誤りも、判定を目視で確かめるまで表に出ない。
//
// 実物の node_modules ではなく fixture のツリーを読ませる（本物は上流の更新で
// 中身が変わる＝テストが勝手に赤くなる）。判定はどちらも「ディスクの
// package.json を読むだけ」なので、fixture で十分に再現できる。

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

describe('sqliteCheck', () => {
  test('binding.gyp があり install スクリプトが無ければ必要', () => {
    const dir = writePkg('better-sqlite3', { version: '13.0.1', scripts: { test: 'mocha' } });
    fs.writeFileSync(path.join(dir, 'binding.gyp'), '{}');
    expect(sqliteCheck(tmp)?.needed).toBe(true);
  });

  test.each([
    ['gypfile:false を宣言した', { version: '13.0.2', gypfile: false }],
    ['install スクリプトを持った', { version: '13.0.2', scripts: { install: 'prebuild-install || node-gyp rebuild' } }],
  ])('上流が%s → 不要', (_label, pkg) => {
    const dir = writePkg('better-sqlite3', pkg);
    fs.writeFileSync(path.join(dir, 'binding.gyp'), '{}');
    expect(sqliteCheck(tmp)?.needed).toBe(false);
  });

  test('binding.gyp を同梱しなくなれば不要', () => {
    writePkg('better-sqlite3', { version: '14.0.0' });
    expect(sqliteCheck(tmp)?.needed).toBe(false);
  });

  test('読むものが無ければ判定不能（null）', () => {
    expect(sqliteCheck(tmp)).toBeNull();
  });
});
