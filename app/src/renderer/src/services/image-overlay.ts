// 画像ビューの作画補助のオーバーレイの切り替え（#80）＝左右反転、グリッド、グレースケール。
// 表示側のツールバーの2つ目のまとまりで、ズームのまとまり（image-zoom.ts）の右にある。
//
// ズームと違い、この状態はスライドごとの載せ直しより上にある。image-tab/ImageTab.tsx は
// Zoomable / <video> / UgoiraPlayer に `item.src` の key を付けるので、素朴にスライドごとの
// ストアにすると、ページを送るたびに戻ってしまう。しかし #80 の確定した設計（2026-07-17）は、
// 1つの画像ビューの中でページを送っても切り替えが残ることを求めている（「タブ内一時・
// ページ送りで維持」）。だからこのモジュールは素のモジュールレベルのストアで、ツールバーの
// ボタンが直接書き、舞台が直接読む＝image-zoom.ts が必要としているような、スライドごとの
// 登録と解除は無い（ここで渡すべき命令的な DOM のインスタンスは無く、真偽値が3つあるだけ）。
//
// これが防ぐ漏れ: ある画像タブから別の画像タブへ直接切り替えても（どちらも既に自分の画像
// ビューを出している）、image-tab/index.tsx のホストが外れることはない＝変わるのは
// `activeImageTab` のストアの値の同一性だけ。image-tab/ImageTab.tsx が自分にタブの id の key を
// 付けているのは、まさにその切り替えでこのモジュールの reset() が走るようにするため（その
// マウントの effect を参照）＝切り替えの状態が、あるタブの絵から別のタブの絵へ持ち越されては
// いけない。
export interface ImageOverlayState {
  readonly flip: boolean;
  readonly grid: boolean;
  readonly gray: boolean;
}

const IDLE: ImageOverlayState = { flip: false, grid: false, gray: false };

// 書き換えず必ず差し替える。そうすれば useSyncExternalStore のスナップショットの同一性が、本物の変化の信号になる。
let state: ImageOverlayState = IDLE;
const subs = new Set<() => void>();

const notify = () => {
  for (const cb of [...subs]) {
    try {
      cb();
    } catch (_e) {
      /* 1つの購読側の不調で、残りを止めてはいけない */
    }
  }
};

export const getState = (): ImageOverlayState => state;
export function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

export function toggleFlip(): void {
  state = { ...state, flip: !state.flip };
  notify();
}
export function toggleGrid(): void {
  state = { ...state, grid: !state.grid };
  notify();
}
export function toggleGray(): void {
  state = { ...state, gray: !state.gray };
  notify();
}

// image-tab/ImageTab.tsx のマウントの effect が1回だけ呼ぶ＝別の画像タブになるたびに発火する
// （その key はタブの id）ので、新しく開いた、あるいは切り替えて着いたビューでは、3つの
// 切り替えが必ずオフから始まる。#80 が確定させた寿命に従う（永続化もせず、持ち越しもしない）。
export function reset(): void {
  state = IDLE;
  notify();
}
