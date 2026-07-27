// theme.ts is the pre-paint FOUC boot (set [data-theme] before first paint). It
// must live in src/renderer/public/ as a plain classic <script> — it must run
// during <head> parse, before first paint, which the module-script entry (loaded
// at the end of body) can't guarantee — see the load-order comment in
// src/renderer/index.html. electron-vite's renderer build copies public/ verbatim
// (it never processes theme.ts itself), so this standalone Vite lib-mode build is
// what keeps src/renderer/public/theme.js in sync with its real source
// (src/renderer/src/services/theme.ts). Run before `electron-vite build`/`dev`
// whenever theme.ts changes (same limitation the old islands/build.mjs had: no
// live-reload path for this one file).
//
//   node build-theme-boot.mjs
import { build } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)); // app/

await build({
  root: here,
  configFile: false,
  logLevel: 'warn',
  build: {
    outDir: path.join(here, 'src', 'renderer', 'public'),
    emptyOutDir: false, // shares the dir with vendor/ (public asset copies) — never wipe it
    target: 'chrome130', // Electron 43 ships Chromium 130
    minify: true,
    sourcemap: false,
    lib: {
      entry: path.join(here, 'src', 'renderer', 'src', 'services', 'theme.ts'),
      formats: ['iife'],
      name: '__hologramTheme', // side-effect only (pre-paint [data-theme] boot); no window global, no exports read
      fileName: () => 'theme.js',
    },
  },
});

console.log('[build-theme-boot] built src/renderer/public/theme.js from src/renderer/src/services/theme.ts');
