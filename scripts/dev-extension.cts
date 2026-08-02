'use strict';

// `npm run dev:ext` — the WXT development server for the DEDICATED Chrome
// profile (#732).
//
// The development build never goes near the daily browser. It is written to one
// fixed folder outside the working tree (~/.hologram-dev/chrome-mv3-dev), so the
// development profile loads it once, by hand, and keeps working no matter which
// worktree the session is in. Nothing about this is resident: the server lives
// for as long as this command runs and not a second longer.
//
// FIRST TIME on a machine, in the development profile only:
//   1. chrome://extensions → Developer mode ON
//   2. "Load unpacked" → the folder printed below
//   3. node scripts/register-dev-native-host.cts   (isolates its saves)
//
// The extension id is the same as the release build's (the signing key is fixed),
// so do not load both into the SAME profile — that is what the separate profile
// is for.

const { execFileSync } = require('node:child_process');
const { homedir } = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const output = process.env.HOLOGRAM_EXTENSION_DEV_OUTPUT || path.join(homedir(), '.hologram-dev', 'chrome-mv3-dev');

console.log(`[hologram] development build folder: ${output}`);
console.log('[hologram] load THAT folder as an unpacked extension in the development Chrome profile (once).');

// Windows: npm.cmd spawned without a shell is EINVAL (skill windows-scripting).
execFileSync('npm --prefix extension run dev', {
  cwd: ROOT,
  shell: true,
  stdio: 'inherit',
  env: Object.assign({}, process.env, { HOLOGRAM_EXTENSION_DEV_OUTPUT: output }),
});
