// app/src/renderer/design-tokens.css のコントラストの「対」を守る番人。
//
// token-parity.test.ts の兄弟。あちらが見るのは「トークンが両テーマで定義されているか」で、
// こちらが見るのは「意味を担う色の組み合わせが読める状態を保っているか、ライトとダークで
// 見比べられるか」＝片方のテーマだけ濃くしてもう片方を薄いまま置くこともできないし、塗りを
// いじってその上の文字を壊すこともできない。
//
// 分類は3つ（WCAG の比 = (L_lighter+0.05)/(L_darker+0.05)、L は線形化した RGB。色は CSS
// 自身からテーマごとに解決するので、実際に出荷される値を調べている）:
//
//  1. 文字ロール vs 背景。最上位のロール (--text/--text-strong) には下限だけを置く（どちらの
//     テーマも「できるだけ暗く／明るく」を狙うので、厳密な一致には意味が無い）。中位のロール
//     には、両テーマが収まるべき目標帯を置く＝見比べられるコントラストということ。
//  2. 塗りの上に乗る前景（ボタン上の白文字、アクティブ pill の上のインク）。今は正しいが、
//     塗りを調整し直すと黙って壊れる（ずれやすい）＝下限は AA の 4.5。
//  3. サイドバー上での部品 (chip / アクティブな塗り) の視認性。文字でない枠線はグラデーション
//     の上に乗るので、明るい上に明るいと WCAG の 3:1 に届かない＝代わりに「見分けが付くか」
//     という緩い下限を使う。部品は塗りか枠線のどちらかで読めれば足りるので、各テーマの最悪の
//     点に対して良い方を取る。

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const CSS = path.join(import.meta.dirname, 'design-tokens.css');

type Theme = 'light' | 'dark';

// 1. role = 文字のトークン / ref = それが主に乗る背景
const CHECKS: { role: string; ref: string; floor?: number; band?: [number, number] }[] = [
  { role: '--text', ref: '--surface', floor: 11 },
  { role: '--text-strong', ref: '--surface', floor: 13 },
  { role: '--text-muted', ref: '--surface', band: [4.5, 6.0] },
  { role: '--text-muted-strong', ref: '--sidebar-bg', band: [6.5, 8.0] },
  { role: '--text-subtle', ref: '--surface', band: [2.2, 3.6] },
  // アクセント色を前景・文字として使う経路（リンク、ホバーのラベル、アクティブのインク、
  // アクセント色のアイコン）は、代わりに専用の --accent-text を通す（--accent 自体は塗りで、
  // ダークでは文字として暗すぎる＝2.88:1）。両テーマとも AA を越えていなければならない。
  { role: '--accent-text', ref: '--surface', floor: 4.5 },
  // 状態色を前景として使う経路（削除のラベル、エラー文字）。本文の 4.5 ではなく、状態・
  // アイコンの 3:1 の段で判定する＝彩度の高い赤は見分けが付きやすく、短い動作ラベルと
  // アイコンにしか使わない（ライトの --danger は 3.91 でこの段を越える。3:1 を下回れば
  // このテストが捕まえる）。
  { role: '--danger', ref: '--surface', floor: 3.0 },
];
// 目標帯で見るロールについて、テーマ間の開きの上限
const MAX_SPREAD = 1.6;

// 2. 塗りの上に乗る前景＝塗りがずれると壊れる。下限は AA。
const FILL_CHECKS = [
  // アクセントの下限は 4.5 ではなく 3.0（アイコン・大きい文字の段）。空色のブランド
  // アクセントは意図して明るくしてある（DESIGN.md の「空色のアクセント」の注を参照）。
  // 「弱ければ塗りを深くするだけ」の規則に従い、ダークは sky-500 から sky-600 へ動かして
  // この段を越えさせた（両テーマとも 3.32＝2026-07-02 の利用者の判断）。
  { fg: '--accent-fg', fill: '--accent', floor: 3.0, what: 'アクセントボタン上の白文字' },
  { fg: '--accent-subtle-fg', fill: '--accent-subtle', floor: 4.5, what: 'アクティブ pill 上のインク' },
  // 状態色の塗りの上に乗る白アイコン (.ws-btn remove)。アイコンの段＝3:1。
  { fg: '--text-on-accent', fill: '--danger', floor: 3.0, what: 'danger（削除）ボタン上の白アイコン' },
];

// 3. サイドバー上で見えている必要のある、文字でない部品（塗りか枠線で読む）。緩い下限は
// 「Mica に溶けた」退行（実測でおよそ 1.0）を捕まえつつ、ダークで正当に控えめな浮いた pill
// は通す。サイドバー上での各テーマの最悪の点は、ライトがグラデーションの下端（最も暗い）、
// ダークがサイドバーの地色（その上に乗る暗い chip の中で最も明るい点）。
const COMPONENT_CHECKS = [
  { name: 'chip', fill: '--chip-bg', border: '--chip-border', floor: 1.2 },
  { name: 'active fill', fill: '--accent-subtle', border: '--accent-subtle', floor: 1.2 },
];
// サイドバーは今は単色（縦のグラデーションは外した）なので、ライトの最悪の点も
// --sidebar-bg（以前は --sidebar-grad-bot だった）。
const SIDEBAR_REF: Record<Theme, string> = { light: '--sidebar-bg', dark: '--sidebar-bg' };

// ---- CSS の解析: :root のブロックは全部ライトへ、dark のブロックは全部ダークへ合流させる
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

// ---- カスタムプロパティを、渡されたテーマでの [r,g,b] まで解決する（var() の連鎖をたどる）
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
