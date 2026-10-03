import cp from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const { violationFor } = require('./guard-repository-content.cts');

describe('公開リポジトリへ追加するファイルの検査', () => {
  test('実ライブラリと検証成果物を拒否する', () => {
    expect(violationFor('tmp/ui.jpg')).toBeTruthy();
    expect(violationFor('captures/home.png')).toBeTruthy();
    expect(violationFor('backup/hologram.library/items/a.png')).toBeTruthy();
    expect(violationFor('library/hologram.db')).toBeTruthy();
  });

  test('許可された製品素材と visual baseline は通す', () => {
    expect(violationFor('app/assets/icon.png')).toBeNull();
    expect(violationFor('extension/public/icons/icon128.png')).toBeNull();
    expect(violationFor('e2e/visual/surfaces.spec.ts-snapshots/inspector-post-light-visual-win32.png')).toBeNull();
  });

  test('許可リスト外のメディアは拒否する', () => {
    expect(violationFor('docs/example.jpg')).toBeTruthy();
    expect(violationFor('fixtures/movie.mp4')).toBeTruthy();
  });

  test('Git が引用する非 ASCII 名のメディアも拒否する', () => {
    const repository = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-content-guard-'));
    const guard = path.resolve(__dirname, 'guard-repository-content.cts');
    try {
      cp.execFileSync('git', ['init', '--quiet'], { cwd: repository });
      fs.mkdirSync(path.join(repository, 'docs'));
      fs.writeFileSync(path.join(repository, 'docs', '写真.jpg'), 'private capture');
      cp.execFileSync('git', ['add', 'docs/写真.jpg'], { cwd: repository });

      expect(() => cp.execFileSync(process.execPath, [guard, '--staged'], { cwd: repository, stdio: 'pipe' })).toThrow();
    } finally {
      fs.rmSync(repository, { recursive: true, force: true });
    }
  });
});
