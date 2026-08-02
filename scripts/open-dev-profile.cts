'use strict';

// `npm run ext:dev:browser` — open the DEVELOPMENT Chrome profile (#732).
//
// A separate profile is the whole point: the daily browser carries verified
// release builds and nothing else, so everything about developing the extension
// — the dev server's bundle, tab reloads on every save, captures that must not
// reach the real library — happens over here instead.
//
// It is its own `--user-data-dir`, so it runs alongside the daily Chrome as a
// second process with its own sessions. Signing in to the five sites is a
// one-time human step, and the profile keeps those logins.
//
// NO --load-extension. Chrome 137+ ignores it (#657, measured on Chrome 151),
// and it is not needed: an unpacked extension loaded once through
// chrome://extensions is remembered by the profile. That first load is the only
// part of this that a person has to do.
//
//   node scripts/open-dev-profile.cts

const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const { homedir } = require('node:os');
const path = require('node:path');

const PROFILE = process.env.HOLOGRAM_EXTENSION_DEV_PROFILE || path.join(homedir(), '.hologram-ext-profile');
const OUTPUT = process.env.HOLOGRAM_EXTENSION_DEV_OUTPUT || path.join(homedir(), '.hologram-dev', 'chrome-mv3-dev');

// Where Chrome actually is, asked of Windows rather than guessed: the 32-bit
// install path exists on plenty of machines and a hardcoded 64-bit path would
// fail there with a message about the wrong thing.
function chromePath(): string {
  const candidates = [
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  try {
    // Last resort: the shell's own association for http.
    const found = execFileSync('where.exe', ['chrome'], { encoding: 'utf8' }).split(/\r?\n/).find(Boolean);
    if (found && fs.existsSync(found)) return found;
  } catch {
    /* not on PATH either */
  }
  throw new Error('Chrome was not found. Set HOLOGRAM_CHROME to its full path.');
}

const chrome = process.env.HOLOGRAM_CHROME || chromePath();

// `--print` resolves everything and opens nothing. Opening a browser window
// takes the screen and the keyboard away from whoever is using the machine, so
// checking that the paths are right must not require paying that — including
// when the checker is an agent (which is how this flag came to exist: the first
// run of this script stole focus for a check that needed no window at all).
if (process.argv.includes('--print')) {
  console.log(`chrome:  ${chrome}`);
  console.log(`profile: ${PROFILE}`);
  console.log(`build:   ${OUTPUT}${fs.existsSync(path.join(OUTPUT, 'manifest.json')) ? '' : '  (not built yet)'}`);
  process.exit(0);
}

fs.mkdirSync(PROFILE, { recursive: true });

// Detached: this command opens a browser and returns, rather than owning it for
// as long as it is up. Closing the terminal must not close the browser.
const child = spawn(chrome, [`--user-data-dir=${PROFILE}`], { detached: true, stdio: 'ignore' });
child.unref();

console.log(`[hologram] opened the development Chrome profile: ${PROFILE}`);
if (fs.existsSync(path.join(OUTPUT, 'manifest.json'))) {
  console.log(`[hologram] development build to load: ${OUTPUT}`);
} else {
  console.log(`[hologram] no development build yet — run "npm run dev:ext" first (it writes ${OUTPUT})`);
}
console.log('[hologram] first time only: chrome://extensions → Developer mode → Load unpacked → the folder above.');
console.log('[hologram] do NOT load it into the daily profile: both builds carry the same extension id.');
