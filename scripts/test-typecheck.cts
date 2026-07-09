'use strict';
// TypeScript contract checks. Five tsc projects (all --noEmit) so type rot
// can't accumulate silently between sessions:
//   1. app/tsconfig.json          — single strict project for React islands
//      (.tsx) + the renderer service layer (app/renderer/**/*.ts). Merged
//      2026-07-09 (formerly two separate configs, islands strict / renderer
//      checkJs+noImplicitAny:false — that split was a staging device for
//      gradual TS adoption, not a real boundary; both are strict now and both
//      fold into the same Vite bundle, islands/app.js).
//   2. app/tsconfig.main.json     — the Electron main-process ESM layer
//      (main.mts + ipc-*.mts + lib-*.mts + backup-guard.mts + preload.js, stage
//      2/3; Node ESM via .mts, no DOM; runs un-built under Electron 43 (type strip))
//   3. native-host/tsconfig.json  — the native-messaging-host CJS layer
//      (bridge.cts + install.cts + paths.cts + media-download.cts +
//      config-recovery.cts, stage 2/3; a THIRD standalone-Node runtime, .cts,
//      no DOM; runs un-built via the same Node type-stripping)
//   4. extension/tsconfig.json    — the Chrome extension (MV3) browser layer,
//      stage 2/3; a FOURTH runtime (real browser, no type-stripping) — the one
//      layer with a real tsc emit step (extension/build.mjs), so it uses its
//      own local typescript + @types/chrome install (extension/package.json)
//      rather than app/'s.
//   5. scripts/tsconfig.json      — the dev-tooling / test-harness layer (pure
//      units + app-harness Electron smoke + capture/verify CLIs), stage 2/3;
//      a FIFTH standalone-Node runtime, .cts, no build step — the runtime the
//      original TS-scope declaration never named (2026-07-09 audit).

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const appTsc = path.join(appDir, 'node_modules', 'typescript', 'bin', 'tsc');
const extDir = path.join(__dirname, '..', 'extension');
const extTsc = path.join(extDir, 'node_modules', 'typescript', 'bin', 'tsc');

const PROJECTS = [
  { p: appDir, label: 'islands + renderer services', tsc: appTsc, cwd: appDir },
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
console.log('PASS test-typecheck: islands+renderer + main process + native-host + extension + scripts type-check clean');
