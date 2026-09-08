// app/src/renderer/design-tokens.css のテーマ間パリティの番人。
//
// トークンの体系は :root（ライト）と [data-theme="dark"] という2つの並行したブロックで
// 動く。テーマ別の意味トークン（色・影・パネルの細線）は必ず両方で定義する。:root にだけ
// 足してダークを忘れると、ダークは黙ってライトの値へ退避する（「片方のテーマしか変わって
// いない」不具合＝たとえばライトでは消えてしまう白いガラスの縁）。2つのブロックがずれた
// ときに、このテストが落ちる。
//
// 共有のトークン（原色のランプ・色ではない構造・動的な別名）は、意図して :root に1回だけ
// 定義してある。ここでは対象外。

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const CSS = path.join(import.meta.dirname, 'design-tokens.css');

// :root にだけ在るのが正しいトークン:
//  - 原色のランプ (gray/blue/indigo/red/green/amber) と、プラットフォームのブランド色
//  - 色ではない構造: spacing/radius/control/type-scale/weight/leading/tracking/font/easing/duration
//  - --ring（テーマ別の --focus-ring から動的に組み立てる）と、古い別名
//    (--fg/--muted/… は var() を経てテーマ別の意味トークンへ解決するので、一緒に切り替わる)
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
  // 色ではないレイアウトの定数（--tabbar-h と同じく、どちらのテーマでも同じ値）
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
  // #136 の、内容の上に乗る素材（不透明のスクリム＋ガラスのクローム）。その裏にあるのは
  // 任意の画像であってテーマの付いた UI ではない＝意図してテーマに依存させず、:root に1回
  // だけ置く。(--float-border はテーマ別のままで、いつもどおり検査する。)
  '--scrim-bg',
  '--scrim-ink',
  '--chrome-glass-bg',
  '--chrome-glass-blur',
  '--chrome-glass-rim',
]);
const isShared = (n: string) => SHARED_EXACT.has(n) || SHARED_PREFIX.some((p) => n.startsWith(p));

function collect() {
  const css = fs.readFileSync(CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''); // コメントを落とす（散文の中の --x を拾わないため）
  const light = new Set<string>();
  const dark = new Set<string>();

  // ここの宣言は波括弧を入れ子にしない（color-mix や linear-gradient は丸括弧を使う）ので、
  // 平坦な「セレクタ { 本体 }」の一致で足りる。
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

  // 本当に狙っている不具合＝ダーク側の相方が無い、テーマ別のライトのトークン
  test('ライト(:root)にあってダークに無いテーマ別トークンは無い', () => {
    // ここが落ちたら、ダーク側の値を足す。本当にテーマに依存しないものなら SHARED_* へ足す。
    expect([...light].filter((n) => !isShared(n) && !dark.has(n)).sort()).toEqual([]);
  });

  // 逆向き＝ダークにあってライトに無い（ライト側は何にも解決できなくなる）
  test('ダークにあってライトに無いトークンは無い', () => {
    expect([...dark].filter((n) => !light.has(n)).sort()).toEqual([]);
  });
});
