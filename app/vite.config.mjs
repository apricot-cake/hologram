import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
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
// still resolves: index.html is served at /renderer/index.html, and the island
// sources at /islands/<name>/index.tsx — all under the same root so Vite serves
// them. renderer/theme.js is the one non-module <script src> left (the pre-paint
// FOUC boot — must run before first paint, see index.html's load-order comment;
// the live theme runtime API is renderer/theme-api.ts, folded into app.js). It's a
// committed Vite lib-IIFE build output of renderer/theme.ts (islands/build.mjs) —
// dev serves whatever copy is on disk as a static file, so `npm run build:islands`
// after editing theme.ts is what refreshes it (dev has no live-reload path for
// this one file).

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
      // Dev serves each island's .tsx as an ES module that imports React straight
      // from node_modules (same as the prod bundle now inlines it — no separate
      // runtime script to strip here anymore).
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
    // Array form, mirroring islands/build.mjs (dev must resolve the same specifiers the
    // prod build does). Order matters: shim/index.js before shim.
    alias: [
      // The CJS use-sync-external-store shim → a 1-line ESM re-export (React 18+ has the hook).
      { find: 'use-sync-external-store/shim/index.js', replacement: path.join(here, 'islands', '_shared', 'use-sync-external-store-shim.ts') },
      { find: 'use-sync-external-store/shim', replacement: path.join(here, 'islands', '_shared', 'use-sync-external-store-shim.ts') },
      // shadcn/ui standard import alias — islands/ plays the role of src/.
      // Mirrored in tsconfig.json "paths" and islands/build.mjs.
      { find: '@', replacement: path.join(here, 'islands') },
    ],
  },
  plugins: [react(), tailwindcss(), corpusDevHtml()],
});
