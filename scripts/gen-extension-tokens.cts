'use strict';

// Generates the extension's colour/typography/motion tokens from the app's own
// design tokens (#270), so the two never drift by hand-copied literals again.
//
//   node scripts/gen-extension-tokens.cts            write extension/utils/tokens.generated.css
//   node scripts/gen-extension-tokens.cts --check    exit 1 if the file on disk is stale
//
// SOURCE OF TRUTH — app/src/renderer/src/globals.css, the sheet the redesign
// actually renders from (Tailwind v4 @theme + shadcn base-nova). NOT the
// pre-redesign design-tokens.css: its --accent is still the sky ramp #114
// rejected, and its motion values predate the redesign's, so generating from it
// would pipe a retired generation of the design language into a second runtime.
//
// Two inputs, one output:
//   1. globals.css          — everything the app has an opinion about
//   2. tokens.source.css    — the few things only the extension needs, because
//                             its surfaces sit on an ARBITRARY host page rather
//                             than on the app's own background (see that file)
//
// The extraction is a real CSS parse (postcss), not a regex: `var()` chains,
// comments containing `--foo`, and multi-selector rules all have to resolve the
// way a browser resolves them, and each of those is a way a regex quietly reads
// the wrong value.
//
// Values are RESOLVED to sRGB rather than passed through as oklch(). The
// generated file is a checked-in artifact humans review, and `#171717` says what
// changed where `oklch(0.205 0 0)` does not; resolving also lets the contrast
// guard (scripts/extension-tokens.test.ts) be a plain unit test instead of
// needing a colour library or a browser. The conversion below is the CSS Color 4
// matrix pair, checked against Chrome's own rasterisation for every value this
// repo ships — 0/255 channel difference on all of them (2026-07-29).

const fs = require('node:fs');
const path = require('node:path');
const postcss = require('postcss');

const ROOT = path.join(__dirname, '..');
const APP_CSS = path.join(ROOT, 'app', 'src', 'renderer', 'src', 'globals.css');
const EXT_CSS = path.join(ROOT, 'extension', 'utils', 'tokens.source.css');
const OUT_CSS = path.join(ROOT, 'extension', 'utils', 'tokens.generated.css');
const OUT_TS = path.join(ROOT, 'extension', 'utils', 'tokens.generated.ts');

// The motion values, generated a SECOND time as TypeScript. Everything the
// extension draws reads its tokens through var(), but the entrance/exit pops go
// through Web Animations, whose `duration` is a number of milliseconds and
// cannot take a custom property. Emitting them keeps one source of truth for the
// motion tone rather than leaving two numbers to drift.
const MOTION_MS = ['--hologram-duration-base', '--hologram-duration-fast'];
const MOTION_EASE = ['--hologram-ease-out', '--hologram-ease-in'];

// The allowlist. Everything the extension gets from the app is named here, so
// adding a token to globals.css never silently widens what crosses the border,
// and the mapping doubles as the record of which app role each extension
// surface is claiming to be.
interface AppToken {
  out: string;
  from: string;
  why: string;
}
const FROM_APP: AppToken[] = [
  // --- the floating surface the on-page UI is made of -----------------------
  // popover, not card: this is a transient layer the extension raises over
  // someone else's page, which is what --popover names in shadcn.
  { out: '--hologram-surface', from: '--popover', why: 'on-page card / banner / drop-zone fill' },
  { out: '--hologram-ink', from: '--popover-foreground', why: 'label + glyph ink on that fill' },
  { out: '--hologram-ink-muted', from: '--ui-muted-foreground', why: 'secondary explanatory text' },
  // --- the extension's own pages (options.html / diag.html) ----------------
  { out: '--hologram-page-bg', from: '--background', why: 'extension page background' },
  { out: '--hologram-page-surface', from: '--card', why: 'raised block on an extension page' },
  { out: '--hologram-ink-strong', from: '--foreground', why: 'headings' },
  { out: '--hologram-border', from: '--ui-border', why: 'structural hairline INSIDE an extension page' },
  { out: '--hologram-border-strong', from: '--input', why: 'the same, one step heavier' },
  { out: '--hologram-hover', from: '--ui-accent', why: 'generic hover surface (menu/list rows)' },
  { out: '--hologram-active', from: '--secondary', why: 'pressed/active surface' },
  { out: '--hologram-focus-ring', from: '--ui-ring', why: 'keyboard focus ring' },
  // --- state -------------------------------------------------------------
  // #114 / ADR 0013 scopes the product accent to selection and active state
  // and keeps it off CTAs and standing chrome. Both extension uses are exactly
  // that: the Alt+S highlight frame IS the selection indicator, and the
  // drop-zone's drag-over is an active state.
  { out: '--hologram-accent', from: '--ui-selected', why: 'selection frame + drag-over' },
  { out: '--hologram-danger', from: '--destructive', why: 'save failed' },
  // --- non-colour ---------------------------------------------------------
  { out: '--hologram-radius', from: '--radius', why: 'corner radius' },
  { out: '--hologram-duration-base', from: '--motion-duration-base', why: 'enter / state change' },
  { out: '--hologram-duration-fast', from: '--motion-duration-fast', why: 'exit / micro-feedback' },
  { out: '--hologram-ease-out', from: '--motion-ease-out', why: 'enter curve' },
  { out: '--hologram-ease-in', from: '--motion-ease-in', why: 'exit curve' },
];

// Deliberately NOT taken from the app:
//   --font-sans (= 'Geist Variable') — a bundled webfont with no Japanese
//   coverage. Shipping it onto host pages would mean a web_accessible_resource
//   @font-face on every site, and the banner strings are Japanese-primary, so
//   every label would mix two type designs mid-sentence. The extension keeps a
//   system stack; see tokens.source.css.

type Theme = 'light' | 'dark';
type Decls = Map<string, string>;

// ---------------------------------------------------------------------------
// colour
// ---------------------------------------------------------------------------

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function encodeGamma(x: number): number {
  const a = Math.abs(x);
  const v = a <= 0.0031308 ? 12.92 * a : 1.055 * a ** (1 / 2.4) - 0.055;
  return Math.sign(x) * v;
}

// oklch -> sRGB (CSS Color 4 §12.3 + the OKLab->linear-sRGB matrix). Out-of-gamut
// results are clipped per channel, which is what Chrome does for these values.
function oklchToRgb(L: number, C: number, hDeg: number): { r: number; g: number; b: number } {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l3 = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m3 = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s3 = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3, -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3, -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3].map((v) => Math.max(0, Math.min(255, Math.round(encodeGamma(v) * 255))));
  return { r: linear[0], g: linear[1], b: linear[2] };
}

const alphaOf = (raw: string | undefined): number => {
  if (raw === undefined) return 1;
  const t = raw.trim();
  const n = t.endsWith('%') ? Number.parseFloat(t) / 100 : Number.parseFloat(t);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
};

function parseColor(value: string): Rgba | null {
  const v = value.trim();

  const oklch = /^oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+%?)\s*)?\)$/i.exec(v);
  if (oklch) {
    const pct = (s: string) => (s.endsWith('%') ? Number.parseFloat(s) / 100 : Number.parseFloat(s));
    const { r, g, b } = oklchToRgb(pct(oklch[1]), pct(oklch[2]), Number.parseFloat(oklch[3]));
    return { r, g, b, a: alphaOf(oklch[4]) };
  }

  const hex = /^#([0-9a-f]{3,8})$/i.exec(v);
  if (hex) {
    const h = hex[1];
    const wide =
      h.length <= 4
        ? h
            .split('')
            .map((c) => c + c)
            .join('')
        : h;
    if (wide.length !== 6 && wide.length !== 8) return null;
    const byte = (i: number) => Number.parseInt(wide.slice(i, i + 2), 16);
    return { r: byte(0), g: byte(2), b: byte(4), a: wide.length === 8 ? byte(6) / 255 : 1 };
  }

  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[/,]\s*([\d.]+%?)\s*)?\)$/i.exec(v);
  if (rgb) {
    return { r: Math.round(Number(rgb[1])), g: Math.round(Number(rgb[2])), b: Math.round(Number(rgb[3])), a: alphaOf(rgb[4]) };
  }

  return null;
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0');

function formatColor(c: Rgba): string {
  if (c.a >= 1) return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${Number(c.a.toFixed(4))})`;
}

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

const isLightSelector = (sel: string) => /(^|,)\s*:root\s*(,|$)/.test(sel);
const isDarkSelector = (sel: string) => /\.dark\b|\[data-theme=["']?dark["']?\]/.test(sel);

// Every custom property declared for a theme, in source order (later wins, the
// same way the cascade resolves two declarations of equal specificity).
function collect(css: string, from: string): { light: Decls; dark: Decls } {
  const light: Decls = new Map();
  const dark: Decls = new Map();
  const root = postcss.parse(css, { from });

  root.walkDecls((decl: any) => {
    if (!decl.prop.startsWith('--')) return;
    const parent = decl.parent;
    if (!parent) return;
    // Tailwind's `@theme` holds the theme-independent half of the vocabulary
    // (motion, radius, font). It has no dark counterpart, so it feeds light and
    // dark alike; a later :root/[data-theme=dark] declaration still overrides it.
    if (parent.type === 'atrule' && /^theme$/i.test(parent.name)) {
      light.set(decl.prop, decl.value);
      dark.set(decl.prop, decl.value);
      return;
    }
    if (parent.type !== 'rule') return;
    if (isDarkSelector(parent.selector)) dark.set(decl.prop, decl.value);
    else if (isLightSelector(parent.selector)) light.set(decl.prop, decl.value);
  });

  return { light, dark };
}

// ---------------------------------------------------------------------------
// resolve
// ---------------------------------------------------------------------------

// var(--a, fallback) chains, resolved against one theme. A name the dark block
// does not redeclare falls back to the light declaration — which is exactly what
// the browser does, since the dark rule only overrides the properties it lists.
function resolveVars(value: string, theme: Decls, base: Decls, seen: Set<string> = new Set()): string {
  return value.replace(/var\(\s*(--[\w-]+)\s*(?:,([^()]*(?:\([^()]*\)[^()]*)*))?\)/g, (_m, name: string, fallback?: string) => {
    if (seen.has(name)) throw new Error(`token ${name} refers to itself`);
    const raw = theme.get(name) ?? base.get(name);
    if (raw === undefined) {
      if (fallback !== undefined) return resolveVars(fallback.trim(), theme, base, seen);
      throw new Error(`token ${name} is referenced but never declared`);
    }
    return resolveVars(raw, theme, base, new Set([...seen, name]));
  });
}

// rem is resolved to px HERE, on purpose. The extension's on-page UI lives in a
// host document whose root font-size it does not control (and several of the
// supported sites set their own), so a rem shipped verbatim would resize the
// extension's chrome per site. 16px is the CSS initial value, which is what the
// app itself renders against.
function normalize(value: string): string {
  const v = value.trim();
  const colour = parseColor(v);
  if (colour) return formatColor(colour);
  const rem = /^(-?[\d.]+)rem$/.exec(v);
  if (rem) return `${Number((Number.parseFloat(rem[1]) * 16).toFixed(4))}px`;
  return v;
}

interface GeneratedToken {
  name: string;
  light: string;
  dark: string;
  why: string;
  owner: 'app' | 'extension';
}

function build(): { tokens: GeneratedToken[]; css: string; ts: string } {
  const app = collect(fs.readFileSync(APP_CSS, 'utf8'), APP_CSS);
  const ext = collect(fs.readFileSync(EXT_CSS, 'utf8'), EXT_CSS);

  const tokens: GeneratedToken[] = [];

  for (const { out, from, why } of FROM_APP) {
    if (!app.light.has(from)) throw new Error(`${path.basename(APP_CSS)} no longer declares ${from} (allowlisted for ${out})`);
    tokens.push({
      name: out,
      light: normalize(resolveVars(app.light.get(from) as string, app.light, app.light)),
      dark: normalize(resolveVars(app.dark.get(from) ?? (app.light.get(from) as string), app.dark, app.light)),
      why,
      owner: 'app',
    });
  }

  // Extension-owned tokens are taken wholesale: the source file IS the
  // allowlist, and it only ever declares --hologram-* names.
  for (const [name, value] of ext.light) {
    if (!name.startsWith('--hologram-')) throw new Error(`${path.basename(EXT_CSS)} declares ${name}; extension-owned tokens must be --hologram-*`);
    if (tokens.some((t) => t.name === name)) throw new Error(`${name} is declared in both ${path.basename(EXT_CSS)} and the app allowlist`);
    tokens.push({
      name,
      light: normalize(resolveVars(value, ext.light, ext.light)),
      dark: normalize(resolveVars(ext.dark.get(name) ?? value, ext.dark, ext.light)),
      why: '',
      owner: 'extension',
    });
  }

  for (const [name] of ext.dark) {
    if (!ext.light.has(name)) throw new Error(`${path.basename(EXT_CSS)} declares ${name} for dark only; every token needs a light value`);
  }

  const pad = Math.max(...tokens.map((t) => t.name.length));
  const line = (t: GeneratedToken, theme: Theme) => `  ${`${t.name}:`.padEnd(pad + 1)} ${t[theme]};`;
  const darkOverrides = tokens.filter((t) => t.dark !== t.light);

  const css = `${[
    '/* GENERATED FILE — do not edit.',
    ' *',
    ' * Written by scripts/gen-extension-tokens.cts from app/src/renderer/src/globals.css',
    ' * (the app design tokens) plus extension/utils/tokens.source.css (the few values',
    " * only an overlay on someone else's page needs). Change either input and re-run;",
    ' * scripts/extension-tokens.test.ts fails while this file is stale.',
    ' *',
    " * The extension follows the BROWSER/OS theme, not the host page's: what it draws",
    " * belongs to the browser's furniture (#270), and prefers-color-scheme is the only",
    ' * signal that reports that. It is a media query rather than a value JavaScript',
    ' * picks, so a theme switch reaches UI that is already on screen.',
    ' */',
    ':root,',
    ':host {',
    ...tokens.map((t) => line(t, 'light')),
    '}',
    '',
    '@media (prefers-color-scheme: dark) {',
    '  :root,',
    '  :host {',
    ...darkOverrides.map((t) => `  ${line(t, 'dark')}`),
    '  }',
    '}',
  ].join('\n')}\n`;

  const camel = (name: string) => name.replace('--hologram-', '').replace(/-(\w)/g, (_m, c: string) => c.toUpperCase());
  const value = (name: string) => {
    const t = tokens.find((x) => x.name === name);
    if (!t) throw new Error(`motion token ${name} is not generated`);
    if (t.light !== t.dark) throw new Error(`motion token ${name} differs per theme; the TS artifact has no theme to pick`);
    return t.light;
  };
  const ms = (raw: string) => {
    const m = /^([\d.]+)ms$/.exec(raw);
    if (!m) throw new Error(`motion duration ${raw} is not in ms`);
    return Number(m[1]);
  };

  const ts = `${[
    '// GENERATED FILE — do not edit.',
    '//',
    '// Written by scripts/gen-extension-tokens.cts. The colour half of the design',
    '// tokens is delivered as CSS custom properties (tokens.generated.css) so a theme',
    '// switch reaches UI already on screen; this file exists only for the values that',
    '// CANNOT be read as a custom property — Web Animations takes a number of',
    '// milliseconds for `duration`, not a var().',
    '//',
    '// Exported under a distinct name and re-exported as `motion` from tokens.ts:',
    '// WXT auto-imports every module under utils/, and two of them exporting the',
    '// same symbol makes it warn on every build about which one it dropped.',
    'export const generatedMotion = {',
    ...MOTION_MS.map((n) => `  ${camel(n)}: ${ms(value(n))}, // ${n}`),
    ...MOTION_EASE.map((n) => `  ${camel(n)}: '${value(n)}', // ${n}`),
    '} as const;',
  ].join('\n')}\n`;

  return { tokens, css, ts };
}

const OUTPUTS = [
  { file: OUT_CSS, key: 'css' as const },
  { file: OUT_TS, key: 'ts' as const },
];

function main() {
  const built = build();
  const check = process.argv.includes('--check');
  let stale = 0;
  for (const { file, key } of OUTPUTS) {
    const wanted = built[key];
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (current === wanted) continue;
    if (check) {
      console.error(`${path.relative(ROOT, file)} is stale`);
      stale += 1;
      continue;
    }
    fs.writeFileSync(file, wanted);
    console.log(`wrote ${path.relative(ROOT, file)}`);
  }
  if (check) {
    if (stale) {
      console.error('run: node scripts/gen-extension-tokens.cts');
      process.exit(1);
    }
    console.log('extension tokens are up to date');
  }
}

module.exports = { build, parseColor, oklchToRgb, formatColor, FROM_APP, OUT_CSS, OUT_TS };

if (require.main === module) main();
