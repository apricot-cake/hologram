'use strict';

// #1004: whether this process should warn that it was launched without
// --remote-debugging-port. restart-app.ps1 is the sole thing that adds it, and
// anything else that starts electron.exe on this app directory (a Start Menu
// shortcut with stale arguments turned out to be the real culprit, #1004) omits it
// silently: no error, just an instance scripts/cdp-verify.cts cannot attach to.
// Warning here at least gets it into main.log for whoever goes looking next.
//
// Scope shrank on 2026-08-07: the flag used to double as the marker the stop half
// of restart-app.ps1 picked the real instance by, so missing it also meant the app
// could not be stopped. Stopping now goes through the single-instance lock
// (restart-signal.ts) and does not read this flag at all — what is left is CDP.
//
// Pure function (argv/isPackaged passed in, mirroring dev-server-guard.ts's
// resolveDevServerUrl) so the packaged/dev split is regression-tested without
// spawning a real packaged build.
//   argv       — process.argv (unvalidated)
//   isPackaged — app.isPackaged; packaged builds never carry this flag and don't
//                need the warning
function shouldWarnMissingDebugPort(argv: string[], isPackaged: boolean): boolean {
  if (isPackaged) return false;
  return !argv.some((arg) => arg.startsWith('--remote-debugging-port'));
}

export { shouldWarnMissingDebugPort };
