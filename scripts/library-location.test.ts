import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { defaultLibraryDir, libraryDestinationDir } from '../native-host/paths.mts';

describe('ライブラリの保存先', () => {
  const parent = path.resolve('selected-folder');

  test('初回と親フォルダ選択時は Hologram/Library を使う', () => {
    expect(defaultLibraryDir()).toBe(path.join(os.homedir(), 'Hologram', 'Library'));
    expect(libraryDestinationDir(parent)).toBe(path.join(parent, 'Hologram', 'Library'));
  });

  test.each(['Hologram', 'hologram'])('製品フォルダ %s を重複させない', (name) => {
    expect(libraryDestinationDir(path.join(parent, name))).toBe(path.join(parent, name, 'Library'));
  });

  test.each(['Library', 'library'])('ライブラリフォルダ %s 自体を使う', (name) => {
    const chosen = path.join(parent, 'Hologram', name);
    expect(libraryDestinationDir(chosen)).toBe(chosen);
  });
});
