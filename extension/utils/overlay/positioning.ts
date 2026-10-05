// 隅の操作のアンカー: どのコンテナへ mount するか、left/top がどこに着地
// するか、そしてポインタがまだそれが注釈を付ける画像の「上」にあるか
// （モーダル・固定ヘッダーによる遮蔽、あるいは何も残っていない状態によ
// る）。#399 で overlay.ts から分離した。以下の数値をスタイルシートで
// はなくインライン !important で書いている理由は、Issue の #310 の設計
// 注記で説明している。
//
// 「純粋」と印を付けた3つの関数は、素の rect を受け取って素の数値を返
// す＝DOM もグローバルも使わない。これによって scripts/overlay-
// positioning.test.ts はブラウザなしで主要な配置の分岐を検証できる。こ
// こにあるそれ以外のものはすべて依然としてページに触れる
// （getBoundingClientRect、getComputedStyle、elementsFromPoint）。「ど
// の要素が containing block か」や「この点の上に何が乗っているか」を決
// めることは、生きた document を離れては意味を持たないからだ。受け入れ
// 基準（#399）は配置の数式であって、このモジュール全体ではない。
import type { OverlaySite, PostMediaElement } from '../extractor/types.ts';
import { CONTROL_INSET, CONTROL_SIZE } from './constants.ts';
import type { Anchor } from './types.ts';

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function rectHoldsPointer(r: RectLike, x: number, y: number): boolean {
  return x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height;
}
// DOMRect は right/bottom を getter として持つが、素の RectLike（ユニッ
// トテストが組み立てるもの）はそれらを明示的に与えなければならない。ど
// ちらも受け付ける。
function right(r: RectLike): number {
  return (r as DOMRect).right ?? r.left + r.width;
}
function bottom(r: RectLike): number {
  return (r as DOMRect).bottom ?? r.top + r.height;
}

// 純粋: positionControl におけるメディアアンカーの配置。`hostRect` は、
// 操作が箱自体へ直接 mount されているとき（別途 containing block を借
// りていないとき）は null になる＝その場合、隅は箱自身の左上から固定の
// inset の位置に座る。箱と host が同じ要素だからだ。
export function computeMediaOffset(hostRect: RectLike | null, boxRect: RectLike, inset: number): { left: number; top: number } {
  if (!hostRect) return { left: inset, top: inset };
  return { left: boxRect.left - hostRect.left + inset, top: boxRect.top - hostRect.top + inset };
}

// 純粋: positionTextControl におけるテキストアンカーの配置（#575）。印
// はアバター自身の縁、その円上の135度の点に座り（左上角からのオフセッ
// トとして表す）、その点がディスクの中心になるようディスクの半径分だけ
// 後退させる。これ以前に計測して却下した2つの配置については overlay.ts
// の履歴を参照。
export function computeTextOffset(hostRect: RectLike, avatarRect: RectLike, controlSize: number): { left: number; top: number } {
  const radius = (avatarRect.width + avatarRect.height) / 4;
  const offset = Math.round(radius - radius * Math.SQRT1_2 - controlSize / 2);
  return { left: avatarRect.left - hostRect.left + offset, top: avatarRect.top - hostRect.top + offset };
}

// 純粋: clearXViewerCloseButton における X の写真ビューアの閉じるボタン
// 回避。左端は画像に結びつけたまま、上端だけを衝突を解消するのにちょう
// ど足りる分だけ下げる。1つのボタンの下端をよけると別のボタンに乗って
// しまう場合に備えて、最大4回まで再チェックする。
export function resolveViewerCloseButtonClearance(hostRect: RectLike, left: number, top: number, controlSize: number, buttonRects: RectLike[]): number {
  let adjustedTop = top;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const controlLeft = hostRect.left + left;
    const controlTop = hostRect.top + adjustedTop;
    const collisions = buttonRects.filter((rect) => rect.width > 0 && rect.height > 0 && controlLeft < right(rect) && controlLeft + controlSize > rect.left && controlTop < bottom(rect) && controlTop + controlSize > rect.top);
    if (!collisions.length) break;
    const nextTop = Math.max(adjustedTop, ...collisions.map((rect) => bottom(rect) - hostRect.top + CONTROL_INSET));
    if (nextTop === adjustedTop) break;
    adjustedTop = nextTop;
  }
  return adjustedTop;
}

// === DOM: containing block（＝host）を選び、借りる ===

// メディアの箱は、プラットフォーム自身のプレーヤーが引き継ぐまでは
// <img> を保持している: X は動画や GIF 投稿のポスター用 <img> を、プ
// レーヤーが初期化した瞬間に <video poster="..."> へ差し替え、二度と
// <img> を戻さない（#450）。そのため <img> だけを探すと、まさに画面上
// にある投稿で何も見つからず、それが再生中の動画にボタンが一度も現れな
// かった理由だ。
export function postMediaIn(box: Element): PostMediaElement | null {
  if (box.tagName === 'IMG' || box.tagName === 'VIDEO') return box as PostMediaElement;
  return box.querySelector('img, video');
}

export function controlHost(box: Element): HTMLElement | null {
  // それ自体が absolute/fixed で位置指定された箱（Bluesky の
  // image-fill パターン: 素の、サイズ指定のないラッパーの中にある
  // <img style="position:absolute;inset:0">）は、すでにフローの外にあ
  // り、containing block はツリーのさらに上にある。直近の親に
  // position:relative を借りる（下の一般的なケース）と、その
  // containing block を黙って置き換えてしまう＝ラッパー自身には高さが
  // なく（唯一の子がフローの外にあるため）、操作が mount されている間、
  // 画像は高さ0に潰れてしまう。これが #347 の「画像がちらつく」半分
  // で、bsky.app で実際に確認済みだ。新しく作るのではなく、すでにそれ
  // を定義している祖先まで遡る。
  const boxPosition = box instanceof HTMLElement ? getComputedStyle(box).position : null;
  if (boxPosition === 'absolute' || boxPosition === 'fixed') {
    let node = box.parentElement;
    while (node && getComputedStyle(node).position === 'static') node = node.parentElement;
    return node;
  }
  // <img> は子要素を持てない。その直近の親はそのスクロール transform
  // を共有していて、プラットフォーム固有のメディアの箱は自身が host に
  // なる。
  return box instanceof HTMLImageElement ? box.parentElement : box instanceof HTMLElement ? box : null;
}

// shadow の境界の裏へ絶対に持っていけない唯一のもの: containing block
// はページ自身の要素でなければならず、そのため借りてきた
// `position: relative` はページの要素に書き込まれ、ページのカスケード
// の対象であり続ける。!important にしているのは、そうしないと
// `* { all: unset !important }` のようなありふれたホスト側のルールが勝
// ってしまい、操作はさらに上の何かの祖先を基準に配置されて画像のどこに
// も近くない場所に着地してしまうからだ＝操作自体は存在していて正しい
// ことを言い続けているだけに、静かな失敗になる。以前のインライン値とそ
// の priority の両方を保持しておくことで、unmount 時にページを元どお
// りに戻せる。
export function borrowHostPosition(anchor: Anchor, host: HTMLElement): void {
  anchor.hostInlinePosition = host.style.getPropertyValue('position');
  anchor.hostInlinePriority = host.style.getPropertyPriority('position');
  host.style.setProperty('position', 'relative', 'important');
}

export function restoreControlHost(anchor: Anchor): void {
  if (anchor.host && anchor.hostInlinePosition !== null && anchor.host.style.getPropertyValue('position') === 'relative') {
    if (anchor.hostInlinePosition) anchor.host.style.setProperty('position', anchor.hostInlinePosition, anchor.hostInlinePriority);
    else anchor.host.style.removeProperty('position');
  }
  anchor.host = null;
  anchor.hostInlinePosition = null;
  anchor.hostInlinePriority = '';
}

// 隅の host 要素をその containing block へ mount する。箱がまだ確立し
// ていなければ、先に `position: relative` を借りる。コンテナが見つから
// なければ false を返す（mount する先が何もない＝paint() はこのパスで
// このアンカーをスキップし、半端に mount された操作を残さない）。
export function mountControl(anchor: Anchor, el: HTMLElement): boolean {
  // テキストアンカーの箱は投稿ユニットそのもの（#575）: すでに位置指定
  // されていて、すでに正しいサイズで、遡って探すものが何もない。
  // controlHost() の static/absolute を遡る処理はメディアの箱の
  // containing block を選ぶためのもので、ここには当てはまらない。
  const host = anchor.kind === 'text' ? (anchor.box as HTMLElement) : controlHost(anchor.box);
  if (!host) return false;
  if (anchor.host !== host) {
    restoreControlHost(anchor);
    anchor.host = host;
    if (getComputedStyle(host).position === 'static') borrowHostPosition(anchor, host);
  }
  host.appendChild(el);
  return true;
}

// === DOM: 数値がどこに着地するか ===

// X の写真ビューアでは、画像自体がビューポートの左上に届くことがある。
// すると通常の画像の角への配置が、ビューアの閉じるボタンの上に乗ってし
// まう。左端は画像に結びつけたまま、その小さな角と交差するネイティブの
// ボタンを避けるのにちょうど足りる分だけ下げる。これは意図してビューア
// の安定したスワイプ用ラッパーに限定してある: フィードの画像は通常どお
// り6pxの画像の角への配置のままだ（#704）。
export function clearXViewerCloseButton(box: Element, hostRect: RectLike, left: number, top: number): number {
  if (!box.closest('[data-testid="swipe-to-dismiss"]')) return top;
  const buttonRects = [...document.querySelectorAll('button[aria-label]')].map((button) => button.getBoundingClientRect());
  return resolveViewerCloseButtonClearance(hostRect, left, top, CONTROL_SIZE, buttonRects);
}

// テキストのみの投稿の印（#575）はアバターに乗る。画像の印が画像に乗る
// のと同じやり方で、しかも同じ角、左上に。ここが置く数値については
// computeTextOffset を参照。
export function positionTextControl(anchor: Anchor, host: HTMLElement, site: OverlaySite, place: (left: number, top: number) => void): void {
  const hostRect = host.getBoundingClientRect();
  const avatar = site.textAnchorIn?.(anchor.box)?.getBoundingClientRect();
  if (!avatar) return;
  const { left, top } = computeTextOffset(hostRect, avatar, CONTROL_SIZE);
  place(left, top);
}

export function positionControl(anchor: Anchor, el: HTMLElement, site: OverlaySite): void {
  const host = anchor.host;
  // host 要素の箱の残りの部分と同じ理由で !important にしている
  // （control.ts の CONTROL_HOST_STYLE）: この2つの数値は、画像の角と、
  // こちらを containing している何かの左上との差分だ。
  const place = (left: number, top: number) => {
    el.style.setProperty('left', `${left}px`, 'important');
    el.style.setProperty('top', `${top}px`, 'important');
  };
  if (anchor.kind === 'text') {
    positionTextControl(anchor, host || (anchor.box as HTMLElement), site, place);
    return;
  }
  if (!host || host === anchor.box) {
    const boxRect = anchor.box.getBoundingClientRect();
    const { left, top } = computeMediaOffset(null, boxRect, CONTROL_INSET);
    place(left, clearXViewerCloseButton(anchor.box, boxRect, left, top));
    return;
  }
  const hostRect = host.getBoundingClientRect();
  const boxRect = anchor.box.getBoundingClientRect();
  const { left, top } = computeMediaOffset(hostRect, boxRect, CONTROL_INSET);
  place(left, clearXViewerCloseButton(anchor.box, hostRect, left, top));
}

// === DOM: ポインタの遮蔽（ポインタは本当にこの画像の「上」にあるか） ===

// このアンカーの画像の上に、モーダル（これとは別のライトボックス、投
// 稿作成ダイアログ）が重なっているか。「モーダルが何か開いていれば一
// 律」というのが元のルールだった（#347）: これはダイアログの背後にあ
// る画像を保護する。隅の操作は自分の画像のスタッキングコンテキスト内で
// しか z-index:1 を持たず、そこでは届かず見た目もおかしくなるからだ。
// しかし X 自身の写真ビューアはそれ自体が
// `[role="dialog"][aria-modal="true"]` であるため、その一律ルールは
// ビューア自身の画像も永久に届かなくしてしまった（#659）＝これはこの
// 番人が隠すつもりなど一度もなかったものだ。アンカーを内包するモーダル
// はそれを覆っているのではなく、それこそが今見られているものだ。
export function modalCovers(anchor: Anchor): boolean {
  return [...document.querySelectorAll<HTMLElement>('dialog[open], [role="dialog"], [aria-modal="true"]')].some((el) => {
    if (el.contains(anchor.box)) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  });
}

// ポインタがある場所で、画像の上に何かが重なっているか（ライトボック
// ス、ページ自身の固定ヘッダー）。操作の位置ではなくポインタの位置で判
// 定する: 操作は画像の左上の角にあるので、そこで判定すると「その角は
// ヘッダーの下にあるか」にしか答えられず、画像の上端が x.com のヘッ
// ダーを過ぎてスクロールすると、完全に見えている画像の中央にとどまる
// ポインタからボタンが消えてしまっていた（#347）。
//
// 層は画像自身に到達するまでしか数えず、しかも fixed/sticky のものだ
// けだ: サイト自身がメディアの上に描く操作（Bluesky の ALT バッジ、
// pixiv のブックマークハート）は同じスタック内の絶対位置指定された兄
// 弟要素であり、それにホバーすることは依然として画像へのホバーだ
// （#338）。
export function pointerIsOccluded(anchor: Anchor, pointerPosition: { x: number; y: number } | null, pointerOverlayInMedia?: (overlay: Element, mediaBox: Element) => boolean): boolean {
  if (!pointerPosition) return false;
  if (typeof document.elementsFromPoint !== 'function') return false;
  const hitBox = anchor.hitBoxes.find((box) => rectHoldsPointer(box.getBoundingClientRect(), pointerPosition.x, pointerPosition.y)) || anchor.box;
  for (const el of document.elementsFromPoint(pointerPosition.x, pointerPosition.y)) {
    if (el === hitBox || hitBox.contains(el) || el.contains(hitBox)) return false;
    if (anchor.el && (el === anchor.el || anchor.el.contains(el))) return false;
    if (pointerOverlayInMedia?.(el, hitBox)) continue;
    const position = getComputedStyle(el).position;
    if (position === 'fixed' || position === 'sticky') return true;
  }
  return false;
}

// ポインタがどのアンカーの中にいるか＝DOM ツリーではなく幾何で判定す
// る。以前の祖先を遡る方式（「ポインタが物理的に着地した要素の祖先はど
// の追跡中の箱か」）は、自前の操作を画像の兄弟要素として画像の上に重ね
// るサイトでは壊れる: Bluesky ではポインタは <img> の上に乗る ALT/オー
// バーレイの div に着地し、<img>（その箱）はその div の兄弟であって祖
// 先では絶対にないので、この遡りは何も見つけられない（pixiv のブック
// マークハートも同じ形だ）。rect のテストなら何が上に重なっていようが
// 関係なく、しかもポインタがその上にある間は操作を表示し続けられる
// （操作は箱自身の rect の中に座っているから）。`anchors` は追跡中の
// すべてではなく画面上にあるアンカーだけに絞られていることを前提にして
// いるので、1回の判定でもせいぜい数個の rect しか読まない。
export function anchorAtPoint(anchors: Iterable<Anchor>, x: number, y: number): Anchor | null {
  let hit: Anchor | null = null;
  let hitArea = Number.POSITIVE_INFINITY;
  for (const anchor of anchors) {
    const matches = anchor.hitBoxes.map((box) => box.getBoundingClientRect()).filter((rect) => rectHoldsPointer(rect, x, y));
    if (!matches.length || modalCovers(anchor)) continue;
    // 重なっている場所では最小の箱が勝つので、引用された投稿の中の画像
    // は、その背後にある外側の投稿自身の画像より優先される。
    const area = Math.min(...matches.map((r) => r.width * r.height));
    if (area < hitArea) {
      hitArea = area;
      hit = anchor;
    }
  }
  return hit;
}

// pointer-events:none の可視面を座標委譲するとき、その点を本当に拡張機能が
// 所有してよいか。画像を包むリンクは保存面の土台だが、画像内外を問わず
// 前面にある button/link/フォーム部品や、無関係な modal・cover はページの
// 操作であり奪わない。サイト固有のメディア装飾も、操作要素でなければ従来
// どおり画像の一部として扱える。
export function controlPointIsOwned(anchor: Anchor, x: number, y: number, pointerOverlayInMedia?: (overlay: Element, mediaBox: Element) => boolean, textAnchor?: Element | null): boolean {
  const top = document.elementFromPoint(x, y);
  if (!top) return false;
  // テキスト投稿の操作は投稿全体を hover 領域にする一方、面そのものは
  // avatar に置く。所有判定まで投稿全体を使うと <a><avatar></a> のリンクを
  // 「投稿の内側にある別の操作」と誤認するため、配置と同じランドマークを使う。
  const hitBox = anchor.kind === 'text' && textAnchor ? textAnchor : anchor.hitBoxes.find((box) => rectHoldsPointer(box.getBoundingClientRect(), x, y)) || anchor.box;
  // profile の <a><avatar></a> だけは操作面の土台として扱う。包含関係だけを
  // 例外条件にすると、<button><avatar></button> や role=button、フォーム、
  // 編集領域まで拡張機能が所有し、ページの trusted click を奪ってしまう。
  if (top.closest('button, input, select, textarea, summary, [role="button"], [role="link"]:not(a[href]), [contenteditable="true"]')) return false;
  const link = top.closest('a[href]');
  // X の実DOMは avatar container > profile link > img。サイトによっては
  // link > avatar container なので、期待するprofile linkとの包含は両向きを許す。
  if (link && !(link.contains(hitBox) || (anchor.kind === 'text' && hitBox.contains(link)))) return false;
  if (top === hitBox || hitBox.contains(top) || top.contains(hitBox)) return true;
  return pointerOverlayInMedia?.(top, hitBox) === true;
}

// すべての解除経路が尋ねなければならない問い、そしてそれらがホバーを落
// としてよい唯一の理由: ポインタはまだこの画像の上にあるか。操作を隠し
// うるものはすべてここを通るので、「カーソルが画像の上にある間はボタン
// が残る」というのは、各経路がそれぞれ覚えておくべきことではなく、コー
// ドの性質そのものになる（#347）。
export function pointerStillOn(anchor: Anchor | null, pointerPosition: { x: number; y: number } | null, pointerOverlayInMedia?: (overlay: Element, mediaBox: Element) => boolean): boolean {
  if (!anchor || !pointerPosition) return false;
  if (!anchor.box.isConnected || modalCovers(anchor)) return false;
  if (!anchor.hitBoxes.some((box) => rectHoldsPointer(box.getBoundingClientRect(), pointerPosition.x, pointerPosition.y))) return false;
  return !pointerIsOccluded(anchor, pointerPosition, pointerOverlayInMedia);
}
