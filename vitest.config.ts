import path from 'node:path';
import { defineConfig } from 'vitest/config';

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
  test: {
    include: ['scripts/**/*.test.ts'],
    // Node is the default; the four suites that exercise browser-side extension
    // code opt into jsdom per file via a `@vitest-environment jsdom` docblock.
    environment: 'node',
    // Sandboxes ~/.hologram per test file (CLAUDE.md: never let a test see the
    // real config dir).
    setupFiles: [path.resolve(__dirname, 'scripts/vitest.setup.ts')],
  },
});
