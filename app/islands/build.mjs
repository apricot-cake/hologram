// esbuild bundler for the React "islands" — small, isolated React surfaces that
// load into the otherwise build-less renderer as a single IIFE under CSP
// `script-src 'self'`. The rest of the renderer stays build-less; only these
// islands are compiled. See plan: 設定モーダル React 化パイロット.
//
//   npm run build:settings   → production: minified, NODE_ENV=production, no map
//   npm run watch:settings   → dev: unminified, NODE_ENV=development, inline map,
//                              rebuild on save (then reload the renderer)
//
// Entry imports its own CSS (`import './styles.css'`), so esbuild emits both
// renderer/islands/settings.js and renderer/islands/settings.css.

import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dev = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const opts = {
  entryPoints: [
    { in: path.join(here, 'settings/index.jsx'), out: 'settings' },
    { in: path.join(here, 'sidebar-tags/index.jsx'), out: 'sidebar-tags' },
  ],
  outdir: path.join(here, '../renderer/islands'),
  bundle: true,
  format: 'iife',
  jsx: 'automatic', // react/jsx-runtime — no `import React` needed in components
  // Electron 33 ships Chromium 130; target it directly (no legacy down-leveling).
  target: ['chrome130'],
  // React reads process.env.NODE_ENV; esbuild won't define it for us → ReferenceError.
  define: { 'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production') },
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  logLevel: 'info',
};

if (dev) {
  const ctx = await esbuild.context(opts);
  await ctx.watch();
  console.log('[island] watching settings/ + sidebar-tags/ … (reload the renderer to see changes)');
} else {
  await esbuild.build(opts);
  console.log('[island] built renderer/islands/{settings,sidebar-tags}.js');
}
