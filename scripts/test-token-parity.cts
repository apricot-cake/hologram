'use strict';
// Theme-parity guard for app/renderer/design-tokens.css.
//
// The token system is two parallel blocks: :root (light) + [data-theme="dark"].
// Per-theme SEMANTIC tokens (colors, shadows, panel hairline) MUST be defined in
// BOTH — if you add one to :root and forget dark, dark silently falls back to the
// light value (a "片テーマだけ変更" bug, e.g. white glass rims that vanish on light).
// This test fails when the two blocks drift, so the omission can't ship unnoticed.
//
// SHARED tokens (primitive color ramps + non-color structure + dynamic aliases)
// are intentionally defined ONCE in :root and are exempt.
//
// Run: node scripts/test-token-parity.cts   (exit 1 on mismatch)

const fs = require('node:fs');
const path = require('node:path');

const CSS = path.join(__dirname, '..', 'app', 'renderer', 'design-tokens.css');

// Tokens that legitimately live in :root only (not per-theme):
//  - primitive ramps (gray/blue/indigo/red/green/amber) + platform brand
//  - non-color structure: spacing/radius/control/type-scale/weight/leading/
//    tracking/font/easing/duration
//  - --ring (composes the per-theme --focus-ring dynamically) + legacy aliases
//    (--fg/--muted/… resolve to per-theme semantics via var(), so they flip too)
const SHARED_PREFIX = ['--gray-', '--blue-', '--indigo-', '--red-', '--green-', '--amber-', '--sky-', '--brand-', '--space-', '--radius-', '--control-', '--weight-', '--leading-', '--tracking-', '--font-', '--ease-', '--dur-'];
const SHARED_EXACT = new Set([
  '--text-2xs',
  '--text-xs',
  '--text-sm',
  '--text-base',
  '--text-md',
  '--text-lg',
  '--text-xl',
  '--text-2xl',
  '--text-3xl',
  '--text-4xl',
  '--tabbar-h',
  // Non-color layout constants (same in both themes, like --tabbar-h):
  '--scrollbar-w',
  '--activebar-h',
  '--window-controls-w',
  '--sidebar-float',
  '--ring',
  '--fg',
  '--fg-strong',
  '--muted',
  '--muted2',
  '--border-soft',
  // #136 materials over CONTENT (scrim solid + glass chrome): what's behind
  // them is arbitrary imagery, not the themed UI, so they are deliberately
  // theme-INDEPENDENT — defined once in :root. (--float-border stays
  // per-theme and is checked normally.)
  '--scrim-bg',
  '--scrim-ink',
  '--chrome-glass-bg',
  '--chrome-glass-blur',
  '--chrome-glass-rim',
  // Motion timing, theme-agnostic like --dur-*/--ease-* (just no --dur- prefix):
  // the card-entrance stagger step (34ms) is the same in both themes.
  '--stagger',
]);
const isShared = (n) => SHARED_EXACT.has(n) || SHARED_PREFIX.some((p) => n.startsWith(p));

function collect() {
  const raw = fs.readFileSync(CSS, 'utf8');
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, ''); // strip comments (avoid --x in prose)
  const light = new Set();
  const dark = new Set();
  // Declarations here never nest braces (color-mix/linear-gradient use parens), so a
  // flat "selector { body }" match is sufficient.
  const blockRe = /([^{}]+)\{([^{}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(css))) {
    const sel = m[1];
    const names = m[2].match(/--[a-z0-9-]+(?=\s*:)/gi) || [];
    if (/:root/.test(sel)) names.forEach((n) => light.add(n));
    if (/\[data-theme="dark"\]/.test(sel)) names.forEach((n) => dark.add(n));
  }
  return { light, dark };
}

function main() {
  const { light, dark } = collect();
  if (!light.size || !dark.size) {
    console.error(`FAIL: parse error (light=${light.size}, dark=${dark.size}) — selectors changed?`);
    process.exit(1);
  }
  // Forward: a per-theme light token missing its dark counterpart (the main bug).
  const missingInDark = [...light].filter((n) => !isShared(n) && !dark.has(n)).sort();
  // Reverse: a dark token with no light counterpart (light would fall back to nothing).
  const missingInLight = [...dark].filter((n) => !light.has(n)).sort();

  if (!missingInDark.length && !missingInLight.length) {
    const themed = [...dark].filter((n) => !isShared(n)).length;
    console.log(`PASS: light/dark token parity OK (${themed}+ per-theme tokens defined in both, ${light.size} light / ${dark.size} dark).`);
    return;
  }
  if (missingInDark.length) {
    console.error('FAIL: defined for LIGHT (:root) but missing the DARK ([data-theme="dark"]) value:');
    missingInDark.forEach((n) => console.error('  - ' + n));
    console.error('  → add the dark value, or (if truly theme-agnostic) add it to SHARED_* in this test.');
  }
  if (missingInLight.length) {
    console.error('FAIL: defined for DARK but missing the LIGHT (:root) value:');
    missingInLight.forEach((n) => console.error('  - ' + n));
  }
  process.exit(1);
}

main();
