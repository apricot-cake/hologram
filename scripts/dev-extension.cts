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
const { DEV_SERVER_PORT, devServerAlive } = require('./lib-dev-server.cts');

const ROOT = path.join(__dirname, '..');
const output = process.env.HOLOGRAM_EXTENSION_DEV_OUTPUT || path.join(homedir(), '.hologram-dev', 'chrome-mv3-dev');

// Started WITHOUT a terminal — an agent session, a task runner — the server would
// run with its output going nowhere anyone looks: the log lands in a scratch file
// the session picked, and from outside there is no sign the server is even up.
// A server nobody can see is one that gets started twice, or left running for
// days. So open a real console window and hand the server to it. Started FROM a
// terminal (a person typed this) nothing is detached: the server runs in front of
// them, which is what makes Ctrl+C and WXT's key bindings work.
//
// The window IS the status indicator: it is on the taskbar exactly as long as the
// server is up, under Node's icon, so "is the dev server running" is answered by
// looking rather than by hunting for a process. That is why this window belongs to
// node and not to a cmd wrapper, and why it is not kept open after the server ends.
const detach = process.platform === 'win32' && !process.stdout.isTTY && !process.env.CI && !process.env.HOLOGRAM_DEV_EXT_WINDOW;

async function main() {
  // Already up? Then this call is done, whoever made it. One dev server serves
  // every worktree (the output folder and the port are both fixed), so the second
  // start is never what the caller wanted — it either dies on the port or, worse,
  // gets a window that dies while the caller believes it started something.
  //
  // Checking here rather than in a procedure someone has to remember: the taskbar
  // answers "is it running" for a person, but an agent cannot see the taskbar, and
  // a rule written in a checklist only works while it is being read. This is the
  // same shape open-dev-profile.cts uses for the browser window (#857).
  if (await devServerAlive()) {
    console.log(`[hologram] the dev server is already up on localhost:${DEV_SERVER_PORT} — leaving it alone.`);
    console.log('[hologram] one server serves every worktree. To stop it, close its console window.');
    return;
  }

  console.log(`[hologram] development build folder: ${output}`);
  console.log('[hologram] load THAT folder as an unpacked extension in the development Chrome profile (once).');

  if (detach) {
    // `start` is what creates the new console; the quoted argument right after it is
    // the window TITLE (cmd's own quirk — an unquoted first argument would be read as
    // the command). One command STRING through a shell, not an argument array: Node
    // escapes array arguments for the child, and the quotes around the title come out
    // escaped, so the window ends up titled \Hologram dev:ext\ (measured 2026-08-04).
    //
    // `node` directly, NOT `cmd /k npm run dev:ext`, and the difference is what the
    // taskbar shows:
    //   - the window's owner is this script's own node process, so the taskbar button
    //     carries Node's icon instead of cmd's — distinguishable at a glance from the
    //     other console windows on this machine.
    //   - nothing outlives the server. A `cmd /k` wrapper would sit at a prompt after
    //     the server died, leaving a window on the taskbar that says "running" about a
    //     server that is gone. A failure still gets read: the run below pauses on a
    //     non-zero exit before the window closes.
    // (The title, either way, only holds until wxt starts — cmd and npm rewrite the
    // console title to whatever is currently running. Identify the window by npm's
    // `hologram-extension@<version>` header, the .hologram-dev output paths, or the
    // port: docs/build.md.)
    const child = spawn('start "Hologram dev:ext" node scripts/dev-extension.cts', {
      cwd: ROOT,
      shell: true,
      detached: true,
      stdio: 'ignore',
      // Marks the re-entry as "this one owns a status window", which is what turns on
      // the pause below. It also makes a detach loop impossible, though the console it
      // now has would already prevent that.
      env: Object.assign({}, process.env, { HOLOGRAM_DEV_EXT_WINDOW: '1' }),
    });
    child.unref();
    console.log('[hologram] opened a console window — the server runs THERE, under Node on the taskbar.');
    console.log('[hologram] the window is up only while the server is: close it to stop, and it closing means it stopped.');
  } else {
    try {
      // Windows: npm.cmd spawned without a shell is EINVAL (skill windows-scripting).
      execFileSync('npm --prefix extension run dev', {
        cwd: ROOT,
        shell: true,
        stdio: 'inherit',
        env: Object.assign({}, process.env, { HOLOGRAM_EXTENSION_DEV_OUTPUT: output }),
      });
    } catch (error) {
      // In a status window, a non-zero exit would otherwise take the reason with it:
      // the port collision, the build error, the missing install all print and vanish
      // as the window closes. Hold the window until it is read — but ONLY on failure,
      // so a server stopped on purpose still clears itself off the taskbar.
      //
      // Ctrl+C is not a failure: Windows reports it as its own exit status
      // (STATUS_CONTROL_C_EXIT), and stopping the server by hand should close the
      // window the same way closing it does.
      const CONTROL_C_EXIT = 3221225786; // 0xC000013A
      if (process.env.HOLOGRAM_DEV_EXT_WINDOW && error.status !== CONTROL_C_EXIT && error.signal !== 'SIGINT') {
        console.error('\n[hologram] the dev server exited. The window stays open so the reason above can be read.');
        try {
          execFileSync('cmd', ['/c', 'pause'], { stdio: 'inherit' });
        } catch {
          // pause needs a console; without one there is nothing to hold open anyway.
        }
      }
      process.exitCode = typeof error.status === 'number' ? error.status : 1;
    }
  }
}

main();
