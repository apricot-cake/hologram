// 共有のライブラリファイル境界（app/src/main/library-files.ts, #132）のユニットテスト。
// window/shell 系の IPC ハンドラが入力を必ず通す「素のファイル名だけ許す」ゲートと、
// ドラッグアウトの裏にあるパス一括解決。純ロジック＝Electron 不要。
// 賭かっているのは設計が名指しした2つの失敗モード＝保存フォルダの外へ出る名前を OS へ
// 渡さないこと、存在しないパスを startDrag へ渡さないこと（Windows は1つ解決できないと
// ドラッグ全体を中止する）。

import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { isLibraryFileName, libraryFilePaths } from '../app/src/main/library-files';

const save = path.resolve(path.sep === '\\' ? 'C:\\Hologram\\library' : '/home/alice/Hologram/library');
const at = (f: string) => path.join(save, f);
const existsAll = () => true;

describe('isLibraryFileName（ゲート）', () => {
  test('素の sidecar 画像名は通す', () => {
    expect(isLibraryFileName('abc123.jpg')).toBe(true);
    expect(isLibraryFileName('dummy-x_1.png')).toBe(true);
  });

  test.each(['../config.json', 'a/../../b.jpg', '..'])('相対参照を弾く: %s', (name) => {
    expect(isLibraryFileName(name)).toBe(false);
  });

  test.each(['sub/a.jpg', 'sub\\a.jpg', 'C:\\Windows\\system32\\calc.exe', '/etc/passwd'])('区切り文字を弾く（posix も windows も、どの OS でも）: %s', (name) => {
    expect(isLibraryFileName(name)).toBe(false);
  });

  test.each([['', null, undefined, 0, 42, {}, [], true]].flat())('文字列でない・空を弾く: %s', (v) => {
    expect(isLibraryFileName(v)).toBe(false);
  });
});

describe('libraryFilePaths（ドラッグアウトの一括解決）', () => {
  test('保存フォルダ基準で解決する', () => {
    expect(libraryFilePaths(['a.jpg', 'b.png'], save, existsAll)).toEqual([at('a.jpg'), at('b.png')]);
  });

  test('ゲートが弾く名前だけ落として残りは通す', () => {
    expect(libraryFilePaths(['a.jpg', '../secret.json', 'sub/b.png', 'c.webp'], save, existsAll)).toEqual([at('a.jpg'), at('c.webp')]);
  });

  test('消えたファイルは落とす（隣が1つ消えただけでドラッグを中止させない）', () => {
    const exists = (p: string) => p !== at('gone.jpg');
    expect(libraryFilePaths(['a.jpg', 'gone.jpg', 'b.jpg'], save, exists)).toEqual([at('a.jpg'), at('b.jpg')]);
  });

  test('全部消えていれば空（呼び出し側は startDrag を呼ばず no-op）', () => {
    expect(libraryFilePaths(['gone.jpg'], save, () => false)).toEqual([]);
  });

  test('重複排除＝同じファイルを2回並べても1回だけ', () => {
    expect(libraryFilePaths(['a.jpg', 'a.jpg', 'b.jpg'], save, existsAll)).toEqual([at('a.jpg'), at('b.jpg')]);
  });

  test.each([null, undefined, 'a.jpg', 42, {}])('配列でない入力は空（renderer がゴミを送った時）: %s', (v) => {
    expect(libraryFilePaths(v, save, existsAll)).toEqual([]);
  });

  test('renderer が送った順序を保つ（ドロップ先の並びが選択順に従う）', () => {
    expect(libraryFilePaths(['z.jpg', 'a.jpg'], save, existsAll)).toEqual([at('z.jpg'), at('a.jpg')]);
  });
});
