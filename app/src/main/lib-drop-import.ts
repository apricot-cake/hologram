'use strict';

// ウィンドウへのドロップの入口（#234）のための再帰の走査。ドロップのルートのパス（ファイルや
// フォルダ。preload の webUtils.getPathForFile が解決したもの）を、平坦で件数の分かる一覧に
// する＝ここでは何も書かない。件数は、既に終わった走査から来なければならない（#234 の設計
// コメント: 再帰の走査は、レンダラーが "N 件を取り込みますか？" と尋ねる前に完了する。走って
// いる最中ではない）＝ipc-transfer.ts の collect-dropped-paths のハンドラがこれを呼び、その
// 件数をあの問いへ渡す。import-dropped-paths が走るのは答えが是のときだけで、対象はこれが返した
// のと同じ一覧（2回目の走査は無い）。
//
// 隠しファイルと OS が作る管理ファイルは取り込まない。シンボリックリンクとジャンクションも
// lstat で拒否し、フォルダを再帰するときにリンクの循環へ入らないようにする。
import fs from 'node:fs';
import path from 'node:path';

import { IMPORTABLE_MEDIA } from './lib-local-intake.ts';
import type { DropCollectResult, DroppedFile } from './ipc-payloads.ts';

function isHiddenOrJunk(name: string): boolean {
  return name.startsWith('.') || name.startsWith('~$') || /^(Thumbs\.db|desktop\.ini)$/i.test(name);
}

async function walk(entryPath: string, out: DroppedFile[]): Promise<void> {
  let st: fs.Stats;
  try {
    st = await fs.promises.lstat(entryPath);
  } catch {
    return; // ドロップからこの走査までの間に消えた
  }
  // ファイルでもフォルダでも決して辿らない＝フォルダのシンボリックリンクやジャンクションが、
  // 設計の名指しするループのリスク。ファイルのシンボリックリンクは十分に珍しい（Windows の
  // 利用者が個々のファイルを気軽に mklink することはない）ので、両方に1つの規則を当てる方が、
  // 2つ要るより単純に済む。
  if (st.isSymbolicLink()) return;
  if (isHiddenOrJunk(path.basename(entryPath))) return;
  if (st.isDirectory()) {
    let names: string[];
    try {
      names = await fs.promises.readdir(entryPath);
    } catch {
      return;
    }
    for (const name of names) await walk(path.join(entryPath, name), out);
    return;
  }
  if (!st.isFile()) return; // デバイスやソケットなど＝取り込む対象ではない
  const ext = path.extname(entryPath).slice(1).toLowerCase();
  if (!IMPORTABLE_MEDIA.includes(ext)) return;
  out.push({ path: entryPath, ext });
}

export async function collectDroppedPaths(roots: string[]): Promise<DropCollectResult> {
  const files: DroppedFile[] = [];
  for (const root of roots) await walk(path.resolve(root), files);
  return { files, mediaCount: files.length };
}
