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

async function walk(entryPath: string, out: DroppedFile[], folderGroup?: number, folderTitle?: string): Promise<void> {
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
    for (const name of names) await walk(path.join(entryPath, name), out, folderGroup, folderTitle);
    return;
  }
  if (!st.isFile()) return; // デバイスやソケットなど＝取り込む対象ではない
  const ext = path.extname(entryPath).slice(1).toLowerCase();
  if (!IMPORTABLE_MEDIA.includes(ext)) return;
  out.push({ path: entryPath, ext, ...(folderGroup == null ? {} : { folderGroup }), ...(folderTitle == null ? {} : { folderTitle }) });
}

export async function collectDroppedPaths(roots: string[]): Promise<DropCollectResult> {
  const files: DroppedFile[] = [];
  let hasFolder = false;
  let nextGroup = 0;
  for (let i = 0; i < roots.length; i++) {
    const root = path.resolve(roots[i]);
    try {
      if ((await fs.promises.lstat(root)).isDirectory()) {
        hasFolder = true;
        const rootTitle = path.basename(root);
        let rootGroup: number | undefined;
        const entries = await fs.promises.readdir(root, { withFileTypes: true });
        // 直下のファイルを先に1グループへまとめ、子フォルダはそれぞれ別グループにする。
        // 表示順もこの構造に揃うので、確認画面と実際の取り込みが食い違わない。
        for (const entry of entries.filter((entry) => !entry.isDirectory())) {
          const entryPath = path.join(root, entry.name);
          rootGroup ??= nextGroup++;
          await walk(entryPath, files, rootGroup, rootTitle);
        }
        for (const entry of entries.filter((entry) => entry.isDirectory())) {
          await walk(path.join(root, entry.name), files, nextGroup++, entry.name);
        }
      } else await walk(root, files);
    } catch {
      /* ドロップから走査までに消えた */
    }
  }
  const grouped = new Map<number, { name: string; mediaCount: number }>();
  for (const file of files) {
    if (file.folderGroup == null || !file.folderTitle) continue;
    const current = grouped.get(file.folderGroup);
    if (current) current.mediaCount++;
    else grouped.set(file.folderGroup, { name: file.folderTitle, mediaCount: 1 });
  }
  const groups = [...grouped.entries()].sort(([a], [b]) => a - b).map(([id, group]) => ({ id, ...group }));
  return { files, mediaCount: files.length, groups, ...(hasFolder ? { hasFolder: true } : {}) };
}
