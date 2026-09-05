// Hologram のページレベル UI のすべてが中に描かれる、唯一の ShadowRoot
// （#44。#154 が定めて #270 が先送りにした境界を実行に移すもの）。
//
// なぜ Shadow Root なのか。この拡張機能が描くものはすべて他人のページの
// 上に乗っている。root がなければホスト側の CSS がこちらの要素に届いてし
// まう（`div { all: unset }` や `*` ルールがあれば十分だ）し、こちらの
// CSS も向こうに届いてしまう。#270 はすべての宣言をインラインスタイルと
// して書くことでこの一線を守った（ホスト側の !important でないルールに
// 対して勝てる）が、そのせいで見た目を CSS クラスとして表現できなかった。
// root があって初めて、スタイルシートを1つにまとめられる。
//
// ここに「ない」もの。保存済みの印とホバー保存ボタンは、それが注釈を付
// ける画像の子要素のままだ。これらはこの層にはなく、このモジュールもそ
// れを望んでいない＝固定レイヤーはスクロールのフレームごとにビューポー
// ト座標をコピーしなければならず、それは滑らかなスクロールに対して目に
// 見えて遅れるし、ホスト自身の sticky ヘッダーの上に描画してしまう。ど
// ちらも以前の実装で実測済み（#270 の設計レビュー、2026-07-29）。それで
// もこれらは同じように隔離されている＝#310 がそれぞれの操作に、サブツ
// リー内その場に、専用の小さな shadow root を与えたので、移動しなくても
// 境界はそこにある（overlay.ts の CONTROL_TAG）。
//
// CSS はどうやって入るのか。注入する <style> は使わず、必ず constructed
// stylesheet を使う＝`style-src 'none'` を出しているホストは shadow
// root の中の <style> でも殺してしまうが、`adoptedStyleSheets` は CSP が
// 守るシンクではまったくない（実測済み、#270。完全な表は tokens.ts を参
// 照）。x.com はまさにそのポリシーを出している。
import { markUiLanguage } from './locale.ts';
import { ensureTokens, withCurrentTokenSheet } from './tokens.ts';
import componentsCss from './components.css?inline';

const HOST_TAG = 'hologram-extension-ui';

// ホスト要素自身の箱。インライン !important として書いているのは、これ
// がホストページから見えて対象にできる唯一の要素だからだ＝それ以外はす
// べて shadow の境界の裏にある。インライン !important はカスケードの頂
// 点なので、悪意ある `hologram-extension-ui { display: none !important }`
// でも負けない。
const HOST_STYLE: Record<string, string> = {
  position: 'fixed',
  inset: '0',
  // このレイヤーがページのクリックを食ってはいけない。各操作部分はそれ
  // ぞれ自分で pointer events を戻す（components.css を参照）。
  'pointer-events': 'none',
  'z-index': '2147483647',
  margin: '0',
  padding: '0',
  border: '0',
  // この要素のどこかに transform/filter/perspective があると、
  // `position: fixed` の子孫にとっての containing block になってしまう。
  // 中の画面はまさにそれが起きないことに依存している。
  transform: 'none',
  filter: 'none',
  contain: 'none',
  display: 'block',
  visibility: 'visible',
  opacity: '1',
};

const COMPONENTS_STATE = Symbol.for('hologram.components-stylesheet');
interface ComponentsState {
  css: string;
  sheet: CSSStyleSheet | null;
  previous: Set<CSSStyleSheet>;
}

const componentScope = globalThis as typeof globalThis & { [COMPONENTS_STATE]?: ComponentsState };

function componentsSheet(): CSSStyleSheet | null {
  const current = componentScope[COMPONENTS_STATE];
  if (current?.css === componentsCss) return current.sheet;
  let sheet: CSSStyleSheet | null = null;
  try {
    const created = new CSSStyleSheet();
    created.replaceSync(componentsCss);
    sheet = created;
  } catch {
    // jsdom や constructed stylesheet を持たないエンジンの場合: 詳細は下を参照
  }
  const next: ComponentsState = {
    css: componentsCss,
    sheet,
    previous: new Set(current?.previous ?? []),
  };
  if (current?.sheet) next.previous.add(current.sheet);
  componentScope[COMPONENTS_STATE] = next;
  return sheet;
}

function adoptCurrentStyles(root: ShadowRoot): void {
  try {
    const components = componentsSheet();
    const componentState = componentScope[COMPONENTS_STATE];
    const obsolete = componentState?.previous ?? new Set<CSSStyleSheet>();
    const kept = root.adoptedStyleSheets.filter((candidate) => candidate !== components && !obsolete.has(candidate));
    root.adoptedStyleSheets = [...withCurrentTokenSheet(kept), ...(components ? [components] : [])];
  } catch {
    /* constructed stylesheet はあくまで拡張であり、保存機能自体は使える */
  }
}

// この document 用の root。初回使用時に作成する。
//
// 呼び出しをまたいでだけでなく、スクリプトのインスタンスをまたいでも冪
// 等だ＝常駐する content script とオンデマンドの一括取り込みは同じ
// isolated world で動くが、別々のバンドルで別々のモジュールスコープを持
// つため、モジュールレベルのキャッシュはこの2つの間で共有されない。この
// 2つが共有しているのは DOM なので、尋ねる先も DOM にする＝`mode:
// 'open'` がそれを可能にしていて、`closed` では何も得られない（これは
// ページに対するセキュリティ境界ではなく、ページはどのみちホスト要素を
// 見られる）。
//
// document がそもそも root を持てない場合にだけ null を返す。呼び出し元
// は自前の要素へフォールバックするので、スタイルの失敗が保存経路を道連
// れにすることはない。
export function ensureUiRoot(): ShadowRoot | null {
  const parent = document.body || document.documentElement;
  if (!parent) return null;

  // Element ではなく HTMLElement として型付けしている: このタグは HTML
  // パーサーにとって未知だが、それでも HTMLUnknownElement なので style
  // 属性を持つ。何らかの理由でそうでない要素がこの名前で存在していても、
  // 下の attachShadow がどのみち失敗し、それは try/catch がすでに「root
  // なし」に変換している。
  const existing = document.querySelector<HTMLElement>(HOST_TAG);
  if (existing?.shadowRoot) {
    // SPA はノードをまるごと移動させたり捨てたりできる。もう document
    // にない root を返すのではなく、再度 attach する。
    if (!existing.isConnected) parent.appendChild(existing);
    // 信頼せず再度主張する: サブツリーを書き換えるホストページは、見え
    // ている要素からこの属性を落としてしまえる（#1057）。
    markUiLanguage(existing);
    ensureTokens();
    adoptCurrentStyles(existing.shadowRoot);
    return existing.shadowRoot;
  }

  try {
    const host = existing || document.createElement(HOST_TAG);
    for (const [property, value] of Object.entries(HOST_STYLE)) host.style.setProperty(property, value, 'important');
    markUiLanguage(host);
    const root = host.attachShadow({ mode: 'open' });
    adoptCurrentStyles(root);
    if (!host.isConnected) parent.appendChild(host);
    // ページ自身の UI もトークンを document 上に欲しがる（サブツリー内の
    // コンパクトな操作がそれを読む）。この呼び出しは冪等だ。
    ensureTokens();
    return root;
  } catch {
    return null;
  }
}

// 共有 root がアイドル中でも HMR が CSS を変えることがある。ユーザーが一
// 度も開いていないページレベルの host を作らずに、それを再読み込みす
// る。
export function refreshUiRootStyles(): void {
  ensureTokens();
  const root = document.querySelector(HOST_TAG)?.shadowRoot;
  if (root) adoptCurrentStyles(root);
}

// この root が持つものをすべて取り除く。host 要素自体はそのまま残す＝同
// じタブでの2回目の一括取り込みはそれを再利用するし、空の不活性なレイヤーは
// コストを生まない。
export function clearUiRoot(): void {
  const root = document.querySelector(HOST_TAG)?.shadowRoot;
  root?.replaceChildren();
}
