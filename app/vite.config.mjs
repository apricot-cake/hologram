import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// app/ — pin root to this config's own dir so it's correct regardless of cwd.
const here = path.dirname(fileURLToPath(import.meta.url));

// DEV-SERVE Vite config for the renderer's React islands (gives HMR + React Fast
// Refresh while developing). This is used ONLY when the app is launched with
// CORPUS_DEV_SERVER set (see main.js). Production loads the Vite lib-mode IIFE
// bundles (npm run build:islands -> islands/build.mjs) via loadFile from the same
// renderer/islands/<name>.js paths; this config (the apply:'serve' plugin) never
// runs for the prod build.
//
// root is app/ (this directory), NOT renderer/, because the island SOURCES live
// in app/islands/ — OUTSIDE renderer/. With root=app/ every existing relative URL
// still resolves: index.html is served at /renderer/index.html, its plain
// non-module scripts (viewer.js, folders.js, theme.js, …) at /renderer/*,
// ../vendor/jszip.min.js at /vendor/*, and the island sources at
// /islands/<name>/index.tsx — all under the same root so Vite serves them.

// Matches the committed island <script src="islands/NAME.js"> tags in index.html.
const ISLAND_SCRIPT = /<script src="islands\/([\w-]+)\.js"><\/script>/g;

// Dev CSP = the prod meta plus what Vite's dev server needs: inline scripts (the
// React Refresh preamble Vite injects) and the HMR websocket. The strict prod
// meta (script-src 'self') is never changed on disk — we only rewrite the served
// HTML in dev. psimg:/data:/blob: are carried over so local images still load.
const DEV_CSP = "default-src 'self'; img-src 'self' psimg: data: blob:; media-src 'self' psimg: blob:; " + "style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; " + "connect-src 'self' ws: http://localhost:*; base-uri 'none'; form-action 'none';";

// Dev-only HTML rewrite: swap the island IIFE bundles for their .tsx ES-module
// sources (so Vite can HMR them) and relax the CSP meta. apply:'serve' keeps this
// out of any future `vite build`.
function corpusDevHtml() {
  return {
    name: 'corpus-dev-html',
    apply: 'serve',
    transformIndexHtml(html) {
      // The prebuilt shared React runtime is prod-only: dev serves each island's
      // .tsx as an ES module that imports React straight from node_modules, and
      // vendor-react has a .ts entry (no .tsx) the island rewrite below could not
      // resolve anyway. Strip its <script> before the island rewrite so the
      // ISLAND_SCRIPT regex below doesn't turn it into a dead /index.tsx module.
      html = html.replace(/[ \t]*<script src="islands\/vendor-react\.js"><\/script>\r?\n?/, '');
      html = html.replace(ISLAND_SCRIPT, (_m, name) => `<script type="module" src="/islands/${name}/index.tsx"></script>`);
      html = html.replace(/(<meta http-equiv="Content-Security-Policy" content=")[^"]*(">)/, `$1${DEV_CSP}$2`);
      return html;
    },
  };
}

export default defineConfig({
  root: here,
  server: { port: 5173, strictPort: true },
  resolve: {
    alias: {
      // Same alias as islands/build.mjs: the CJS use-sync-external-store shim is
      // replaced with a 1-line ESM re-export (React 18+ has the hook natively).
      'use-sync-external-store/shim/index.js': path.join(here, 'islands', '_shared', 'use-sync-external-store-shim.ts'),
      'use-sync-external-store/shim': path.join(here, 'islands', '_shared', 'use-sync-external-store-shim.ts'),
      // The barrel imports renderer/viewer.ts via this bare specifier so the strict
      // islands tsc project never type-checks it (checked by tsconfig.renderer.json
      // instead); dev must resolve the same alias islands/build.mjs uses for prod.
      'corpus-viewer-bundle': path.join(here, 'renderer', 'viewer.ts'),
    },
  },
  plugins: [react(), corpusDevHtml()],
});
