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
// (the 2026-06 save-folder divergence). A dotfile under the (non-virtualized)
// home dir is the SAME real path for every process. Tests isolate by pointing
// HOLOGRAM_CONFIG_DIR at a sandbox dir.

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

module.exports = { configDir, defaultLibraryDir, APP_NAME };
