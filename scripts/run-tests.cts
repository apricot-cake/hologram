'use strict';
// Pure-unit test aggregator: runs every network-/Electron-free suite in sequence
// and exits non-zero if ANY fails, so silent rot can't accumulate (the 2026-07-02
// Biome sweep found token/contrast-parity had been red for weeks unnoticed).
// Heavier suites (Electron smoke, e2e capture, app-level tests) stay separate —
// see docs/testing.md.
//
// Run: npm test   (= node scripts/run-tests.cts)

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The extension suites import their TypeScript source directly. WXT's build is
// exercised separately by the typecheck suite and the browser e2e test.

// Every network-/Electron-free scripts/test-*.cts belongs here — the list was
// seeded (2026-07-02) from the suites that were red at the time, so the ones
// predating it sat unregistered for weeks (test-backup-guard, the prune safety
// valve docs/testing.md calls a pillar of the 2026-06-23 loss defense, among
// them). Deliberately NOT here, and the only valid reasons to leave a suite out:
//   - needs network: test-metadata, test-select-posts, test-watch-verify
//     (capture-flow CLIs; see docs/testing.md)
//   - needs Electron: test-app-*.cts → run-app-tests.cts globs them
// MIGRATION IN PROGRESS (#4): entries disappear from this list as they become
// scripts/*.test.ts under Vitest (`npm run test:unit`). This file goes away with
// the last one.
const TESTS = [
  'test-typecheck',
  'test-index',
  'test-db-unit',
  'test-db-schema',
  'test-db-import',
  'test-db-query',
  'test-db-write',
  'test-post-record',
  'test-query-unit',
  'test-records-unit',
  'test-facets-unit',
  'test-tabstate-unit',
  'test-listing-unit',
  'test-migrate-unit',
  'test-folders-merge',
  'test-folder-nesting',
  'test-metadata-correctness',
  'test-content-fixtures',
  'test-overlay-unit',
  'test-capture-mode-select',
  'test-bulk-capture-unit',
  'test-bridge',
  'test-bridge-query',
  'test-bridge-ssrf',
  'test-media',
  'test-backfill-metadata',
];

// Sandbox convention (CLAUDE.md): never let a test see the real ~/.hologram.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-tests-'));

let failed = 0;
for (const t of TESTS) {
  const r = spawnSync(process.execPath, [path.join(__dirname, `${t}.cts`)], {
    stdio: 'pipe',
    encoding: 'utf8',
    env: { ...process.env, HOLOGRAM_CONFIG_DIR: sandbox },
  });
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${t}`);
  if (!ok) {
    const tail = ((r.stdout || '') + (r.stderr || '')).trim().split(/\r?\n/).slice(-15).join('\n');
    console.log(tail.replace(/^/gm, '     '));
  }
}

try {
  fs.rmSync(sandbox, { recursive: true, force: true });
} catch (_e) {
  /* best-effort cleanup */
}

if (failed) {
  console.error(`FAIL run-tests: ${failed}/${TESTS.length} suite(s) red`);
  process.exit(1);
}
console.log(`PASS run-tests: all ${TESTS.length} pure-unit suites green`);
