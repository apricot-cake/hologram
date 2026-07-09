'use strict';
// Contrast-PARITY guard for app/renderer/design-tokens.css.
//
// Sibling to test-token-parity.cts. That test proves a token is DEFINED in both
// themes; this one proves the COLOR PAIRS that carry meaning stay legible — and
// comparably so across light/dark — so you can't bump one theme and silently leave
// the other faint, and you can't retune a fill and silently break the text on it.
//
// Three categories (WCAG ratio = (L_light+0.05)/(L_dark+0.05), L = linearized RGB;
// colors resolved from the CSS itself per theme, so it checks SHIPPING values):
//
//  1. TEXT roles vs their background. High-end roles (--text/--text-strong) get a
//     FLOOR (both themes are "as dark/light as possible", exact equality is moot);
//     mid roles get a TARGET BAND both themes must sit inside (comparable contrast).
//  2. FOREGROUND-ON-FILL: text/ink that rides on a fill (white on a button, active
//     ink on the active pill). Correct today but silently breaks if the fill is
//     retuned (high drift risk) — floor = AA 4.5.
//  3. COMPONENT visibility on the sidebar (chip / active fill). Non-text boundary
//     on a gradient; light-on-light can't reach WCAG 3:1, so a softer "is it
//     distinguishable" floor. The component reads via EITHER fill OR border, so we
//     take the better of the two against the sidebar's worst-case point per theme.
//
// Run: node scripts/test-contrast-parity.cts   (exit 1 on out-of-band / floor miss)

const fs = require('node:fs');
const path = require('node:path');

const CSS = path.join(__dirname, '..', 'app', 'renderer', 'design-tokens.css');

// 1. role = text token; ref = the background it predominantly sits on.
const CHECKS = [
  { role: '--text', ref: '--surface', floor: 11 },
  { role: '--text-strong', ref: '--surface', floor: 13 },
  { role: '--text-muted', ref: '--surface', band: [4.5, 6.0] },
  { role: '--text-muted-strong', ref: '--sidebar-bg', band: [6.5, 8.0] },
  { role: '--text-subtle', ref: '--surface', band: [2.2, 3.6] },
  // Accent as FOREGROUND/text (links, hover labels, active ink, accent icons) via
  // the dedicated --accent-text token (--accent itself is a fill, too dark as text
  // on dark = 2.88:1). Must clear AA in both themes.
  { role: '--accent-text', ref: '--surface', floor: 4.5 },
  // Status hue as foreground (delete labels, error text). Held to the 3:1 status/
  // icon tier, NOT 4.5 body-text — a saturated red is distinct and is only used for
  // short action labels/icons (light --danger is 3.91, fine at this tier; the guard
  // catches a future drift below 3:1).
  { role: '--danger', ref: '--surface', floor: 3.0 },
];
// Cross-theme spread cap for band roles.
const MAX_SPREAD = 1.6;

// 2. foreground that rides on a fill — breaks if the fill drifts. Floor = AA.
const FILL_CHECKS = [
  // Accent floor = 3.0 (icon/large-text tier), not the 4.5 text tier: the sky brand
  // accent is deliberately light (DESIGN.md「水色アクセント」注意書き), and per its
  //「弱ければ塗りだけ一段濃く」clause dark moved sky-500→sky-600 to clear this tier
  // (both themes 3.32 — user decision 2026-07-02).
  { fg: '--accent-fg', fill: '--accent', floor: 3.0, what: 'white text on accent button' },
  { fg: '--accent-subtle-fg', fill: '--accent-subtle', floor: 4.5, what: 'active ink on active pill' },
  // White ICONS on status fills (.ws-btn remove). Icon tier = 3:1, not 4.5.
  // (The --success token and its "added" check died with 7481710 — the clip
  // button is色反転 now, and nothing defines or uses --success anymore.)
  { fg: '--text-on-accent', fill: '--danger', floor: 3.0, what: 'white icon on danger (remove) button' },
];

// 3. non-text component visible on the sidebar (reads via fill OR border). Soft
// floor: catches the "dissolved into the Mica" regressions (those measured ~1.0)
// while allowing the legitimately-subtle raised dark pills. Per-theme worst-case
// sidebar point: light = gradient bottom (darkest), dark = sidebar base (lightest
// point a dark chip sits on).
const COMPONENT_CHECKS = [
  { name: 'chip', fill: '--chip-bg', border: '--chip-border', floor: 1.2 },
  { name: 'active fill', fill: '--accent-subtle', border: '--accent-subtle', floor: 1.2 },
];
// Sidebar is a single flat colour now (the vertical gradient was retired), so the
// worst-case sidebar point in light is just --sidebar-bg (was --sidebar-grad-bot).
const SIDEBAR_REF = { light: '--sidebar-bg', dark: '--sidebar-bg' };

// ---- CSS parse: merge every :root block -> light map, every dark block -> dark map.
function parse() {
  const raw = fs.readFileSync(CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const light = new Map(),
    dark = new Map();
  const blockRe = /([^{}]+)\{([^{}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(raw))) {
    const sel = m[1];
    const target = /\[data-theme="dark"\]/.test(sel) ? dark : /:root/.test(sel) ? light : null;
    if (!target) continue;
    const declRe = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
    let d: RegExpExecArray | null;
    while ((d = declRe.exec(m[2]))) target.set(d[1], d[2].trim());
  }
  return { light, dark };
}

// ---- resolve a custom prop to an [r,g,b] in a given theme (follow var() chains).
function resolve(name, theme, maps, seen = new Set()) {
  if (seen.has(name)) throw new Error('var() cycle at ' + name);
  seen.add(name);
  const map = theme === 'dark' && maps.dark.has(name) ? maps.dark : maps.light;
  const v = map.get(name);
  if (v == null) throw new Error(`unresolved ${name} (${theme})`);
  const varM = v.match(/^var\((--[a-z0-9-]+)\)$/i);
  if (varM) return resolve(varM[1], theme, maps, seen);
  return toRGB(v, name);
}
function toRGB(v, ctx) {
  let m = v.match(/^#([0-9a-f]{6})$/i);
  if (m) return [0, 2, 4].map((i) => Number.parseInt(m[1].slice(i, i + 2), 16));
  m = v.match(/^#([0-9a-f]{3})$/i);
  if (m) return [0, 1, 2].map((i) => Number.parseInt(m[1][i] + m[1][i], 16));
  m = v.match(/^rgba?\(([^)]+)\)$/i);
  if (m)
    return m[1]
      .split(',')
      .slice(0, 3)
      .map((s) => Number.parseFloat(s));
  throw new Error(`not a plain color: "${v}" (${ctx}) — contrast inputs must resolve to hex/rgb, not color-mix`);
}

const lin = (c) => {
  c /= 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const L = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => {
  const la = L(a) + 0.05,
    lb = L(b) + 0.05;
  return Math.max(la, lb) / Math.min(la, lb);
};
const r2 = (n) => Math.round(n * 100) / 100;

function main() {
  const maps = parse();
  const fails: any[] = [];
  const rows: any[] = [];

  // 1. text roles vs bg
  for (const c of CHECKS) {
    const lr = ratio(resolve(c.role, 'light', maps), resolve(c.ref, 'light', maps));
    const dr = ratio(resolve(c.role, 'dark', maps), resolve(c.ref, 'dark', maps));
    const spread = Math.abs(lr - dr);
    if (c.floor != null) {
      if (lr < c.floor) fails.push(`${c.role} LIGHT ${r2(lr)} < floor ${c.floor} (vs ${c.ref})`);
      if (dr < c.floor) fails.push(`${c.role} DARK ${r2(dr)} < floor ${c.floor} (vs ${c.ref})`);
    } else {
      const [lo, hi] = c.band;
      if (lr < lo || lr > hi) fails.push(`${c.role} LIGHT ${r2(lr)} outside band [${lo}, ${hi}] (vs ${c.ref})`);
      if (dr < lo || dr > hi) fails.push(`${c.role} DARK ${r2(dr)} outside band [${lo}, ${hi}] (vs ${c.ref})`);
      if (spread > MAX_SPREAD) fails.push(`${c.role} spread |${r2(lr)}-${r2(dr)}|=${r2(spread)} > ${MAX_SPREAD} (vs ${c.ref})`);
    }
    rows.push(`  ${c.role.padEnd(22)} vs ${c.ref.padEnd(15)} L=${r2(lr).toString().padStart(6)} D=${r2(dr).toString().padStart(6)} ${c.floor != null ? `(floor ${c.floor})` : `[${c.band[0]}, ${c.band[1]}] Δ=${r2(spread)}`}`);
  }
  // 2. foreground-on-fill
  for (const c of FILL_CHECKS) {
    const lr = ratio(resolve(c.fg, 'light', maps), resolve(c.fill, 'light', maps));
    const dr = ratio(resolve(c.fg, 'dark', maps), resolve(c.fill, 'dark', maps));
    if (lr < c.floor) fails.push(`${c.fg} on ${c.fill} LIGHT ${r2(lr)} < floor ${c.floor} (${c.what})`);
    if (dr < c.floor) fails.push(`${c.fg} on ${c.fill} DARK ${r2(dr)} < floor ${c.floor} (${c.what})`);
    rows.push(`  ${(c.fg + ' on ' + c.fill).padEnd(40)} L=${r2(lr).toString().padStart(6)} D=${r2(dr).toString().padStart(6)} (floor ${c.floor})`);
  }
  // 3. component visibility on the sidebar (best of fill/border vs worst-case sidebar)
  for (const c of COMPONENT_CHECKS) {
    const best = (theme) => {
      const ref = resolve(SIDEBAR_REF[theme], theme, maps);
      return Math.max(ratio(resolve(c.fill, theme, maps), ref), ratio(resolve(c.border, theme, maps), ref));
    };
    const lr = best('light'),
      dr = best('dark');
    if (lr < c.floor) fails.push(`component "${c.name}" LIGHT ${r2(lr)} < floor ${c.floor} (best of fill/border vs ${SIDEBAR_REF.light})`);
    if (dr < c.floor) fails.push(`component "${c.name}" DARK ${r2(dr)} < floor ${c.floor} (best of fill/border vs ${SIDEBAR_REF.dark})`);
    rows.push(`  ${('component:' + c.name).padEnd(40)} L=${r2(lr).toString().padStart(6)} D=${r2(dr).toString().padStart(6)} (floor ${c.floor}, best fill/border)`);
  }

  console.log('Contrast parity (WCAG ratio, per theme):');
  rows.forEach((r) => console.log(r));
  if (fails.length) {
    console.error('\nFAIL:');
    fails.forEach((f) => console.error('  - ' + f));
    console.error("\n  → adjust the offending theme's token to clear the floor/band, or retune the threshold if intent changed.");
    process.exit(1);
  }
  console.log('\nPASS: text, foreground-on-fill, and component contrasts hold in light & dark.');
}

main();
