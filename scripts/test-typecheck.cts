'use strict';
// TypeScript contract checks. Six tsc projects (all --noEmit) so type rot
// can't accumulate silently between sessions:
//   1. app/tsconfig.json          — React islands + _shared (.tsx, stage 1)
//   2. app/tsconfig.renderer.json — checkJs over the build-less plain-JS
//      renderer service layer (viewer.js extraction slices + store, stage 2;
//      contracts in app/renderer/types/renderer-globals.d.ts)
//   3. app/tsconfig.main.json     — the Electron main-process ESM layer
//      (main.mts + ipc-*.mts + lib-*.mts + backup-guard.mts + preload.js, stage
//      2/3; Node ESM via .mts, no DOM; runs un-built under Electron 43 (type strip))
//   4. native-host/tsconfig.json  — the native-messaging-host CJS layer
//      (bridge.cts + install.cts + paths.cts + media-download.cts +
//      config-recovery.cts, stage 2/3; a THIRD standalone-Node runtime, .cts,
//      no DOM; runs un-built via the same Node type-stripping)
//   5. extension/tsconfig.json    — the Chrome extension (MV3) browser layer,
//      stage 2/3; a FOURTH runtime (real browser, no type-stripping) — the one
//      layer with a real tsc emit step (extension/build.mjs), so it uses its
//      own local typescript + @types/chrome install (extension/package.json)
//      rather than app/'s.
//   6. scripts/tsconfig.json      — the dev-tooling / test-harness layer (pure
//      units + app-harness Electron smoke + capture/verify CLIs), stage 2/3;
//      a SIXTH standalone-Node runtime, .cts, no build step — the runtime the
//      original TS-scope declaration never named (2026-07-09 audit).

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const appTsc = path.join(appDir, 'node_modules', 'typescript', 'bin', 'tsc');
const extDir = path.join(__dirname, '..', 'extension');
const extTsc = path.join(extDir, 'node_modules', 'typescript', 'bin', 'tsc');

const PROJECTS = [
  { p: appDir, label: 'islands', tsc: appTsc, cwd: appDir },
  { p: path.join(appDir, 'tsconfig.renderer.json'), label: 'renderer services (checkJs)', tsc: appTsc, cwd: appDir },
  { p: path.join(appDir, 'tsconfig.main.json'), label: 'main process (checkJs)', tsc: appTsc, cwd: appDir },
  { p: path.join(__dirname, '..', 'native-host', 'tsconfig.json'), label: 'native-host', tsc: appTsc, cwd: appDir },
  { p: path.join(extDir, 'tsconfig.json'), label: 'extension', tsc: extTsc, cwd: extDir },
  { p: path.join(__dirname, 'tsconfig.json'), label: 'scripts', tsc: appTsc, cwd: appDir },
];

let failed = 0;
for (const { p, label, tsc, cwd } of PROJECTS) {
  const r = spawnSync(process.execPath, [tsc, '--noEmit', '-p', p], { stdio: 'inherit', cwd });
  if (r.status !== 0) {
    console.error(`FAIL test-typecheck: ${label} reported errors`);
    failed++;
  }
}
if (failed) process.exit(1);
console.log('PASS test-typecheck: islands + renderer services + main process + native-host + extension + scripts type-check clean');
