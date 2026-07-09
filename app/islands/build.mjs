// Vite library-mode bundler for the React "islands" — small, isolated React
// surfaces that load into the otherwise build-less renderer as a single IIFE
// under CSP `script-src 'self'`. The rest of the renderer stays build-less; only
// these islands are compiled. Replaces the former esbuild bundler.
//
//   npm run build:islands   → production: builds every island (imported by the
//                              app/index.tsx barrel) into ONE renderer/islands/app.js,
//                              plus two standalone side-effect-only IIFEs that stay
//                              OUTSIDE that bundle (vendor-react.js, theme.js — see
//                              each build() call below for why).
//
// ALL islands are bundled into a single IIFE via one barrel entry (app/index.tsx
// side-effect-imports every island). rollup CAN emit IIFE for a single entry, so
// sharing one entry lets masonic / react-aria / _shared/* bundle ONCE instead of
// duplicating per island (the former per-island loop re-inlined each). IIFE (not
// ESM) is required so the prod `file://` load never hits the module-from-null-origin
// CORS block. The barrel (app/index.tsx) is the source of truth for the island set.
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
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)); // app/islands
const appRoot = path.join(here, '..'); // app

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
// Forward slashes so the regex-alias replacement below (which substitutes $1 into a
// path string) doesn't inject backslash escapes on Windows.
const RENDERER_DIR = path.join(appRoot, 'renderer').replace(/\\/g, '/');
// Array form (order matters: the more specific shim/index.js must precede shim). The
// `corpus-svc:NAME` regex folds the renderer SERVICE layer into this one bundle — each
// former <script src="NAME.js"> is now `import 'corpus-svc:NAME'` from app/index.tsx,
// resolved here to renderer/NAME.ts. Bare specifiers (not relative paths) so the strict
// islands tsc can't resolve them → the services stay OUT of that program and are
// type-checked ONLY by tsconfig.renderer.json (same isolation as corpus-viewer-bundle).
const RESOLVE_ALIAS = [
  { find: 'use-sync-external-store/shim/index.js', replacement: USE_SYNC_SHIM },
  { find: 'use-sync-external-store/shim', replacement: USE_SYNC_SHIM },
  { find: 'corpus-viewer-bundle', replacement: path.join(appRoot, 'renderer', 'viewer.ts') },
  { find: /^corpus-svc:(.+)$/, replacement: `${RENDERER_DIR}/$1.ts` },
];

// theme.ts stays OUTSIDE the app.js bundle (its own IIFE, next to it): it must
// run during <head> parse, before first paint, which app.js (loaded at the end
// of body) can't guarantee — see the load-order comment in renderer/index.html.
// Built the same way as vendor-react.js above (standalone Vite lib IIFE) so the
// source can be real TypeScript despite never going through the app.js bundle.
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
      name: '__corpusTheme', // side-effect only (assigns window.corpusTheme); no exports read
      fileName: () => 'theme.js',
    },
  },
});

// Build every island as ONE IIFE bundle via the app/index.tsx barrel.
await build({
  root: appRoot,
  configFile: false, // self-contained; vite.config.mjs is dev-serve only
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  resolve: { alias: RESOLVE_ALIAS },
  plugins: [react()],
  logLevel: 'warn',
  build: {
    outDir: path.join(appRoot, 'renderer/islands'),
    emptyOutDir: false, // shares the dir with vendor-react.js (built above); don't wipe it
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
    rollupOptions: {
      external: REACT_EXTERNALS, // don't inline React; reach it via window globals
      output: { globals: REACT_GLOBALS },
    },
  },
});

console.log('[islands] built renderer/theme.js + renderer/islands/{vendor-react,app}.js via Vite lib IIFE');
