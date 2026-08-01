// Unit tests for the shared library-file boundary (app/src/main/library-files.ts, #132).
// Covers the "allow only bare file names" gate that every window/shell-family IPC handler
// must route input through, and the batch path resolution behind drag-out. Pure logic — no
// Electron needed.
// What's at stake is the two failure modes the design specifically named = never handing the
// OS a name that escapes the save folder, and never handing startDrag a path that doesn't
// exist (Windows aborts the entire drag if it can't resolve even one).

import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { resolveInSaveFolder } from '../app/src/main/lib-save-folder-path';
import { isLibraryFileName, isViewerImageName, libraryFilePath, libraryFilePaths } from '../app/src/main/library-files';

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

describe('isViewerImageName（単独ウィンドウで開いてよい形式・#215）', () => {
  test.each(['a.jpg', 'a.JPEG', 'a.jfif', 'a.png', 'a.webp', 'a.gif', 'a.avif'])('ラスタ画像は通す（大文字拡張子も）: %s', (name) => {
    expect(isViewerImageName(name)).toBe(true);
  });

  // Failure mode at stake: SVG is a "document" that can carry a script, and asset://img/*
  // is a single origin across the whole library = opening it at the top level would let a
  // same-origin fetch read other files. Must not slip through via extension case or a
  // double extension.
  test.each(['a.svg', 'a.SVG', 'a.png.svg'])('SVG は拒む: %s', (name) => {
    expect(isViewerImageName(name)).toBe(false);
  });

  test.each(['a.mp4', 'a.webm', 'a.mov', 'a.m4v', 'a.zip', 'a.html', 'a.json', 'noext'])('静止画ビューアの守備範囲外は拒む: %s', (name) => {
    expect(isViewerImageName(name)).toBe(false);
  });

  test.each(['../a.png', 'sub/a.png', 'sub\\a.png', '', null, undefined, 42])('素のライブラリ名でないものは拒む（ゲートを通してから拡張子を見る）: %s', (v) => {
    expect(isViewerImageName(v)).toBe(false);
  });
});

// The only exit point that hands real file entities out of the app = drag-out, clipboard,
// "show in Explorer". The containment itself lives in lib-save-folder-path.ts (#267); this
// is the rule layered on top of it for what's "allowed to leave" = only directly under the
// save folder, only under the exact name given. Passing and failing shapes are placed in the
// same describe block so that looking at only one side doesn't let the rule quietly widen.
describe('libraryFilePath（持ち出しの解決）', () => {
  test.each(['a.jpg', 'dummy-x_1.png', '.hidden.jpg', 'ふつうの 名前.png'])('保存フォルダ直下の素の名前は通す: %s', (name) => {
    expect(libraryFilePath(name, save)).toBe(at(name));
  });

  // Must not slip through no matter how the spelling is varied = the check goes by "where it
  // resolves to", not "what the input string looks like" (resolveInSaveFolder normalizes
  // first, then checks).
  test.each(['..', '.', '../secret.json', '..\\secret.json', 'a/../../b.jpg', 'sub/../a.jpg', './a.jpg', '.\\a.jpg'])('親をたどる綴りは全部弾く: %s', (name) => {
    expect(libraryFilePath(name, save)).toBeNull();
  });

  test.each(['C:\\Windows\\system32\\calc.exe', '/etc/passwd', '\\\\server\\share\\x.jpg', 'C:/Hologram/library/a.jpg'])('絶対パスは弾く（basename へ潰して通さない）: %s', (name) => {
    expect(libraryFilePath(name, save)).toBeNull();
  });

  test.each(['sub/b.png', 'sub\\b.png', 'sub/deeper/b.png'])('知らないサブフォルダは弾く: %s', (name) => {
    expect(libraryFilePath(name, save)).toBeNull();
  });

  // Failure mode at stake = treating "readable location" and "location it's OK to hand out"
  // as the same rule. #267 made .trash/ and avatars/ resolvable = that's why cards can render
  // thumbnails there, but handing them out is a separate call (trash = restore comes first
  // and it's purged after 30 days / avatars = not the post's own media).
  test.each(['.trash/a.jpg', '.trash\\a.jpg', 'avatars/a.png', 'avatars\\a.png'])('許可サブフォルダでも持ち出しは弾く: %s', (name) => {
    expect(libraryFilePath(name, save)).toBeNull();
  });

  test('同じ名前が「読めるが出せない」＝2つの規則の差はここにしかない', () => {
    expect(resolveInSaveFolder(save, '.trash/a.jpg')).toBe(at(path.join('.trash', 'a.jpg')));
    expect(resolveInSaveFolder(save, 'avatars/a.png')).toBe(at(path.join('avatars', 'a.png')));
    expect(libraryFilePath('.trash/a.jpg', save)).toBeNull();
    expect(libraryFilePath('avatars/a.png', save)).toBeNull();
  });

  test.each([['', null, undefined, 0, 42, {}, [], true]].flat())('文字列でない・空を弾く: %s', (v) => {
    expect(libraryFilePath(v, save)).toBeNull();
  });
});

describe('libraryFilePaths（ドラッグアウトの一括解決）', () => {
  test('保存フォルダ基準で解決する', () => {
    expect(libraryFilePaths(['a.jpg', 'b.png'], save, existsAll)).toEqual([at('a.jpg'), at('b.png')]);
  });

  test('ゲートが弾く名前だけ落として残りは通す', () => {
    expect(libraryFilePaths(['a.jpg', '../secret.json', 'sub/b.png', 'c.webp'], save, existsAll)).toEqual([at('a.jpg'), at('c.webp')]);
  });

  // If even one trash entity is mixed in, only that one is dropped and the rest can still be
  // handed out = the whole drag isn't stopped (same handling as a missing file. Trash cards
  // don't accept drag in the first place = TrashView.tsx).
  test('ゴミ箱・アバターの実体は一括でも落とす', () => {
    expect(libraryFilePaths(['a.jpg', '.trash/deleted.jpg', 'avatars/who.png', 'b.jpg'], save, existsAll)).toEqual([at('a.jpg'), at('b.jpg')]);
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
