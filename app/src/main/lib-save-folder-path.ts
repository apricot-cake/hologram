'use strict';

// ライブラリのすべてのファイル名に掛かる内包の規則。レコード・`asset://` の URL・IPC の引数から
// 来た名前が、保存先フォルダの中の何に解決してよいか。
//
// 受け入れる形は4つ。「任意のサブディレクトリ」へ一般化せず列挙してある＝サブフォルダがこの一覧に
// 加わる方法は、ここへ書き足されること。
//
//   <file>          キャプチャとダウンロードしたメディア。フォルダの直下に平らに置かれる
//   avatars/<file>  共有のアバターのストア（アバターの URL 1つにつきファイル1つ）
//   emoji/<file>    共有のカスタム絵文字のストア（#290＝:shortcode: の絵文字画像の URL 1つに
//                   つきファイル1つ。理屈は avatars/ と同じ）
//   .trash/<file>   ソフト削除の預かり場所（#267＝ゴミ箱の表示はライブラリ自身のカードを描くので、
//                   そのファイルも配れなければならない）
//
// それ以外＝より深いパス、知らないサブフォルダ、絶対パス＝は、そのベース名へ押し潰す。だから
// 名指しできるのは今もフォルダのルートにあるものだけ。外へ登ろうとする試みにとってそれが何を
// 意味するかに注意。`.trash/../..` は「.. という名前のゴミ箱のファイル」ではなく、`..` へ
// 押し潰され、その後で下の内包の確認が弾く。確認は入力ではなく解決後のパスに対して走るので、
// 綴りを先回りして予想していたかどうかに依存しない。
//
// Electron に依存しないので、この規則は素の node で単体テストできるし
// （scripts/save-folder-path.test.ts）、すべての呼び出し元が1つの実体を共有できる。main の
// asset:// のハンドラ、取込キューの流し込み、整合性の走査、ゴミ箱の掃き寄せは、かつて手で同一に
// 保たれた2つを抱えていた。広がった許可一覧が引き裂くのは、まさにその形（#267）。

import path from 'node:path';

/** 共有のアバターのストア＝アバターの URL 1つにつきファイル1つ。その投稿者のすべてのキャプチャが参照する。 */
export const AVATAR_SUBDIR = 'avatars';
/** 共有のカスタム絵文字のストア（#290）＝:shortcode: の絵文字画像の URL 1つにつきファイル1つ。 */
export const EMOJI_SUBDIR = 'emoji';
/** ソフト削除の預かり場所。`getTrashDir()` はこれを名指ししなければならない＝だから共有の定数。 */
export const TRASH_SUBDIR = '.trash';

const ALLOWED_SUBDIRS: readonly string[] = [AVATAR_SUBDIR, EMOJI_SUBDIR, TRASH_SUBDIR];

/**
 * `name` を `saveFolder` の厳密に内側の絶対パスへ解決する。ほかのどこかへ着地するなら null。
 * 受け入れる形については、モジュールのコメントを参照。
 */
export function resolveInSaveFolder(saveFolder: string | null | undefined, name: string | null | undefined): string | null {
  if (!saveFolder || !name) return null;
  const root = path.resolve(saveFolder);
  const rel = String(name).replace(/\\/g, '/');
  // 2区間の名前をそのまま受け取るのは、認めたサブフォルダで、かつその子が本物のベース名である
  // ときだけ。'.' と '..' は path.join が歩く名前なので、決してベース名には数えない。
  const m = /^([^/]+)\/([^/]+)$/.exec(rel);
  const sub = m && ALLOWED_SUBDIRS.includes(m[1]) && m[2] !== '.' && m[2] !== '..' ? { dir: m[1], child: m[2] } : null;
  const parent = sub ? path.resolve(root, sub.dir) : root;
  const resolved = sub ? path.resolve(parent, sub.child) : path.resolve(root, path.basename(rel));
  if (!resolved.startsWith(root + path.sep)) return null;
  // 名前が求めたディレクトリの直下であること＝保存先フォルダのどこか下、というだけでは足りない。
  // これが無いと、上の分岐への将来の変更が、入れ子のパスを返しつつ内包の確認を通してしまい得る。
  return path.dirname(resolved) === parent ? resolved : null;
}
