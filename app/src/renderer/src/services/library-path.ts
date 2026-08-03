// Library-path service (#37, extended by #176) — get-library-status /
// pick-repoint-folder / apply-repoint / pick-library-folder / switch-library /
// get-recent-libraries / remove-recent-library, wrapping the flat hologramIpc
// calls. Pure 1:1 forwarding (same shape as backup.ts / posts.ts), imported by
// empty/LibraryMissingState.tsx, the App-level status gate that seeds
// hologramStore's 'libraryMissing' key, and settings/sections/Data.tsx's
// "ライブラリ" card.
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
// (see lib-switch-library.ts's classifyLibraryFolder), which decides whether the
// caller confirms "start as an empty new library?" before calling applyRepoint.
export function pickRepointFolder() {
  return hologramIpc.pickRepointFolder();
}
// Opens `dest` as the current library (#176's switchLibrary) — the escape hatch for
// a save folder that went missing out from under the app (pickSaveFolder/
// moveSaveFolder in services/posts.ts assume the CURRENT folder is there to copy FROM).
export function applyRepoint(dest: string) {
  return hologramIpc.applyRepoint(dest);
}
// #176: Settings' deliberate "switch to a different library" flow — pick-library-folder
// resolves + classifies a destination WITHOUT opening anything (`classification` says
// which confirm, if any, the caller should show before calling switchLibrary).
export function pickLibraryFolder() {
  return hologramIpc.pickLibraryFolder();
}
export function switchLibrary(dest: string) {
  return hologramIpc.switchLibrary(dest);
}
// The "最近使ったライブラリ" list — newest first, with a live exists() check per row.
export function getRecentLibraries() {
  return hologramIpc.getRecentLibraries();
}
export function removeRecentLibrary(folder: string) {
  return hologramIpc.removeRecentLibrary(folder);
}
