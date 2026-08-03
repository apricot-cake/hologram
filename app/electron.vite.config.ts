import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// The renderer CSP lives in main (app/src/main/renderer-csp.ts) because main is
// what delivers it. Dev is the one place Vite has to be let past it, so the
// nonce is read from there rather than written down twice.
import { DEV_CSP_NONCE } from './src/main/renderer-csp.ts';

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
    // better-sqlite3 (native addon), kysely, electron-log, yauzl, yazl
    // etc. stay external (required from node_modules at runtime) rather than
    // bundled — required for the native addon, kept for the rest for parity.
    //
    // koffi is named explicitly because externalizeDepsPlugin only externalizes
    // `dependencies`, and koffi is a devDependency on purpose: it is loaded only
    // by the HOLOGRAM_START_INACTIVE verify path, so it must stay out of the
    // shipped app. Bundling it would both break (it is a native addon) and drag
    // a dev-only dependency into dist.
    //
    // The two ONNX Runtime packages are named for the same "not a direct
    // dependency, must not be bundled" reason: ml-worker.ts loads them itself to
    // decide which backend it got (#831), but they belong to
    // @huggingface/transformers, so the plugin's package.json scan does not see
    // them. Bundled, onnxruntime-node's require of
    // bin/napi-v6/<platform>/<arch>/onnxruntime_binding.node is rewritten
    // relative to out/main and never finds the addon.
    plugins: [externalizeDepsPlugin({ include: ['koffi', 'onnxruntime-node', 'onnxruntime-web'] })],
    build: {
      // TWO entries, not one: ml-worker.ts is forked as a utilityProcess by
      // lib-ml-runtime.ts (#831), so it has to exist as its own file next to
      // index.js. This extends electron-vite's own lib-mode entry rather than
      // setting rollupOptions.input, which replaces lib mode entirely and
      // silently flips the output to ESM .mjs with the npm deps inlined
      // (measured: index 272kB CJS -> 886kB ESM). `index` must keep its name —
      // package.json's "main" points at out/main/index.js.
      lib: { entry: { index: r('src/main/index.ts'), 'ml-worker': r('src/main/ml-worker.ts') } },
    },
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
    // Dev only: nonce every tag Vite emits, so the Fast Refresh preamble (an
    // INLINE module script) runs under the same CSP the packaged app uses.
    // renderer-csp.ts has the why; `apply: "serve"` keeps it out of the build,
    // where the policy carries no nonce and nothing needs one.
    plugins: [react(), tailwindcss(), { name: 'hologram:dev-csp-nonce', apply: 'serve', config: () => ({ html: { cspNonce: DEV_CSP_NONCE } }) }],
  },
});
