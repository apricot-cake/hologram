// 拡張機能のデザイントークンの番人(#270)。
//
// アプリの globals.css を正本として生成した extension/utils/tokens.generated.css
// について、(1) 手で編集されていないか (2) 拡張機能のコードが実在するトークンだけを
// 参照しているか (3) 拡張機能側に色のベタ書きが戻っていないか (4) 両テーマ×4種の基準の
// 下地で読めるか、を見る。
//
// 主眼は (4)。拡張機能の画面は「アプリが選んだ背景」ではなく、どんなページの上にも
// 乗る。だからアプリの中では問題ない組み合わせ(面の色に近い髪の毛ほどの細さの輪郭など)
// が、外でもそのまま通るとは限らない。基準の下地を4つ＝純黒、X の dim テーマ、pixiv の
// ダークテーマ、白に固定し、「輪郭は下地に対しても塗りに対しても 3:1」「本文は 4.5:1」
// という数値の線を守らせる。
//
// 半透明のトークンは下地へ合成してから測る＝画像の上に乗る小さな操作子は、最悪の両端
// (真っ黒な写真 / 真っ白な写真)のどちらに対しても本文の水準を満たさなければならない。

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

// === 色の計算 =========================================================================

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

// 半透明の色を下地へ合成する(source-over)。
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

// 基準の下地4種。拡張機能の画面は、この4つ全部の上で成立しなければならない
// (利用者のブラウザのテーマと、見ているサイトのライト/ダークは、それぞれ別に決まる)。
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

// === (1) 生成物が最新か ===============================================================================

describe('生成物', () => {
  test('tokens.generated.css は入力と一致している（手編集・生成漏れが無い）', () => {
    // これが落ちたら: node scripts/gen-extension-tokens.cts
    expect(fs.readFileSync(OUT_CSS, 'utf8')).toBe(css);
  });

  // TS 側の生成物も同じ検査に掛ける(#269)。
  // 注意: これが無いと、下の「色のベタ書き」検査から tokens.generated.ts を除いた瞬間に
  // このファイルだけ手編集し放題になる＝バッジの色がアプリのトークンから静かにずれる。
  test('tokens.generated.ts は入力と一致している', () => {
    expect(fs.readFileSync(OUT_TS, 'utf8')).toBe(ts);
  });

  test('ライトに無くダークにだけある値は無い', () => {
    expect([...dark.keys()].filter((n) => !light.has(n))).toEqual([]);
  });
});

// === (2)(3) 拡張コードとの噛み合わせ ==============================================================

// トークンの入力(拡張機能に固有の定義)と生成物そのものは対象外＝色のリテラルを持っていて
// 正しいのはこの2ファイルだけ。他の .css は #44 で入ったコンポーネントのシートで、状態→色
// の対応は今そこにある。走査から外すと「使われていないトークン」の判定が嘘になる。
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

  // #270 の受け入れ条件: 拡張機能側で色のリテラルを置いてよいのは、トークンの入力と生成物だけ。
  test('拡張のコードに色のベタ書きが無い', () => {
    // 白と黒も例外にしない。「白なら安全だろう」が、ライトテーマで白い面に白を置く不具合の
    // 入口になってきた(#136 が一掃したはずの種類の不具合＝片方のテーマだけ壊れる)。
    const COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|color-mix)\s*\(/g;
    const offenders: string[] = [];
    // 生成された .ts は SOURCES に残したまま、この検査からだけ外す＝ツールバーのバッジ
    // (#269)は、service worker が var() を渡せないので解決済みの色の文字列を使う。だから
    // 生成物が色のリテラルを持つのは正しい。SOURCES から外すと、この生成ファイルだけが
    // 名指ししているトークン(モーションの4本)が「使われていない」側へ倒れる。
    for (const rel of SOURCES.filter((f) => path.basename(f) !== 'tokens.generated.ts')) {
      // 不動点まで削る。1回通しただけだと、自分が開いていないコメントの区切りが残り、
      // それが継ぎ合わさって新しいコメントになる(`<!-<!-- -->->`)。本当にコメントの無い
      // テキストにするのはこのループ。
      let text = read(rel);
      let previous: string;
      do {
        previous = text;
        text = text
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '')
          // HTML のコメントも削る＝拡張機能のページの .html には3つ目のコメントの書き方が
          // ある。削らないと issue 番号(`#269`)が16進の色として引っ掛かり、「色をベタ書き
          // した」と読める文言で落ちる。
          .replace(/<!--[\s\S]*?-->/g, '');
      } while (text !== previous);
      for (const [hit] of text.matchAll(COLOR)) offenders.push(`${rel}: ${hit}`);
    }
    expect(offenders.sort()).toEqual([]);
  });
});

// === (4) コントラスト ======================================================

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

  // Alt+S の選択フレームと、ドラッグ中の輪郭。カードの上ではなくページに直に乗るので、
  // 4種の下地すべてに対して見えなければならない。
  test.each(Object.entries(HOSTS))('選択フレームのアクセントが %s の上で 3:1 以上', (_host, bg) => {
    expect(ratio(rgb(v.get('--hologram-accent') as string), bg)).toBeGreaterThanOrEqual(3);
  });

  test('アクセントの塗りに乗るアイコンが 4.5:1 以上', () => {
    expect(ratio(rgb(v.get('--hologram-on-accent') as string), rgb(v.get('--hologram-accent') as string))).toBeGreaterThanOrEqual(4.5);
  });

  // ドラッグ中の破線リングはアクセント色そのもの＝カードの上で見えなければならない。
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

  // 小さな操作子(保存ボタン)のホバー時の塗り。カードと同じ面を使うので、ホバーで面が
  // 変わってもインクは読めるままでなければならない。
  test('ホバー時の面の上でもインクが 4.5:1 以上', () => {
    expect(ratio(rgb(v.get('--hologram-ink') as string), rgb(v.get('--hologram-hover') as string))).toBeGreaterThanOrEqual(4.5);
  });

  // 保存済みの印と、保存中の面は半透明＝下地が「どんな写真でもありうる」ので、最悪の
  // 両端(真っ黒な写真 / 真っ白な写真)のどちらでも本文の水準を満たさなければならない。
  // これが alpha の上限を決める＝透けるほど下地が滲み出し、いずれ文字が読めなくなる。
  test.each([
    ['真っ黒な写真', { r: 0, g: 0, b: 0 }],
    ['真っ白な写真', { r: 255, g: 255, b: 255 }],
  ] as [string, Rgb][])('保存済みマークのグリフが %s の上で 4.5:1 以上', (_what, photo) => {
    const disc = over(v.get('--hologram-control-surface') as string, photo);
    expect(ratio(rgb(v.get('--hologram-ink') as string), disc)).toBeGreaterThanOrEqual(4.5);
  });

  // ホバー時の保存ボタンも同じ半透明の円盤に乗る(2026-07-29 に利用者が決めた)。ホバーは
  // 色を持ち上げるだけなので、持ち上げた色でもグリフは読めるままでなければならない。
  test.each([
    ['真っ黒な写真', { r: 0, g: 0, b: 0 }],
    ['真っ白な写真', { r: 255, g: 255, b: 255 }],
  ] as [string, Rgb][])('ホバー中の保存ボタンのグリフが %s の上で 4.5:1 以上', (_what, photo) => {
    const disc = over(v.get('--hologram-control-surface-hover') as string, photo);
    expect(ratio(rgb(v.get('--hologram-ink') as string), disc)).toBeGreaterThanOrEqual(4.5);
  });

  // リングはカードの中にあるので、下地は乗せているページではなくカードの塗り。
  test('ドロップ先の破線リングがカードの上で 3:1 以上', () => {
    expect(ratio(over(v.get('--hologram-ring') as string, surface()), surface())).toBeGreaterThanOrEqual(3);
  });
});

// === (5) ツールバーのバッジ (#269) ===========================================

// ブラウザ自身が描く唯一の画面＝service worker にはテーマを問い合わせる手立てが無いので、
// ライトの行の値が両テーマともそのままツールバーへ行く。円はその値でべた塗りされる
// (ツールバーの色は透けない)ので、成り立てばよいのは「塗り 対 文字」の組だけ。
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
