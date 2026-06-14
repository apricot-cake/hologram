'use strict';
// Contrast-PARITY guard for app/renderer/design-tokens.css.
//
// Sibling to test-token-parity.js. That test proves a token is DEFINED in both
// themes; this one proves the text roles carry COMPARABLE WCAG contrast in both
// themes — so light and dark stay legible to the same degree, and you can't bump
// one theme's text and silently leave the other faint.
//
// Why bands, not exact equality:
//   - High-end roles (--text / --text-strong) are "as dark/light as possible" in
//     both themes (13–19:1). Matching them to 2 decimals is meaningless (15 vs 19
//     looks identical), so they get a FLOOR only.
//   - Mid roles (--text-muted / -muted-strong / -subtle) live in the perceptually
//     sensitive 2.5–8:1 range where a drift is visible. They get a TARGET BAND
//     [min,max] that BOTH themes must fall inside → comparable contrast, enforced.
//
// WCAG contrast = (L_light+0.05)/(L_dark+0.05), L = relative luminance from the
// linearized RGB. Colors are resolved from the CSS itself (var() chains followed
// per theme), so this checks the SHIPPING values, not a hand-copied table.
//
// Run: node scripts/test-contrast-parity.js   (exit 1 on out-of-band / floor miss)

const fs = require('fs');
const path = require('path');

const CSS = path.join(__dirname, '..', 'app', 'renderer', 'design-tokens.css');

// role = text token; ref = the background it predominantly sits on (per theme).
// eyebrows/tab-titles (--text-muted-strong) live on the sidebar/band, the rest on
// the content surface (cards/panels/rows).
const CHECKS = [
  { role: '--text',              ref: '--surface',    floor: 11 },
  { role: '--text-strong',       ref: '--surface',    floor: 13 },
  { role: '--text-muted',        ref: '--surface',    band: [4.5, 6.0] },
  { role: '--text-muted-strong', ref: '--sidebar-bg', band: [6.5, 8.0] },
  { role: '--text-subtle',       ref: '--surface',    band: [2.2, 3.6] },
];
// Cross-theme spread cap for band roles: even inside the band the two themes must
// not sit at opposite ends (that would be "comparable" on paper but not in feel).
const MAX_SPREAD = 1.6;

// ---- CSS parse: merge every :root block → light map, every dark block → dark map.
function parse() {
  const raw = fs.readFileSync(CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const light = new Map(), dark = new Map();
  const blockRe = /([^{}]+)\{([^{}]+)\}/g;
  let m;
  while ((m = blockRe.exec(raw))) {
    const sel = m[1];
    const target = /\[data-theme="dark"\]/.test(sel) ? dark : (/:root/.test(sel) ? light : null);
    if (!target) continue;
    const declRe = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
    let d;
    while ((d = declRe.exec(m[2]))) target.set(d[1], d[2].trim());
  }
  return { light, dark };
}

// ---- resolve a custom prop to an [r,g,b] in a given theme (follow var() chains).
function resolve(name, theme, maps, seen = new Set()) {
  if (seen.has(name)) throw new Error('var() cycle at ' + name);
  seen.add(name);
  const map = theme === 'dark' && maps.dark.has(name) ? maps.dark : maps.light;
  let v = map.get(name);
  if (v == null) throw new Error(`unresolved ${name} (${theme})`);
  const varM = v.match(/^var\((--[a-z0-9-]+)\)$/i);
  if (varM) return resolve(varM[1], theme, maps, seen);
  return toRGB(v, name);
}
function toRGB(v, ctx) {
  let m = v.match(/^#([0-9a-f]{6})$/i);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = v.match(/^#([0-9a-f]{3})$/i);
  if (m) return [0, 1, 2].map((i) => parseInt(m[1][i] + m[1][i], 16));
  m = v.match(/^rgba?\(([^)]+)\)$/i);
  if (m) return m[1].split(',').slice(0, 3).map((s) => parseFloat(s));
  throw new Error(`not a plain color: "${v}" (${ctx}) — contrast roles must resolve to hex/rgb, not color-mix`);
}

const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const L = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const la = L(a) + 0.05, lb = L(b) + 0.05; return Math.max(la, lb) / Math.min(la, lb); };
const r2 = (n) => Math.round(n * 100) / 100;

function main() {
  const maps = parse();
  const fails = [];
  const rows = [];
  for (const c of CHECKS) {
    const lr = ratio(resolve(c.role, 'light', maps), resolve(c.ref, 'light', maps));
    const dr = ratio(resolve(c.role, 'dark', maps), resolve(c.ref, 'dark', maps));
    const spread = Math.abs(lr - dr);
    let status = 'ok';
    if (c.floor != null) {
      if (lr < c.floor) fails.push(`${c.role} LIGHT ${r2(lr)} < floor ${c.floor} (vs ${c.ref})`);
      if (dr < c.floor) fails.push(`${c.role} DARK ${r2(dr)} < floor ${c.floor} (vs ${c.ref})`);
    } else {
      const [lo, hi] = c.band;
      if (lr < lo || lr > hi) { fails.push(`${c.role} LIGHT ${r2(lr)} outside band [${lo}, ${hi}] (vs ${c.ref})`); status = 'FAIL'; }
      if (dr < lo || dr > hi) { fails.push(`${c.role} DARK ${r2(dr)} outside band [${lo}, ${hi}] (vs ${c.ref})`); status = 'FAIL'; }
      if (spread > MAX_SPREAD) { fails.push(`${c.role} spread |${r2(lr)}-${r2(dr)}|=${r2(spread)} > ${MAX_SPREAD} (vs ${c.ref})`); status = 'FAIL'; }
    }
    rows.push(`  ${c.role.padEnd(22)} vs ${c.ref.padEnd(13)} L=${r2(lr).toString().padStart(6)} D=${r2(dr).toString().padStart(6)} Δ=${r2(spread).toString().padStart(5)} ${c.floor != null ? `(floor ${c.floor})` : `[${c.band[0]}, ${c.band[1]}]`}`);
  }
  console.log('Contrast parity (WCAG ratio vs reference bg, per theme):');
  rows.forEach((r) => console.log(r));
  if (fails.length) {
    console.error('\nFAIL:');
    fails.forEach((f) => console.error('  - ' + f));
    console.error('\n  → adjust the offending theme\'s token to land in-band, or retune the band if the design intent changed.');
    process.exit(1);
  }
  console.log('\nPASS: text roles carry comparable contrast in light & dark.');
}

main();
