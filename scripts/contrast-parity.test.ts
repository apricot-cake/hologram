// Contrast "parity" guard for app/src/renderer/design-tokens.css.
//
// Sibling of token-parity.test.ts. That one checks "are the tokens defined for both themes",
// this one checks "do the color pairings that carry meaning stay readable, and are they
// comparable between light and dark" — so you can't darken one theme while leaving the other
// pale, and you can't tweak a fill without breaking the text on top of it.
//
// 3 categories (WCAG ratio = (L_lighter+0.05)/(L_darker+0.05), L is linearized RGB. Colors are
// resolved per-theme from the CSS itself, so this inspects the actual shipped values):
//
//  1. Text role vs background. Top-tier roles (--text/--text-strong) get only a floor (since
//     both themes aim for "as dark/light as possible," an exact match would be meaningless).
//     Mid-tier roles get a target band both themes should land in (i.e. comparable contrast).
//  2. Foreground sitting on top of a fill (white text on a button, ink on an active pill).
//     Correct today, but silently breaks if the fill is retuned (easy to drift) — floor is AA 4.5.
//  3. Component visibility on the sidebar (chip / active fill). Non-text borders sit on a
//     gradient, so light-on-light doesn't reach WCAG 3:1 — use a looser "can you tell it apart"
//     floor instead. A component is legible via either its fill or its border, so take the
//     better of the two against each theme's worst-case point.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const CSS = path.join(import.meta.dirname, '..', 'app', 'src', 'renderer', 'design-tokens.css');

type Theme = 'light' | 'dark';

// 1. role = text token / ref = the background it mainly sits on
const CHECKS: { role: string; ref: string; floor?: number; band?: [number, number] }[] = [
  { role: '--text', ref: '--surface', floor: 11 },
  { role: '--text-strong', ref: '--surface', floor: 13 },
  { role: '--text-muted', ref: '--surface', band: [4.5, 6.0] },
  { role: '--text-muted-strong', ref: '--sidebar-bg', band: [6.5, 8.0] },
  { role: '--text-subtle', ref: '--surface', band: [2.2, 3.6] },
  // Paths that use the accent color as a foreground/text (links, hover labels, active ink,
  // accent-colored icons) go through the dedicated --accent-text instead (--accent itself is a
  // fill and is too dark as text in dark mode — 2.88:1). Must clear AA in both themes.
  { role: '--accent-text', ref: '--surface', floor: 4.5 },
  // Paths that use a status color as a foreground (delete labels, error text). Judged against
  // the status/icon 3:1 tier rather than the body-text 4.5 — a saturated red is easy to tell
  // apart and is only ever used for short action labels and icons (light --danger is 3.91,
  // which clears this tier; if it ever drops below 3:1, this test catches it).
  { role: '--danger', ref: '--surface', floor: 3.0 },
];
// Upper bound on the cross-theme spread for band-checked roles
const MAX_SPREAD = 1.6;

// 2. Foreground sitting on top of a fill — breaks if the fill drifts. Floor is AA.
const FILL_CHECKS = [
  // Accent's floor is 3.0 (icon/large-text tier), not 4.5: the sky-blue brand accent is
  // intentionally light (see the "sky-blue accent" note in DESIGN.md). Per the "if it's weak,
  // just deepen the fill" rule, dark mode was moved from sky-500 to sky-600 to clear this tier
  // (3.32 in both themes — 2026-07-02 user decision).
  { fg: '--accent-fg', fill: '--accent', floor: 3.0, what: 'アクセントボタン上の白文字' },
  { fg: '--accent-subtle-fg', fill: '--accent-subtle', floor: 4.5, what: 'アクティブ pill 上のインク' },
  // White icon sitting on a status fill (.ws-btn remove). Icon tier = 3:1.
  { fg: '--text-on-accent', fill: '--danger', floor: 3.0, what: 'danger（削除）ボタン上の白アイコン' },
];

// 3. Non-text components that need to be visible on the sidebar (read via fill or border). A
// loose floor catches "melted into the Mica" regressions (measured ~1.0) while still passing a
// legitimately subtle floating pill in dark mode. Each theme's worst-case point on the sidebar:
// light is the bottom of the gradient (darkest), dark is the sidebar base color (the lightest
// point among the dark chips sitting on it).
const COMPONENT_CHECKS = [
  { name: 'chip', fill: '--chip-bg', border: '--chip-border', floor: 1.2 },
  { name: 'active fill', fill: '--accent-subtle', border: '--accent-subtle', floor: 1.2 },
];
// The sidebar is now a flat color (the vertical gradient was removed), so light mode's
// worst-case point is also --sidebar-bg (it used to be --sidebar-grad-bot).
const SIDEBAR_REF: Record<Theme, string> = { light: '--sidebar-bg', dark: '--sidebar-bg' };

// ---- CSS parsing: merge all :root blocks into light, all dark blocks into dark
function parse() {
  const raw = fs.readFileSync(CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const light = new Map<string, string>();
  const dark = new Map<string, string>();
  const blockRe = /([^{}]+)\{([^{}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(raw))) {
    const target = /\[data-theme="dark"\]/.test(m[1]) ? dark : /:root/.test(m[1]) ? light : null;
    if (!target) continue;
    const declRe = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
    let d: RegExpExecArray | null;
    while ((d = declRe.exec(m[2]))) target.set(d[1], d[2].trim());
  }
  return { light, dark };
}

const maps = parse();

// ---- Resolve a custom property down to [r,g,b] for the given theme (follows var() chains)
function resolve(name: string, theme: Theme, seen = new Set<string>()): number[] {
  if (seen.has(name)) throw new Error(`var() cycle at ${name}`);
  seen.add(name);
  const map = theme === 'dark' && maps.dark.has(name) ? maps.dark : maps.light;
  const v = map.get(name);
  if (v == null) throw new Error(`unresolved ${name} (${theme})`);
  const varM = v.match(/^var\((--[a-z0-9-]+)\)$/i);
  return varM ? resolve(varM[1], theme, seen) : toRGB(v, name);
}

function toRGB(v: string, ctx: string): number[] {
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

const lin = (c: number) => {
  const x = c / 255;
  return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
const L = ([r, g, b]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a: number[], b: number[]) => {
  const la = L(a) + 0.05;
  const lb = L(b) + 0.05;
  return Math.max(la, lb) / Math.min(la, lb);
};

const THEMES: Theme[] = ['light', 'dark'];

describe('文字ロール vs 背景', () => {
  const floors = CHECKS.filter((c) => c.floor != null);
  const bands = CHECKS.filter((c) => c.band != null);

  test.each(floors.flatMap((c) => THEMES.map((theme) => [c.role, c.ref, theme, c.floor] as const)))('%s on %s (%s) は下限 %d 以上', (role, ref, theme, floor) => {
    expect(ratio(resolve(role, theme), resolve(ref, theme))).toBeGreaterThanOrEqual(floor);
  });

  test.each(bands.flatMap((c) => THEMES.map((theme) => [c.role, c.ref, theme, c.band] as const)))('%s on %s (%s) は目標帯の中', (role, ref, theme, band) => {
    const r = ratio(resolve(role, theme), resolve(ref, theme));
    expect(r).toBeGreaterThanOrEqual(band[0]);
    expect(r).toBeLessThanOrEqual(band[1]);
  });

  test.each(bands.map((c) => [c.role, c.ref] as const))('%s on %s のライト/ダーク差が開きすぎない', (role, ref) => {
    const [lr, dr] = THEMES.map((theme) => ratio(resolve(role, theme), resolve(ref, theme)));
    expect(Math.abs(lr - dr)).toBeLessThanOrEqual(MAX_SPREAD);
  });
});

describe('塗りの上に乗る前景', () => {
  test.each(FILL_CHECKS.flatMap((c) => THEMES.map((theme) => [c.what, theme, c.fg, c.fill, c.floor] as const)))('%s (%s): %s on %s が下限 %d 以上', (_what, theme, fg, fill, floor) => {
    expect(ratio(resolve(fg, theme), resolve(fill, theme))).toBeGreaterThanOrEqual(floor);
  });
});

describe('サイドバー上での部品の視認性（塗り/枠線の良い方）', () => {
  test.each(COMPONENT_CHECKS.flatMap((c) => THEMES.map((theme) => [c.name, theme, c.fill, c.border, c.floor] as const)))('%s (%s)', (_name, theme, fill, border, floor) => {
    const ref = resolve(SIDEBAR_REF[theme], theme);
    const best = Math.max(ratio(resolve(fill, theme), ref), ratio(resolve(border, theme), ref));
    expect(best).toBeGreaterThanOrEqual(floor);
  });
});
