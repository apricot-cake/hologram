// 表示の軸（#618）＝「どう見るか」を、直交したキーへ分解したもの。
//
// P2② は表示ポップオーバーを、3値のストアのキー1つ（`view` = card/tile/list）に被せた
// 見せかけとして出した。4つがまとめて1つの値に乗っていたせいで、「情報を表示」がメタデータと
// 一緒にサムネイルの形、GIF の再生、画像の画質まで切り替えていた。このモジュールがその
// 置き換え＝独立したキー3つ、正当な状態は5つ:
//
//   グリッド＋元の縦横比＋情報あり
//   グリッド＋元の縦横比＋情報なし
//   グリッド＋正方形＋情報あり
//   グリッド＋正方形＋情報なし
//   一覧                            （行そのものが情報なので、どちらのスイッチも効かない）
//
// 名付けについて。名前が付いているのは正方形の側だけ＝「元の縦横比のまま詰める」に専用の
// 語は要らない。だからこのコードベースに `masonry`/`waterfall` は無い（2026-07-19 に確定、
// #154）。`square` は Mac の写真アプリが「正方形のサムネイル」に使っているのと同じ語。
//
// #658 は4つ目の直交したキー `avatar` を足す＝上の各状態が2倍（アイコンのあり／なし）に
// なり、正当な状態は10。新しい概念は増えない（このモジュールが既に従っている「束ねずに
// 広げる」規則のまま）。無効になる条件が `square`/`info` と逆向きに走る理由は、下の
// `avatarDisabled` を参照。
import { store, subscribeKey } from './store.ts';

/** 表示の状態を作る、4つのストアのキー。 */
export const DISPLAY_KEYS = ['layout', 'squareThumbs', 'showInfo', 'showAvatar'] as const;

export interface DisplayShape {
  /** グリッドではなく行にする。true の間、下の2つのスイッチは効かない（そして無効になる）。 */
  list: boolean;
  /** グリッド。サムネイルをすべて正方形に切り抜き、グリッドを均一な格子にする。 */
  square: boolean;
  /** グリッド。サムネイルの下に、投稿者／抜粋／メタデータの塊を描く。 */
  info: boolean;
  /** AuthorLine に投稿者のアイコンを描く（#658）。`info` とは独立＝avatarDisabled を参照。 */
  avatar: boolean;
}

/** 既定はグリッド、元の縦横比、情報あり（旧 `view: 'card'` が描いていたもの）、アイコンあり。 */
export function currentShape(): DisplayShape {
  return {
    list: store.getState().layout === 'list',
    square: store.getState().squareThumbs === true,
    info: store.getState().showInfo !== false,
    avatar: store.getState().showAvatar !== false,
  };
}

/** 3つのキーのどれが変わっても発火する＝形を丸ごと導き直す呼び出し側のためのもの。 */
export function subscribeShape(cb: () => void): () => void {
  const unsubs = DISPLAY_KEYS.map((k) => subscribeKey(k, cb));
  return () => {
    for (const u of unsubs) u();
  };
}

/** 形が変わるたびに変わる値（useSyncExternalStore のスナップショット用）。 */
export function shapeSnapshot(): string {
  const s = currentShape();
  return `${s.list ? 'list' : 'grid'}|${s.square ? 'sq' : 'ar'}|${s.info ? 'info' : 'bare'}|${s.avatar ? 'av' : 'noav'}`;
}

// --- サイズの軸 -------------------------------------------------------------
// 配置ごとにサイズが1つ。グリッドのそれは列の幅（正方形が有効なら正方形の一辺＝どちらに
// しても同じ数値）で、一覧のそれはサムネイルの幅。
//
// グリッドの下限は `info` に、そしてそれだけに依存する。軸の小さい端ではセルがサムネイル
// そのものになる＝それが俯瞰のズーム（#141）で、メタデータの塊はそこに置き場が無い。だから
// 「情報を表示」を入れると下限が上がり（俯瞰のサイズにいるグリッドはそこまで引き上げられる）、
// 切ると小さい端がまた開く。
export const GRID_MAX = 560;
export const GRID_MIN_BARE = 48;
export const GRID_MIN_INFO = 200;
export const LIST_MIN = 56;
export const LIST_MAX = 200;

export const gridMin = (info: boolean): number => (info ? GRID_MIN_INFO : GRID_MIN_BARE);

/** グリッドの列の幅を、今の `info` のスイッチが許す範囲へ丸める。 */
export const clampGridSize = (px: number, info: boolean): number => Math.max(gridMin(info), Math.min(GRID_MAX, px));

/**
 * セルどうしの隙間、px 単位。式は1つで、読み手は2つ＝グリッドのモデルはこれを行と列の溝と
 * して masonic へ渡し、サイズのトラックは何列入るかを求めるのに同じ数値を要る。素の正方形の
 * 格子が最も詰まる（pixiv / X のメディアタブ）。文字を載せるものは、別々のカードとして
 * 読めるだけの余白が要る。
 */
export const gutterFor = (shape: DisplayShape): number => (shape.list ? 14 : shape.square && !shape.info ? 8 : 16);

/** 軸を1つ設定する。ストアへ書くことが操作の全部＝読み手はみな購読している。 */
export function setLayout(list: boolean): void {
  store.setState({ layout: list ? 'list' : 'grid' });
}
export function setSquare(on: boolean): void {
  store.setState({ squareThumbs: on });
}
export function setInfo(on: boolean): void {
  store.setState({ showInfo: on });
}
export function setAvatar(on: boolean): void {
  store.setState({ showAvatar: on });
}

// アイコンのスイッチが無効になる条件は、square/info とは逆向き。あちらは一覧モードで効かなく
// なる（行に情報の切り替えは別に無い＝上の `list` の doc を参照）。アイコンは一覧モードでも
// 描く場所がある。ListRow.tsx は、自分の「情報」の概念があろうとなかろうと、必ず AuthorLine を
// 描くからだ。アイコンの唯一の描画の場を奪うのは、グリッド自身の情報の塊が消えること＝
// PostCard.tsx は `shape.info` が false の時、その `info` の塊（AuthorLine の住処）を
// まったく描かないので、スイッチが働きかける先が残らない。よって、無効になるのはグリッドで、
// しかも info を切った後だけ。一覧では常に生かしておく（#658）。
export function avatarDisabled(s: DisplayShape): boolean {
  return !s.list && !s.info;
}

// --- 投稿者グリッドの軸（#630） ---------------------------------------------
// 同じ分解の、軸が1つ少ない版。保存した絵は正方形に切り抜く価値がありうる（ライブラリは
// あらゆる比率を持つ）が、アイコンは Hologram が読む5つのプラットフォームすべてで既に
// 正方形（X / Bluesky / Misskey / Mastodon / pixiv がそう配る）なので、ここに正方形の
// スイッチを置いても、操作の皮をかぶった恒等写像にしかならない。GitHub の Members や
// Stargazers、Linear の Members、Discord のメンバー一覧も、人の一覧に縦横比のスイッチを
// 付けていない。
//
//   グリッド＋情報あり  （GitHub の Members のカード）
//   グリッド＋情報なし  （アイコンだけの俯瞰＝#141 と同じ性格）
//   一覧                （行そのものが情報なので、スイッチは効かない）
//
// 撤去した3値の密度（card / tile / list）はこれに1対1で対応するので、これは同じ3つの状態を
// 2つのキーから描いているだけ＝増えたものも落としたものも無い。
// キーは投稿者グリッド専用（投稿グリッドとは共有しない）。軸の数が違うので、キーを共有すると
// 投稿者モードで `squareThumbs` が無意味になる＝見せかけが抱えていたのと同じ失敗。Finder や
// エクスプローラー、写真アプリの「ピープル」も同じく、アプリ全体に1つではなく、場所ごとに
// ビューを覚えている。
export const POSTER_DISPLAY_KEYS = ['posterLayout', 'posterShowInfo'] as const;

export interface PosterShape {
  /** グリッドではなく行にする。true の間、下のスイッチは効かない（そして無効になる）。 */
  list: boolean;
  /** グリッド。アイコンの下に、名前／ハンドル／プラットフォーム／件数の塊を描く。 */
  info: boolean;
}

/** 既定はグリッド、情報あり（旧 `posterView: 'card'` が描いていたもの）。 */
export function currentPosterShape(): PosterShape {
  return {
    list: store.getState().posterLayout === 'list',
    info: store.getState().posterShowInfo !== false,
  };
}

export function subscribePosterShape(cb: () => void): () => void {
  const unsubs = POSTER_DISPLAY_KEYS.map((k) => subscribeKey(k, cb));
  return () => {
    for (const u of unsubs) u();
  };
}

export function posterShapeSnapshot(): string {
  const s = currentPosterShape();
  return `${s.list ? 'list' : 'grid'}|${s.info ? 'info' : 'bare'}`;
}

// 投稿側と同じく、配置ごとにサイズが1つ。グリッドのそれは列の幅で、一覧にはまったく無い
// （行は高さの決まった1行の文字＝GitHub の貢献者の行にも、Linear のメンバーの行にもサイズの
// 操作は無い）。下限が「情報を表示」に連動する理由も向こうと同じ＝素のセルはアイコンだけなので
// 俯瞰のズームまで縮められるが、メタデータの塊を載せたセルは縮められない。
export const POSTER_GRID_MAX = 340;
export const POSTER_GRID_MIN_BARE = 72;
export const POSTER_GRID_MIN_INFO = 150;

export const posterGridMin = (info: boolean): number => (info ? POSTER_GRID_MIN_INFO : POSTER_GRID_MIN_BARE);

export const clampPosterGridSize = (px: number, info: boolean): number => Math.max(posterGridMin(info), Math.min(POSTER_GRID_MAX, px));

/** 投稿者のセルどうしの溝＝素のアイコンの格子が最も詰まる。 */
export const posterGutterFor = (shape: PosterShape): number => (shape.list ? 4 : shape.info ? 14 : 10);

export function setPosterLayout(list: boolean): void {
  store.setState({ posterLayout: list ? 'list' : 'grid' });
}
export function setPosterInfo(on: boolean): void {
  store.setState({ posterShowInfo: on });
}
