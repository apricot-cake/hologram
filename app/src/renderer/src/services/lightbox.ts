// 画像1枚のクイックビュー（覗き見）の状態＝lightbox/index.tsx から切り出したもの
// （settings.ts と並ぶ「本当にコンポーネントに縛られたグローバル」2つのうちの1つ）。これで
// orchestrator.ts と *-builder.ts のモジュールが、グローバルのブリッジを読まずに直接
// import できる。本物の ES モジュールで、lightbox/index.tsx（QuickViewHost がここにある
// ものを描く）と、これを開くか isOpen() で防ぐ orchestrator.ts やビルダーが import する。
//
// #143 でこれは項目1つだけになった。覗き見が持つのは1件で、呼び出し側はサムネイル
// （ギャラリーの先頭の項目）を渡し、前後への移動は無い（ギャラリー全体のページ送りは
// 画像ビューにある）。
//
// P2⑦ でこれは純粋なストアになった。オーバーレイの要素も、その表示・非表示も、背景の
// クリックも、Esc キーも、今はすべて React のもの（lightbox/）。ここは DOM に一切触れないので、
// 覗き見を開くのは状態の書き込み1回と通知だけ＝getElementById も、クラスの切り替えも、
// モジュールの読み込み時のリスナーも無い。

export interface LightboxItem {
  src: string;
  video?: boolean;
  alt?: string;
}
export interface LightboxState {
  item: LightboxItem | null;
  open: boolean;
}

let state: LightboxState = { item: null, open: false };
const subs = new Set<() => void>();

function notify() {
  for (const cb of [...subs]) {
    try {
      cb();
    } catch (_e) {
      /* 無視する */
    }
  }
}

export function open(item: LightboxItem | null | undefined) {
  if (!item || !item.src) return;
  state = { item, open: true };
  notify();
}

export function close() {
  if (!state.open) return;
  state = { item: null, open: false };
  notify();
}

export function isOpen(): boolean {
  return state.open;
}

export function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

export function getSnapshot(): LightboxState {
  return state;
}
