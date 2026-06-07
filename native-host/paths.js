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

module.exports = { configDir, APP_NAME };
