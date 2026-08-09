// 実行時における拡張機能のデザイントークン（#270）。
//
// 値そのものはアプリ自身のトークンから生成される。
// scripts/gen-extension-tokens.cts を参照。このモジュールは拡張機能のコー
// ドがそれらへアクセスする経路で、意図して解決済みの色ではなく
// `var(--hologram-…)` の参照を渡す＝この参照はブラウザのテーマが変わる
// たびに再解決されるので、ライト/ダークの切り替えは JavaScript の誰かが
// 気付いたり再描画したりしなくても、すでに画面にある UI に届く。
//
// 値がどうやってページへ届くか＝document へ adopt した constructed
// stylesheet であり、注入する <style> は絶対に使わない。
// `style-src 'none'` を出しているページで実測した（2026-07-29）:
//
//   isolated world からの <style>   ブロックされる（CSP レポート、効果なし）
//   shadow root 内の <style>        ブロックされる（同上）
//   document.adoptedStyleSheets     効く
//   element.style.setProperty       効く
//
// つまり旧 glass-ui.ts にあった長年の注記「注入する <style> はホスト
// ページの style-src の対象になる」は正しかったし、今も正しい＝x.com の
// ようなサイトはまさにそのポリシーを出している。それが知らなかったの
// は、constructed stylesheet が CSP の守るシンクではない（そもそもチェッ
// クすべきソースがない）ということと、CSSOM も同様だということだ。この
// モジュールとその呼び出し元が使っているのはこの2つなので、拡張機能は
// スタイルシートを一切禁じているページ上でも本物の CSS カスタムプロパ
// ティを持てる。
//
// Trusted Types はどちらにしても影響しない: `replaceSync` と
// `element.style` はスクリプトのシンクではない。innerHTML のような文字
// 列シンクは今も対象だ。icons.ts を参照。
import tokensCss from './tokens.generated.css?inline';
import { generatedActionBadge, generatedMotion } from './tokens.generated.ts';

// Web Animations（その `duration` はカスタムプロパティにできない）を通
// る入場・退場のポップのための、数値/文字列としての motion の値。
export const motion = generatedMotion;

// UI をそもそも注入できなかったとき（#269）に service worker が上げる
// ツールバーのバッジ。このファイルの中で唯一こちらが描いていない画面
// だ＝Chrome が解決済みの色からピルを描くので、これは var() 参照ではな
// く値であり、テーマの切り替えに追従できない。生成されたファイルを参
// 照。
export const actionBadge = generatedActionBadge;

// トークンごとに参照を1つ。ページ上の UI を描くものはすべてこれを経由
// する。これが色のリテラルを拡張機能の他の部分から締め出している
// （scripts/extension-tokens.test.ts が強制する）。
export const token = {
  // 浮かんでいる画面そのもの
  surface: 'var(--hologram-surface)',
  ink: 'var(--hologram-ink)',
  inkMuted: 'var(--hologram-ink-muted)',
  overlayBorder: 'var(--hologram-overlay-border)',
  overlayShadow: 'var(--hologram-overlay-shadow)',
  radius: 'var(--hologram-radius)',
  // state
  accent: 'var(--hologram-accent)',
  accentSoft: 'var(--hologram-accent-soft)',
  onAccent: 'var(--hologram-on-accent)',
  success: 'var(--hologram-success)',
  onSuccess: 'var(--hologram-on-success)',
  warning: 'var(--hologram-warning)',
  onWarning: 'var(--hologram-on-warning)',
  danger: 'var(--hologram-danger)',
  onDanger: 'var(--hologram-on-danger)',
  badgeNeutral: 'var(--hologram-badge-neutral)',
  ring: 'var(--hologram-ring)',
  hover: 'var(--hologram-hover)',
  // カードではなく写真の上に乗るコンパクトな操作。リムはカードのもの
  // で、塗りは retry を除くすべての面について下の半透明ディスク。
  // retry だけは不透明な `danger` を取る＝その塗り自体が状態を表すから
  // だ（#526。理由とアルファの上下限は tokens.source.css で論じてい
  // る）。
  controlSurface: 'var(--hologram-control-surface)',
  controlSurfaceHover: 'var(--hologram-control-surface-hover)',
  controlHoverGlow: 'var(--hologram-control-hover-glow)',
  // カードのものではなく自前の影（#310）: ぼかし36px・オフセット下12px
  // は24pxのディスクより幅が広く、自分の高さの半分ぶん下にはみ出す。
  // tokens.source.css で、これがなぜ印ではなく elevation として読めて
  // しまうのかを論じている。
  controlShadow: 'var(--hologram-control-shadow)',
  // type + motion
  fontSans: 'var(--hologram-font-sans)',
  durationBase: 'var(--hologram-duration-base)',
  durationFast: 'var(--hologram-duration-fast)',
  easeOut: 'var(--hologram-ease-out)',
} as const;

const TOKENS_STATE = Symbol.for('hologram.tokens-stylesheet');
interface TokensState {
  css: string;
  sheet: CSSStyleSheet | null;
  previous: Set<CSSStyleSheet>;
}

const tokenScope = globalThis as typeof globalThis & { [TOKENS_STATE]?: TokensState };

function state(): TokensState {
  const current = tokenScope[TOKENS_STATE];
  if (current?.css === tokensCss) return current;
  let nextSheet: CSSStyleSheet | null = null;
  try {
    nextSheet = new CSSStyleSheet();
    nextSheet.replaceSync(tokensCss);
  } catch {
    /* jsdom や constructed stylesheet を持たないエンジンの場合 */
  }
  const next: TokensState = {
    css: tokensCss,
    sheet: nextSheet,
    previous: new Set(current?.previous ?? []),
  };
  if (current?.sheet) next.previous.add(current.sheet);
  tokenScope[TOKENS_STATE] = next;
  return next;
}

// document 以外のどこかへ adopt する必要がある呼び出し元のための、
// constructed sheet そのもの＝ページレベルの ShadowRoot（#44）はまさに
// このオブジェクトを adopt する。だから生成されたファイルは `:root` だ
// けでなく `:root, :host` を対象にしている。モジュールのインスタンスご
// とに最大1回だけ構築する。constructed sheet が存在しない環境
// （オフラインのユニットスイートの jsdom）では null。
export function tokensSheet(): CSSStyleSheet | null {
  return state().sheet;
}

export function withCurrentTokenSheet(current: CSSStyleSheet[]): CSSStyleSheet[] {
  const tokenState = state();
  const kept = current.filter((candidate) => candidate !== tokenState.sheet && !tokenState.previous.has(candidate));
  return tokenState.sheet ? [...kept, tokenState.sheet] : kept;
}

// 冪等: ページ上のすべてのエントリポイントは、何かを組み立てる前にこれ
// を呼ぶ。常駐する content script とオンデマンドの Alt+S スクリプトは
// document ごとに1つの isolated world を共有するので、上のモジュール状
// 態も共有され、2回目の呼び出し元は無料で済む。
export function ensureTokens(): void {
  const tokenState = state();
  const created = tokenState.sheet;
  if (!created) return;
  try {
    // 前提とせずガードする: adoptedStyleSheets を一切持たない document
    // は、上のコンストラクタ失敗と同じ「ここにはスタイルがない」ケース
    // であり、この行での throw は呼び出し元のこの呼び出し以降の行をすべ
    // て道連れにしてしまう（memory: dead-dom-throw-kills-next-line）。ス
    // タイルなしの操作でも画像の保存はでき、それこそがこれらの何にも依
    // 存してはいけない部分だ。
    const current = document.adoptedStyleSheets;
    if (!current) return;
    document.adoptedStyleSheets = withCurrentTokenSheet(current);
  } catch {
    /* 理由は同上 */
  }
}

// 都度生きた状態で読み、絶対にキャッシュしない。旧 glass-ui.ts はこれを
// モジュールの import 時に一度だけ評価していたので、セッションの途中で
// reduced motion をオンにしたユーザーは、タブをリロードするまでアニ
// メーションが動き続けていた。色・書体・トランジションは生成されたシー
// トのメディアクエリに従う。尋ねる必要があるのは Web Animations だけ
// で、その `duration` はカスタムプロパティではなく数値だからだ。
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
