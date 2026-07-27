'use strict';
// App-harness aggregator: runs every scripts/test-app-*.cts in sequence and exits
// non-zero if ANY fails. Each harness boots its own sandboxed Electron (HOLOGRAM_SMOKE
// + a mkdtemp config dir), so this is HEAVY (~10s per harness, a window flashes per
// boot) — it is deliberately NOT part of npm test (Vitest = pure units). Run it
// at milestones (feedback-verify-batch-at-milestones), e.g. after a renderer
// restructure, to catch the silent rot npm test can't see (the 2026-07-02 React-island
// migration had left 5 of these red unnoticed).
//
// Run all:     node scripts/run-app-tests.cts
// Run a subset: node scripts/run-app-tests.cts tabs search   (suffix match)

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const all = fs
  .readdirSync(__dirname)
  .filter((f) => /^test-app-.*\.cts$/.test(f))
  .sort();
const args = process.argv.slice(2);
const picked = args.length ? all.filter((f) => args.some((a) => f === a || f === `test-app-${a}.cts`)) : all;
if (!picked.length) {
  console.error(`no matching test-app-*.cts (have: ${all.join(', ')})`);
  process.exit(2);
}

let failed = 0;
for (const f of picked) {
  const t0 = Date.now();
  // Each harness builds its own sandbox (mkdtemp + HOLOGRAM_CONFIG_DIR); 120s guards
  // against a hung Electron (the in-app smoke timeout is 9s, so this never bites a
  // healthy run).
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: 'pipe', encoding: 'utf8', timeout: 120000 });
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${f} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  if (!ok) {
    const tail = ((r.stdout || '') + (r.stderr || '')).trim().split(/\r?\n/).slice(-15).join('\n');
    console.log(tail.replace(/^/gm, '     '));
  }
}

if (failed) {
  console.error(`FAIL run-app-tests: ${failed}/${picked.length} harness(es) red`);
  process.exit(1);
}
console.log(`PASS run-app-tests: all ${picked.length} app harnesses green`);
