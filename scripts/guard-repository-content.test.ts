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
});
