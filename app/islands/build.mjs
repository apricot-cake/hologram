// Vite library-mode bundler for the React "islands" — small, isolated React
// surfaces that load into the otherwise build-less renderer as a single IIFE
// under CSP `script-src 'self'`. The rest of the renderer stays build-less; only
// these islands are compiled. Replaces the former esbuild bundler.
//
//   npm run build:islands   → production: builds every entry in ISLANDS below to
//                              renderer/islands/<name>.js
//
// Each island is built in its own single-entry lib build because rollup cannot
// emit IIFE for multiple entries at once. IIFE (not ESM) is required so the prod
// `file://` load never hits the module-from-null-origin CORS block.
//
// dev uses `vite` (serve) with HMR/Fast Refresh instead of this script.
//
// NOTE: configFile:false makes Vite skip its automatic `process.env.NODE_ENV`
// define, which would leave React's dev branches un-DCE'd (~3x bloat). We define
// it explicitly so production builds strip them.
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)); // app/islands
const appRoot = path.join(here, '..'); // app

const ISLANDS = ['settings', 'sidebar-tags', 'query-chips', 'tabs', 'collections', 'searchbox', 'posters', 'lightbox', 'toolbar', 'context-menu', 'kind-menu', 'filter-popover', 'qf-pop', 'inspector', 'edit-overlay', 'grid'];

// React is externalized out of every island and shared via one prebuilt runtime
// (vendor-react.js, loaded first in index.html). These specifiers map to the
// globals that vendor-react/index.js assigns on `window` — the two lists MUST
// stay in sync. Without this, each island re-inlines its own ~186KB React copy.
const REACT_EXTERNALS = ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'];
const REACT_GLOBALS = {
  react: 'React',
  'react-dom': 'ReactDOM',
  'react-dom/client': 'ReactDOMClient',
  'react/jsx-runtime': 'ReactJsxRuntime',
};

// Build the shared runtime FIRST (react + react-dom bundled in, nothing
// external) so it exists before the islands that expect its globals at load.
await build({
  root: appRoot,
  configFile: false,
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  logLevel: 'warn',
  build: {
    outDir: path.join(appRoot, 'renderer/islands'),
    emptyOutDir: false,
    target: 'chrome130',
    minify: true,
    sourcemap: false,
    lib: {
      entry: path.join(here, 'vendor-react', 'index.ts'),
      formats: ['iife'],
      name: '__corpusReactRuntime', // side-effect only (assigns window.*); no exports read
      fileName: () => 'vendor-react.js',
    },
  },
});

// The CJS 'use-sync-external-store' shim (react-aria / react-stately transitive
// dep) keeps a literal require("react") in lib-IIFE output — externals are
// global-mapped only for ESM imports — and throws at load. React 18+ has the
// hook natively; point both import specifiers at a 1-line ESM re-export.
const USE_SYNC_SHIM = path.join(here, '_shared', 'use-sync-external-store-shim.ts');
const RESOLVE_ALIAS = {
  'use-sync-external-store/shim/index.js': USE_SYNC_SHIM,
  'use-sync-external-store/shim': USE_SYNC_SHIM,
};

for (const name of ISLANDS) {
  await build({
    root: appRoot,
    configFile: false, // self-contained; vite.config.mjs is dev-serve only
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    resolve: { alias: RESOLVE_ALIAS },
    plugins: [react()],
    logLevel: 'warn', // quiet the per-build banner across all builds
    build: {
      outDir: path.join(appRoot, 'renderer/islands'),
      emptyOutDir: false, // builds share the dir; don't wipe each other / other assets
      target: 'chrome130', // Electron 33 ships Chromium 130
      minify: true, // vite 8 (rolldown) uses its built-in oxc minifier; 'esbuild' would require esbuild as a separate dep
      cssCodeSplit: true, // settings imports './styles.css' → emit settings.css
      modulePreload: { polyfill: false }, // no inline polyfill → keep CSP 'self'
      sourcemap: false,
      lib: {
        entry: path.join(here, name, 'index.tsx'),
        formats: ['iife'],
        name: '__corpusIsland_' + name.replace(/-/g, '_'), // IIFE needs a name; islands export nothing (side-effect only)
        fileName: () => name + '.js',
      },
      rollupOptions: {
        external: REACT_EXTERNALS, // don't inline React; reach it via window globals
        output: { globals: REACT_GLOBALS },
      },
    },
  });
}

console.log('[islands] built renderer/islands/{vendor-react,' + ISLANDS.join(',') + '}.js via Vite lib IIFE');
