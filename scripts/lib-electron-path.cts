'use strict';
// Where the Electron binary actually is, for the harnesses that spawn a real app.
//
// Every caller used to hardcode require(app/node_modules/electron). That is not a
// location the repo controls: app/ is an npm workspace, so npm lifts its
// dependencies to the repo root whenever nothing pins a conflicting version —
// which is what a plain root `npm install` produces. The hardcoded path then
// throws MODULE_NOT_FOUND before the harness runs a single assertion.
//
// Resolve from app/ first (it is app's declared dependency) and fall back to the
// repo root, so either layout works.

const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const appDir = path.join(repoRoot, 'app');

// electron's main export IS the absolute path to the executable (a string).
function electronPath(): string {
  return require(require.resolve('electron', { paths: [appDir, repoRoot] }));
}

module.exports = { electronPath };
