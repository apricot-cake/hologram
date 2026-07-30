import path from 'node:path';
import { type Plugin, transformWithOxc } from 'vite';
import { defineConfig } from 'vitest/config';

// Vite's "this is a JS/TS source" test covers .ts/.mts but not .cts, so a .cts
// import reaches the parser with its type annotations intact and dies on the
// first `interface`. native-host/ is written in .cts on purpose (CommonJS, run
// un-built by Node's type stripping — see native-host/tsconfig.json), and the
// suites for it import those modules directly, so teach the transform about the
// extension instead of renaming the runtime's files.
const ctsAsTypeScript = (): Plugin => ({
  name: 'hologram:cts-as-typescript',
  async transform(code, id) {
    if (!id.endsWith('.cts')) return null;
    const { code: js, map } = await transformWithOxc(code, id, { lang: 'ts' });
    return { code: js, map };
  },
});

// Pure-unit test runner. Registration is glob-based: any scripts/*.test.ts is
// picked up automatically — there is no hand-maintained list of suites to keep
// in sync (the 2026-07-02 audit found suites that had sat unregistered, and red,
// for weeks because the old aggregator's TESTS array was written by hand).
//
// A separate config rather than app/electron.vite.config.ts: that file's default
// export is electron-vite's main/preload/renderer triple, which Vitest cannot
// consume. Nothing from it is needed here either — the suites import renderer
// SERVICE modules (plain .ts, no JSX, no '@' alias) and extension utils, so no
// react/tailwind plugin and no alias table is in play.
//
// Deliberately NOT run here, and the only valid reasons to stay out:
//   - needs network: scripts/test-metadata.cts, test-select-posts.cts,
//     test-watch-verify.cts (capture-flow CLIs; see docs/testing.md)
//   - needs Electron: scripts/test-app-*.cts → node scripts/run-app-tests.cts
// Both groups keep the old `test-*.cts` name, so the include glob below cannot
// reach them by accident.
export default defineConfig({
  plugins: [ctsAsTypeScript()],
  test: {
    include: ['scripts/**/*.test.ts'],
    // Node is the default; the four suites that exercise browser-side extension
    // code opt into jsdom per file via a `@vitest-environment jsdom` docblock.
    environment: 'node',
    // Sandboxes ~/.hologram per test file (CLAUDE.md: never let a test see the
    // real config dir).
    setupFiles: [path.resolve(__dirname, 'scripts/vitest.setup.ts')],
    // Builds the extension when its output is stale, so the suites that read
    // extension/.output/chrome-mv3 (the jsdom bundle suites and the manifest
    // consistency guard) never test a bundle older than the sources (#130).
    // Once per RUN, not per file — see that file's header.
    globalSetup: [path.resolve(__dirname, 'scripts/vitest.global-setup.ts')],
  },
});
