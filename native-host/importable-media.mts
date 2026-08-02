'use strict';

// The extensions local intake treats as MEDIA (assetClass:'media', the full
// card/gallery/viewer experience) rather than an arbitrary collected file
// (assetClass:'file', #236 — a generic card, no gallery, "開く" via the OS's
// own default app instead). Split out of app/src/main/lib-local-intake.ts
// (which still re-exports these under their original names, so no caller
// there has to change) so this module — and the "開く" allowlist that also
// needs it (open-allowlist.mts) — stays Electron- and better-sqlite3-free:
// the renderer needs both to label its own UI, the same reason post-key.mts /
// tag-normalize.mts live here rather than under app/src/main.
export const IMPORTABLE_IMG = ['jpg', 'jpeg', 'jfif', 'png', 'webp', 'gif', 'avif', 'bmp', 'tiff', 'svg'];
export const IMPORTABLE_VID = ['mp4', 'webm', 'mov', 'm4v'];
export const IMPORTABLE_MEDIA = IMPORTABLE_IMG.concat(IMPORTABLE_VID);
