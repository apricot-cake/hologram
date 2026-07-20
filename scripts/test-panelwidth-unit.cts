'use strict';

// panel-width-pref.ts unit tests (#30): the clamp that every dragged, typed and
// restored panel width goes through. Pure — the module's IPC/localStorage halves are
// only touched inside functions, so importing it here runs nothing.
//
// What this guards: a width can arrive from a pointer at any coordinate, from a saved
// config.json somebody edited by hand, or from a key press at the limit. All three land
// on clampWidth, and its viewport cap is the one rule that is easy to get backwards —
// on a narrow window the cap can fall below the panel's own minimum, and a naive
// min(cap, …) would then return a sliver nobody can grab.
//
//   node scripts/test-panelwidth-unit.cts

const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function main() {
  const P = await import(pathToFileURL(path.join(__dirname, '..', 'app', 'renderer', 'panel-width-pref.ts')).href);
  const { clampWidth, LIMITS } = P;

  let failed = 0;
  function assert(name, cond) {
    if (cond) {
      console.log('ok  ', name);
    } else {
      console.log('FAIL', name);
      failed++;
    }
  }

  const WIDE = 2560; // wide enough that the viewport cap never binds

  // --- absolute limits ---
  assert('sidebar: in-range width passes through', clampWidth('sidebarWidth', 300, WIDE) === 300);
  assert('sidebar: below min clamps up', clampWidth('sidebarWidth', 40, WIDE) === LIMITS.sidebarWidth.min);
  assert('sidebar: above max clamps down', clampWidth('sidebarWidth', 9999, WIDE) === LIMITS.sidebarWidth.max);
  assert('inspector: in-range width passes through', clampWidth('inspectorWidth', 400, WIDE) === 400);
  assert('inspector: below min clamps up', clampWidth('inspectorWidth', 0, WIDE) === LIMITS.inspectorWidth.min);
  assert('inspector: above max clamps down', clampWidth('inspectorWidth', 5000, WIDE) === LIMITS.inspectorWidth.max);

  // --- viewport cap (45%) ---
  // 1000px window → 450px cap, which is below the inspector's 560 max and above the
  // sidebar's 400: it binds for one panel and not the other.
  assert('inspector: cap binds before max on a 1000px window', clampWidth('inspectorWidth', 560, 1000) === 450);
  assert('sidebar: max still binds first on a 1000px window', clampWidth('sidebarWidth', 560, 1000) === LIMITS.sidebarWidth.max);

  // The window's own minWidth is 720px; at that size 45% is 324, under the inspector's
  // 260 min but over it — the case where cap and min cross is smaller still.
  assert('inspector: cap at the 720px window minimum', clampWidth('inspectorWidth', 500, 720) === 324);
  assert('inspector: min wins when the cap would go under it', clampWidth('inspectorWidth', 500, 400) === LIMITS.inspectorWidth.min);
  assert('sidebar: min wins when the cap would go under it', clampWidth('sidebarWidth', 500, 300) === LIMITS.sidebarWidth.min);

  // --- rounding: pointer coordinates are fractional, CSS px written back are not ---
  assert('fractional width rounds to whole px', clampWidth('sidebarWidth', 300.4, WIDE) === 300);
  assert('fractional width rounds half up', clampWidth('sidebarWidth', 300.5, WIDE) === 301);

  // --- idempotence: a clamped width must survive being clamped again (a restored
  //     config value goes through this on every boot) ---
  for (const key of ['sidebarWidth', 'inspectorWidth']) {
    for (const w of [0, 250, 400, 9999]) {
      const once = clampWidth(key, w, 1440);
      assert(`${key}: clamp is idempotent (${w})`, clampWidth(key, once, 1440) === once);
    }
  }

  if (failed) {
    console.error(`FAIL test-panelwidth-unit: ${failed} assertion(s)`);
    process.exit(1);
  }
  console.log('PASS test-panelwidth-unit');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
