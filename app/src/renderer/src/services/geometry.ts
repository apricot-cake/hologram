// グリッドジオメトリサービス――純粋な列／サイズ／スライダートラックの計算。
// viewer.js から1:1で抽出した、viewer 分解（最終形B）における10番目の
// 「純粋ロジック→サービス」切り出し。post タイルのスライダーとポスター
// サイズのスライダーは、それぞれ同じ計算式（pColsFor/tileColsFor、
// pSizeFor/tileSizeFor、nBig/nSmall/反転トラックの導出）の専用コピーを
// 抱えていた――このモジュールが唯一の持ち主。実体は本物の ES モジュール
// （named exports）で、viewer.ts から直接 import される。DOM には触れない
// （コンテナは呼び出し側が測って metrics として渡す）。

// metrics の契約: m = { W: コンテナ幅 px（端数を切り捨てた幅――
// clientWidth は半ピクセルを切り上げるので、それだとぴったり収まるはずの
// サイズが1px 広くなり、1列を黙って落としてしまう）, g: 溝の px }。

// 与えられた最小列サイズで何列入るか（auto-fill minmax の計算――masonic
// の columnWidth は最小値で、列は埋めるよう伸びる。旧来の CSS グリッドと
// 同じ列数の式）。
export const colsFor = (size: number, m: HologramGridMetrics) => Math.max(1, Math.floor((m.W + m.g) / (size + m.g)));
// 目標の列数にぴったり収まる列サイズ。
export const sizeFor = (n: number, m: HologramGridMetrics) => Math.floor((m.W - (n - 1) * m.g) / n);
// ぴったり収まるサイズが max 以下に収まる最小の列数。ceil を使う――floor
// だと、サイズが頭打ちのまま二度と再フローしない切れ目を提供してしまう。
export const minColsFor = (max: number, m: HologramGridMetrics) => Math.max(1, Math.ceil((m.W + m.g) / (max + m.g)));

// 生の px ではなく「列数」に対応するサイズスライダーのトラックを導出する:
// 伸縮するグリッドは列数のしきい値でしかレイアウトを動かさないので、各
// デテントを1つの列数に対応させることで、すべてのステップが見える形に
// なる（無反応な領域が無い）。トラックは反転している（右＝大きい＝列数は
// 少ない）。
//   st = { min, max, size }（view のサイズ軸＋今の値）
//   opts.minCols ― nBig の絶対下限（カード表示は常に1列を許す）。
// { nBig, nSmall, single, value } を返す。single＝幾何学的に可能な列数が
// 1つしかない（1段しかないスライダーは何も伝えないので、呼び出し側が
// 隠す）。
export function sliderTrack(st: { min: number; max: number; size: number }, m: HologramGridMetrics, opts?: { minCols?: number }) {
  const nBig = (opts && opts.minCols) || minColsFor(st.max, m);
  const nSmall = Math.max(nBig, colsFor(st.min, m));
  const n = Math.min(nSmall, Math.max(nBig, colsFor(st.size, m)));
  return { nBig, nSmall, single: nBig === nSmall, value: nBig + nSmall - n };
}
// トラックの値を反転を解いて目標の列数へ戻す（自己反転――count→value も同じ式で写像する）。
export const trackCols = (value: number, nBig: number, nSmall: number) => nBig + nSmall - value;

// 表示サイズごとのサムネイル幅: ドラッグの1ピクセルごとにキャッシュキーが
// 断片化しないよう60px 刻みでバケット化し、サムネイル生成器が対応できる
// 範囲へ収める。
export const thumbW = (raw: number, min: number, max: number) => Math.min(max, Math.max(min, Math.ceil(raw / 60) * 60));
