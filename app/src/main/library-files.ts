'use strict';

// Which file names the renderer may name, and which of them may leave the app
// (#132). The renderer never handles real paths — it sees asset:// URLs and the
// bare sidecar names inside them — so a name carrying a separator or a traversal
// segment did not come from the library and is refused here. Pulled out as pure
// functions (like save-folder-guard.ts / backup-guard.ts) so the boundary the
// window/shell IPC handlers share (show-in-folder, open-image-window, drag-out,
// copy-image) has one owner and unit-tests without spinning up Electron.
//
// Two questions, deliberately kept apart:
//   isLibraryFileName / isViewerImageName — the NAME's shape, for the call sites
//     that hold no save folder (lib-window.ts's navigation guard).
//   libraryFilePath / libraryFilePaths   — the real PATH an export resolves to,
//     stricter than the read rule (see the note on libraryFilePath).

import path from 'node:path';
import { resolveInSaveFolder } from './lib-save-folder-path.ts';

export const isLibraryFileName = (f: unknown): f is string => typeof f === 'string' && !!f && !f.includes('..') && !f.includes('/') && !f.includes('\\');

// Which library files may become a TOP-LEVEL asset:// document (#215). Raster
// formats only: Chromium wraps those in its own passive image document, which
// carries no author script. SVG is the odd one out — it is a full XML document
// with <script> and event handlers, and asset://img/* is one origin, so a
// scripted SVG opened top-level could read every other library file through
// same-origin fetch and post it anywhere. Video/zip are excluded too: this
// window is the still-image viewer, and nothing needs them here.
//
// This is the ENTRY gate. The asset handler's CSP (assetSecurityHeaders) is the
// second layer that holds even when a future caller reaches past this list.
const VIEWER_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.jfif', '.png', '.webp', '.gif', '.avif']);

export const isViewerImageName = (f: unknown): f is string => isLibraryFileName(f) && VIEWER_IMAGE_EXTS.has(path.extname(f).toLowerCase());

// The real path of ONE library file that is about to LEAVE the app — dragged to
// another application, written to the clipboard, revealed in the file manager
// (#132) — or null when the name may not become one.
//
// Containment is not re-derived here: resolveInSaveFolder (lib-save-folder-path.ts)
// owns the single rule for where a library name resolves, and #267 pulled it out
// precisely so the next caller adds to it instead of hand-copying it. What this
// adds on top is the EXPORT rule, narrower than the read rule in two ways:
//
//   - the save folder's own ROOT only. `avatars/<file>`, `emoji/<file>` (#290) and
//     `.trash/<file>` all resolve fine for reading (the cards draw them), and none
//     of the three is a file to hand out — an avatar or emoji image is a shared
//     sidecar rather than the post's own media, and a trashed file is on its way
//     out (see below).
//   - the name AS GIVEN. resolveInSaveFolder deliberately squashes a climbing name
//     onto its basename (`../secret.json` → `<save>/secret.json`) so a stray name
//     still reads something inside the folder. For an export that would silently
//     hand over a different file than the one named, so the mismatch is refused
//     rather than resolved.
//
// Why the trash is on the wrong side of that line: dragging out of a trash means
// "restore it here" everywhere the OS teaches the gesture (in Windows' Recycle Bin
// a drag to a folder IS the restore), while Hologram's drag hands over a path and
// never learns where the drop landed — it cannot mean that. The path it would hand
// over is also one the 30-day sweep deletes. Restore first, then drag; the trash view
// offers that verb and no other edit (#268).
export function libraryFilePath(name: unknown, saveFolder: string): string | null {
  if (typeof name !== 'string' || !name) return null;
  const resolved = resolveInSaveFolder(saveFolder, name);
  if (!resolved) return null;
  return path.dirname(resolved) === path.resolve(saveFolder) && path.basename(resolved) === name ? resolved : null;
}

// Real paths for a batch of names: anything that may not be exported (above), or
// isn't on disk, drops out. Windows aborts the ENTIRE drag when startDrag is handed
// a path that doesn't exist, so a file deleted behind the library's back has to
// drop rather than poison the gesture for its siblings. `exists` is injected so
// this stays pure (callers pass fs.existsSync).
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
