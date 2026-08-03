'use strict';

// Recursive walk for the window-drop door (#234): turns a drop's root paths
// (files and/or folders, resolved by preload's webUtils.getPathForFile) into a
// flat, counted list — nothing is written here. The count has to come from a
// walk that already finished (#234's design comment: the recursive walk
// completes BEFORE the renderer asks "N 件を取り込みますか？", never while
// still running) — ipc-transfer.ts's collect-dropped-paths handler calls this
// and hands the count to that question; import-dropped-paths only runs once
// the answer is yes, over the SAME list this returned (no second walk).
//
// Shares the hidden/junk-name filter with the watch-folder door
// (lib-watch-import.ts's isHiddenOrJunk) so "what counts as noise" has one
// definition. Adds its own symlink/junction refusal (lstat, never followed) —
// the watch door's chokidar scan is depth:0 and never recurses into a
// subfolder, so it never had to decide this; a folder drop does, and the
// design calls out looping through a symlink as the risk to guard against.
import fs from 'node:fs';
import path from 'node:path';

import { isHiddenOrJunk } from './lib-watch-import.ts';
import { IMPORTABLE_MEDIA } from './lib-local-intake.ts';
import type { DropCollectResult, DroppedFile } from './ipc-payloads.ts';

async function walk(entryPath: string, out: DroppedFile[]): Promise<void> {
  let st: fs.Stats;
  try {
    st = await fs.promises.lstat(entryPath);
  } catch {
    return; // gone between the drop and this walk
  }
  // Never followed, files or folders alike — a folder symlink/junction is the
  // loop risk the design calls out; a file symlink is rare enough (Windows
  // users do not casually mklink individual files) that one rule for both
  // keeps this simple instead of needing two.
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
  if (!st.isFile()) return; // device/socket/etc — not a collectable item
  out.push({ path: entryPath, ext: (path.extname(entryPath).slice(1) || 'bin').toLowerCase() });
}

export async function collectDroppedPaths(roots: string[]): Promise<DropCollectResult> {
  const files: DroppedFile[] = [];
  for (const root of roots) await walk(path.resolve(root), files);
  let mediaCount = 0;
  for (const f of files) if (IMPORTABLE_MEDIA.includes(f.ext)) mediaCount++;
  return { files, mediaCount, otherCount: files.length - mediaCount };
}
