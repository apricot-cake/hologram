// Library-path service (#37) — get-library-status / pick-repoint-folder / apply-repoint,
// wrapping the flat hologramIpc calls. Pure 1:1 forwarding (same shape as backup.ts /
// posts.ts), imported by empty/LibraryMissingState.tsx and the App-level status gate
// that seeds hologramStore's 'libraryMissing' key.
import { hologramIpc } from './ipc.ts';

// Always a fresh check (main does a statSync, never a cached flag) — call this again
// after a retry or a repoint rather than expecting a push.
export function getLibraryStatus() {
  return hologramIpc.getLibraryStatus();
}
// #71: whether the extension has EVER made contact (installed + processed a
// check/save at least once) — App.tsx's boot-time gate seeds hologramStore's
// 'extensionContacted' from this, which empty/EmptyState.tsx reads to decide
// between the install-guide and the ordinary firstRun variant.
export function getExtensionContact() {
  return hologramIpc.getExtensionContact();
}
// Opens a directory picker and validates it as a repoint destination WITHOUT writing
// anything — `hasEvidence` says whether it looks like an existing Hologram library
// (see ipc-transfer.ts's looksLikeLibrary), which decides whether the caller confirms
// "start as an empty new library?" before calling applyRepoint.
export function pickRepointFolder() {
  return hologramIpc.pickRepointFolder();
}
// Rewrites config.saveFolder to `dest` with NO copy — the escape hatch for a save
// folder that went missing out from under the app (pickSaveFolder/moveSaveFolder in
// services/posts.ts assume the CURRENT folder is there to copy FROM).
export function applyRepoint(dest: string) {
  return hologramIpc.applyRepoint(dest);
}
