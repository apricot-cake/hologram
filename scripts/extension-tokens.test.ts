// 拡張のデザイントークン（#270）のガード。
//
// アプリの globals.css を正として生成した extension/utils/tokens.generated.css が、
// ①手で編集されていないか ②拡張のコードが実在するトークンだけを参照しているか
// ③拡張側に色のベタ書きが復活していないか ④両テーマ × 参照4下地で読めるか、を見る。
//
// ④が本題。拡張の面は「アプリが選んだ背景」ではなく**任意のページ**の上に乗るので、
// アプリ内なら成立する組み合わせ（サーフェス色に近い髪の毛のような境界線など）が
// そのままでは成立しない。純黒・X の dim・pixiv の暗色・白の4つを参照下地に固定し、
// 「境界は下地と塗りの両方に対して 3:1」「本文は 4.5:1」を数値で押さえる。
//
// 半透明のトークンは下地の上に合成してから測る＝画像の上に乗る小型コントロールは
// 最悪ケース（真っ黒な写真／真っ白な写真）の両方で本文ティアを満たす必要がある。

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { build, OUT_CSS, parseColor } from './gen-extension-tokens.cts';

const ROOT = path.join(import.meta.dirname, '..');
const EXT = path.join(ROOT, 'extension');

const { tokens, css } = build();
const light = new Map(tokens.map((t: any) => [t.name, t.light as string]));
const dark = new Map(tokens.map((t: any) => [t.name, t.dark as string]));

// === 色の計算 ===============================================================

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

// 半透明を下地の上に合成する（source-over）。
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

// 参照下地4種。拡張の面はこの4つ「すべての上」で成立しなければならない
// （ユーザーのブラウザテーマと、見ているサイトの明暗は独立に決まる）。
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

// === ①生成物が最新か =========================================================

describe('生成物', () => {
  test('tokens.generated.css は入力と一致している（手編集・生成漏れが無い）', () => {
    // 落ちたら: node scripts/gen-extension-tokens.cts
    expect(fs.readFileSync(OUT_CSS, 'utf8')).toBe(css);
  });

  test('ライトに無くダークにだけある値は無い', () => {
    expect([...dark.keys()].filter((n) => !light.has(n))).toEqual([]);
  });
});

// === ②③拡張コードとの噛み合わせ ==============================================

// トークンの入力（拡張固有の定義）と生成物そのものは対象外＝ここに色リテラルが在るのが
// 正しい2ファイル。それ以外の .css は #44 で入った部品シートで、状態→色の対応を持つのは
// もうそこなので、スキャンから外すと「使われていないトークン」の判定が嘘になる。
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

  // #270 の受け入れ条件: 拡張側の色リテラルは token source と生成物だけ。
  test('拡張のコードに色のベタ書きが無い', () => {
    // 白と黒だけは例外にしない: 「白なら安全」がライトテーマで白い面に白を置く
    // 事故の入口だった（#136 が根絶したはずの、片テーマだけ壊れる系統）。
    const COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|color-mix)\s*\(/g;
    const offenders: string[] = [];
    for (const rel of SOURCES) {
      const text = read(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      for (const [hit] of text.matchAll(COLOR)) offenders.push(`${rel}: ${hit}`);
    }
    expect(offenders.sort()).toEqual([]);
  });
});

// === ④コントラスト ==========================================================

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

  // Alt+S の選択フレームとドラッグ中の枠。カードの上ではなくページに直接乗るので、
  // 4下地すべてに対して見えなければならない。
  test.each(Object.entries(HOSTS))('選択フレームのアクセントが %s の上で 3:1 以上', (_host, bg) => {
    expect(ratio(rgb(v.get('--hologram-accent') as string), bg)).toBeGreaterThanOrEqual(3);
  });

  test('アクセントの塗りに乗るアイコンが 4.5:1 以上', () => {
    expect(ratio(rgb(v.get('--hologram-on-accent') as string), rgb(v.get('--hologram-accent') as string))).toBeGreaterThanOrEqual(4.5);
  });

  // ドラッグ中の破線リングはアクセントそのもの＝カードの上で見えること。
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

  // 小型コントロール（保存ボタン）のホバー時の塗り。カードと同じ面を使うので、
  // ホバーで面が変わってもインクが読めなくなってはいけない。
  test('ホバー時の面の上でもインクが 4.5:1 以上', () => {
    expect(ratio(rgb(v.get('--hologram-ink') as string), rgb(v.get('--hologram-hover') as string))).toBeGreaterThanOrEqual(4.5);
  });

  // 保存済みマークと保存中の面は半透明＝下地は「任意の写真」なので、最悪ケースの
  // 両端（真っ黒な写真／真っ白な写真）で本文ティアを満たすこと。ここがアルファの
  // 上限を決めている＝透かすほど下地が混ざり、いずれ字が読めなくなる。
  test.each([
    ['真っ黒な写真', { r: 0, g: 0, b: 0 }],
    ['真っ白な写真', { r: 255, g: 255, b: 255 }],
  ] as [string, Rgb][])('保存済みマークのグリフが %s の上で 4.5:1 以上', (_what, photo) => {
    const disc = over(v.get('--hologram-control-surface') as string, photo);
    expect(ratio(rgb(v.get('--hologram-ink') as string), disc)).toBeGreaterThanOrEqual(4.5);
  });

  // ホバー保存ボタンも同じ半透明のディスクに乗る（ユーザー判断・2026-07-29）。
  // ホバーで色だけ持ち上げるので、持ち上げた先でもグリフが読めなければならない。
  test.each([
    ['真っ黒な写真', { r: 0, g: 0, b: 0 }],
    ['真っ白な写真', { r: 255, g: 255, b: 255 }],
  ] as [string, Rgb][])('ホバー中の保存ボタンのグリフが %s の上で 4.5:1 以上', (_what, photo) => {
    const disc = over(v.get('--hologram-control-surface-hover') as string, photo);
    expect(ratio(rgb(v.get('--hologram-ink') as string), disc)).toBeGreaterThanOrEqual(4.5);
  });

  // リングはカードの内側なので、下地はホストページではなくカードの塗り。
  test('ドロップ先の破線リングがカードの上で 3:1 以上', () => {
    expect(ratio(over(v.get('--hologram-ring') as string, surface()), surface())).toBeGreaterThanOrEqual(3);
  });
});
