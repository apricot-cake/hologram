// app/src/renderer/design-tokens.css のコントラスト「パリティ」ガード。
//
// token-parity.test.ts の兄弟。あちらは「トークンが両テーマで定義されているか」を、
// こちらは「意味を担う色の組み合わせが読めるままか・ライトとダークで同程度か」を見る＝
// 片テーマだけ濃くして他方を薄いまま放置することも、塗りを調整して上の文字を壊すことも
// できなくなる。
//
// 3カテゴリ（WCAG 比 = (L_明+0.05)/(L_暗+0.05)、L は線形化 RGB。色は CSS 自身から
// テーマごとに解決するので、出荷される値そのものを検査する）:
//
//  1. 文字ロール vs 背景。上位ロール（--text/--text-strong）は下限だけ（どちらのテーマも
//     「できるだけ濃い/明るい」なので厳密な一致は無意味）。中位ロールは両テーマが収まる
//     べき目標帯（＝同程度のコントラスト）。
//  2. 塗りの上に乗る前景（ボタン上の白文字、アクティブ pill 上のインク）。今は正しいが
//     塗りを調整すると黙って壊れる（ずれやすい）＝下限は AA 4.5。
//  3. サイドバー上での部品の視認性（chip / アクティブの塗り）。文字でない境界がグラデの
//     上に乗るので、ライト on ライトでは WCAG 3:1 に届かない＝「見分けられるか」の緩い
//     下限にする。部品は塗りか枠線のどちらかで読めるので、テーマごとの最悪点に対して
//     良い方を採る。

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const CSS = path.join(import.meta.dirname, '..', 'app', 'src', 'renderer', 'design-tokens.css');

type Theme = 'light' | 'dark';

// 1. role = 文字トークン / ref = 主にその上に乗る背景
const CHECKS: { role: string; ref: string; floor?: number; band?: [number, number] }[] = [
  { role: '--text', ref: '--surface', floor: 11 },
  { role: '--text-strong', ref: '--surface', floor: 13 },
  { role: '--text-muted', ref: '--surface', band: [4.5, 6.0] },
  { role: '--text-muted-strong', ref: '--sidebar-bg', band: [6.5, 8.0] },
  { role: '--text-subtle', ref: '--surface', band: [2.2, 3.6] },
  // アクセントを前景/文字として使う経路（リンク・ホバーのラベル・アクティブのインク・
  // アクセント色アイコン）は専用の --accent-text 経由（--accent 自体は塗りで、ダークでは
  // 文字として暗すぎる＝2.88:1）。両テーマで AA を超えること。
  { role: '--accent-text', ref: '--surface', floor: 4.5 },
  // ステータス色を前景として使う経路（削除ラベル・エラー文）。本文の 4.5 ではなく
  // ステータス/アイコンの 3:1 ティアで見る＝彩度の高い赤は識別しやすく、短い操作ラベルと
  // アイコンにしか使わない（ライトの --danger は 3.91 でこのティアなら十分。将来 3:1 を
  // 割ったらここで捕まる）。
  { role: '--danger', ref: '--surface', floor: 3.0 },
];
// 帯で見るロールの、テーマ間の開き幅の上限
const MAX_SPREAD = 1.6;

// 2. 塗りの上に乗る前景＝塗りがずれると壊れる。下限は AA。
const FILL_CHECKS = [
  // アクセントの下限は 3.0（アイコン/大きい文字のティア）で 4.5 ではない: 水色のブランド
  // アクセントは意図的に明るい（DESIGN.md「水色アクセント」注意書き）。「弱ければ塗りだけ
  // 一段濃く」の条項に従い、ダークは sky-500→sky-600 へ動かしてこのティアを満たした
  // （両テーマ 3.32 — 2026-07-02 ユーザー判断）。
  { fg: '--accent-fg', fill: '--accent', floor: 3.0, what: 'アクセントボタン上の白文字' },
  { fg: '--accent-subtle-fg', fill: '--accent-subtle', floor: 4.5, what: 'アクティブ pill 上のインク' },
  // ステータスの塗りの上に乗る白アイコン（.ws-btn remove）。アイコンティア＝3:1。
  { fg: '--text-on-accent', fill: '--danger', floor: 3.0, what: 'danger（削除）ボタン上の白アイコン' },
];

// 3. サイドバー上で見えるべき非文字部品（塗りか枠線で読む）。緩い下限で「Mica に溶けた」
// 退行（実測 ~1.0）を捕まえつつ、正当に控えめなダークの浮き pill は通す。テーマごとの
// サイドバー最悪点＝ライトはグラデ下端（最も暗い）、ダークはサイドバー地（暗い chip が
// 乗る中で最も明るい点）。
const COMPONENT_CHECKS = [
  { name: 'chip', fill: '--chip-bg', border: '--chip-border', floor: 1.2 },
  { name: 'active fill', fill: '--accent-subtle', border: '--accent-subtle', floor: 1.2 },
];
// サイドバーは単色になった（縦グラデは廃止）ので、ライトの最悪点も --sidebar-bg
// （かつては --sidebar-grad-bot）。
const SIDEBAR_REF: Record<Theme, string> = { light: '--sidebar-bg', dark: '--sidebar-bg' };

// ---- CSS 解析: :root ブロックを全部ライトへ、dark ブロックを全部ダークへ合流させる
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

// ---- カスタムプロパティを、指定テーマでの [r,g,b] まで解決する（var() の連鎖を辿る）
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
