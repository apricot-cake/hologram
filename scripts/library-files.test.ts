// ライブラリのファイルの共通境界（app/src/main/library-files.ts、#132）の単体テスト。
// window / shell 系の IPC ハンドラが必ず入力を通さなければならない「素のファイル名だけを許す」
// ゲートと、ドラッグアウトの裏にある一括のパス解決を見る。純粋なロジックで、Electron は要らない。
// 賭かっているのは、設計が名指しした2つの失敗の形＝保存フォルダの外へ出る名前を OS へ渡さない
// こと、そして存在しないパスを startDrag へ渡さないこと（Windows は1つでも解決できないと
// ドラッグ全体を中止する）。

import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { resolveInSaveFolder } from '../app/src/main/lib-save-folder-path';
import { isLibraryFileName, isViewerImageName, libraryFilePath, libraryFilePaths, libraryStoragePath } from '../app/src/main/library-files';

const save = path.resolve(path.sep === '\\' ? 'C:\\Hologram\\library' : '/home/alice/Hologram/library');
const at = (f: string) => path.join(save, f);
const existsAll = () => true;

describe('isLibraryFileName（ゲート）', () => {
  test('素の sidecar 画像名は通す', () => {
    expect(isLibraryFileName('abc123.jpg')).toBe(true);
    expect(isLibraryFileName('dummy-x_1.png')).toBe(true);
  });

  test('項目フォルダーのファイルは通す', () => {
    expect(isLibraryFileName('items/abc123/abc123.jpg')).toBe(true);
    expect(isLibraryFileName('items\\abc123\\abc123-media-0.png')).toBe(true);
  });

  test.each(['../config.json', 'a/../../b.jpg', '..'])('相対参照を弾く: %s', (name) => {
    expect(isLibraryFileName(name)).toBe(false);
  });

  test.each(['sub/a.jpg', 'sub\\a.jpg', 'items/a.jpg', 'items/a/deeper/a.jpg', 'C:\\Windows\\system32\\calc.exe', '/etc/passwd'])('項目フォルダー以外の区切り文字を弾く: %s', (name) => {
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

  test('項目フォルダー内のラスタ画像は通す', () => {
    expect(isViewerImageName('items/cap-1/cap-1.png')).toBe(true);
  });

  // 賭かっている失敗の形: SVG はスクリプトを載せられる「文書」で、asset://img/* はライブラリ
  // 全体で1つのオリジン＝最上位で開かせると、同一オリジンの fetch が他のファイルを読めて
  // しまう。拡張子の大小や二重拡張子ですり抜けさせてはいけない。
  test.each(['a.svg', 'a.SVG', 'a.png.svg'])('SVG は拒む: %s', (name) => {
    expect(isViewerImageName(name)).toBe(false);
  });

  test.each(['a.mp4', 'a.webm', 'a.mov', 'a.m4v', 'a.zip', 'a.html', 'a.json', 'noext'])('静止画ビューアの守備範囲外は拒む: %s', (name) => {
    expect(isViewerImageName(name)).toBe(false);
  });

  test.each(['../a.png', 'sub/a.png', 'sub\\a.png', 'items/cap-1/deeper/a.png', '', null, undefined, 42])('正規のライブラリ名でないものは拒む（ゲートを通してから拡張子を見る）: %s', (v) => {
    expect(isViewerImageName(v)).toBe(false);
  });
});

// 実体のファイルをアプリの外へ渡す唯一の出口＝ドラッグアウト・クリップボード・「フォルダで
// 表示」。閉じ込め自体は lib-save-folder-path.ts にある（#267）。ここに在るのはその上へ重ねた
// 「出してよい」の規則＝保存フォルダの直下だけ、渡された名前そのままだけ。通る形と落ちる形を
// 同じ describe に並べてある。片側だけを見ていると規則が黙って広がるため。
describe('libraryFilePath（持ち出しの解決）', () => {
  test.each(['a.jpg', 'dummy-x_1.png', '.hidden.jpg', 'ふつうの 名前.png'])('保存フォルダ直下の素の名前は通す: %s', (name) => {
    expect(libraryFilePath(name, save)).toBe(at(name));
  });

  test('項目フォルダー内のファイルは実体まで解決する', () => {
    expect(libraryFilePath('items/cap-1/cap-1.jpg', save)).toBe(at(path.join('items', 'cap-1', 'cap-1.jpg')));
  });

  // 綴りをどう変えてもすり抜けさせない＝検査が見るのは「入力の文字列がどう見えるか」ではなく
  // 「どこへ解決するか」（resolveInSaveFolder は先に正規化してから検査する）。
  test.each(['..', '.', '../secret.json', '..\\secret.json', 'a/../../b.jpg', 'sub/../a.jpg', './a.jpg', '.\\a.jpg'])('親をたどる綴りは全部弾く: %s', (name) => {
    expect(libraryFilePath(name, save)).toBeNull();
  });

  test.each(['C:\\Windows\\system32\\calc.exe', '/etc/passwd', '\\\\server\\share\\x.jpg', 'C:/Hologram/library/a.jpg'])('絶対パスは弾く（basename へ潰して通さない）: %s', (name) => {
    expect(libraryFilePath(name, save)).toBeNull();
  });

  test.each(['sub/b.png', 'sub\\b.png', 'sub/deeper/b.png'])('知らないサブフォルダは弾く: %s', (name) => {
    expect(libraryFilePath(name, save)).toBeNull();
  });

  // 賭かっている失敗の形＝「読める場所」と「渡してよい場所」を同じ規則として扱うこと。
  // #267 が .trash/ と avatars/ を解決できるようにした＝カードがそこのサムネイルを描けるのは
  // そのため。だが渡してよいかどうかは別の判断（ゴミ箱＝まず復元が先で、30日で消える／
  // avatars＝投稿自身のメディアではない）。
  test.each(['.trash/a.jpg', '.trash\\a.jpg', 'avatars/a.png', 'avatars\\a.png', 'emoji/a.png', 'emoji\\a.png'])('許可サブフォルダでも持ち出しは弾く: %s', (name) => {
    expect(libraryFilePath(name, save)).toBeNull();
  });

  test('同じ名前が「読めるが出せない」＝2つの規則の差はここにしかない', () => {
    expect(resolveInSaveFolder(save, '.trash/a.jpg')).toBe(at(path.join('.trash', 'a.jpg')));
    expect(resolveInSaveFolder(save, 'avatars/a.png')).toBe(at(path.join('avatars', 'a.png')));
    expect(resolveInSaveFolder(save, 'emoji/a.png')).toBe(at(path.join('emoji', 'a.png')));
    expect(libraryFilePath('.trash/a.jpg', save)).toBeNull();
    expect(libraryFilePath('avatars/a.png', save)).toBeNull();
    expect(libraryFilePath('emoji/a.png', save)).toBeNull();
  });

  test.each([['', null, undefined, 0, 42, {}, [], true]].flat())('文字列でない・空を弾く: %s', (v) => {
    expect(libraryFilePath(v, save)).toBeNull();
  });
});

describe('libraryStoragePath（右クリックの保存単位）', () => {
  test('項目ファイルは項目フォルダーを返す', () => {
    expect(libraryStoragePath('items/cap-1/cap-1.jpg', save)).toBe(at(path.join('items', 'cap-1')));
  });

  test('移行前の直下ファイルはそのファイルを返す', () => {
    expect(libraryStoragePath('cap-1.jpg', save)).toBe(at('cap-1.jpg'));
  });
});

describe('libraryFilePaths（ドラッグアウトの一括解決）', () => {
  test('保存フォルダ基準で解決する', () => {
    expect(libraryFilePaths(['a.jpg', 'items/cap-2/cap-2.png'], save, existsAll)).toEqual([at('a.jpg'), at(path.join('items', 'cap-2', 'cap-2.png'))]);
  });

  test('ゲートが弾く名前だけ落として残りは通す', () => {
    expect(libraryFilePaths(['a.jpg', '../secret.json', 'sub/b.png', 'c.webp'], save, existsAll)).toEqual([at('a.jpg'), at('c.webp')]);
  });

  // ゴミ箱の実体が1つ混ざっていても、落とすのはそれだけで残りは渡せる＝ドラッグ全体は止め
  // ない（消えたファイルと同じ扱い。ゴミ箱のカードはそもそもドラッグを受け付けない＝
  // TrashView.tsx）。
  test('ゴミ箱・アバター・絵文字の実体は一括でも落とす', () => {
    expect(libraryFilePaths(['a.jpg', '.trash/deleted.jpg', 'avatars/who.png', 'emoji/e.png', 'b.jpg'], save, existsAll)).toEqual([at('a.jpg'), at('b.jpg')]);
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
