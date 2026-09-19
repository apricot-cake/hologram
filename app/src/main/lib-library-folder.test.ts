import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { classifyLibraryFolder } from './lib-library-folder';

const dirs: string[] = [];
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-classify-'));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('classifyLibraryFolder', () => {
  test('データベースがある保存先を復旧候補として認識する', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'hologram.db'), '');
    expect(classifyLibraryFolder(dir)).toBe('has-db');
  });

  test('ゴミ箱または取込キューだけが残る保存先を復旧候補として認識する', () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, '.hologram-inbox'));
    expect(classifyLibraryFolder(dir)).toBe('evidence-no-db');
  });

  test('空の保存先は空として扱う', () => {
    expect(classifyLibraryFolder(path.join(tempDir(), 'not-created'))).toBe('empty');
  });

  test('無関係なファイルが入る保存先は拒否する', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'readme.txt'), 'unrelated');
    expect(classifyLibraryFolder(dir)).toBe('reject');
  });
});
