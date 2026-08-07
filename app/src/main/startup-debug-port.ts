'use strict';

// #1004: whether this process should warn that it was launched without
// --remote-debugging-port. That flag is the ONLY marker scripts/cdp-verify.cts and
// the marker-based stop command in docs/build.md use to pick this app's real
// instance out of every electron.exe running on the machine — restart-app.ps1 is
// the sole thing that adds it. Anything else that starts electron.exe on this app
// directory (a Start Menu shortcut with stale arguments turned out to be the real
// culprit, #1004) omits it silently: no error, just an instance CDP can't attach
// to and the stop command can't find. Warning here at least gets it into main.log
// for whoever goes looking next.
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
