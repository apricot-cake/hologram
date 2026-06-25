'use strict';

// Resolves the shared config directory used by BOTH the native messaging
// bridge (plain Node, spawned by Chrome) and the Electron desktop app.
//
// The bridge cannot ask Electron where its userData is, so both sides must
// resolve the SAME absolute path independently. The Electron app pins this by
// calling app.setPath('userData', configDir()) at startup.
//
// Override order: CORPUS_CONFIG_DIR (explicit) wins, else a per-OS default:
//   Windows : ~/.corpus      (NOT %APPDATA% — see below)
//   macOS   : ~/Library/Application Support/Corpus
//   Linux   : $XDG_CONFIG_HOME/Corpus (or ~/.config/Corpus)
//
// Why Windows avoids %APPDATA%: when the app (or our tooling) is driven from
// inside an MSIX-packaged host — e.g. the Claude desktop app — child processes
// get %APPDATA%/HKCU storage virtualization: writes silently divert to a private
// per-package LocalCache and diverge from what the user's real app/Chrome see
// (the 2026-06 save-folder divergence). A dotfile under the (non-virtualized)
// home dir is the SAME real path for every process. Tests isolate by pointing
// CORPUS_CONFIG_DIR at a sandbox dir.

const path = require('path');
const os = require('os');

const APP_NAME = 'Corpus';

function configDir() {
  if (process.env.CORPUS_CONFIG_DIR) return process.env.CORPUS_CONFIG_DIR;
  if (process.platform === 'win32') {
    return path.join(os.homedir(), '.corpus');
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
//   Windows : ~/Corpus/library
//   macOS   : ~/Library/Application Support/Corpus/library
//   Linux   : $XDG_DATA_HOME/Corpus/library (or ~/.local/share/Corpus/library)
function defaultLibraryDir() {
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
