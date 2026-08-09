// グリッドの寸法の登録簿＝キーボードでの選択の移動が、ウィンドウイングするグリッドから
// 受け取るしかなく、モデルからは導けない唯一のもの＝配置が実際に何列に落ち着いたかと、
// 見える位置までスクロールするために、ある項目がどこにあるか。
//
// どちらも masonic の positioner の中にあり、それは VirtualGridHost のローカルなフックの
// 結果だ。positioner を丸ごとアプリの状態へ持ち上げる（itemsKey や幅が変わるたびに作り
// 直される）のではなく、ホストが載る時に小さな読み取り専用のハンドルをここへ登録し、外れる
// 時に消す＝searchbox の focusSearchBox() と同じ ref の登録の形。React の外の呼び出し側
// （selection-builder）は下の関数から尋ね、グリッドが載っていなければ安全な既定を得る。
//
// 投稿グリッド専用。選択＝したがって矢印での移動＝は投稿グリッドの領分（投稿者グリッドに
// 選択は無い）なので、キー付きの表ではなく枠は1つ。

export interface GridNavHandle {
  // positioner が実際に作った列の数（モデルが columnCount を固定していなければ＝例えば
  // 一覧なら 1＝masonic が入れ物の幅から導く）。
  columnCount(): number;
  // この項目が完全に見えるところまで、スクローラーを最小限だけ動かす。既に見えていれば
  // 何もしない。
  scrollIntoView(index: number): void;
}

let handle: GridNavHandle | null = null;

export function registerGridNav(h: GridNavHandle): () => void {
  handle = h;
  return () => {
    if (handle === h) handle = null;
  };
}

export function gridColumnCount(): number {
  const n = handle?.columnCount() ?? 1;
  return n > 0 ? n : 1;
}

export function scrollGridIndexIntoView(index: number): void {
  handle?.scrollIntoView(index);
}
