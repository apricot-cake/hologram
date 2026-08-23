// タイムラインオーバーレイを分割したモジュール群が共有する形（#399）。1
// ファイルにまとめてあるのは、tracker.ts・saved-state.ts・
// positioning.ts・control.ts とコントローラ（overlay.ts）が、型に到達す
// るためだけに互いを import せずに同じ Anchor/UnitState を扱えるようにす
// るため。

// 隅が今何をしているか。`flash` はユーザーがここで行った保存の直後の瞬間
// を指す＝印は「表示しない」設定でも表示する。ユーザーがたった今押したボ
// タンには応答が返ってこなければならないからだ。
export type Phase = 'idle' | 'saving' | 'flash' | 'error';
// 隅が何を描いているか。null は何もない。
export type Face = 'mark' | 'partial' | 'save' | 'busy' | 'failed';
// 「保存済み」の印をどう表示するか（設定ページ）。既定は `always`＝この
// 印はステータス表示であり、その役目の一部は「これは保存したっけ」とい
// う問いが意識に上る前に済ませてしまうことにある。これができるのは静止
// した印だけだ。うるさいと感じる人のために hover も残してある（#309）。
export type MarkMode = 'always' | 'hover' | 'off';

export interface Anchor {
  box: Element; // この操作が隅に乗るメディアの箱
  // 'text'（#575）: box が画像ではなく投稿ユニット全体を指す＝画像そのも
  // のが存在しないケース。それでも印はどこかに乗る場所が必要なので、メ
  // ディア要素の代わりにユニット自身の箱（すでに位置とサイズが決まって
  // いる）を借りる。このアンカーを保存対象として扱おうとするもの（ボタ
  // ンの見た目、画像ごとのキー照合）は、代わりにここで短絡する。
  kind: 'media' | 'text';
  el: HTMLElement | null; // <hologram-corner-control>、ページのサブツリー内
  root: ShadowRoot | HTMLElement | null; // el の見た目を描く先
  control: HTMLDivElement | HTMLButtonElement | null; // ディスクそのもの
  host: HTMLElement | null; // メディアと一緒にスクロールする、位置決めされた親
  hostInlinePosition: string | null; // こちらが加えたインライン position を復元する
  hostInlinePriority: string; // …とそれを書いたときの priority
  face: Face | null; // el が今何を描いているか（再描画を省略できるように）
  accessibleName: string | null; // 同じ面のまま総ページ数だけ変わった場合の再描画判定
  phase: Phase;
  timer: ReturnType<typeof setTimeout> | null; // phase を idle へ戻すタイマー
}

// ライブラリが1つの投稿について持っているもの。この側から比較できる範囲
// で（#334）。ブリッジは投稿の保存済み画像を返す。`keys` は URL でページ
// と照合できるもの、`seqs` はライブラリが URL を持たなかったものの位置。
// `whole` は誠実なフォールバック＝投稿はライブラリにあるがその画像を区別
// できない場合（テキストのみの投稿、画像ごとの答えができる前に保存され
// たレコード、ページ側の対応物がポスターフレームしかない動画）で、画像
// ごとの答えが存在する前にこのオーバーレイがやっていたのとまったく同じ
// 形で投稿に印を付ける。
export interface SavedPictures {
  whole: boolean;
  keys: Set<string>;
  seqs: Set<number>;
  // 元投稿が持つ画像の総数。古い索引や総数を記録できない投稿では null。
  // 一覧の代表サムネイルで「一部」と「全ページ」を区別するために使う。
  total: number | null;
}

export interface UnitState {
  url: string | null;
  saved: SavedPictures | null; // null = ライブラリにない（またはまだ問い合わせていない）
  anchors: Map<Element, Anchor>;
}
