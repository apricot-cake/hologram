// Vite library-mode bundler for the React "islands" — small, isolated React
// surfaces that load into the otherwise build-less renderer as a single IIFE
// under CSP `script-src 'self'`. The rest of the renderer stays build-less; only
// these islands are compiled. Replaces the former esbuild bundler.
//
//   npm run build:islands   → production: 9 islands → renderer/islands/<name>.js
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
const appRoot = path.join(here, '..');                     // app

// post-card uses react-dom/server (renderToStaticMarkup); the rest use
// react-dom/client (createRoot). Both bundle fine in lib IIFE mode.
const ISLANDS = [
  'settings', 'sidebar-tags', 'query-chips', 'tabs', 'collections',
  'suggest', 'posters', 'post-card', 'lightbox', 'toolbar', 'context-menu',
];

for (const name of ISLANDS) {
  await build({
    root: appRoot,
    configFile: false, // self-contained; vite.config.mjs is dev-serve only
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    plugins: [react()],
    logLevel: 'warn', // quiet the per-build banner across 9 builds
    build: {
      outDir: path.join(appRoot, 'renderer/islands'),
      emptyOutDir: false, // 9 builds share the dir; don't wipe each other / other assets
      target: 'chrome130', // Electron 33 ships Chromium 130
      minify: true, // vite 8 (rolldown) uses its built-in oxc minifier; 'esbuild' would require esbuild as a separate dep
      cssCodeSplit: true, // settings imports './styles.css' → emit settings.css
      modulePreload: { polyfill: false }, // no inline polyfill → keep CSP 'self'
      sourcemap: false,
      lib: {
        entry: path.join(here, name, 'index.jsx'),
        formats: ['iife'],
        name: '__corpusIsland_' + name.replace(/-/g, '_'), // IIFE needs a name; islands export nothing (side-effect only)
        fileName: () => name + '.js',
      },
    },
  });
}

console.log('[islands] built renderer/islands/{' + ISLANDS.join(',') + '}.js via Vite lib IIFE');
