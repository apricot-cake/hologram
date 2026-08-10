// コンテンツ領域の要素がどこにあるか。それを実測する必要のあるモジュールのためのもの。
//
// どちらも以前は、シェルが保つと約束した id（`#mode-post`、`#postGrid`、`#posterGrid`）に
// 対する `document.getElementById` の探索だった＝#153 が禁じた「1バイト単位の DOM の
// 取り決め」。要素を描くのはシェルなので、代わりにシェルが渡してくる＝React 側では ref の
// コールバック、読み手側では getter。
//
// スクロールの根はウィンドウではない。ページは決してスクロールせず、コンテンツの列が
// スクロールする。閲覧の領域でスクロール位置を読み書きするものは、すべてこれを通る。

/** コンテンツ領域の3つの行き先。それぞれが自分のグリッドの枠を持つ。 */
export type GridKind = 'post' | 'poster' | 'trash';

let scrollerEl: HTMLElement | null = null;
const gridEls: Partial<Record<GridKind, HTMLElement | null>> = {};

/** コンテンツの列のための ref のコールバック（`<div ref={registerScroller}>`）。 */
export function registerScroller(el: HTMLElement | null): void {
  scrollerEl = el;
}

/**
 * コンテンツ領域のスクロールの入れ物。null になるのはシェルが載る前だけ＝呼び出し側は
 * どれもその後で走るが、型が起動の順序を正直に保つ。
 */
export function scroller(): HTMLElement | null {
  return scrollerEl;
}

/**
 * グリッド1つの枠のための ref のコールバック＝仮想化するホストが自分の masonry を
 * 差し込む箱。呼び出し側が種類ごとにモジュールスコープで1回だけ作る。同一性が変わると、
 * React が描画のたびに ref を外して付け直してしまうため。
 */
export const registerGridSlot = (kind: GridKind) => (el: HTMLElement | null) => {
  gridEls[kind] = el;
};

/** 枠そのもの。そこへ載るホストのためのもの。 */
export function gridSlot(kind: GridKind): HTMLElement | null {
  return gridEls[kind] ?? null;
}

/**
 * グリッドの小数を含む幅の切り捨て＝clientWidth は半端な px を切り上げるので、ちょうど
 * 埋まる列の大きさが 1px 広くなり、列が1つ黙って落ちる。グリッドが画面に出ていない時
 * （別の行き先が出ている時）は null なので、そこから計算するサイズのトラックは、推測せずに
 * 「答えが無い」と言える。
 */
export function gridWidth(kind: GridKind): number | null {
  const el = gridEls[kind];
  if (!el) return null;
  const w = Math.floor(el.getBoundingClientRect().width);
  return w || null;
}
