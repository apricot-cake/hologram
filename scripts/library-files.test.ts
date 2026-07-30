// 共有のライブラリファイル境界（app/src/main/library-files.ts, #132）のユニットテスト。
// window/shell 系の IPC ハンドラが入力を必ず通す「素のファイル名だけ許す」ゲートと、
// ドラッグアウトの裏にあるパス一括解決。純ロジック＝Electron 不要。
// 賭かっているのは設計が名指しした2つの失敗モード＝保存フォルダの外へ出る名前を OS へ
// 渡さないこと、存在しないパスを startDrag へ渡さないこと（Windows は1つ解決できないと
// ドラッグ全体を中止する）。

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

  // 賭かっている失敗モード: SVG はスクリプトを持てる「文書」で、asset://img/* は
  // ライブラリ全体で1オリジン＝トップレベルで開けば同一オリジン fetch で他の
  // ファイルを読み出せてしまう。拡張子の大小・二重拡張子で抜けないこと。
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

// アプリの外へ実体を渡す唯一の口＝ドラッグアウト・クリップボード・エクスプローラで表示。
// 封じ込め自体は lib-save-folder-path.ts（#267）が持ち、ここはその上に乗る「持ち出してよい
// 形」の規則＝保存フォルダ直下だけ・与えられた名前そのままだけ。通る形と通らない形を同じ
// describe に並べるのは、片方だけ見て規則を広げると気付けないため。
describe('libraryFilePath（持ち出しの解決）', () => {
  test.each(['a.jpg', 'dummy-x_1.png', '.hidden.jpg', 'ふつうの 名前.png'])('保存フォルダ直下の素の名前は通す: %s', (name) => {
    expect(libraryFilePath(name, save)).toBe(at(name));
  });

  // 綴りを変えても抜けないこと＝判定は「入力文字列がどう見えるか」ではなく
  // 「解決した先がどこか」で行う（resolveInSaveFolder が正規化してから見る）。
  test.each(['..', '.', '../secret.json', '..\\secret.json', 'a/../../b.jpg', 'sub/../a.jpg', './a.jpg', '.\\a.jpg'])('親をたどる綴りは全部弾く: %s', (name) => {
    expect(libraryFilePath(name, save)).toBeNull();
  });

  test.each(['C:\\Windows\\system32\\calc.exe', '/etc/passwd', '\\\\server\\share\\x.jpg', 'C:/Hologram/library/a.jpg'])('絶対パスは弾く（basename へ潰して通さない）: %s', (name) => {
    expect(libraryFilePath(name, save)).toBeNull();
  });

  test.each(['sub/b.png', 'sub\\b.png', 'sub/deeper/b.png'])('知らないサブフォルダは弾く: %s', (name) => {
    expect(libraryFilePath(name, save)).toBeNull();
  });

  // 賭かっている失敗モード＝「読める場所」と「出してよい場所」を同じ規則にしてしまうこと。
  // #267 で .trash/ と avatars/ は解決できるようになった＝カードが描けるのはそのおかげだが、
  // 持ち出しは別の判断（ゴミ箱＝復元が先・30日で消える／アバター＝投稿のメディアではない）。
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

  // 1枚でもゴミ箱の実体が混ざれば、その1枚だけ落ちて残りは出せる＝ドラッグ全体は止めない
  // （欠損ファイルと同じ扱い。ゴミ箱のカードはそもそもドラッグを受けない＝TrashView.tsx）。
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
