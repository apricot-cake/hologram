// Vite library-mode bundler for the React "islands" — small, isolated React
// surfaces that load into the otherwise build-less renderer as a single IIFE
// under CSP `script-src 'self'`. The rest of the renderer stays build-less; only
// these islands are compiled. Replaces the former esbuild bundler.
//
//   npm run build:islands   → production: builds every island (imported by the
//                              app/index.tsx barrel) — React included — into ONE
//                              renderer/islands/app.js, plus a standalone
//                              side-effect-only IIFE that stays OUTSIDE that bundle
//                              (theme.js — see its build() call below for why),
//                              plus the preload bridge (preload.cts → app/preload.js
//                              CJS — see its build() call below for why).
//
// ALL islands (React included — see the removed vendor-react split below) are
// bundled into a single IIFE via one barrel entry (app/index.tsx side-effect-imports
// every island). rollup CAN emit IIFE for a single entry, so sharing one entry lets
// React / masonic / react-aria / _shared/* bundle ONCE instead of duplicating per
// island (the former per-island loop re-inlined each). IIFE (not ESM) is required so
// the prod `file://` load never hits the module-from-null-origin CORS block. The
// barrel (app/index.tsx) is the source of truth for the island set.
//
// dev uses `vite` (serve) with HMR/Fast Refresh instead of this script; its HTML
// rewrite turns `islands/app.js` into `/islands/app/index.tsx` (the barrel) via
// the same generic island-<script> regex — no dev-config change needed.
//
// NOTE: configFile:false makes Vite skip its automatic `process.env.NODE_ENV`
// define, which would leave React's dev branches un-DCE'd (~3x bloat). We define
// it explicitly so production builds strip them.
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)); // app/islands
const appRoot = path.join(here, '..'); // app

// The CJS 'use-sync-external-store' shim (react-aria / react-stately transitive
// dep) keeps a literal require("react") in lib-IIFE output — externals are
// global-mapped only for ESM imports — and throws at load. React 18+ has the
// hook natively; point both import specifiers at a 1-line ESM re-export.
const USE_SYNC_SHIM = path.join(here, '_shared', 'use-sync-external-store-shim.ts');
// Array form (order matters: the more specific shim/index.js must precede shim).
// The former `corpus-svc:NAME` regex (which folded the renderer service layer into
// this bundle via bare specifiers) is gone — every service, shell.ts included, is
// now imported by plain relative path (V18 item 7).
const USE_SYNC_WITH_SELECTOR_SHIM = path.join(here, '_shared', 'use-sync-external-store-with-selector-shim.ts');
const RESOLVE_ALIAS = [
  { find: 'use-sync-external-store/shim/with-selector.js', replacement: USE_SYNC_WITH_SELECTOR_SHIM },
  { find: 'use-sync-external-store/shim/with-selector', replacement: USE_SYNC_WITH_SELECTOR_SHIM },
  { find: 'use-sync-external-store/shim/index.js', replacement: USE_SYNC_SHIM },
  { find: 'use-sync-external-store/shim', replacement: USE_SYNC_SHIM },
  // shadcn/ui standard import alias — islands/ plays the role of src/.
  // Mirrored in tsconfig.json "paths" and vite.config.mjs.
  { find: '@', replacement: here },
];

// theme.ts is the pre-paint FOUC boot (set [data-theme] before first paint). It stays
// OUTSIDE the app.js bundle (its own IIFE, next to it): it must run during <head> parse,
// before first paint, which app.js (loaded at the end of body) can't guarantee — see the
// load-order comment in renderer/index.html. Built the same way as vendor-react.js above
// (standalone Vite lib IIFE) so the source can be real TypeScript despite never going
// through the app.js bundle. It publishes no window global; the LIVE theme runtime API
// (apply/get/set/resolve/applyTitleBar) is renderer/theme-api.ts, folded into app.js.
await build({
  root: appRoot,
  configFile: false,
  logLevel: 'warn',
  build: {
    outDir: path.join(appRoot, 'renderer'),
    emptyOutDir: false, // shares the dir with every other renderer/*.ts source — never wipe it
    target: 'chrome130',
    minify: true,
    sourcemap: false,
    lib: {
      entry: path.join(appRoot, 'renderer', 'theme.ts'),
      formats: ['iife'],
      name: '__corpusTheme', // side-effect only (pre-paint [data-theme] boot); no window global, no exports read
      fileName: () => 'theme.js',
    },
  },
});

// preload.cts → app/preload.js (committed CJS build output, loaded by main.mts's
// webPreferences.preload). The sandbox preload loader does NOT type-strip, so
// unlike the rest of the .mts main-process layer this ONE file goes through a
// build. electron stays external (the literal require('electron') is the only
// module the sandboxed preload can resolve); unminified so the committed security
// boundary (the contextBridge surface) stays readable in diffs.
await build({
  // repo root, NOT appRoot: with root === outDir Vite emits a (here harmless —
  // emptyOutDir:false) "outDir must not be the same directory of root" warning
  // on every build. root only anchors relative resolution (entry is absolute).
  root: path.join(appRoot, '..'),
  configFile: false,
  logLevel: 'warn',
  build: {
    outDir: appRoot,
    emptyOutDir: false, // outDir IS app/ itself — wiping it would delete the app
    target: 'chrome130',
    minify: false,
    sourcemap: false,
    lib: {
      entry: path.join(appRoot, 'preload.cts'),
      formats: ['cjs'],
      fileName: () => 'preload.js',
    },
    rollupOptions: { external: ['electron'] },
  },
});

// Build every island as ONE IIFE bundle via the app/index.tsx barrel.
await build({
  root: appRoot,
  configFile: false, // self-contained; vite.config.mjs is dev-serve only
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  resolve: { alias: RESOLVE_ALIAS },
  plugins: [react(), tailwindcss()],
  logLevel: 'warn',
  build: {
    outDir: path.join(appRoot, 'renderer/islands'),
    emptyOutDir: false, // shares the dir with theme.js (built above, under renderer/ though — harmless)
    target: 'chrome130', // Electron 33 ships Chromium 130
    minify: true, // vite 8 (rolldown) uses its built-in oxc minifier; 'esbuild' would require esbuild as a separate dep
    cssCodeSplit: true, // settings imports './styles.css' → emitted as app.css alongside app.js
    modulePreload: { polyfill: false }, // no inline polyfill → keep CSP 'self'
    sourcemap: false,
    lib: {
      entry: path.join(here, 'app', 'index.tsx'), // the barrel: side-effect-imports every island
      formats: ['iife'],
      name: '__corpusIslands', // IIFE needs a name; islands export nothing (side-effect only)
      fileName: () => 'app.js',
    },
    // React (and jszip) are bundled straight into app.js now — no external/globals
    // split (see the removed vendor-react step above). file:// is a single-app load
    // with no cross-page caching to gain from splitting it back out.
  },
});

console.log('[islands] built renderer/theme.js + renderer/islands/app.js (IIFE) + preload.js (CJS) via Vite lib mode');
