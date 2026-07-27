// Bundles native-host entry points (+ the local modules and npm deps they pull
// in, e.g. undici) into native-host/dist/*.js — one file per entry, node
// builtins external, everything else inlined. Two entries need this, for two
// different reasons:
//   - bridge.cts: the process Chrome spawns per native-messaging connection.
//     It runs from the ASCII config dir (see native-host/install.cts's
//     deployBridge), so bundling makes the deployed artifact ONE file with no
//     runtime module resolution left (a missed file used to crash the host with
//     no hint beyond "Error when communicating with the native messaging host").
//   - media-download.cts: required directly by the PACKAGED Electron main
//     process (app/src/main/index.ts). electron-builder copies native-host/ as
//     a raw extraResource — no node_modules — so a require() of the raw source
//     crashed on startup with "Cannot find module 'undici'". In dev, main
//     still requires the raw source (repo-root node_modules resolves undici
//     fine there and this keeps edit-and-restart working with no rebuild step);
//     only the packaged path uses this bundle.
//
// native-host/ is a separate deliverable (out of #156's scope — its .cts source
// is untouched), but this build step previously lived in app/islands/build.mjs
// (retired with the rest of the old build-less renderer pipeline), so it moves
// here rather than disappearing. Unminified because a silent host crash is
// diagnosed by reading bridge.log against this file.
//
//   node build-native-host-bridge.mjs
import { build } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)); // app/
const repoRoot = path.join(here, '..');
const outDir = path.join(repoRoot, 'native-host', 'dist');

// Each entry gets its OWN Rollup build (not one multi-entry build) so the two
// outputs never share an extracted chunk. bridge.js and media-download.js both
// pull in media-download.cts's code (bridge.cts requires it directly), and a
// single combined build hoists that shared code into a third file that each
// entry require()s by relative path — which silently breaks deployBridge()
// (native-host/install.cts), which copies ONLY the single bridge.js file into
// ~/.hologram. Two independent builds keep each output a fully self-contained
// single file, matching what deployBridge assumes.
async function buildEntry(name, emptyOutDir) {
  await build({
    root: repoRoot,
    configFile: false,
    logLevel: 'warn',
    build: {
      outDir,
      emptyOutDir, // only the FIRST build may empty the shared dist/ dir
      target: 'node20', // Electron 43 runs Node 20 in ELECTRON_RUN_AS_NODE; system Node ≥ 20 for the dev CLI
      minify: false,
      sourcemap: false,
      lib: {
        entry: path.join(repoRoot, 'native-host', `${name}.cts`),
        formats: ['cjs'],
        fileName: () => `${name}.js`,
      },
      rollupOptions: { external: [/^node:/] },
    },
  });
}

await buildEntry('bridge', true);
await buildEntry('media-download', false);

console.log('[build-native-host-bridge] built native-host/dist/bridge.js and native-host/dist/media-download.js');
