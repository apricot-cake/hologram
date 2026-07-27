'use strict';
// TypeScript contract checks (`npm run typecheck`). NOT a Vitest suite: it runs
// tsc over whole projects rather than asserting anything, so it stays a plain
// script — `npm run check` is what runs it alongside the tests.
//
// Five projects (all no-emit) so type rot can't accumulate silently between
// sessions. The Vitest suites (scripts/*.test.ts) are deliberately NOT a sixth:
// a single suite imports across the renderer, main-process, native-host and
// extension layers, and those are separate projects precisely because their
// compiler settings conflict (DOM vs Node globals, bundler vs nodenext). They
// were unchecked before this migration too — require() typed every import as
// any — so this is the status quo, not a loss.
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
//   5. scripts/tsconfig.json      — the dev-tooling / CLI layer (app-harness
//      Electron smoke + capture/verify CLIs), stage 2/3; a FIFTH standalone-Node
//      runtime, .cts, no build step — the runtime the original TS-scope
//      declaration never named (2026-07-09 audit).

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const extDir = path.join(__dirname, '..', 'extension');

// Find <pkg>/<subPath> by walking the node_modules chain up from fromDir,
// instead of hardcoding <workspace>/node_modules/<pkg>. npm hoists a
// dependency to the repo root whenever no workspace pins a conflicting
// version, so whether typescript lands in app/node_modules or the root is an
// install-order detail the repo doesn't control — the hardcoded nested path
// made `npm test` red on a plain root `npm install` while every other check
// stayed green. require.resolve is not usable here: wxt's package.json is
// walled off by its "exports" map, and a bin path is not an export either.
function resolveBin(pkg: string, subPath: string, fromDir: string): string {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', pkg, subPath);
    if (fs.existsSync(candidate)) return candidate;
    if (path.dirname(dir) === dir) throw new Error(`typecheck: cannot find ${pkg}/${subPath} from ${fromDir} — run npm install`);
  }
}

const appTsc = resolveBin('typescript', path.join('bin', 'tsc'), appDir);
const extTsc = resolveBin('typescript', path.join('bin', 'tsc'), extDir);
const extWxt = resolveBin('wxt', path.join('bin', 'wxt.mjs'), extDir);

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
    console.error(`FAIL typecheck: ${label} reported errors`);
    failed++;
  }
}
if (failed) process.exit(1);
console.log('PASS typecheck: renderer + main process + native-host + extension + scripts type-check clean');
