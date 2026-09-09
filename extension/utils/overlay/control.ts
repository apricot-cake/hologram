import { mediaKeysOf } from '../extractor/index.ts';
// 隅の面: host 要素自身の shadow で隔離された箱（#310）、その中に描くディ
// スク、そしてある瞬間にどの面（mark/save/busy/failed）が求められている
// か。#399 で overlay.ts から分離した。スクロール、保存状態のまとめ処理、
// 保存のネットワーク呼び出し自体については何も知らない＝呼び出し元が何
// を表示するかと、押せる2つの面のためのコールバックを2つ渡す。
import { ICONS, makeIcon, makeSpinner } from '../icons.ts';
import type { MediaIdentitySite } from '../extractor/types.ts';
import { markUiLanguage } from '../locale.ts';
import { userOnly } from '../user-gesture.ts';
import { motion, prefersReducedMotion, token } from '../tokens.ts';
import { restoreControlHost, postMediaIn } from './positioning.ts';
import { postSavedState } from './saved-state.ts';
import type { Anchor, Face, MarkMode, UnitState } from './types.ts';
import { CONTROL_SIZE } from './constants.ts';

// shadow の host。ハイフン入りの名前があるからこそ、HTML パーサーが聞い
// たこともない要素で attachShadow が合法になる。そしてこれは、ホスト
// ページがこちらを対象にしようとするなら書かなければならない名前でもあ
// る。
export const CONTROL_TAG = 'hologram-corner-control';
// host 要素自身の箱＝この操作のうちページのカスケードがまだ届く唯一の
// 部分なので、すべての宣言はインライン !important にしてある（作者側の
// スタイルシートが書けるものでこれに勝てるものはない）。`all: initial`
// を最初に置いているのが、その後が続く理由だ: これによって、ページが
// shadow の境界越しに押し付けてくるはずだった継承フォント・色・行高・
// テキストレンダリングを落とす。カスタムプロパティはリセットしない＝だ
// からこそ --hologram-* トークンは中にもちゃんと届く。
export const CONTROL_HOST_STYLE: Array<[string, string]> = [
  ['all', 'initial'],
  ['position', 'absolute'],
  ['display', 'block'],
  ['width', `${CONTROL_SIZE}px`],
  ['height', `${CONTROL_SIZE}px`],
  ['pointer-events', 'auto'],
  // 画像より上、ページが意図して上げるものより下: これは他人のコンテン
  // ツへの注釈であって、その上に乗るレイヤーではない。
  ['z-index', '1'],
];
// 報告ではなく操作である2つの面。「これは押せる」から導かれるすべて
// （ネイティブの <button> 要素、アクセシブルな名前、タブストップ、ポイ
// ンタのカーソル）は、このただ1つの述語から決まる。だから、押せるはず
// の面が押せることに必要な何かを欠くことはありえない。retry は以前これ
// を欠いていた（#536）: 面ごとのコードが名前とタブストップを `save` に
// しか復元していなかったため、retry は tabIndex -1 の名前なしボタンの
// ままになっていた＝つまり失敗した保存からの復旧は、ポインタでしか到達
// できなかった。
export const isPressable = (face: Face) => face === 'save' || face === 'failed' || face === 'mark';
// 投稿の主眼になるには小さすぎる画像: 引用プレビューのサムネイル、アバ
// ターサイズの装飾。それらの保存が意図されていることはほぼない。
export const MIN_SAVE_PX = 100;

// ここでの保存は誠実なレコードを生むか。src のパターン（media-identity
// のプラットフォームごとのルール）、解決できる投稿、そして投稿の主眼に
// なるのに十分な大きさの画像＝この3つすべてが揃わなければボタンは出な
// い。
export function savable(anchor: Anchor, rect: DOMRect, media: MediaIdentitySite | null): boolean {
  if (anchor.kind === 'text') return true;
  if (!media) return false;
  if (rect.width < MIN_SAVE_PX || rect.height < MIN_SAVE_PX) return false;
  const el = postMediaIn(anchor.box);
  if (!el || !media.isPostMedia(el)) return false;
  return media.extractIdentity(el) != null;
}

export interface FaceContext {
  state: UnitState;
  anchor: Anchor;
  index: number;
  rect: DOMRect;
  markMode: MarkMode;
  hoverSave: boolean;
  hoveredAnchor: Anchor | null;
  media: MediaIdentitySite | null;
}

export function faceFor(ctx: FaceContext): Face | null {
  const { state, anchor, rect, markMode, hoverSave, hoveredAnchor, media } = ctx;
  if (anchor.phase === 'saving') return 'busy';
  if (anchor.phase === 'error') return 'failed';
  if (anchor.phase === 'flash') return 'mark';
  const item = anchor.kind === 'media' ? postMediaIn(anchor.box) : null;
  const individual = anchor.kind === 'media' && [...state.anchors.values()].filter((anchor) => anchor.kind === 'media').length > 1;
  const keys = individual ? (state.saved?.individualKeys ?? state.saved?.keys) : state.saved?.keys;
  const whole = state.saved?.whole && (!individual || state.saved.individualKeys === undefined);
  const imageSaved = whole || (!!item && !!media && mediaKeysOf(item, media.platform).some((key) => keys?.has(key)));
  const saved = anchor.kind === 'text' ? postSavedState(state) === 'complete' : imageSaved;
  const hovered = hoveredAnchor === anchor || (anchor.kind === 'text' && [...state.anchors.values()].some((a) => a === hoveredAnchor));
  if (saved) {
    if (markMode === 'off') return null;
    // 保存した画像ごとに印を置く。アバターは全体の保存状態を示す。
    if (markMode === 'always') return 'mark';
    // ホバー表示なら、問い合わせ対象の画像に乗る。
    return hovered ? 'mark' : null;
  }
  if (!hoverSave || !hovered || !state.url) return null;
  return savable(anchor, rect, media) ? 'save' : null;
}

// ページ側の host 要素と、その面を描く場所。shadow root が隔離の仕組み
// で、host 要素自身へのフォールバックは、このファイルの残りが従うのと
// 同じ「スタイルなしの操作でも画像は保存できる」というルールに従ってい
// る＝attachShadow が失敗するのは document がそもそもそれを持てない場
// 合だけで、そこで保存を失うのは境界を失うよりはるかに悪い取引だ。
export function makeControlHost(): { el: HTMLElement; root: ShadowRoot | HTMLElement } {
  const el = document.createElement(CONTROL_TAG);
  for (const [property, value] of CONTROL_HOST_STYLE) el.style.setProperty(property, value, 'important');
  el.setAttribute('data-hologram-overlay', '');
  // 4つの面はアクセシブルな名前以外の何物でもない（下の drawFace を参
  // 照＝24pxのディスクは誰に対しても視覚的には何も説明しない）ので、
  // ページ自身の `lang` がそこへ届くかどうかが、それらが何語で読み上げ
  // られるかを決める（#1057）。上の `all: initial` はここでは助けにな
  // らない: 言語はカスケードではなく DOM 上で確定するものだからだ。
  markUiLanguage(el);
  let root: ShadowRoot | HTMLElement = el;
  try {
    root = el.attachShadow({ mode: 'open' });
  } catch {
    /* 理由は上を参照 */
  }
  return { el, root };
}

// ディスクそのもの、shadow root の中。スタイルシートではなくインライン
// でスタイルを当てている: インラインなら CSSStyleSheet のコンストラク
// タ（jsdom にはない）も <style> 要素（`style-src 'none'` を出すホスト
// は shadow root の中でもそれを殺す＝#270 で実測済み）も要らず、shadow
// ツリーの中には打ち負かすべきホストのカスケードがそもそも残っていない
// ので、クラスを選ぶ通常の理由が消える。
export function makeControl(anchor: Anchor, pressable: boolean): HTMLDivElement | HTMLButtonElement {
  const el = document.createElement(pressable ? 'button' : 'div');
  if (el instanceof HTMLButtonElement) el.type = 'button';
  el.style.cssText = [
    `width:${CONTROL_SIZE}px`,
    `height:${CONTROL_SIZE}px`,
    'border-radius:50%',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'box-sizing:border-box',
    'margin:0',
    `border:1px solid ${token.overlayBorder}`,
    // カードのものではなく自前の影（#310 — tokens.source.css）。
    `box-shadow:${token.controlShadow}`,
    // width/height/border-radius はここにはない: #531 が4つの面すべて
    // に同じ24pxの円を与えたので、これらはもう面ごとに違うことがなく、
    // それらへのアニメーションはアニメーションすべきものが何も残ってい
    // ない。
    `transition:background ${token.durationBase},color ${token.durationBase},border-color ${token.durationBase},box-shadow ${token.durationBase},transform ${token.durationBase} ${token.easeOut}`,
    'appearance:none',
    `font-family:${token.fontSans}`,
  ].join(';');
  anchor.root?.replaceChildren(el);
  anchor.control = el;
  return el;
}

// 保存が成立した一瞬だけ、処理中だった場所で「終わった」と返す。ディスク全体
// を跳ねさせたり状態色を外へ広げたりせず、新しく現れたチェックだけを短く動か
// す。頻繁に使う操作の確認が、画像そのものより目立たないためだ。
export function celebrateSave(el: HTMLElement | null): void {
  if (!el || prefersReducedMotion()) return;
  el.firstElementChild?.animate(
    [
      { opacity: 0, transform: 'scale(0.6)', transformOrigin: 'center' },
      { opacity: 1, transform: 'scale(1.12)', transformOrigin: 'center', offset: 0.6 },
      { opacity: 1, transform: 'scale(1)', transformOrigin: 'center' },
    ],
    { duration: 300, easing: motion.easeOut },
  );
}

export function stopPress(e: Event) {
  e.preventDefault();
  e.stopPropagation();
}

export interface DrawFaceCallbacks {
  onOpen(): void;
  onSave(): void;
  onRetry(): void;
  names?: Partial<Record<Face, string>>;
}

// 押せることが伴うものを、面ごとにではなく1か所にまとめる: 要素の型、
// タブストップ、カーソル、そして下のアクセシブルな名前（これには面自身
// の文が必要で、それは switch が書く）。
//
// `title` はアクセシブルな名前の代わりに一度もなったことがない: それへ
// のフォールバックへの対応は支援技術によってまちまちで、キーボードで
// やってきた人には決して読み上げられない。#310 は tooltip を再実装する
// のではなく取り除いた。詳しい理由は overlay.ts の履歴を参照（印は事実
// を述べるものであって操作対象ではない。押せる2つの面はユーザーに1文を
// 負っているが、その置き場は名前であり、より長い話をするなら保存バナー
// だ）。
export function drawFace(anchor: Anchor, face: Face, t: (key: string) => string, callbacks: DrawFaceCallbacks): void {
  const pressable = isPressable(face);
  // busy はステータス表示で、保存済み・save・retry は操作用ボタン。
  // 状態に応じて要素を作り直し、ブラウザ標準のボタン操作を使う。
  let el = anchor.control;
  if (!el || el instanceof HTMLButtonElement !== pressable) el = makeControl(anchor, pressable);
  el.replaceChildren();
  el.onclick = null;
  el.onpointerdown = null;
  el.onpointerenter = null;
  el.onpointerleave = null;
  el.tabIndex = pressable ? 0 : -1;
  el.style.cursor = pressable ? 'pointer' : '';
  // ステータスの面は事実を述べるグラフィックだ。`img` があるからこそ、
  // 支援技術が読み飛ばす空の <div> ではなく、1つの名前を持つ1つのオブ
  // ジェクトになる。押せる面はすでに <button> であり、それ以外の何かだ
  // と告げてはいけない。
  if (pressable) el.removeAttribute('role');
  else el.setAttribute('role', 'img');
  // 隅の既定の塗り、それが何を言っていようと: 半透明のディスク。これは
  // ユーザー自身の画像の上に乗るものだからだ。それを手放すのは下の
  // `failed` だけで、危険色の塗りと引き換えになる。
  el.style.background = token.controlSurface;
  el.style.color = token.ink;
  el.style.width = `${CONTROL_SIZE}px`;
  el.style.height = `${CONTROL_SIZE}px`;
  el.style.padding = '0';
  el.style.gap = '0';
  el.style.borderRadius = '50%';
  el.style.borderColor = token.overlayBorder;
  el.style.boxShadow = token.controlShadow;
  el.style.transform = '';
  let name: string;
  switch (face) {
    case 'mark':
      // チェックの見た目を保ち、保存した投稿を開く操作にする。
      name = callbacks.names?.mark || t('cornerOpenSaved');
      el.appendChild(makeIcon(ICONS.check, 14));
      el.onpointerdown = stopPress;
      el.onclick = userOnly<MouseEvent>((e) => {
        stopPress(e);
        callbacks.onOpen();
      });
      break;
    case 'save': {
      name = callbacks.names?.save || t('cornerSave');
      el.style.color = token.ink;
      el.appendChild(makeIcon(ICONS.drop, 14));
      // どちらのハンドラもイベントを止める: この操作は投稿のサブツリー
      // の外にあるが、x.com と bsky.app は document で listen していて、
      // それらまで届いた押下は、保存の裏でライトボックスを開いてしま
      // う。
      el.onpointerdown = stopPress;
      el.onpointerenter = () => {
        // ホバー時の持ち上がりはディスクの不透明度ではなく色を変える:
        // ホバーで不透明にしてしまうと、まさにポインタがある場所、つま
        // り画像が見られているその場所で半透明を打ち消してしまう。
        el.style.background = token.controlSurfaceHover;
        el.style.boxShadow = `${token.controlShadow}, 0 0 0 2px ${token.controlHoverGlow}`;
        el.style.transform = 'scale(1.04)';
      };
      el.onpointerleave = () => {
        el.style.background = token.controlSurface;
        el.style.borderColor = token.overlayBorder;
        el.style.boxShadow = token.controlShadow;
        el.style.transform = '';
      };
      // 信頼された押下のみ（#323）。この操作は、それが注釈を付ける画像
      // の子要素なので、ページはそれを見つけてクリックでき、この経路は
      // それ以上の確認なしに保存する。
      el.onclick = userOnly<MouseEvent>((e) => {
        stopPress(e);
        callbacks.onSave();
      });
      break;
    }
    case 'busy':
      name = t('cornerSaving');
      el.appendChild(makeSpinner(14));
      break;
    case 'failed':
      // 失敗は行き止まりではない: もう一度押せばすぐに再試行し、放って
      // おけば自分から普通のボタンへ戻る。
      name = t('cornerRetry');
      el.onpointerdown = stopPress;
      el.onclick = userOnly<MouseEvent>((e) => {
        stopPress(e);
        callbacks.onRetry();
      });
      el.style.background = token.danger;
      el.style.color = token.onDanger;
      el.appendChild(makeIcon(ICONS.cross, 14));
      break;
  }
  el.setAttribute('aria-label', name);
}

export function removeControl(anchor: Anchor): void {
  anchor.el?.remove();
  anchor.el = null;
  anchor.root = null;
  anchor.control = null;
  anchor.face = null;
  anchor.accessibleName = null;
  restoreControlHost(anchor);
}

export function clearControls(state: UnitState): void {
  for (const [, anchor] of state.anchors) removeControl(anchor);
}
