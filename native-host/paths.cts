'use strict';

// Resolves the shared config directory used by BOTH the native messaging
// bridge (plain Node, spawned by Chrome) and the Electron desktop app.
//
// The bridge cannot ask Electron where its userData is, so both sides must
// resolve the SAME absolute path independently. The Electron app pins this by
// calling app.setPath('userData', configDir()) at startup.
//
// Override order: HOLOGRAM_CONFIG_DIR (explicit) wins, else a per-OS default:
//   Windows : ~/.hologram      (NOT %APPDATA% — see below)
//   macOS   : ~/Library/Application Support/Hologram
//   Linux   : $XDG_CONFIG_HOME/Hologram (or ~/.config/Hologram)
//
// Why Windows avoids %APPDATA%: when the app (or our tooling) is driven from
// inside an MSIX-packaged host — e.g. the Claude desktop app — child processes
// get %APPDATA%/HKCU storage virtualization: writes silently divert to a private
// per-package LocalCache and diverge from what the user's real app/Chrome see
// (the 2026-06 save-folder divergence, ~9082 items). A dotfile under the
// (non-virtualized) home dir is the SAME real path for every process. Tests
// isolate by pointing HOLOGRAM_CONFIG_DIR at a sandbox dir.
//
// NOTE (2026-08-06, #1003): that virtualization is not happening any more —
// Claude Code moved outside the package, and FS/HKCU reads and writes were all
// measured as real. So this is no longer a hard requirement, and #232 plans to
// move the config default back to %APPDATA%\Hologram. It has not been moved yet
// on purpose: the very fact that the host's layout changed once means it can
// change back, and the failure mode is silent (the 2026-06 incident only
// surfaced as "I saved it but the library does not show it"). #232 pairs the
// move with a check that detects a LocalCache-redirected path at startup.
// The LIBRARY default is a separate question and does not move — see #232, where
// its rationale is already a product decision rather than this one.

const path = require('node:path');
const os = require('node:os');

const APP_NAME = 'Hologram';

function configDir(): string {
  if (process.env.HOLOGRAM_CONFIG_DIR) return process.env.HOLOGRAM_CONFIG_DIR;
  if (process.platform === 'win32') {
    return path.join(os.homedir(), '.hologram');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', APP_NAME);
  }
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, APP_NAME);
}

// Default library (capture) folder, used by BOTH the bridge and the app when the
// user hasn't picked an explicit save folder. Kept SEPARATE from configDir(): the
// library can grow large (screenshots + original media), so it lives in its own
// top-level folder, not mixed into the (small) config dir.
//
// Like configDir(), the Windows default is kept OUT of %LOCALAPPDATA% so it isn't
// subject to MSIX storage virtualization (see above).
//   Windows : ~/Hologram/library
//   macOS   : ~/Library/Application Support/Hologram/library
//   Linux   : $XDG_DATA_HOME/Hologram/library (or ~/.local/share/Hologram/library)
function defaultLibraryDir(): string {
  if (process.platform === 'win32') {
    return path.join(os.homedir(), APP_NAME, 'library');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', APP_NAME, 'library');
  }
  const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(base, APP_NAME, 'library');
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
