import { defineConfig } from '@playwright/test';

// Playwright runs the Electron E2E layer (#14) — the only layer that drives the
// real app with real pointer input and compares real pixels. It is a third runner
// beside Vitest (scripts/*.test.ts) and the app-harness aggregator
// (scripts/run-app-tests.cts) because it is the one that owns snapshot baselines;
// docs/testing.md holds the split.
//
// Two projects, because only one half of the suite can run anywhere:
//   flow   — user flows. Machine-independent, so app-tests.yml runs it on the
//            Windows runner alongside the other real-Electron layers.
//   visual — toHaveScreenshot baselines. LOCAL-ONLY by decision (#14, 2026-07-29):
//            the baselines are taken on the development machine and committed, and
//            CI never runs this project. e2e/README.md has the reasoning.
export default defineConfig({
  testDir: './e2e',
  // One at a time. Each case boots a real Electron, and while the sandboxes are
  // isolated from each other, a machine running several of them concurrently
  // makes the timing-sensitive half (pointer input, first paint) load-dependent
  // — and would put several windows on screen at once.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  // Playwright's 30s default is close for this layer: a case is an Electron cold
  // start (~2s) plus the app's own index build before the first card paints.
  timeout: 90_000,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: {
      // Start strict and mask what turns out to move, rather than starting loose
      // and never learning what the tolerance was hiding.
      maxDiffPixels: 0,
      // Freezes CSS transitions/animations at their end state before the shot.
      animations: 'disabled',
    },
  },
  projects: [
    { name: 'flow', testDir: './e2e/flows' },
    { name: 'visual', testDir: './e2e/visual' },
  ],
});
