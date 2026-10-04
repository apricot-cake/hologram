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
import { getPreparedImage } from './image-processing.ts';
import type { DropCollectResult, DroppedFile } from './ipc-payloads.ts';

function isHiddenOrJunk(name: string): boolean {
  return name.startsWith('.') || name.startsWith('~$') || /^(Thumbs\.db|desktop\.ini)$/i.test(name);
}

type FolderPlacement = Pick<DroppedFile, 'folderGroup' | 'folderTitle' | 'folderRoot' | 'folderRootTitle' | 'folderIsRoot'>;

const DROP_SCAN_MAX_ENTRIES = 10_000;
const DROP_SCAN_MAX_DEPTH = 64;
const DROP_SCAN_MAX_MS = 10_000;

interface ScanState {
  entries: number;
  deadline: number;
  maxEntries: number;
  maxDepth: number;
  limited: boolean;
}

function allowEntry(state: ScanState, depth: number): boolean {
  if (state.limited) return false;
  if (depth > state.maxDepth || ++state.entries > state.maxEntries || Date.now() > state.deadline) {
    state.limited = true;
    return false;
  }
  return true;
}

function addFile(entryPath: string, out: DroppedFile[], placement?: FolderPlacement): void {
  const ext = path.extname(entryPath).slice(1).toLowerCase();
  if (!IMPORTABLE_MEDIA.includes(ext)) return;
  out.push({ path: entryPath, ext, ...placement });
}

async function walkDirectory(dirPath: string, out: DroppedFile[], state: ScanState, placement?: FolderPlacement, depth = 0): Promise<void> {
  if (isHiddenOrJunk(path.basename(dirPath))) return;
  let dir: fs.Dir;
  try {
    dir = await fs.promises.opendir(dirPath);
  } catch {
    return;
  }
  try {
    for await (const entry of dir) {
      if (!allowEntry(state, depth + 1)) break;
      if (entry.isSymbolicLink() || isHiddenOrJunk(entry.name)) continue;
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isFile()) addFile(entryPath, out, placement);
      else if (entry.isDirectory()) await walkDirectory(entryPath, out, state, placement, depth + 1);
    }
  } finally {
    await dir.close().catch(() => {});
  }
}

async function previewDataUrl(filePath: string): Promise<string | undefined> {
  try {
    // 確認画面では先頭フレームだけを 72px 四方に収め、data URL の量を抑える。
    const prepared = await getPreparedImage(filePath, { kind: 'copy', width: 72 });
    if (!prepared || prepared.mime !== 'image/png') return undefined;
    const bytes = await fs.promises.readFile(prepared.path);
    return `data:${prepared.mime};base64,${bytes.toString('base64')}`;
  } catch {
    return undefined;
  }
}

export async function collectDroppedPaths(roots: string[], limits: { maxEntries?: number; maxDepth?: number; maxMs?: number } = {}): Promise<DropCollectResult> {
  const files: DroppedFile[] = [];
  const state: ScanState = {
    entries: 0,
    deadline: Date.now() + (limits.maxMs ?? DROP_SCAN_MAX_MS),
    maxEntries: limits.maxEntries ?? DROP_SCAN_MAX_ENTRIES,
    maxDepth: limits.maxDepth ?? DROP_SCAN_MAX_DEPTH,
    limited: false,
  };
  let hasFolder = false;
  let nextGroup = 0;
  let nextRoot = 0;
  for (let i = 0; i < roots.length; i++) {
    if (!allowEntry(state, 0)) break;
    const root = path.resolve(roots[i]);
    try {
      const rootStat = await fs.promises.lstat(root);
      if (rootStat.isSymbolicLink() || isHiddenOrJunk(path.basename(root))) continue;
      if (rootStat.isDirectory()) {
        hasFolder = true;
        const rootTitle = path.basename(root);
        const folderRoot = nextRoot++;
        let rootGroup: number | undefined;
        const entries: fs.Dirent[] = [];
        const dir = await fs.promises.opendir(root);
        try {
          for await (const entry of dir) {
            if (!allowEntry(state, 1)) break;
            entries.push(entry);
          }
        } finally {
          await dir.close().catch(() => {});
        }
        // 直下のファイルを先に1グループへまとめ、子フォルダはそれぞれ別グループにする。
        // 表示順もこの構造に揃うので、確認画面と実際の取り込みが食い違わない。
        for (const entry of entries.filter((entry) => !entry.isDirectory())) {
          const entryPath = path.join(root, entry.name);
          rootGroup ??= nextGroup++;
          if (!entry.isSymbolicLink() && !isHiddenOrJunk(entry.name) && entry.isFile()) {
            addFile(entryPath, files, { folderGroup: rootGroup, folderTitle: rootTitle, folderRoot, folderRootTitle: rootTitle, folderIsRoot: true });
          }
        }
        for (const entry of entries.filter((entry) => entry.isDirectory())) {
          await walkDirectory(path.join(root, entry.name), files, state, { folderGroup: nextGroup++, folderTitle: entry.name, folderRoot, folderRootTitle: rootTitle }, 1);
        }
      } else if (rootStat.isFile()) addFile(root, files);
    } catch {
      /* ドロップから走査までに消えた */
    }
  }
  if (state.limited) return { files: [], mediaCount: 0, groups: [], error: 'scan-limit' };
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
