'use strict';
// Pure-unit test aggregator: runs every network-/Electron-free suite in sequence
// and exits non-zero if ANY fails, so silent rot can't accumulate (the 2026-07-02
// Biome sweep found token/contrast-parity had been red for weeks unnoticed).
// Heavier suites (Electron smoke, e2e capture, app-level tests) stay separate —
// see docs/testing.md.
//
// Run: npm test   (= node scripts/run-tests.js)

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TESTS = [
  'test-typecheck',
  'test-index',
  'test-search-unit',
  'test-query-unit',
  'test-records-unit',
  'test-facets-unit',
  'test-cooc-unit',
  'test-migrate-unit',
  'test-collections-merge',
  'test-token-parity',
  'test-contrast-parity',
  'test-i18n-parity',
  'test-parse-url',
  'test-bridge-ssrf',
  'test-archive-zipslip',
  'test-archive-zipbomb',
];

// Sandbox convention (CLAUDE.md): never let a test see the real ~/.corpus.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-tests-'));

let failed = 0;
for (const t of TESTS) {
  const r = spawnSync(process.execPath, [path.join(__dirname, `${t}.js`)], {
    stdio: 'pipe',
    encoding: 'utf8',
    env: { ...process.env, CORPUS_CONFIG_DIR: sandbox },
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
} catch (e) {
  /* best-effort cleanup */
}

if (failed) {
  console.error(`FAIL run-tests: ${failed}/${TESTS.length} suite(s) red`);
  process.exit(1);
}
console.log(`PASS run-tests: all ${TESTS.length} pure-unit suites green`);
