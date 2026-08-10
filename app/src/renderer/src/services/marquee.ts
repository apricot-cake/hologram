// ラバーバンドによる範囲選択の寸法＝グリッドのドラッグ選択の操作（#484）の、純粋な側の
// 半分。React のホストから意図して切り離してある。当たり判定は masonic の配置のモデル
// （positioner のセル）に対して走り、DOM の矩形には一切触れない。仮想化する
// グリッドはセルを絶対配置し、窓が動くにつれて載せたり外したりするので、DOM に基づく判定は、
// 帯をドラッグしている最中に、判定の対象を黙って変えてしまうからだ。計算をここに置いておけば、
// 素の数値で単体テストできる（scripts/marquee.test.ts）。
//
// このモジュールの座標はすべて入れ物の座標系（masonic のグリッドの入れ物＝原点はその左上で、
// スクロールの影響を受けない）。positioner.get() がセルを報告するのもこの座標系。

export interface MarqueeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MarqueeCell {
  index: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

// 何も無い場所への押下がラバーバンドになるまでに、ポインタが動くべき距離（px）。それ未満なら
// その操作は素のクリックのままで、それは何も起きないことではなく、同じ押下のもう半分
// （#242、下の clearsSelection）＝このしきい値が、クリック中の手の震えを帯として読ませない。
export const MARQUEE_THRESHOLD = 4;

// その押下をドラッグと見なせるだけ、ポインタが動いたか。どちらか片方の軸だけでも数え、
// しきい値はちょうどの値も含む。
export function exceedsThreshold(dx: number, dy: number, threshold: number = MARQUEE_THRESHOLD): boolean {
  return Math.abs(dx) >= threshold || Math.abs(dy) >= threshold;
}

// 同じ操作のクリック側の半分（#242）。何も無い場所への押下が最後までドラッグにならなければ、
// 指を離した時に選択を消す。Ctrl/Shift を押していれば消さない。これは調べたどのラバーバンドの
// 実装にも共通する作法で＝Nautilus は unselect_all を
// `!(modifiers & (GDK_CONTROL_MASK | GDK_SHIFT_MASK))` で守り、Dolphin は clearSelection() を
// `!shiftOrControlPressed` で止める＝しかも帯自身が「置き換えではなく拡張する」ために読むのと
// 同じフラグなので、1回の押下が「拡張」と「全消し」を同時に意味することはありえない。
//
// 押下時ではなく離した時に決めるのは、イベントの順序がそう強いるから＝押下の時点では、帯が
// 来るかどうかがまだ分からない。Qt（digiKam）も同じ解き方をする。GTK 系の実装が押下時に消すのは、
// あちらの帯がどのみち選択を置き換えるからで、ここではそうではない＝追加する帯は、始めた時点の
// 選択を保たなければならない。
export function clearsSelection(dragged: boolean, additive: boolean): boolean {
  return !dragged && !additive;
}

// ポインタがスクローラーの端にどれだけ近づいたら、帯の下でグリッドがスクロールし始めるか。
// そしてその最大の速さ（アニメーションの1フレームあたりの px なので、1秒でおよそ60倍）。
export const AUTOSCROLL_EDGE = 48;
export const AUTOSCROLL_MAX = 24;

// 押下した点と今のポインタの間の帯。幅と高さが負にならないよう正規化する（上や左へ
// ドラッグしても同じ矩形になる）。
export function rectFromPoints(ax: number, ay: number, bx: number, by: number): MarqueeRect {
  return { x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) };
}

// 包含ではなく交差で判定する＝帯が触れただけのカードも選ばれる。エクスプローラーも Finder も
// 交差を使う（#484 の Issue 本文）＝完全に包むことを求めると、背の高い masonry のカードは
// ほとんど選べなくなる。1枚のカードが、見えている帯より背が高くなりうるからだ。
//
// 辺は含めない。カードの境界にちょうど止まった帯は、そのカードに触れない＝だから溝を
// なぞるドラッグは、両隣を選ぶのではなく何も選ばない。
export function intersects(rect: MarqueeRect, cell: MarqueeCell): boolean {
  return rect.x < cell.left + cell.width && rect.x + rect.width > cell.left && rect.y < cell.top + cell.height && rect.y + rect.height > cell.top;
}

// 帯が触れたセルの添字を、昇順で返す。呼び出し側は帯の縦の範囲であらかじめ絞る
// （masonic の区間木が O(log n) でやる）ので、`cells` はグリッド全体ではなく候補の集合。
export function hitIndices(rect: MarqueeRect, cells: readonly MarqueeCell[]): number[] {
  const hits: number[] = [];
  for (const cell of cells) if (intersects(rect, cell)) hits.push(cell.index);
  return hits.sort((a, b) => a - b);
}

// アニメーションの1フレーム分の、符号付きのスクロール量。負ならグリッドを上へ、正なら下へ
// 引き、ポインタがどちらの端からも離れていれば 0。速さはポインタが端の帯へどれだけ食い込んで
// いるかで増える（スクローラーの外へ出ても増え続け、`max` で頭打ちになる）。だから修飾キー
// 無しで、ゆっくりした前進も速い一掃も両方できる。
export function autoScrollStep(pointerY: number, viewTop: number, viewBottom: number, edge: number = AUTOSCROLL_EDGE, max: number = AUTOSCROLL_MAX): number {
  if (edge <= 0) return 0;
  if (pointerY < viewTop + edge) {
    const depth = Math.min(edge, viewTop + edge - pointerY);
    return -Math.ceil((depth / edge) * max);
  }
  if (pointerY > viewBottom - edge) {
    const depth = Math.min(edge, pointerY - (viewBottom - edge));
    return Math.ceil((depth / edge) * max);
  }
  return 0;
}
