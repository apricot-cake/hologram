'use strict';

// Window drop-to-import (#234) — dragging local files/folders from the OS onto
// the app window. The two other local-file doors already live in Data.tsx (the
// file-picker dialog) and clipboard-intake.ts (Ctrl+V); this is the third, and
// the odd one out because a folder drop can pull in far more than the user
// bargained for. Unlike the dialog (an explicit, bounded pick) this door always
// confirms a COUNT first, and the recursive walk that count is based on runs to
// completion before the question is asked — never while still walking, so a
// "いいえ" answer leaves the library untouched (#234's design comment).
//
// Registration (the window-wide overlay + the native drag/drop listeners) lives
// in the DropOverlay component (app/App.tsx); this module holds the two-IPC-
// round-trip logic + the confirm/report wiring, the same split GlobalShortcuts/
// clipboard-intake.ts use for their own features.
import { collectDroppedPaths, getPathForFile, importDroppedPaths } from './posts.ts';
import { open as confirmOpen } from './confirm.ts';
import { loadPosts } from './post-grid-builder.ts';
import { notify } from './ui.ts';
import { t } from '../_shared/i18n.ts';
import type { DropCollectResult, DroppedFile } from '../../../main/ipc-payloads.ts';

/** webUtils.getPathForFile per dropped item — the OS path a File carries once
 * dropped (File.path was removed in Electron 32; this is preload's replacement). */
export function pathsFromFileList(list: FileList): string[] {
  const out: string[] = [];
  for (let i = 0; i < list.length; i++) {
    try {
      const p = getPathForFile(list[i]);
      if (p) out.push(p);
    } catch {
      /* a File with no resolvable OS path (rare) — skip it */
    }
  }
  return out;
}

const reload = () => {
  if (loadPosts) loadPosts();
};

function reportImportError(error: string | undefined): void {
  notify(error === 'library-missing' ? t('saveFolderErrLibraryMissing') : t('importFailed'));
}

async function runImport(files: DroppedFile[]): Promise<void> {
  try {
    const out = await importDroppedPaths(files);
    if (out.error) {
      reportImportError(out.error);
      return;
    }
    reload();
    if (out.skipped > 0) notify(t('importSkipped', [out.imported, out.skipped]));
    else notify(t('imported', [out.imported]));
  } catch {
    notify(t('importFailed'));
  }
}

/**
 * The drop's whole flow: collect → confirm(count) → import → report. Never
 * writes anything before the user accepts the count.
 */
export async function handleDroppedPaths(paths: string[]): Promise<void> {
  if (!paths.length) return;
  let res: DropCollectResult;
  try {
    res = await collectDroppedPaths(paths);
  } catch {
    notify(t('importFailed'));
    return;
  }
  if (res.error) {
    reportImportError(res.error);
    return;
  }
  if (!res.files.length) {
    notify(t('dropNothingToImport'));
    return;
  }
  // #233: once cloud-direct backup lands (the OAuth destination — PR 823 only
  // landed the local generation-restore UI, items 1/4 of #233 are still ahead),
  // an interactive drop should warn "this will also upload to <provider>" here,
  // before the count confirm below, with an exclude-from-upload option. No
  // cloud-enabled flag exists to gate that on yet, so this step is skipped
  // entirely for now — the drop always falls through to the plain count confirm.
  confirmOpen({
    message: t('dropImportConfirm', [res.files.length, res.mediaCount, res.otherCount]),
    okLabel: t('dropImportOk'),
    cancelLabel: t('confirmCancel'),
    okDestructive: false,
    onOk: () => void runImport(res.files),
  });
}
