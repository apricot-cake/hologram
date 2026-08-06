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
// Two things happen before anything opens (#857):
//
//   1. If the profile is already up, this stops and says so. The window is
//      long-lived — the sign-ins, the loaded unpacked extension and whatever
//      timelines are open all live in it — so "already running" is the common
//      case, not the exception. Opening a browser takes the screen and the
//      keyboard away from whoever is using the machine, and paying that to
//      reach a window that is already there is pure cost.
//   2. Otherwise it launches through a one-shot scheduled task instead of
//      spawning chrome.exe as a child, for the reason HologramLaunch exists:
//      a process started from inside the MSIX-packaged desktop app runs in the
//      container, where registry and filesystem writes go to a per-package
//      copy. A Chrome started there could fork the profile it is supposed to
//      reuse. The task scheduler starts the action from the service, i.e. as
//      if a person had double-clicked it.
//
//      EXPIRED 2026-08-06 (#1003): Claude Code runs outside the package now and
//      the filesystem is real, and PROFILE below is under the home dir anyway,
//      so there is nothing left to fork. The task detour can go — kept until
//      someone actually opens the profile without it and confirms. Tracked
//      separately; do not remove it as a drive-by.
//
//   node scripts/open-dev-profile.cts

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const { homedir } = require('node:os');
const path = require('node:path');
const { DEV_SERVER_PORT, devServerAlive } = require('./lib-dev-server.cts');

const PROFILE = process.env.HOLOGRAM_EXTENSION_DEV_PROFILE || path.join(homedir(), '.hologram-ext-profile');
const OUTPUT = process.env.HOLOGRAM_EXTENSION_DEV_OUTPUT || path.join(homedir(), '.hologram-dev', 'chrome-mv3-dev');

// ポートと生死判定は scripts/lib-dev-server.cts が持つ（dev-extension.cts と共有）。
// dev ビルドは自己完結していない（#861）＝popup.html 等はスクリプトと CSS を
// http://localhost:51731 から直接読む。サーバーが落ちていても拡張は壊れた顔を
// しない＝ポップアップは開くが、素の HTML が縦一列に潰れて出る（CSS/レイアウトの
// バグに見えるが原因はサーバー未起動）。窓を開く前にここを確かめておく。

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

// The process that owns the window for a given --user-data-dir, if there is
// one. Chrome's helper processes (--type=renderer and friends) repeat the same
// --user-data-dir, so they are filtered out — otherwise a profile whose window
// was closed but whose crashpad handler lingers would read as running.
function runningPid(profile: string): number | null {
  let processes: { ProcessId: number; CommandLine: string | null }[];
  try {
    const json = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process -Filter "Name=\'chrome.exe\'" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress'], { encoding: 'utf8' }).trim();
    if (!json) return null;
    const parsed = JSON.parse(json);
    processes = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // No process list means no answer, not "nothing is running" — say so by
    // returning null and let the caller open a window it may not have needed,
    // rather than silently skipping a launch that was actually required.
    return null;
  }
  const want = path.resolve(profile).toLowerCase();
  for (const proc of processes) {
    const cmd = proc.CommandLine || '';
    if (cmd.includes('--type=')) continue;
    const match = /--user-data-dir=(?:"([^"]*)"|(\S+))/.exec(cmd);
    const dir = match?.[1] ?? match?.[2];
    if (dir && path.resolve(dir).toLowerCase() === want) return proc.ProcessId;
  }
  return null;
}

async function main() {
  const devServerUp = await devServerAlive();

  // `--print` resolves everything and opens nothing. Opening a browser window
  // takes the screen and the keyboard away from whoever is using the machine, so
  // checking that the paths are right must not require paying that — including
  // when the checker is an agent (which is how this flag came to exist: the first
  // run of this script stole focus for a check that needed no window at all).
  if (process.argv.includes('--print')) {
    const pid = runningPid(PROFILE);
    console.log(`chrome:  ${chrome}`);
    console.log(`profile: ${PROFILE}`);
    console.log(`running: ${pid === null ? 'no' : `yes (pid ${pid})`}`);
    console.log(`dev server (localhost:${DEV_SERVER_PORT}): ${devServerUp ? 'up' : 'down — popup/options/diag will render as bare unstyled HTML until "npm run dev:ext" is running'}`);
    console.log(`build:   ${OUTPUT}${fs.existsSync(path.join(OUTPUT, 'manifest.json')) ? '' : '  (not built yet)'}`);
    process.exit(0);
  }

  if (!devServerUp) {
    console.log(`[hologram] warning: the dev server (localhost:${DEV_SERVER_PORT}) is not responding.`);
    console.log('[hologram] the dev build is not self-contained — popup.html etc. pull their script and CSS straight from it.');
    console.log('[hologram] without it the popup still opens, but as bare unstyled HTML crushed into one column (looks like a layout bug — it is not).');
    console.log('[hologram] run "npm run dev:ext" and leave it running while you verify.');
  }

  const alreadyOpen = runningPid(PROFILE);
  if (alreadyOpen !== null) {
    console.log(`[hologram] the development Chrome profile is already open (pid ${alreadyOpen}): ${PROFILE}`);
    console.log('[hologram] nothing to do — switch to that window. Pass --print to see the paths.');
    process.exit(0);
  }

  fs.mkdirSync(PROFILE, { recursive: true });

  // Through the scheduled task (its original MSIX reason expired — see the
  // header). The task is one-shot and its action is `cmd /c start`, so
  // it completes immediately and the browser it opened outlives it — verified
  // 2026-08-03: the task returns to Ready with exit 0 while Chrome keeps running,
  // and unregistering it does not take the browser down.
  const launched = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'open-dev-profile.ps1'), chrome, PROFILE], { stdio: 'inherit' });
  if (launched.status !== 0) {
    throw new Error(`open-dev-profile.ps1 exited with ${launched.status}. The browser was not opened.`);
  }

  console.log(`[hologram] opened the development Chrome profile: ${PROFILE}`);
  if (fs.existsSync(path.join(OUTPUT, 'manifest.json'))) {
    console.log(`[hologram] development build to load: ${OUTPUT}`);
  } else {
    console.log(`[hologram] no development build yet — run "npm run dev:ext" first (it writes ${OUTPUT})`);
  }
  console.log('[hologram] first time only: chrome://extensions → Developer mode → Load unpacked → the folder above.');
  console.log('[hologram] do NOT load it into the daily profile: both builds carry the same extension id.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
