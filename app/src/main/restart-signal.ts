'use strict';

// The handshake restart-app.ps1 uses to stop the running app, replacing "find the
// right electron.exe from outside and kill it".
//
// Why the old way could not be made correct: what makes an instance THE REAL APP
// is the config dir (userData) it opened — the real one owns %APPDATA%\Hologram,
// every sandbox/test instance is pinned elsewhere via HOLOGRAM_CONFIG_DIR. That
// attribute lives inside the process and nothing outside can read it, so every
// filter the script ever used was a proxy for it, and each proxy failed on one
// side: a '*hologram*' path substring swept up worktree test instances
// (2026-08-05), the --remote-debugging-port marker missed instances started
// without it (#1004), and even the exact exe path cannot separate the real app
// from a sandbox started out of the SAME tree — those run the identical binary
// and differ only by env (scripts/sandbox-app.cts resolves electron through the
// same lib-electron-path.cts).
//
// Electron's single-instance lock is keyed on exactly the attribute we want (app
// name + userData), and a launch that loses the lock hands its argv to the holder
// before exiting. So a throwaway launch carrying QUIT_FLAG reaches the real
// instance and nothing else: the OS does the identification, on the right key,
// with no proxy. A sandbox holds a different lock and never hears it.
//
// The exit codes turn that same throwaway launch into a probe the script can
// poll. It has to know the old instance is really gone before starting the new
// one (start too early and the new launch loses the lock and dies), and asking
// Windows for a process list to find that out would put the guessing straight
// back in.

const QUIT_FLAG = '--hologram-quit';

// Exit codes of a launch carrying QUIT_FLAG. They live next to the flag even
// though only restart-app.ps1 reads them: it is on the other side of a process
// boundary and hard-codes the numbers, so there is no import keeping the two in
// step — only this comment and the test.
const EXIT_NO_INSTANCE = 0; // nobody held the lock — nothing was running
const EXIT_SIGNALLED = 3; // an instance held the lock and has been told to quit

function hasQuitSignal(argv: string[]): boolean {
  return argv.includes(QUIT_FLAG);
}

export { EXIT_NO_INSTANCE, EXIT_SIGNALLED, QUIT_FLAG, hasQuitSignal };
