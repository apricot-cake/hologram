'use strict';

// Pin (floating mini-viewer) window IPC handlers (#79). Window creation and the
// active-window registry live in lib-pin-window.ts (reached here through ctx,
// same indirection ipc-window.ts's openNewWindow uses for lib-window.ts) — this
// module is only the three channels that actually cross the renderer boundary,
// plus "save this set as a folder".
import { ipcMain } from 'electron';
import type { IpcContext } from './ipc-context.ts';
import type { FoldersState, OkResult, PinItem } from './ipc-payloads.ts';

// Same id shape services/folders.ts's genId produces for a library folder
// (idPrefix 'f') — matched here rather than reused because that generator is a
// renderer-only module closure; a pin window never loads it (see the module
// comment below).
function makeFolderId(): string {
  return 'f-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

function register(ctx: IpcContext) {
  const { getSaveFolder, getDbWriter, sendExcept, pinSend, pinGetInitial, pinToggleAlwaysOnTop } = ctx;

  // `on`, not `handle`: fire-and-forget, the same shape open-new-window and
  // drag-out already use — nothing the caller needs to await, and
  // opts.newWindow (the folder "ピンで開く" entry point) should feel instant.
  ipcMain.on('pin-send', (_e, items: unknown, opts: unknown) => {
    if (!Array.isArray(items) || !items.length) return;
    const clean = items.filter((it): it is PinItem => !!it && typeof it.file === 'string' && it.file && typeof it.captureId === 'string' && typeof it.video === 'boolean');
    if (!clean.length) return;
    pinSend(clean, !!(opts && typeof opts === 'object' && (opts as { newWindow?: unknown }).newWindow));
  });

  // The pin window's own first read of what it was opened with — see
  // lib-pin-window.ts's takeInitial for why this is pulled rather than pushed.
  ipcMain.handle('pin-get-initial', (_e): PinItem[] => pinGetInitial(_e.sender.id));

  ipcMain.handle('pin-toggle-always-on-top', (_e): boolean => pinToggleAlwaysOnTop(_e.sender.id));

  // "セットをフォルダとして保存" (#79): a plain static folder, the same shape
  // services/folders.ts's createFolder + applyFolderItems produce from the main
  // renderer — written directly here instead because a pin window never loads
  // that module (it is the renderer-side folders STORE, not just the IPC pair,
  // and pulling in the rest of its state just to write one new entry would be
  // pure weight for a window that never reads folders back). `activeId` is
  // carried through unchanged — it is legacy and no writer sets it any more
  // (ipc-organize.ts's own get/set-folders comment).
  ipcMain.handle('pin-save-as-folder', (_e, name: unknown, captureIds: unknown): OkResult => {
    if (!getSaveFolder() || typeof name !== 'string' || !name.trim() || !Array.isArray(captureIds)) return { ok: false };
    const ids = [...new Set(captureIds.filter((c): c is string => typeof c === 'string' && !!c))];
    if (!ids.length) return { ok: false };
    try {
      const state: FoldersState = getDbWriter().getFolders();
      const folder = { id: makeFolderId(), name: name.trim(), kind: 'static', created: Date.now(), parentId: null, items: ids };
      getDbWriter().setFolders({ folders: [...state.folders, folder], activeId: state.activeId });
      sendExcept(_e.sender.id, 'org-changed', 'folders');
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });
}

export { register };
