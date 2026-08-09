// ズームのアンカー（#282）＝「利用者はどの項目を見ていて、それは画面のどれくらい下に
// あったか」を素の数値で表したものと、ズームの側が問い合わせる小さな登録簿。
//
// Ctrl＋ホイールのズーム（#141）は列の幅を変え、masonry 全体を並べ直す。それをまたいで同じ
// 項目に視点を留めるのは配置の問題だ。項目がどこに落ち着いたかを知っているのは、その配置を
// 計算した島だけだから。だからズームの側（grid-density-builder.ts）がホイールの時点で
// アンカーを解決して渡し、グリッドの島（_shared/VirtualGrid.tsx）が自分の positioner を読んで
// 位置を合わせる＝TanStack Virtual の scrollToIndex(index, {align}) と同じ分担で、masonic には
// それに当たるものが無い。
//
// 計算を React のホストから切り出してあるのは marquee.ts と同じ理由＝配置のモデル
// （positioner のセル）に対して走り、DOM の矩形には一切触れないので、素の数値で単体テスト
// できる（scripts/zoom-anchor.test.ts）。
//
// 座標系は2つあり、混ぜることが罠のすべて:
//   - 入れ物の座標系＝原点は masonry の入れ物の左上で、スクロールの影響を受けない。
//     positioner.get() が報告するのはこれなので、下の `top`/`left` はこの座標系。
//   - ビューポートの座標系＝スクローラーの見えている箱の上端から下へ何 px か。
//     `viewportOffset` はこちら＝「この項目を、画面のこの高さへ戻せ」。
// 両者をつなぐのが `containerOffset`＝masonry の入れ物の上端が、スクローラーの中身の
// どれだけ内側にあるか（有効な絞り込みのバーなどが、その上にある）。
//
// 留めるのは縦の軸だけ。横は留められない＝列数が変わると項目は横へ動くが、それを追いかける
// 横スクロールが存在しない（#282 が明示している限界）。

// ズームがグリッドに留めてほしいと頼むもの。`index` はグリッドの項目の配列の添字＝
// 並べ直しを生き延びるが、px の位置は生き延びない。
export interface ZoomAnchor {
  index: number;
  viewportOffset: number;
}

// 配置済みのセル1つを、入れ物の座標系で表したもの（masonic の PositionerItem に、
// positioner が共有する columnWidth を足した形）。
export interface ZoomAnchorCell {
  index: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

// 点からセルの矩形までの距離の2乗。点が中にあれば 0。2乗のままなのは順序しか使わないから＝
// 平方根は要らない。
function distanceSq(x: number, y: number, cell: ZoomAnchorCell): number {
  const dx = x < cell.left ? cell.left - x : x > cell.left + cell.width ? x - (cell.left + cell.width) : 0;
  const dy = y < cell.top ? cell.top - y : y > cell.top + cell.height ? y - (cell.top + cell.height) : 0;
  return dx * dx + dy * dy;
}

// (x, y) を中心にしたズームが留めるべき項目。そこに何も配置されていなければ null。
//
// 厳密な「カーソルの下」ではなく最も近いものを返す。ポインタが溝に落ちたり、最後の行より
// 下に来ることは十分に多く、含まれるかどうかだけで判定すると「何も無い」と答え続けてしまう＝
// しかも呼び出し側は見えている窓のセルを渡すので、最も近いものは常に利用者が見られるもの。
// セルの中にある点は距離 0 なので、含まれる場合も同じ規則のちょうどの場合でしかない。
// 同点（横の溝にある点は両隣から等距離）のときは小さい方の添字＝左上に近い方を採るので、
// 選択は走査の順序に左右されず安定する。
export function pickAnchorIndex(cells: readonly ZoomAnchorCell[], x: number, y: number): number | null {
  let best: number | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const cell of cells) {
    const d = distanceSq(x, y, cell);
    if (d < bestD || (d === bestD && best !== null && cell.index < best)) {
      best = cell.index;
      bestD = d;
    }
  }
  return best;
}

// セルが今、画面のどこにあるか＝アンカーのもう半分で、並べ直しの前に捕まえておく。
export function anchorViewportOffset(cellTop: number, containerOffset: number, scrollTop: number): number {
  return containerOffset + cellTop - scrollTop;
}

// その厳密な逆＝並べ直しでセルが `cellTop` へ移った後、それを `viewportOffset` へ戻す
// scrollTop。スクローラーの実際の範囲へ丸めるので、どちらかの端に近いアンカーは、ブラウザに
// 黙って直される scrollTop を残すのではなく「中身が許す限り近く」へ落ちる。
export function anchorScrollTop(cellTop: number, containerOffset: number, viewportOffset: number, maxScrollTop: number): number {
  const top = containerOffset + cellTop - viewportOffset;
  if (!(maxScrollTop > 0)) return 0;
  return Math.max(0, Math.min(maxScrollTop, top));
}

// --- 登録簿 --------------------------------------------------------------
// ズームの側は React の外にいて positioner を持たない。グリッドの島は持っているが、それは
// VirtualGridHost のローカルなフックの結果だ。services/grid-nav.ts と同じ形＝島が載る時に
// 読み取り専用のハンドルを登録し、外れる時に消す。グリッドが載っていなければ、呼び出し側は
// null を受け取る。
//
// 投稿グリッド専用＝キー付きの表ではなく、枠は1つ。投稿者グリッドの Ctrl＋ホイールの経路は
// 1目盛りごとにコミットし、アンカーを取らないので、何も登録しない。

export interface ZoomAnchorHandle {
  // クライアント座標のポインタの位置（ホイールのイベントが運ぶもの）からアンカーを
  // 解決する。グリッドがまだ何も配置していなければ null。
  resolve(clientX: number, clientY: number): ZoomAnchor | null;
}

let handle: ZoomAnchorHandle | null = null;

export function registerZoomAnchorSource(h: ZoomAnchorHandle): () => void {
  handle = h;
  return () => {
    if (handle === h) handle = null;
  };
}

export function resolveZoomAnchor(clientX: number, clientY: number): ZoomAnchor | null {
  return handle?.resolve(clientX, clientY) ?? null;
}
