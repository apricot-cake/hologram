'use strict';

// Resolves the shared config directory used by BOTH the native messaging
// bridge (plain Node, spawned by Chrome) and the Electron desktop app.
//
// The bridge cannot ask Electron where its userData is, so both sides must
// resolve the SAME absolute path independently. The Electron app pins this by
// calling app.setPath('userData', configDir()) at startup — so this directory
// also holds whatever Chromium itself keeps in userData (Cache, Local Storage,
// Preferences, ...), not just our own files.
//
// Override order: HOLOGRAM_CONFIG_DIR (explicit) wins, else a per-OS default:
//   Windows : %APPDATA%\Hologram        (Roaming AppData — Electron's own default)
//   macOS   : ~/Library/Application Support/Hologram
//   Linux   : $XDG_CONFIG_HOME/Hologram (or ~/.config/Hologram)
//
// Windows used to default to ~/.hologram (a dotfile under the home dir) to dodge
// MSIX storage virtualization: when driven from inside an MSIX-packaged host,
// child processes got %APPDATA%/HKCU writes silently diverted to a private
// per-package LocalCache, diverging from what the user's real app/Chrome saw
// (the 2026-06 save-folder divergence, ~9082 items). That virtualization is not
// happening in this environment any more (2026-08-06, #1003) — the packaged host
// moved outside the package, and FS/HKCU reads and writes were measured as real —
// so the workaround was retired in #232 and Windows now uses the OS-standard
// location like the other two platforms. If the host's layout ever changes back,
// #1009's startup guard (app/src/main/lib-storage-redirect-guard.ts) detects a
// LocalCache-redirected configDir()/save folder and refuses to start rather than
// silently diverging again.
//
// #232 intentionally shipped WITHOUT migration code: pre-release, the only
// existing config directory is the author's own machine, moved by hand once as
// a one-off operational step (not a design the app carries forward). Do not add
// a fallback that reads the old ~/.hologram if the new location is empty — the
// prior attempt at that shape (migrateConfigDirFromAppData, removed 891a6ba) sat
// around as a permanent no-op with a real hazard: an unconfigured launch could
// pick up a stale left-behind config.
//
// HOLOGRAM_CONFIG_DIR itself stays for a different reason now: test isolation
// (each test/sandbox run points it at its own mkdtemp dir), not dodging
// virtualization.
//
// The LIBRARY default is a separate question and does not move — see #232, where
// its rationale is already a product decision rather than this one.

const path = require('node:path');
const os = require('node:os');

const APP_NAME = 'Hologram';

function configDir(): string {
  if (process.env.HOLOGRAM_CONFIG_DIR) return process.env.HOLOGRAM_CONFIG_DIR;
  if (process.platform === 'win32') {
    // Read from the environment rather than joining homedir() + 'AppData/Roaming':
    // folder redirection and roaming profiles move %APPDATA% off that default
    // relative path, and the join would silently miss it.
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), APP_NAME);
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', APP_NAME);
  }
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, APP_NAME);
}

// Default library (capture) folder — ~/Hologram/library on EVERY OS, used by both the
// bridge and the app until the user picks an explicit save folder. Kept SEPARATE from
// configDir(): the library can grow large (screenshots + original media), so it lives in
// its own top-level folder, not mixed into the (small) config dir.
//
// Home dir rather than the per-OS app-data area is a PRODUCT decision, not a workaround
// (#232). The saved files are the user's own content, so they belong somewhere the user
// opens, moves and backs up — app-data is hidden by default, which says the opposite. The
// established prior art in collection apps agrees (Zotero uses ~/Zotero on every OS).
// Documents/Pictures are avoided on purpose: they are what OneDrive-style folder backup
// targets, and live-writing a library into a syncing folder corrupts it (#95 warns about
// this when the user picks such a folder).
//
// This used to differ per OS — Windows in the home dir, macOS/Linux under app-data — and
// the Windows case was justified by MSIX storage virtualization (avoid %LOCALAPPDATA%).
// That reason expired on 2026-08-06 (#1003); the placement stayed and the other two
// platforms were brought in line with it, on the rationale above.
function defaultLibraryDir(): string {
  return path.join(os.homedir(), APP_NAME, 'library');
}

// Where a LOCAL extension build announces itself (#650). Written by
// `npm run build:ext` once the output folder is complete, read by the bridge so
// every reply can carry the token — which is how an unpacked extension learns
// that its own bundle on disk has been replaced and reloads itself.
//
// In configDir() rather than next to the build output because that is the one
// absolute path the two processes already agree on without being told: the
// bridge is spawned by Chrome from a registry entry and has no idea where the
// repository is. Absent on every machine that has not built the extension, which
// is what makes the whole path inert for released installs.
function extensionBuildStampPath(): string {
  return path.join(configDir(), 'extension-build.json');
}

// #71: the ONE signal the app has that the extension is installed and has ever
// talked to it. A native-messaging host is a one-shot process Chrome spawns per
// connection (see bridge.cts's header) — there is no live heartbeat to ask "is
// it connected right now", so the bridge instead touches this marker whenever it
// processes a check ({type:'query'}) or a save, and the app treats the file's
// mere PRESENCE as "has ever made contact" (empty/EmptyState.tsx's firstRun vs.
// the install-guide variant, #71). The content is a bare ISO timestamp and nothing
// else is ever written into it — no extension id, browser name, or URL — because
// the app never reads the content, only checks existence.
function extensionContactPath(): string {
  return path.join(configDir(), 'extension-contact.json');
}

module.exports = { configDir, defaultLibraryDir, extensionBuildStampPath, extensionContactPath, APP_NAME };
