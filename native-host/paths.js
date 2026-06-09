'use strict';

// Resolves the shared config directory used by BOTH the native messaging
// bridge (plain Node, spawned by Chrome) and the Electron desktop app.
//
// The bridge cannot ask Electron where its userData is, so both sides must
// resolve the SAME absolute path independently. The Electron app pins this by
// calling app.setPath('userData', configDir()) at startup.
//
// Windows : %APPDATA%/Corpus
// macOS   : ~/Library/Application Support/Corpus
// Linux   : $XDG_CONFIG_HOME/Corpus (or ~/.config/Corpus)

const path = require('path');
const os = require('os');

const APP_NAME = 'Corpus';

function configDir() {
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(base, APP_NAME);
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', APP_NAME);
  }
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, APP_NAME);
}

// Default library (capture) folder, used by BOTH the bridge and the app when the
// user hasn't picked an explicit save folder. Kept SEPARATE from configDir():
// the library can grow large (screenshots + original media), so it lives under
// the local (non-roaming) app-data area, not in Roaming/config.
//
// Windows : %LOCALAPPDATA%/Corpus/library
// macOS   : ~/Library/Application Support/Corpus/library
// Linux   : $XDG_DATA_HOME/Corpus/library (or ~/.local/share/Corpus/library)
function defaultLibraryDir() {
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(base, APP_NAME, 'library');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', APP_NAME, 'library');
  }
  const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(base, APP_NAME, 'library');
}

module.exports = { configDir, defaultLibraryDir, APP_NAME };
