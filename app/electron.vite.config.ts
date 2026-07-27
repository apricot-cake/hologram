import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

const r = (...segs: string[]) => path.resolve(__dirname, ...segs);

// The CJS 'use-sync-external-store' shim (react-aria / react-stately transitive
// dep) keeps a literal require("react") in bundled output — externals are
// global-mapped only for ESM imports — and throws at load. React 18+ has the
// hook natively; point both import specifiers at a 1-line ESM re-export.
// Array form: order matters (the more specific shim/index.js must precede shim).
const RESOLVE_ALIAS = [
  { find: 'use-sync-external-store/shim/with-selector.js', replacement: r('src/renderer/src/_shared/use-sync-external-store-with-selector-shim.ts') },
  { find: 'use-sync-external-store/shim/with-selector', replacement: r('src/renderer/src/_shared/use-sync-external-store-with-selector-shim.ts') },
  { find: 'use-sync-external-store/shim/index.js', replacement: r('src/renderer/src/_shared/use-sync-external-store-shim.ts') },
  { find: 'use-sync-external-store/shim', replacement: r('src/renderer/src/_shared/use-sync-external-store-shim.ts') },
  // shadcn/ui standard import alias — mirrored in tsconfig.web.json's paths.
  { find: '@', replacement: r('src/renderer/src') },
];

export default defineConfig({
  main: {
    // better-sqlite3 (native addon), kysely, electron-log, jszip, yauzl, yazl
    // etc. stay external (required from node_modules at runtime) rather than
    // bundled — required for the native addon, kept for the rest for parity.
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    // electron-log must be BUNDLED into the preload output (not required at
    // runtime): sandboxed preload scripts can only require() a small Electron
    // allowlist, not arbitrary npm packages from node_modules (proven live —
    // externalizing it threw "module not found: electron-log/preload" and the
    // whole preload script failed to load). 'electron' itself stays external
    // (electron-vite treats it as external for main/preload unconditionally).
    plugins: [externalizeDepsPlugin({ exclude: ['electron-log'] })],
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias: RESOLVE_ALIAS },
    build: {
      rollupOptions: {
        input: r('src/renderer/index.html'),
      },
    },
    plugins: [react(), tailwindcss()],
  },
});
