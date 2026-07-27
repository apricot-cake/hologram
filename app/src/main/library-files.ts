'use strict';

// Which file names the renderer may name, and where they live on disk (#132).
// The renderer never handles real paths — it sees asset:// URLs and the bare
// sidecar names inside them — so a name carrying a separator or a traversal
// segment did not come from the library and is refused here. Pulled out as pure
// functions (like save-folder-guard.ts / backup-guard.ts) so the boundary the
// window/shell IPC handlers share (show-in-folder, open-image-window, drag-out,
// copy-image) has one owner and unit-tests without spinning up Electron.

import path from 'node:path';

export const isLibraryFileName = (f: unknown): f is string => typeof f === 'string' && !!f && !f.includes('..') && !f.includes('/') && !f.includes('\\');

// Real paths for a batch of names: anything that isn't a library name, or isn't
// on disk, drops out. Windows aborts the ENTIRE drag when startDrag is handed a
// path that doesn't exist, so a file deleted behind the library's back has to
// drop rather than poison the gesture for its siblings. `exists` is injected so
// this stays pure (callers pass fs.existsSync).
export function libraryFilePaths(files: unknown, saveFolder: string, exists: (p: string) => boolean): string[] {
  if (!Array.isArray(files)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of files) {
    if (!isLibraryFileName(f) || seen.has(f)) continue;
    seen.add(f);
    const p = path.join(saveFolder, f);
    if (exists(p)) out.push(p);
  }
  return out;
}
