// app/src/renderer/design-tokens.css のテーマパリティガード。
//
// トークン体系は :root（ライト）と [data-theme="dark"] の2ブロック並列。テーマごとの
// セマンティックトークン（色・影・パネルの細線）は両方に定義されていなければならない＝
// :root にだけ足して dark を忘れると、dark は黙ってライトの値へフォールバックする
// （「片テーマだけ変更」バグ。例＝ライトで消える白いガラスの縁）。2ブロックがずれた時に
// ここで落ちる。
//
// 共有トークン（原始的なカラーランプ＋色でない構造＋動的エイリアス）は意図的に :root に
// 1回だけ定義するもので、対象外。

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const CSS = path.join(import.meta.dirname, '..', 'app', 'src', 'renderer', 'design-tokens.css');

// :root だけに置くのが正しいトークン:
//  - 原始的なランプ（gray/blue/indigo/red/green/amber）＋プラットフォームのブランド色
//  - 色でない構造: spacing/radius/control/type-scale/weight/leading/tracking/font/easing/duration
//  - --ring（テーマごとの --focus-ring を動的に合成）と旧エイリアス（--fg/--muted/… は
//    var() でテーマごとのセマンティクスへ解決されるので一緒に反転する）
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
  // 色でないレイアウト定数（--tabbar-h と同じく両テーマで同値）
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
  // #136 コンテンツの上に乗る素材（不透明スクリム＋ガラスのクローム）: 背後にあるのは
  // 任意の画像であってテーマ済みの UI ではない＝意図的にテーマ非依存で :root に1回だけ置く。
  // （--float-border はテーマごとのままで、通常どおり検査される）
  '--scrim-bg',
  '--scrim-ink',
  '--chrome-glass-bg',
  '--chrome-glass-blur',
  '--chrome-glass-rim',
  // モーションのタイミング。--dur-*/--ease-* と同じくテーマ非依存（接頭辞が違うだけ）＝
  // カード登場のずらし幅（34ms）は両テーマで同じ。
  '--stagger',
]);
const isShared = (n: string) => SHARED_EXACT.has(n) || SHARED_PREFIX.some((p) => n.startsWith(p));

function collect() {
  const css = fs.readFileSync(CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''); // コメント除去（散文中の --x を拾わない）
  const light = new Set<string>();
  const dark = new Set<string>();

  // ここの宣言は波括弧を入れ子にしない（color-mix/linear-gradient は丸括弧）ので、
  // 平坦な "セレクタ { 本体 }" のマッチで足りる。
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

  // 本命のバグ: ライトのテーマ別トークンに dark の対応値が無い
  test('ライト(:root)にあってダークに無いテーマ別トークンは無い', () => {
    // 落ちた時は「ダーク側の値を足す」か、本当にテーマ非依存なら SHARED_* へ足す
    expect([...light].filter((n) => !isShared(n) && !dark.has(n)).sort()).toEqual([]);
  });

  // 逆向き: ダークにあってライトに無い（ライト側が何にも解決できなくなる）
  test('ダークにあってライトに無いトークンは無い', () => {
    expect([...dark].filter((n) => !light.has(n)).sort()).toEqual([]);
  });
});
