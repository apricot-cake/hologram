'use strict';
// TypeScript contract checks. Five projects (all no-emit) so type rot
// can't accumulate silently between sessions:
//   1. app/tsconfig.web.json      — single strict project for the renderer
//      (React components under src/renderer/src/* + the service layer under
//      src/renderer/src/services/*), bundled by electron-vite's renderer target.
//   2. app/tsconfig.node.json     — the Electron main-process + preload layer
//      (src/main/*.ts + src/preload/*.ts, stage 2/3; bundled by electron-vite's
//      main/preload targets — #156 retired the former un-built .mts type-strip
//      execution these files used to run under).
//   3. native-host/tsconfig.json  — the native-messaging-host CJS layer
//      (bridge.cts + install.cts + paths.cts + media-download.cts +
//      config-recovery.cts, stage 2/3; a THIRD standalone-Node runtime, .cts,
//      no DOM; runs un-built via the same Node type-stripping)
//   4. extension/tsconfig.json    — the Chrome extension (MV3) browser layer,
//      stage 2/3; a FOURTH runtime (real browser, no type-stripping) — the one
//      layer is built by WXT. Its type check runs `wxt prepare` first so the
//      generated entrypoint declarations are present.
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
const extWxt = path.join(extDir, 'node_modules', 'wxt', 'bin', 'wxt.mjs');

const PROJECTS = [
  { p: path.join(appDir, 'tsconfig.web.json'), label: 'renderer (components + services)', tsc: appTsc, cwd: appDir },
  { p: path.join(appDir, 'tsconfig.node.json'), label: 'main process + preload', tsc: appTsc, cwd: appDir },
  { p: path.join(__dirname, '..', 'native-host', 'tsconfig.json'), label: 'native-host', tsc: appTsc, cwd: appDir },
  { p: path.join(extDir, 'tsconfig.json'), label: 'extension', tsc: extTsc, prepare: extWxt, cwd: extDir },
  { p: path.join(__dirname, 'tsconfig.json'), label: 'scripts', tsc: appTsc, cwd: appDir },
];

let failed = 0;
for (const project of PROJECTS) {
  const { p, label, tsc, cwd } = project;
  const prepared = project.prepare ? spawnSync(process.execPath, [project.prepare, 'prepare'], { stdio: 'inherit', cwd }) : null;
  const r = project.prepare ? (prepared?.status === 0 ? spawnSync(process.execPath, [tsc, '--noEmit', '-p', p], { stdio: 'inherit', cwd }) : prepared) : spawnSync(process.execPath, [tsc, '--noEmit', '-p', p], { stdio: 'inherit', cwd });
  if (r.status !== 0) {
    console.error(`FAIL test-typecheck: ${label} reported errors`);
    failed++;
  }
}
if (failed) process.exit(1);
console.log('PASS test-typecheck: renderer + main process + native-host + extension + scripts type-check clean');
