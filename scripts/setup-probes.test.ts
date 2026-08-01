// Tests for the "is the workaround still needed" judgment that setup.cts has.
//
// The reason this is guarded is that the judgment directly drives the installer's
// behavior. Answering "no longer needed" by mistake makes the next install fail outright,
// and mistakenly keeping on answering "still needed" makes the workaround permanent.
// Neither direction of error surfaces until someone checks the judgment by eye.
//
// Has it read a fixture tree instead of the real node_modules / package-lock.json
// (the real ones change contents with upstream updates = the test would turn red on its
// own). Both judgments are "just read JSON off disk", so a fixture reproduces them fine.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

const { sqliteCheck, peerCheck, decideFlags, WORKAROUNDS } = require('./setup.cts');

let tmp: string;

// The judgment takes the shape "receive a root and read node_modules", so passing the
// fixture's root as-is verifies it without touching the real node_modules.
function writePkg(rel: string, pkg: Record<string, unknown>) {
  const dir = path.join(tmp, 'node_modules', rel);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
  return dir;
}

// sqliteCheck reads the package-lock.json side (see setup.cts's comment for why), so
// what's needed is a package-lock.json fixture, not a node_modules one.
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
    // A fresh clone has nothing to read. Defaulting to "not needed" here would make that
    // install fail or leave a half-finished tree = the safe side is always "needed".
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
    // Even if gypfile:false is correctly present in the unpacked package (better-sqlite3
    // does in fact declare it), that could be a tree this install built with --ignore-scripts
    // = it isn't proof that a plain install would succeed.
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
    ['^5.0.0 || ^6.0.0 || ^7.0.0', '8.1.5', true], // current state
    ['^5.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.0', '8.1.5', false], // upstream accepted vite 8
    ['^8.0.0', '8.1.5', false],
    ['^7.0.0', '7.2.0', false], // also resolved by downgrading vite
  ];
  test.each(cases)('peer=%s / vite=%s → 回避策が必要=%s', (range, viteVersion, needed) => {
    writePkg('electron-vite', { version: '5.0.0', peerDependencies: { vite: range } });
    writePkg('vite', { version: viteVersion });
    expect(peerCheck(tmp)?.needed).toBe(needed);
  });

  test('範囲の書式を読めなければ「必要」を維持する', () => {
    // Forgetting to remove it does less harm than wrongly answering "not needed".
    writePkg('electron-vite', { version: '9.9.9', peerDependencies: { vite: 'workspace:*' } });
    writePkg('vite', { version: '8.1.5' });
    expect(peerCheck(tmp)?.needed).toBe(true);
  });

  test('読むものが無ければ判定不能（null）', () => {
    expect(peerCheck(tmp)).toBeNull();
  });
});
