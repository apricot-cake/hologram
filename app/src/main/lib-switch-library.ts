'use strict';

// #176: 何かが触れる「前」に、候補のフォルダがどう見えるか——switchLibrary の
// 4つの分岐のどれに当たるかを決める判定役。Electron に依存しない（理由は
// lib-migrate.ts と同じ）ので、アプリを起動せずに単体テストできる。

// これは #37 の looksLikeLibrary（ipc-transfer.ts）を一般化したもので、あちらは
// 答えが2つしか無かった（形跡あり／無し）。データベースは saveFolder が何を
// 指していても、以前は常にフォルダの外に住んでいたため。#176 でデータベースが
// ライブラリフォルダの「内側」へ移ったので、「このフォルダはデータベースを
// 持っているか」は今や「形跡」に畳み込むのではなく、それ自体が1つの分岐になる。

import fs from 'node:fs';
import path from 'node:path';

import { TRASH_SUBDIR } from './lib-save-folder-path.ts';
import { INBOX_DIRNAME } from '../../../native-host/inbox.mts';
import { IMPORTABLE_MEDIA } from '../../../native-host/importable-media.mts';

/** 稼働中のデータベースのファイル名——#176: データベース自体がライブラリの目印。 */
export const DB_FILENAME = 'hologram.db';

export type LibraryClassification = 'has-db' | 'empty' | 'evidence-no-db' | 'reject';

/**
 * `dir` を読む（書き込みは一切しない）だけで、4つの区分のどれかに振り分ける:
 *   'has-db'         — hologram.db がまさにここにある: そのまま開く。
 *   'evidence-no-db' — .trash/.hologram-inbox のサブフォルダ、あるいはライブラリの
 *                       メディアファイルが直下にある——だがデータベースは無い。
 *                       復旧可能（ミラーのスナップショット復元＋取込キューの
 *                       再生。どちらも既存の経路——switchLibrary 参照）で、
 *                       新規開始ではない。
 *   'empty'          — ドットファイル以外何も無い（あるいはフォルダ自体が
 *                       まだ存在しない——開いた時に作成される）。正当な新規
 *                       ライブラリで、利用者の確認待ち。
 *   'reject'         — 空ではないが、Hologram のライブラリだった形跡が一切
 *                       無い。決して開かない——呼び出し元は、誰かの無関係な
 *                       フォルダへ書き込み始めるのではなく、明確に拒まなければ
 *                       ならない。
 */
export function classifyLibraryFolder(dir: string): LibraryClassification {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return 'empty'; // 存在しない（あるいは読めない）——mkdir は開いた時に行われる
  }
  if (names.includes(DB_FILENAME)) return 'has-db';
  if (names.includes(TRASH_SUBDIR) || names.includes(INBOX_DIRNAME)) return 'evidence-no-db';
  const mediaRe = new RegExp('\\.(' + IMPORTABLE_MEDIA.join('|') + ')$', 'i');
  if (names.some((f) => mediaRe.test(f))) return 'evidence-no-db';
  const nonDot = names.filter((f) => !f.startsWith('.'));
  if (nonDot.length === 0) return 'empty';
  return 'reject';
}

export function dbFileIn(dir: string): string {
  return path.join(dir, DB_FILENAME);
}
