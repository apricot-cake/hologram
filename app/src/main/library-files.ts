'use strict';

// レンダラーがどのファイル名を名指しできるか、そのうちどれがアプリの外へ出られるか（#132）。
// レンダラーが本物のパスを扱うことは決してない＝見えるのは asset:// の URL と、保存先からの
// 許可された相対パスだけ。項目フォルダー以外の区切り文字や上位への移動はここで断る。
// 純粋な関数として切り出してある（save-folder-guard.ts や backup-guard.ts と
// 同じ）ので、ウィンドウ・シェルの IPC ハンドラ（show-in-folder、open-image-window、drag-out、
// copy-image）が共有する境界の持ち主が1つで済み、Electron を立ち上げずに単体テストできる。
//
// 意図して分けてある2つの問い:
//   isLibraryFileName / isViewerImageName ＝ 名前の形。保存先フォルダを持たない呼び出し箇所
//     （lib-window.ts のナビゲーションの番人）のためのもの。
//   libraryFilePath / libraryFilePaths   ＝ 書き出しが解決する本物のパス。読み取りの規則より
//     厳しい（libraryFilePath の注記を参照）。

import path from 'node:path';
import { resolveInSaveFolder } from './lib-save-folder-path.ts';
import { parseItemFilePath } from '../../../native-host/item-storage.mts';

const isLegacyRootFileName = (f: unknown): f is string => typeof f === 'string' && !!f && !f.includes('..') && !f.includes('/') && !f.includes('\\');
export const isLibraryFileName = (f: unknown): f is string => isLegacyRootFileName(f) || Boolean(parseItemFilePath(f));

// ライブラリのどのファイルが asset:// の最上位の文書になれるか（#215）。ラスタの形式だけ。
// Chromium はそれらを自前の受け身な画像の文書で包み、そこに作者のスクリプトは載らない。SVG だけが
// 毛色が違う＝<script> とイベントハンドラを持つ完全な XML の文書であり、asset://img/* は1つの
// オリジンなので、最上位で開かれたスクリプト付きの SVG は、同一オリジンの fetch でライブラリの
// ほかのファイルを全部読み、どこへでも送れてしまう。動画と zip も外す。このウィンドウは静止画の
// ビューアであって、ここでそれらを必要とするものは無い。
//
// これは入口のゲート。asset のハンドラの CSP（assetSecurityHeaders）が、将来の呼び出し元がこの
// 一覧を越えて手を伸ばしたときにも持ちこたえる2層目。
const VIEWER_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.jfif', '.png', '.webp', '.gif', '.avif']);

export const isViewerImageName = (f: unknown): f is string => isLibraryFileName(f) && VIEWER_IMAGE_EXTS.has(path.extname(f).toLowerCase());

// アプリの外へ出ようとしているライブラリのファイル1つの本物のパス＝別のアプリケーションへ
// ドラッグされる、クリップボードへ書かれる、ファイルマネージャで表示される（#132）＝あるいは、
// その名前が外へ出られないときは null。
//
// 内包の規則をここで導き直すことはしない。ライブラリの名前がどこへ解決するかの唯一の規則は
// resolveInSaveFolder（lib-save-folder-path.ts）が持つし、#267 がそれを切り出したのは、まさに
// 次の呼び出し元が手で写すのではなくそこへ足すようにするため。ここが上に足すのは書き出しの規則で、
// 読み取りの規則より2つの点で狭い。
//
//   - 現行の `items/<id>/<file>` と移行前の直下ファイルだけ。`avatars/<file>`、
//     `emoji/<file>`（#290）、`.trash/...` は読み取りとしては解決できるが、外へ渡さない。
//   - 与えられたとおりの名前。resolveInSaveFolder は意図して、上へ登る名前をそのベース名へ
//     押し潰す（`../secret.json` → `<save>/secret.json`）ので、はぐれた名前でもフォルダの中の
//     何かを読める。書き出しでそれをやると、名指しされたのとは違うファイルを黙って渡すことに
//     なるので、解決せずに食い違いとして断る。
//
// ゴミ箱がなぜその線の向こう側にあるのか。ゴミ箱からのドラッグは、OS がこの操作を教えるどの
// 場面でも「ここへ復元する」を意味する（Windows のごみ箱では、フォルダへのドラッグが復元
// そのもの）。一方 Hologram のドラッグはパスを渡すだけで、落ちた先を知ることは決してない＝
// だからそれを意味できない。渡すことになるパスは、30日の掃き寄せが消すものでもある。まず復元し、
// それからドラッグする。ゴミ箱の表示はその動詞を差し出し、ほかの編集は差し出さない（#268）。
export function libraryFilePath(name: unknown, saveFolder: string): string | null {
  if (typeof name !== 'string' || !name) return null;
  const resolved = resolveInSaveFolder(saveFolder, name);
  if (!resolved) return null;
  if (isLegacyRootFileName(name)) {
    return path.dirname(resolved) === path.resolve(saveFolder) && path.basename(resolved) === name ? resolved : null;
  }
  const item = parseItemFilePath(name);
  if (!item) return null;
  const expected = path.resolve(saveFolder, item.directory, item.file);
  return resolved === expected ? resolved : null;
}

/** 右クリックのパス操作が指す保存単位。現在の項目はファイルではなく項目フォルダーを返す。 */
export function libraryStoragePath(name: unknown, saveFolder: string): string | null {
  const file = libraryFilePath(name, saveFolder);
  if (!file) return null;
  return parseItemFilePath(name) ? path.dirname(file) : file;
}

// 名前の束に対する本物のパス。書き出せないもの（上）と、ディスクに無いものは落とす。Windows は、
// startDrag に存在しないパスを渡されるとドラッグ全体を中止するので、ライブラリの知らないところで
// 消されたファイルは、兄弟の操作まで台無しにせず落ちなければならない。純粋なままに保つため
// `exists` は注入する（呼び出し元は fs.existsSync を渡す）。
export function libraryFilePaths(files: unknown, saveFolder: string, exists: (p: string) => boolean): string[] {
  if (!Array.isArray(files)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of files) {
    if (typeof f !== 'string' || seen.has(f)) continue;
    seen.add(f);
    const p = libraryFilePath(f, saveFolder);
    if (p && exists(p)) out.push(p);
  }
  return out;
}
