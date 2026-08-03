// Unit test for app/src/main/lib-switch-library.ts (#176) — the read-only
// classifier that decides which of switchLibrary's four confirm branches a
// candidate folder falls into. Pure filesystem reads, no Electron/DB needed.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { classifyLibraryFolder } from '../app/src/main/lib-switch-library';

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
      /* best-effort cleanup */
    }
  }
});

describe('classifyLibraryFolder', () => {
  test('a folder holding hologram.db classifies as has-db, even alongside other evidence', () => {
    const dir = mkTempDir();
    fs.writeFileSync(path.join(dir, 'hologram.db'), '');
    fs.mkdirSync(path.join(dir, '.trash'));
    expect(classifyLibraryFolder(dir)).toBe('has-db');
  });

  test('a nonexistent folder classifies as empty (it will be created on open)', () => {
    const dir = path.join(mkTempDir(), 'does-not-exist-yet');
    expect(classifyLibraryFolder(dir)).toBe('empty');
  });

  test('a folder with nothing but dotfiles classifies as empty', () => {
    const dir = mkTempDir();
    fs.writeFileSync(path.join(dir, '.DS_Store'), '');
    expect(classifyLibraryFolder(dir)).toBe('empty');
  });

  test('.trash present but no database classifies as evidence-no-db (recoverable)', () => {
    const dir = mkTempDir();
    fs.mkdirSync(path.join(dir, '.trash'));
    expect(classifyLibraryFolder(dir)).toBe('evidence-no-db');
  });

  test('.hologram-inbox present but no database classifies as evidence-no-db', () => {
    const dir = mkTempDir();
    fs.mkdirSync(path.join(dir, '.hologram-inbox'));
    expect(classifyLibraryFolder(dir)).toBe('evidence-no-db');
  });

  test('a library media file directly inside, no database, classifies as evidence-no-db', () => {
    const dir = mkTempDir();
    fs.writeFileSync(path.join(dir, 'abcd1234.jpg'), 'not a real jpeg, existence is what matters');
    expect(classifyLibraryFolder(dir)).toBe('evidence-no-db');
  });

  test('a non-empty folder with no library evidence classifies as reject', () => {
    const dir = mkTempDir();
    fs.writeFileSync(path.join(dir, 'readme.txt'), "this is somebody else's folder");
    fs.mkdirSync(path.join(dir, 'Documents'));
    expect(classifyLibraryFolder(dir)).toBe('reject');
  });

  test('an unreadable path (permission denied, dangling symlink) classifies as empty rather than throwing', () => {
    const dir = path.join(mkTempDir(), 'nested', 'deeper', 'unreachable');
    expect(() => classifyLibraryFolder(dir)).not.toThrow();
    expect(classifyLibraryFolder(dir)).toBe('empty');
  });
});
