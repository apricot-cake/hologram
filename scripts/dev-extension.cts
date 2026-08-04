'use strict';

// `npm run dev:ext` — the WXT development server for the DEDICATED Chrome
// profile (#732).
//
// The development build never goes near the daily browser. It is written to one
// fixed folder outside the working tree (~/.hologram-dev/chrome-mv3-dev), so the
// development profile loads it once, by hand, and keeps working no matter which
// worktree the session is in. Nothing about this is resident: no logon task, no
// service — the server lives as long as the console it runs in, and not a second
// longer.
//
// FIRST TIME on a machine, in the development profile only:
//   1. chrome://extensions → Developer mode ON
//   2. "Load unpacked" → the folder printed below
//   3. node scripts/register-dev-native-host.cts   (isolates its saves)
//
// The extension id is the same as the release build's (the signing key is fixed),
// so do not load both into the SAME profile — that is what the separate profile
// is for.

const { execFileSync, spawn } = require('node:child_process');
const { homedir } = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const output = process.env.HOLOGRAM_EXTENSION_DEV_OUTPUT || path.join(homedir(), '.hologram-dev', 'chrome-mv3-dev');

console.log(`[hologram] development build folder: ${output}`);
console.log('[hologram] load THAT folder as an unpacked extension in the development Chrome profile (once).');

// Started WITHOUT a terminal — an agent session, a task runner — the server would
// run with its output going nowhere anyone looks: the log lands in a scratch file
// the session picked, and from outside there is no sign the server is even up.
// A server nobody can see is one that gets started twice, or left running for
// days. So open a real console window and hand the server to it. Started FROM a
// terminal (a person typed this) nothing is detached: the server runs in front of
// them, which is what makes Ctrl+C and WXT's key bindings work.
//
// The window is where the server's whole life is visible — the rebuild lines, the
// reload lines, the port collision if a second one starts. Close it to stop the
// server.
const detach = process.platform === 'win32' && !process.stdout.isTTY && !process.env.CI && !process.env.HOLOGRAM_DEV_EXT_WINDOW;

if (detach) {
  // `start` is what creates the new console; the quoted argument right after it is
  // the window TITLE (cmd's own quirk — an unquoted first argument would be read as
  // the command). `/k` keeps the window up after the server exits, so a crash or a
  // port collision is still readable afterwards rather than a window that blinks
  // and is gone.
  //
  // One command STRING through a shell, not an argument array: Node escapes array
  // arguments for the child, and the quotes around the title come out escaped, so
  // the window is titled \Hologram dev:ext\ (measured 2026-08-04).
  //
  // The title only holds until the server starts: cmd rewrites its console title to
  // whatever it is currently running, and npm reaches wxt through more cmd layers,
  // so a RUNNING server sits in a window titled C:\WINDOWS\system32\cmd.exe (also
  // measured). The lines printed above do not identify the window either — WXT's
  // first build lists every output file and scrolls them away. What stays on
  // screen is npm's own `hologram-extension@<version>` header, the .hologram-dev
  // path repeated down the file list, and the port. That is what tells two
  // dev-server windows apart (docs/build.md).
  const child = spawn('start "Hologram dev:ext" cmd /k npm run dev:ext', {
    cwd: ROOT,
    shell: true,
    detached: true,
    stdio: 'ignore',
    // The re-entry runs with a console, so isTTY is true there anyway. The flag is
    // belt and braces: it makes a loop impossible even if that ever changes.
    env: Object.assign({}, process.env, { HOLOGRAM_DEV_EXT_WINDOW: '1' }),
  });
  child.unref();
  console.log('[hologram] opened a console window — the server runs THERE (the one showing hologram-extension@… on port 51731).');
  console.log('[hologram] close that window to stop it.');
} else {
  // Windows: npm.cmd spawned without a shell is EINVAL (skill windows-scripting).
  execFileSync('npm --prefix extension run dev', {
    cwd: ROOT,
    shell: true,
    stdio: 'inherit',
    env: Object.assign({}, process.env, { HOLOGRAM_EXTENSION_DEV_OUTPUT: output }),
  });
}
