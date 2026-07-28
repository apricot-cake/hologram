'use strict';
// Where the Electron binary actually is, for the harnesses that spawn a real app,
// plus the precondition every one of them shares: the app must be built.
//
// Every caller used to hardcode require(app/node_modules/electron). That is not a
// location the repo controls: app/ is an npm workspace, so npm lifts its
// dependencies to the repo root whenever nothing pins a conflicting version —
// which is what a plain root `npm install` produces. The hardcoded path then
// throws MODULE_NOT_FOUND before the harness runs a single assertion.
//
// Resolve from app/ first (it is app's declared dependency) and fall back to the
// repo root, so either layout works.
//
// The build check exists because skipping it costs the USER, not the run: a fresh
// worktree has no app/out (it is a gitignored build product), and `electron .`
// with no main entry makes Electron itself put an OS modal ("Error launching app"
// / "Unable to find Electron app at …") in front of whatever they were doing —
// once per case, so dismissing one just brings the next. HOLOGRAM_SMOKE=1 draws no
// window when the build IS there, so the dialogs only ever come from this failure.
// Refusing to spawn is the whole fix (#460).

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const appDir = path.join(repoRoot, 'app');

// The entry Electron will look for, taken from app/package.json's `main` so this
// follows the app instead of duplicating the path. The fallback is that same
// field's current value, for the case where package.json is itself unreadable.
function appEntryPath(dir: string = appDir): string {
  let main = './out/main/index.js';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    if (typeof pkg.main === 'string' && pkg.main.trim()) main = pkg.main;
  } catch {
    /* unreadable package.json — the conventional location is still the right thing to report */
  }
  return path.resolve(dir, main);
}

// null when the app is built; otherwise the message to print before refusing to
// launch. Pure (no exit, no spawn) so the refusal can be unit-tested.
function buildArtifactError(dir: string = appDir): string | null {
  const entry = appEntryPath(dir);
  if (fs.existsSync(entry)) return null;
  return `Refusing to launch Electron: the app is not built.
  missing: ${entry}
  fix:     npm run build --workspace=app
Launching without it makes Electron show an OS error dialog per case, which takes over the screen.`;
}

// electron's main export IS the absolute path to the executable (a string).
function electronPath(): string {
  const problem = buildArtifactError();
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
  return require(require.resolve('electron', { paths: [appDir, repoRoot] }));
}

module.exports = { electronPath, appEntryPath, buildArtifactError };
