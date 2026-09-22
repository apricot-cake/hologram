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
import { nativeImage } from 'electron';

import { IMPORTABLE_MEDIA } from './lib-local-intake.ts';
import type { DropCollectResult, DroppedFile } from './ipc-payloads.ts';

function isHiddenOrJunk(name: string): boolean {
  return name.startsWith('.') || name.startsWith('~$') || /^(Thumbs\.db|desktop\.ini)$/i.test(name);
}

type FolderPlacement = Pick<DroppedFile, 'folderGroup' | 'folderTitle' | 'folderRoot' | 'folderRootTitle' | 'folderIsRoot'>;

function addFile(entryPath: string, out: DroppedFile[], placement?: FolderPlacement): void {
  const ext = path.extname(entryPath).slice(1).toLowerCase();
  if (!IMPORTABLE_MEDIA.includes(ext)) return;
  out.push({ path: entryPath, ext, ...placement });
}

async function walk(entryPath: string, out: DroppedFile[], placement?: FolderPlacement): Promise<void> {
  try {
    const st = await fs.promises.lstat(entryPath);
    if (st.isSymbolicLink() || isHiddenOrJunk(path.basename(entryPath))) return;
    if (st.isFile()) addFile(entryPath, out, placement);
    else if (st.isDirectory()) await walkDirectory(entryPath, out, placement);
  } catch {
    /* ドロップから走査までの間に消えた */
  }
}

async function walkDirectory(dirPath: string, out: DroppedFile[], placement?: FolderPlacement): Promise<void> {
  if (isHiddenOrJunk(path.basename(dirPath))) return;
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }
  // Dirent で種別を得れば、各ファイルを改めて lstat する必要がない。子フォルダは
  // 並列に走査するので、多数のローカルメディアでも確認ダイアログを待たせにくい。
  await Promise.all(
    entries.map(async (entry) => {
      if (entry.isSymbolicLink() || isHiddenOrJunk(entry.name)) return;
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isFile()) addFile(entryPath, out, placement);
      else if (entry.isDirectory()) await walkDirectory(entryPath, out, placement);
    }),
  );
}

async function previewDataUrl(filePath: string): Promise<string | undefined> {
  try {
    const image = nativeImage.createFromPath(filePath);
    if (image.isEmpty()) return undefined;
    return image.resize({ width: 72, quality: 'good' }).toDataURL();
  } catch {
    return undefined;
  }
}

export async function collectDroppedPaths(roots: string[]): Promise<DropCollectResult> {
  const files: DroppedFile[] = [];
  let hasFolder = false;
  let nextGroup = 0;
  let nextRoot = 0;
  for (let i = 0; i < roots.length; i++) {
    const root = path.resolve(roots[i]);
    try {
      if ((await fs.promises.lstat(root)).isDirectory()) {
        hasFolder = true;
        const rootTitle = path.basename(root);
        const folderRoot = nextRoot++;
        let rootGroup: number | undefined;
        const entries = await fs.promises.readdir(root, { withFileTypes: true });
        // 直下のファイルを先に1グループへまとめ、子フォルダはそれぞれ別グループにする。
        // 表示順もこの構造に揃うので、確認画面と実際の取り込みが食い違わない。
        for (const entry of entries.filter((entry) => !entry.isDirectory())) {
          const entryPath = path.join(root, entry.name);
          rootGroup ??= nextGroup++;
          await walk(entryPath, files, { folderGroup: rootGroup, folderTitle: rootTitle, folderRoot, folderRootTitle: rootTitle, folderIsRoot: true });
        }
        for (const entry of entries.filter((entry) => entry.isDirectory())) {
          await walkDirectory(path.join(root, entry.name), files, { folderGroup: nextGroup++, folderTitle: entry.name, folderRoot, folderRootTitle: rootTitle });
        }
      } else await walk(root, files);
    } catch {
      /* ドロップから走査までに消えた */
    }
  }
  const grouped = new Map<number, { name: string; mediaCount: number; rootName: string; isRoot?: boolean; previewPath: string }>();
  for (const file of files) {
    if (file.folderGroup == null || !file.folderTitle) continue;
    const current = grouped.get(file.folderGroup);
    if (current) current.mediaCount++;
    else grouped.set(file.folderGroup, { name: file.folderTitle, mediaCount: 1, rootName: file.folderRootTitle || file.folderTitle, ...(file.folderIsRoot ? { isRoot: true } : {}), previewPath: file.path });
  }
  const groups = await Promise.all(
    [...grouped.entries()]
      .sort(([a], [b]) => a - b)
      .map(async ([id, { previewPath, ...group }]) => {
        const preview = await previewDataUrl(previewPath);
        return { id, ...group, ...(preview ? { previewDataUrl: preview } : {}) };
      }),
  );
  return { files, mediaCount: files.length, groups, ...(hasFolder ? { hasFolder: true } : {}) };
}
