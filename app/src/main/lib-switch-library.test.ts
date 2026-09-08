// app/src/main/lib-switch-library.ts（#176）の単体テスト。候補のフォルダが
// switchLibrary の4つの確認分岐のどれに落ちるかを決める、読み取りだけの分類器が対象。
// ファイルシステムを読むだけ＝Electron も DB も要らない。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { classifyLibraryFolder } from './lib-switch-library';

const dirs: string[] = [];
function mkTempDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-classify-'));
  dirs.push(d);
  return d;
}

afterAll(() => {
  for (const d of dirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* できる範囲で片付ける */
    }
  }
});

describe('classifyLibraryFolder', () => {
  test('hologram.db を抱えたフォルダは、他の痕跡が並んでいても has-db', () => {
    const dir = mkTempDir();
    fs.writeFileSync(path.join(dir, 'hologram.db'), '');
    fs.mkdirSync(path.join(dir, '.trash'));
    expect(classifyLibraryFolder(dir)).toBe('has-db');
  });

  test('実在しないフォルダは empty（開くときに作る）', () => {
    const dir = path.join(mkTempDir(), 'does-not-exist-yet');
    expect(classifyLibraryFolder(dir)).toBe('empty');
  });

  test('ドットファイルしか無いフォルダは empty', () => {
    const dir = mkTempDir();
    fs.writeFileSync(path.join(dir, '.DS_Store'), '');
    expect(classifyLibraryFolder(dir)).toBe('empty');
  });

  test('.trash はあるがデータベースが無ければ evidence-no-db（復旧の余地あり）', () => {
    const dir = mkTempDir();
    fs.mkdirSync(path.join(dir, '.trash'));
    expect(classifyLibraryFolder(dir)).toBe('evidence-no-db');
  });

  test('.hologram-inbox はあるがデータベースが無ければ evidence-no-db', () => {
    const dir = mkTempDir();
    fs.mkdirSync(path.join(dir, '.hologram-inbox'));
    expect(classifyLibraryFolder(dir)).toBe('evidence-no-db');
  });

  test('直下にライブラリのメディアファイルがあってデータベースが無ければ evidence-no-db', () => {
    const dir = mkTempDir();
    fs.writeFileSync(path.join(dir, 'abcd1234.jpg'), 'not a real jpeg, existence is what matters');
    expect(classifyLibraryFolder(dir)).toBe('evidence-no-db');
  });

  test('空でなくライブラリの痕跡も無いフォルダは reject', () => {
    const dir = mkTempDir();
    fs.writeFileSync(path.join(dir, 'readme.txt'), "this is somebody else's folder");
    fs.mkdirSync(path.join(dir, 'Documents'));
    expect(classifyLibraryFolder(dir)).toBe('reject');
  });

  test('読めないパス（権限なし、リンク切れのシンボリックリンク）は例外ではなく empty', () => {
    const dir = path.join(mkTempDir(), 'nested', 'deeper', 'unreachable');
    expect(() => classifyLibraryFolder(dir)).not.toThrow();
    expect(classifyLibraryFolder(dir)).toBe('empty');
  });
});
