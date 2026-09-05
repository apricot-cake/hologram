'use strict';

// レンダラーがどのファイル名を名指しできるか、そのうちどれを OS の操作へ渡せるか。
// レンダラーが本物のパスを扱うことは決してない＝見えるのは asset:// の URL と、保存先からの
// 許可された相対パスだけ。項目フォルダー以外の区切り文字や上位への移動はここで断る。
// 純粋な関数として切り出してある（save-folder-guard.ts と同じ）ので、
// ウィンドウ・シェルの IPC ハンドラ（show-in-folder、open-image-window、copy-files）が
// 共有する境界の持ち主が1つで済み、Electron を立ち上げずに単体テストできる。
//
// 意図して分けてある2つの問い:
//   isLibraryFileName / isViewerImageName ＝ 名前の形。保存先フォルダを持たない呼び出し箇所
//     （lib-window.ts のナビゲーションの番人）のためのもの。
//   libraryFilePath ＝ OS の操作が解決する本物のパス。読み取りの規則より
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

// クリップボードへ書くか、ファイルマネージャで表示するライブラリファイルの本物のパス（#132）。
// その名前を OS へ渡せないときは null。
//
// 内包の規則をここで導き直すことはしない。ライブラリの名前がどこへ解決するかの唯一の規則は
// resolveInSaveFolder（lib-save-folder-path.ts）が持つし、#267 がそれを切り出したのは、まさに
// 次の呼び出し元が手で写すのではなくそこへ足すようにするため。ここが上に足すのは OS 操作の規則で、
// 読み取りの規則より2つの点で狭い。
//
//   - 現行の `items/<id>/<file>` と移行前の直下ファイルだけ。`avatars/<file>`、
//     `emoji/<file>`（#290）、`.trash/...` は読み取りとしては解決できるが、外へ渡さない。
//   - 与えられたとおりの名前。resolveInSaveFolder は意図して、上へ登る名前をそのベース名へ
//     押し潰す（`../secret.json` → `<save>/secret.json`）ので、はぐれた名前でもフォルダの中の
//     何かを読める。書き出しでそれをやると、名指しされたのとは違うファイルを黙って渡すことに
//     なるので、解決せずに食い違いとして断る。
//
// ゴミ箱のファイルは30日の掃き寄せで消える。まず復元してから OS の操作へ渡す。
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
