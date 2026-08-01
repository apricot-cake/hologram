// Guard for the extension's design tokens (#270).
//
// extension/utils/tokens.generated.css, generated with the app's globals.css as
// source of truth, is checked for: (1) whether it was hand-edited (2) whether
// the extension's code only references tokens that actually exist (3) whether
// hardcoded colors have crept back into the extension side (4) whether it's
// readable across both themes x 4 reference backdrops.
//
// (4) is the main point. Since the extension's surfaces sit on top of **any
// page**, not "a background the app chose", a combination that works fine
// inside the app (like a hairline border close to the surface color) doesn't
// necessarily work as-is out there. Four reference backdrops are fixed — pure
// black, X's dim theme, pixiv's dark theme, and white — and the numeric bars
// "borders need 3:1 against both the backdrop and the fill" and "body text needs 4.5:1" are enforced.
//
// Semi-transparent tokens are measured after compositing over the backdrop =
// small controls that sit on top of images have to satisfy the body-text tier
// against both worst cases (an all-black photo / an all-white photo).

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { generatedActionBadge } from '../extension/utils/tokens.generated.ts';
import { build, OUT_CSS, OUT_TS, parseColor } from './gen-extension-tokens.cts';

const ROOT = path.join(import.meta.dirname, '..');
const EXT = path.join(ROOT, 'extension');

const { tokens, css, ts } = build();
const light = new Map(tokens.map((t: any) => [t.name, t.light as string]));
const dark = new Map(tokens.map((t: any) => [t.name, t.dark as string]));

// === color calculations ===============================================================

interface Rgb {
  r: number;
  g: number;
  b: number;
}

const rgb = (value: string): Rgb => {
  const c = parseColor(value);
  if (!c) throw new Error(`色として読めない: ${value}`);
  if (c.a < 1) throw new Error(`不透明な色が要る場所に半透明が来た: ${value}`);
  return c;
};

// Composites a semi-transparent color over a backdrop (source-over).
const over = (value: string, bg: Rgb): Rgb => {
  const c = parseColor(value);
  if (!c) throw new Error(`色として読めない: ${value}`);
  return {
    r: Math.round(c.r * c.a + bg.r * (1 - c.a)),
    g: Math.round(c.g * c.a + bg.g * (1 - c.a)),
    b: Math.round(c.b * c.a + bg.b * (1 - c.a)),
  };
};

const luminance = ({ r, g, b }: Rgb): number => {
  const lin = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
};

const ratio = (a: Rgb, b: Rgb): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2));
};

// The 4 reference backdrops. The extension's surfaces must hold up "on top of all four" of these
// (the user's browser theme and the light/dark mode of the site they're viewing are decided independently).
const HOSTS: Record<string, Rgb> = {
  純黒: { r: 0, g: 0, b: 0 },
  'X dim': { r: 21, g: 32, b: 43 },
  'pixiv dark': { r: 31, g: 31, b: 31 },
  白: { r: 255, g: 255, b: 255 },
};

const THEMES: [string, Map<string, string>][] = [
  ['light', light],
  ['dark', dark],
];

// === (1) is the generated artifact up to date =========================================================

describe('生成物', () => {
  test('tokens.generated.css は入力と一致している（手編集・生成漏れが無い）', () => {
    // If this fails: node scripts/gen-extension-tokens.cts
    expect(fs.readFileSync(OUT_CSS, 'utf8')).toBe(css);
  });

  // Put the TS-side generated artifact through the same check too (#269).
  // Warning: without this, the moment tokens.generated.ts is excluded from the
  // "hardcoded color" check below, this file alone becomes free to hand-edit =
  // the badge's color could drift from the app's tokens without anyone noticing.
  test('tokens.generated.ts は入力と一致している', () => {
    expect(fs.readFileSync(OUT_TS, 'utf8')).toBe(ts);
  });

  test('ライトに無くダークにだけある値は無い', () => {
    expect([...dark.keys()].filter((n) => !light.has(n))).toEqual([]);
  });
});

// === (2)(3) fitting together with the extension code ==============================================

// The token input (the extension-specific definitions) and the generated
// artifact itself are out of scope = these are the two files where having
// color literals is correct. The other .css files are the component sheet
// that came in with #44, and since that's where the state->color mapping now
// lives, excluding it from the scan would make the "unused token" judgment a lie.
const TOKEN_FILES = new Set(['tokens.source.css', 'tokens.generated.css']);

const SOURCES = [
  ...fs
    .readdirSync(path.join(EXT, 'utils'))
    .filter((f) => (f.endsWith('.ts') || f.endsWith('.css')) && !TOKEN_FILES.has(f))
    .map((f) => path.join('utils', f)),
  ...fs.readdirSync(path.join(EXT, 'entrypoints')).map((f) => path.join('entrypoints', f)),
  ...fs.readdirSync(path.join(EXT, 'pages')).map((f) => path.join('pages', f)),
].filter((f) => /\.(ts|html|css)$/.test(f));

const read = (rel: string) => fs.readFileSync(path.join(EXT, rel), 'utf8');

describe('拡張コードとの噛み合わせ', () => {
  test('参照している --hologram-* は全て生成されている', () => {
    const dangling: string[] = [];
    for (const rel of SOURCES) {
      for (const [, name] of read(rel).matchAll(/(--hologram-[\w-]+)/g)) {
        if (!light.has(name)) dangling.push(`${rel}: ${name}`);
      }
    }
    expect([...new Set(dangling)].sort()).toEqual([]);
  });

  test('生成されたトークンは全て使われている（使われない値を配らない）', () => {
    const used = new Set<string>();
    for (const rel of SOURCES) for (const [, name] of read(rel).matchAll(/(--hologram-[\w-]+)/g)) used.add(name);
    expect([...light.keys()].filter((n) => !used.has(n)).sort()).toEqual([]);
  });

  // #270's acceptance criterion: the only place color literals belong on the extension side is the token source and the generated artifact.
  test('拡張のコードに色のベタ書きが無い', () => {
    // White and black aren't made exceptions: "white must be safe" has been the
    // entry point for the bug of putting white on a white surface in the light
    // theme (the kind of bug #136 was supposed to have wiped out — only one theme breaks).
    const COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|color-mix)\s*\(/g;
    const offenders: string[] = [];
    // Keep the generated .ts in SOURCES, and only exclude it from this
    // particular check = the toolbar badge (#269) draws from already-resolved
    // color strings since a service worker can't pass var(), so it's correct
    // for the generated artifact to have color literals. Excluding it from
    // SOURCES would make the tokens only this generated file names (the 4
    // motion tokens) fall over into "unused".
    for (const rel of SOURCES.filter((f) => path.basename(f) !== 'tokens.generated.ts')) {
      const text = read(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        // Strip HTML comments too = the extension pages' .html files have a
        // third comment style. Without stripping it, the issue number (`#269`)
        // would trip as a hex color, failing with a message that reads like "a color was hardcoded".
        .replace(/<!--[\s\S]*?-->/g, '');
      for (const [hit] of text.matchAll(COLOR)) offenders.push(`${rel}: ${hit}`);
    }
    expect(offenders.sort()).toEqual([]);
  });
});

// === (4) contrast ==========================================================

describe.each(THEMES)('コントラスト（%s テーマ）', (_name, v) => {
  const surface = () => rgb(v.get('--hologram-surface') as string);

  test('本文のインクがカード上で 4.5:1 以上', () => {
    expect(ratio(rgb(v.get('--hologram-ink') as string), surface())).toBeGreaterThanOrEqual(4.5);
  });

  test('補助テキストがカード上で 4.5:1 以上', () => {
    expect(ratio(rgb(v.get('--hologram-ink-muted') as string), surface())).toBeGreaterThanOrEqual(4.5);
  });

  test.each(Object.entries(HOSTS))('カードの輪郭が %s の上で 3:1 以上（対下地・対塗りとも）', (_host, bg) => {
    const border = rgb(v.get('--hologram-overlay-border') as string);
    expect(ratio(border, bg)).toBeGreaterThanOrEqual(3);
    expect(ratio(border, surface())).toBeGreaterThanOrEqual(3);
  });

  // Alt+S's selection frame and the drag-in-progress outline. Since these sit
  // directly on the page rather than on a card, they must be visible against all 4 backdrops.
  test.each(Object.entries(HOSTS))('選択フレームのアクセントが %s の上で 3:1 以上', (_host, bg) => {
    expect(ratio(rgb(v.get('--hologram-accent') as string), bg)).toBeGreaterThanOrEqual(3);
  });

  test('アクセントの塗りに乗るアイコンが 4.5:1 以上', () => {
    expect(ratio(rgb(v.get('--hologram-on-accent') as string), rgb(v.get('--hologram-accent') as string))).toBeGreaterThanOrEqual(4.5);
  });

  // The dashed ring during a drag is the accent color itself = it must be visible on top of a card.
  test('アクセントがカードの上で 3:1 以上', () => {
    expect(ratio(rgb(v.get('--hologram-accent') as string), surface())).toBeGreaterThanOrEqual(3);
  });

  test.each([
    ['success', '--hologram-success', '--hologram-on-success'],
    ['warning', '--hologram-warning', '--hologram-on-warning'],
    ['danger', '--hologram-danger', '--hologram-on-danger'],
  ])('%s: 塗りの上のグリフが 4.5:1 以上、塗り自体がカードと 3:1 以上', (_what, fillName, inkName) => {
    const fill = rgb(v.get(fillName) as string);
    expect(ratio(rgb(v.get(inkName) as string), fill)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(fill, surface())).toBeGreaterThanOrEqual(3);
  });

  // The fill of a small control's (the save button's) hover state. Since it
  // uses the same surface as the card, the ink must stay readable even when the surface changes on hover.
  test('ホバー時の面の上でもインクが 4.5:1 以上', () => {
    expect(ratio(rgb(v.get('--hologram-ink') as string), rgb(v.get('--hologram-hover') as string))).toBeGreaterThanOrEqual(4.5);
  });

  // The saved mark and the saving-in-progress surface are semi-transparent =
  // since the backdrop is "any photo", they must satisfy the body-text tier at
  // both worst-case extremes (an all-black photo / an all-white photo). This is
  // what sets the upper bound on alpha = the more see-through it is, the more
  // the backdrop bleeds in, and eventually the text becomes unreadable.
  test.each([
    ['真っ黒な写真', { r: 0, g: 0, b: 0 }],
    ['真っ白な写真', { r: 255, g: 255, b: 255 }],
  ] as [string, Rgb][])('保存済みマークのグリフが %s の上で 4.5:1 以上', (_what, photo) => {
    const disc = over(v.get('--hologram-control-surface') as string, photo);
    expect(ratio(rgb(v.get('--hologram-ink') as string), disc)).toBeGreaterThanOrEqual(4.5);
  });

  // The hover save button also sits on the same semi-transparent disc (user's
  // call, 2026-07-29). Since hover only lifts the color, the glyph must stay
  // readable at that lifted color too.
  test.each([
    ['真っ黒な写真', { r: 0, g: 0, b: 0 }],
    ['真っ白な写真', { r: 255, g: 255, b: 255 }],
  ] as [string, Rgb][])('ホバー中の保存ボタンのグリフが %s の上で 4.5:1 以上', (_what, photo) => {
    const disc = over(v.get('--hologram-control-surface-hover') as string, photo);
    expect(ratio(rgb(v.get('--hologram-ink') as string), disc)).toBeGreaterThanOrEqual(4.5);
  });

  // Since the ring is inside the card, the backdrop is the card's fill, not the host page.
  test('ドロップ先の破線リングがカードの上で 3:1 以上', () => {
    expect(ratio(over(v.get('--hologram-ring') as string, surface()), surface())).toBeGreaterThanOrEqual(3);
  });
});

// === (5) the toolbar badge (#269) ============================================

// The only surface the browser itself draws = since a service worker has no
// way to query the theme, the light row's values go straight to the toolbar
// for both themes as-is. Since the circle is filled solid with that value (the
// toolbar's color doesn't show through), all that needs to hold is the "fill vs. text" pair.
describe('ツールバーのバッジ', () => {
  const badge = generatedActionBadge as { background: string; text: string };

  test('文字が塗りの上で 4.5:1 以上', () => {
    expect(ratio(rgb(badge.text), rgb(badge.background))).toBeGreaterThanOrEqual(4.5);
  });

  test('生成された値はライトの danger 対そのもの（手で置き換えられていない）', () => {
    expect(badge.background).toBe(light.get('--hologram-danger'));
    expect(badge.text).toBe(light.get('--hologram-on-danger'));
  });
});
