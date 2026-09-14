'use strict';

// アプリ自身のデザイントークン（#270）から拡張機能の色・タイポグラフィ・
// モーションのトークンを生成する。これで両者が手コピーのリテラルでずれる
// ことは二度と起きない。
//
//   node scripts/gen-extension-tokens.cts            extension/utils/tokens.generated.css を書く
//   node scripts/gen-extension-tokens.cts --check    ディスク上のファイルが古ければ exit 1
//
// 正本 — app/src/renderer/src/globals.css。リデザインが実際にそこから描画
// しているシート（Tailwind v4 @theme + shadcn base-nova）。リデザイン前の
// design-tokens.css ではない: そちらの --accent は #114 で却下された sky の
// 段階のままで、モーションの値もリデザインより前のものなので、そこから
// 生成すると、引退したデザイン言語の世代を別のランタイムへ流し込むことに
// なってしまう。
//
// 入力は2つ、出力は1つ:
//   1. globals.css          — アプリが意見を持つものすべて
//   2. tokens.source.css    — 拡張機能だけが必要とするわずかなもの。その画面は
//                             アプリ自身の背景ではなく「任意の」ホストページの
//                             上に乗るため（そのファイルを参照）
//
// 抽出は正規表現ではなく本物の CSS パース（postcss）で行う: `var()` の連鎖、
// `--foo` を含むコメント、複数セレクタのルールはどれもブラウザが解決するのと
// 同じように解決しなければならず、これらはどれも正規表現が静かに間違った値を
// 読んでしまう経路になる。
//
// 値は oklch() のまま通すのではなく sRGB へ「解決」する。生成されるファイルは
// 人がレビューするコミット対象の成果物であり、`#171717` は何がどこで変わった
// かを語るが `oklch(0.205 0 0)` はそれを語らない。解決しておくことで、
// コントラストの番人（tests/integration/extension-tokens.test.ts）も、色ライブラリや
// ブラウザを必要とせずただの単体テストでいられる。下の変換は CSS Color 4 の
// 行列の組で、このリポジトリが出荷するすべての値について Chrome 自身の
// ラスタライズと突き合わせ済み — 全値でチャンネル差 0/255（2026-07-29）。

const fs = require('node:fs');
const path = require('node:path');
const postcss = require('postcss');

const ROOT = path.join(__dirname, '..');
const APP_CSS = path.join(ROOT, 'app', 'src', 'renderer', 'src', 'globals.css');
const EXT_CSS = path.join(ROOT, 'extension', 'utils', 'tokens.source.css');
const OUT_CSS = path.join(ROOT, 'extension', 'utils', 'tokens.generated.css');
const OUT_TS = path.join(ROOT, 'extension', 'utils', 'tokens.generated.ts');

// モーションの値は、TypeScript としても「2回目」の生成をする。拡張機能が
// 描くものはすべて var() 経由でトークンを読むが、登場・退出のポップだけは
// Web Animations を通り、その `duration` はミリ秒の数値であってカスタム
// プロパティを受け取れない。ここで出力しておくことで、モーションの調子は
// 単一の正本のままになり、2つの数値がずれる余地を残さない。
const MOTION_MS = ['--hologram-duration-base', '--hologram-duration-fast'];
const MOTION_EASE = ['--hologram-ease-out', '--hologram-ease-in'];

// ツールバーのバッジ（#269）。var() にできない2つ目のもの: 拡張機能が自分の
// UI を注入できなかった時に出す警告は「ブラウザ」が描画する。
// chrome.action.setBadgeBackgroundColor / setBadgeTextColor からで、これらは
// 解決済みの色文字列を受け取り、その後は何も読み直さない。
//
// あえてライト側だけ。service worker にはテーマの信号が一切無い — worker には
// matchMedia が無く、ブラウザの配色を報告する chrome.* API も無いので、
// 2つの値を出力したところで書き分ける分岐が存在しない。ピルは不透明で自前の
// インクを持つので、その裏でツールバーが何をしていようとコントラストには
// どのみち関係しない。この組はそれ自身の中だけで保たれれば足り、それはすでに
// ライト側の行が保証している（tests/integration/extension-tokens.test.ts がこの用途に
// 対してもう一度それを検証する）。
const BADGE = { background: '--hologram-danger', text: '--hologram-on-danger', verificationBackground: '--hologram-warning', verificationText: '--hologram-on-warning' };

// 許可リスト。拡張機能がアプリから受け取るものはすべてここで名指しされるので、
// globals.css へトークンを1つ足しても境界を越えるものが黙って広がることは
// 無く、このマッピングは各拡張機能の画面がどのアプリの役割を名乗っているかの
// 記録も兼ねる。
interface AppToken {
  out: string;
  from: string;
  why: string;
}
const FROM_APP: AppToken[] = [
  // --- ページ上の UI を構成する浮遊面 ----------------------------------------
  // card ではなく popover: これは拡張機能が他人のページの上に一時的に持ち上げる
  // レイヤーであり、それはまさに shadcn で --popover が名指すもの。
  { out: '--hologram-surface', from: '--popover', why: 'on-page status banner fill' },
  { out: '--hologram-ink', from: '--popover-foreground', why: 'label + glyph ink on that fill' },
  { out: '--hologram-ink-muted', from: '--ui-muted-foreground', why: 'secondary explanatory text' },
  // --- 拡張機能自身のページ（popup.html / diag.html） ----------------------
  { out: '--hologram-page-bg', from: '--background', why: 'extension page background' },
  { out: '--hologram-page-surface', from: '--card', why: 'raised block on an extension page' },
  { out: '--hologram-ink-strong', from: '--foreground', why: 'headings' },
  { out: '--hologram-border', from: '--ui-border', why: 'structural hairline INSIDE an extension page' },
  { out: '--hologram-border-strong', from: '--input', why: 'the same, one step heavier' },
  { out: '--hologram-hover', from: '--ui-accent', why: 'generic hover surface (menu/list rows)' },
  { out: '--hologram-active', from: '--secondary', why: 'pressed/active surface' },
  { out: '--hologram-focus-ring', from: '--ui-ring', why: 'keyboard focus ring' },
  // --- 状態 -----------------------------------------------------------------
  // 保存中のバッジと、ホバー保存ボタンのフォーカス表示に使う。
  { out: '--hologram-accent', from: '--ui-selected', why: 'saving and focused controls' },
  { out: '--hologram-danger', from: '--destructive', why: 'save failed' },
  // --- 色ではないもの --------------------------------------------------------
  { out: '--hologram-radius', from: '--radius', why: 'corner radius' },
  { out: '--hologram-duration-base', from: '--motion-duration-base', why: 'enter / state change' },
  { out: '--hologram-duration-fast', from: '--motion-duration-fast', why: 'exit / micro-feedback' },
  { out: '--hologram-ease-out', from: '--motion-ease-out', why: 'enter curve' },
  { out: '--hologram-ease-in', from: '--motion-ease-in', why: 'exit curve' },
];

// あえてアプリから取らないもの:
//   --font-sans (= 'Geist Variable') — 日本語をカバーしないバンドル済み
//   Webフォント。ホストページへ出荷すると、すべてのサイトに
//   web_accessible_resource の @font-face を持ち込むことになり、バナーの
//   文言は日本語が主なので、どのラベルも文中で2つの書体デザインが混ざって
//   しまう。拡張機能はシステムのフォントスタックを保つ。tokens.source.css を
//   参照。

type Theme = 'light' | 'dark';
type Decls = Map<string, string>;

// ---------------------------------------------------------------------------
// 色
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

// oklch -> sRGB（CSS Color 4 §12.3 + OKLab->linear-sRGB の行列）。色域外の結果は
// チャンネルごとにクリップする。Chrome がこれらの値に対してやっているのも同じ。
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
// パース
// ---------------------------------------------------------------------------

const isLightSelector = (sel: string) => /(^|,)\s*:root\s*(,|$)/.test(sel);
const isDarkSelector = (sel: string) => /\.dark\b|\[data-theme=["']?dark["']?\]/.test(sel);

// あるテーマに対して宣言されたカスタムプロパティすべてを、ソース上の順序で
// 集める（後勝ち。カスケードが同じ詳細度の2つの宣言を解決するのと同じ）。
function collect(css: string, from: string): { light: Decls; dark: Decls } {
  const light: Decls = new Map();
  const dark: Decls = new Map();
  const root = postcss.parse(css, { from });

  root.walkDecls((decl: any) => {
    if (!decl.prop.startsWith('--')) return;
    const parent = decl.parent;
    if (!parent) return;
    // Tailwind の `@theme` は語彙のうちテーマに依存しない半分（モーション、
    // 半径、フォント）を持つ。dark 側の対応物は無いので、light にも dark にも
    // 同じように供給する。後に来る :root/[data-theme=dark] の宣言は、それでも
    // これを上書きする。
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
// 解決
// ---------------------------------------------------------------------------

// var(--a, fallback) の連鎖を、1つのテーマに対して解決する。dark ブロックが
// 再宣言していない名前は light の宣言にフォールバックする — これはブラウザが
// やっていることそのもので、dark のルールはそこに列挙されたプロパティしか
// 上書きしないため。
function resolveVars(value: string, theme: Decls, base: Decls, seen: Set<string> = new Set()): string {
  return value.replace(/var\(\s*(--[\w-]+)\s*(?:,([^()]*(?:\([^()]*\)[^()]*)*))?\)/g, (_m, name: string, fallback?: string) => {
    if (seen.has(name)) throw new Error(`トークン ${name} が自分自身を参照している`);
    const raw = theme.get(name) ?? base.get(name);
    if (raw === undefined) {
      if (fallback !== undefined) return resolveVars(fallback.trim(), theme, base, seen);
      throw new Error(`トークン ${name} が参照されているが一度も宣言されていない`);
    }
    return resolveVars(raw, theme, base, new Set([...seen, name]));
  });
}

// rem をここで px に解決するのはあえてのこと。拡張機能のページ上 UI は、
// ルートの font-size を自分で制御できないホストドキュメントの中に住んでいる
// （サポート対象のサイトのいくつかは独自のものを設定している）ので、rem を
// そのまま出荷すると拡張機能の chrome がサイトごとに大きさを変えてしまう。
// 16px は CSS の初期値であり、アプリ自身がそれを基準に描画している。
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
    if (!app.light.has(from)) throw new Error(`${path.basename(APP_CSS)} はもう ${from} を宣言していない（${out} 向けに許可リスト登録済み）`);
    tokens.push({
      name: out,
      light: normalize(resolveVars(app.light.get(from) as string, app.light, app.light)),
      dark: normalize(resolveVars(app.dark.get(from) ?? (app.light.get(from) as string), app.dark, app.light)),
      why,
      owner: 'app',
    });
  }

  // 拡張機能所有のトークンは丸ごと取り込む: このソースファイルそのものが
  // 許可リストであり、そこは --hologram-* という名前しか宣言しない。
  for (const [name, value] of ext.light) {
    if (!name.startsWith('--hologram-')) throw new Error(`${path.basename(EXT_CSS)} が ${name} を宣言している。拡張機能所有のトークンは --hologram-* でなければならない`);
    if (tokens.some((t) => t.name === name)) throw new Error(`${name} が ${path.basename(EXT_CSS)} とアプリの許可リストの両方で宣言されている`);
    tokens.push({
      name,
      light: normalize(resolveVars(value, ext.light, ext.light)),
      dark: normalize(resolveVars(ext.dark.get(name) ?? value, ext.dark, ext.light)),
      why: '',
      owner: 'extension',
    });
  }

  for (const [name] of ext.dark) {
    if (!ext.light.has(name)) throw new Error(`${path.basename(EXT_CSS)} が ${name} を dark 用にのみ宣言している。すべてのトークンには light の値が必要`);
  }

  const pad = Math.max(...tokens.map((t) => t.name.length));
  const line = (t: GeneratedToken, theme: Theme) => `  ${`${t.name}:`.padEnd(pad + 1)} ${t[theme]};`;
  const darkOverrides = tokens.filter((t) => t.dark !== t.light);

  const css = `${[
    '/* 生成ファイル — 編集しないこと。',
    ' *',
    ' * scripts/gen-extension-tokens.cts が app/src/renderer/src/globals.css',
    ' * （アプリのデザイントークン）と extension/utils/tokens.source.css',
    ' *（他人のページの上のオーバーレイだけが必要とするわずかな値）から書いている。',
    ' * どちらかの入力を変えたら再実行すること。このファイルが古いままだと',
    ' * tests/integration/extension-tokens.test.ts が失敗する。',
    ' *',
    ' * 拡張機能はホストページのテーマではなく「ブラウザ/OS」のテーマに従う:',
    ' * ここで描くものはブラウザの調度品に属す（#270）ので、それを報告する信号は',
    ' * prefers-color-scheme だけである。JavaScript が選ぶ値ではなくメディア',
    ' * クエリなので、テーマの切り替えはすでに画面上にある UI にも届く。',
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
  const lightValue = (name: string) => {
    const t = tokens.find((x) => x.name === name);
    if (!t) throw new Error(`トークン ${name} は生成されていない`);
    return t.light;
  };
  const value = (name: string) => {
    const t = tokens.find((x) => x.name === name);
    if (!t) throw new Error(`モーショントークン ${name} は生成されていない`);
    if (t.light !== t.dark) throw new Error(`モーショントークン ${name} がテーマごとに異なる。TS の成果物にはどちらを選ぶかのテーマが無い`);
    return t.light;
  };
  const ms = (raw: string) => {
    const m = /^([\d.]+)ms$/.exec(raw);
    if (!m) throw new Error(`モーションの duration ${raw} が ms 単位になっていない`);
    return Number(m[1]);
  };

  const ts = `${[
    '// 生成ファイル — 編集しないこと。',
    '//',
    '// scripts/gen-extension-tokens.cts が書いている。デザイントークンの色の',
    '// 半分は CSS カスタムプロパティ（tokens.generated.css）として届けられ、',
    '// テーマの切り替えはすでに画面上にある UI にも届く。このファイルが存在',
    '// するのは、カスタムプロパティとしては読めない値のためだけ — Web',
    '// Animations は `duration` に var() ではなくミリ秒の数値を取り、ツール',
    '// バーのバッジはブラウザが解決済みの色文字列から描画する。',
    '//',
    '// tokens.ts から別名でエクスポートし、`motion` / `actionBadge` として',
    '// 再エクスポートしている: Vite はインポートされたモジュールしかバンドル',
    '// しないので、2つが同じシンボルをエクスポートすると、ビルドのたびに',
    '// どちらを落としたか警告する。',
    'export const generatedMotion = {',
    ...MOTION_MS.map((n) => `  ${camel(n)}: ${ms(value(n))}, // ${n}`),
    ...MOTION_EASE.map((n) => `  ${camel(n)}: '${value(n)}', // ${n}`),
    '} as const;',
    '',
    '// ツールバーアイコンの警告バッジ（#269）。ライト側の行のみ — service',
    '// worker にはブラウザがどちらの配色を着ているか尋ねる手段が無いので、',
    '// 2つ目の値を渡す分岐が存在しない。ピルは不透明で自前のインクを持つので、',
    '// その裏でツールバーが何をしていようとコントラストには一切関係しない。',
    'export const generatedActionBadge = {',
    ...Object.entries(BADGE).map(([key, name]) => `  ${key}: '${lightValue(name)}', // ${name}`),
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
      console.error(`${path.relative(ROOT, file)} は古い`);
      stale += 1;
      continue;
    }
    fs.writeFileSync(file, wanted);
    console.log(`書いた: ${path.relative(ROOT, file)}`);
  }
  if (check) {
    if (stale) {
      console.error('実行すること: node scripts/gen-extension-tokens.cts');
      process.exit(1);
    }
    console.log('拡張機能のトークンは最新である');
  }
}

module.exports = { build, parseColor, oklchToRgb, formatColor, FROM_APP, OUT_CSS, OUT_TS };

if (require.main === module) main();
