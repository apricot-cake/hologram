// Theme-parity guard for app/src/renderer/design-tokens.css.
//
// The token system runs two parallel blocks: :root (light) and [data-theme="dark"]. Every
// per-theme semantic token (colors, shadows, panel hairlines) must be defined in both — if
// you add one to :root only and forget dark, dark silently falls back to the light value
// (the "only one theme got changed" bug — e.g. a white glass edge that vanishes in light
// mode). This test fails when the two blocks drift apart.
//
// Shared tokens (primitive color ramps, non-color structure, and dynamic aliases) are
// intentionally defined once in :root, and are out of scope here.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const CSS = path.join(import.meta.dirname, '..', 'app', 'src', 'renderer', 'design-tokens.css');

// Tokens that correctly live in :root only:
//  - primitive ramps (gray/blue/indigo/red/green/amber) + platform brand colors
//  - non-color structure: spacing/radius/control/type-scale/weight/leading/tracking/font/easing/duration
//  - --ring (dynamically composed from the per-theme --focus-ring) and legacy aliases
//    (--fg/--muted/… resolve to per-theme semantics via var(), so they flip along with it)
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
  // Non-color layout constants (same value in both themes, just like --tabbar-h)
  '--scrollbar-w',
  '--activebar-h',
  '--window-controls-w',
  '--inspector-w',
  '--sidebar-float',
  '--ring',
  '--fg',
  '--fg-strong',
  '--muted',
  '--muted2',
  '--border-soft',
  // #136 material that sits on top of content (opaque scrim + glass chrome): what's behind
  // it is an arbitrary image, not themed UI — intentionally theme-independent, placed once
  // in :root. (--float-border stays per-theme and is checked as usual.)
  '--scrim-bg',
  '--scrim-ink',
  '--chrome-glass-bg',
  '--chrome-glass-blur',
  '--chrome-glass-rim',
]);
const isShared = (n: string) => SHARED_EXACT.has(n) || SHARED_PREFIX.some((p) => n.startsWith(p));

function collect() {
  const css = fs.readFileSync(CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''); // strip comments (avoid picking up a --x inside prose)
  const light = new Set<string>();
  const dark = new Set<string>();

  // Declarations here don't nest curly braces (color-mix/linear-gradient use parens), so a
  // flat "selector { body }" match is enough.
  const blockRe = /([^{}]+)\{([^{}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(css))) {
    const names = m[2].match(/--[a-z0-9-]+(?=\s*:)/gi) || [];
    if (/:root/.test(m[1])) for (const n of names) light.add(n);
    if (/\[data-theme="dark"\]/.test(m[1])) for (const n of names) dark.add(n);
  }
  return { light, dark };
}

describe('design-tokens.css のライト/ダークパリティ', () => {
  const { light, dark } = collect();

  test('両ブロックとも読めている（セレクタが変わっていない）', () => {
    expect(light.size).toBeGreaterThan(0);
    expect(dark.size).toBeGreaterThan(0);
  });

  // The bug this is really targeting: a per-theme light token with no dark counterpart
  test('ライト(:root)にあってダークに無いテーマ別トークンは無い', () => {
    // If this fails: either add the dark-side value, or if it's genuinely theme-independent, add it to SHARED_*
    expect([...light].filter((n) => !isShared(n) && !dark.has(n)).sort()).toEqual([]);
  });

  // The reverse direction: exists in dark but not light (the light side would resolve to nothing)
  test('ダークにあってライトに無いトークンは無い', () => {
    expect([...dark].filter((n) => !light.has(n)).sort()).toEqual([]);
  });
});
