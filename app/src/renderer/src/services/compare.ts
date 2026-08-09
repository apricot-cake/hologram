// 比較ビューの状態（#82）――選択した2〜4件の投稿を並べて表示し、それぞれが
// 独立したズーム／パンを持つ。lightbox.ts/panels.ts と同じ「純粋なストア、
// React はただ購読するだけ」という形: ここでは DOM に一切触れず、
// オーバーレイを開くのは1回の状態書き込みと notify だけ。menu.ts の
// コンテキストメニューモデルと同じ理由で hologramStore とは別に持って
// いる――これは view ローカルな UI 状態であって、シリアライズ可能な
// ストアに属するアプリケーション状態ではない。
//
// 呼び出し側（orchestrator.ts）は open() を呼ぶ前に、選択した各投稿
// グループを単一の代表画像（buildGroupGalleryItems(g)[0]）へ解決する
// ――このモジュールが持つのは常にフラットな、すでに解決済みの項目だけ。
// ライブラリ自体から何かを再導出することは一切無いので、比較の最中に
// 投稿が削除・編集されても、このモジュールが不整合な何かを抱えたままに
// なることはない。オーバーレイは渡された最後のフレームを表示し続けるだけ
// （ライトボックスが自身の閉じるアニメーションをまたいで使うのと同じ
// 「最後の項目を保つ」規則）。

export interface CompareItem {
  src: string;
  alt: string;
  video: boolean;
}
export interface CompareState {
  items: CompareItem[];
  open: boolean;
}

// v1 のグリッドレイアウトは2〜4ペイン（#82 の採用済み設計: 2＝横並び、
// 3〜4＝2×2 のグリッドで、3件のときは4つ目のセルを空けておく）。2未満は
// 比較するものが無い。4を超えると、そもそもトリガー（orchestrator.ts）が
// メニュー行を提示すらしないが、この上限もここに持たせることで、このモジュール
// が持つレイアウトが表示できる以上のものを渡されることは決して無いように
// している。
const MIN_ITEMS = 2;
const MAX_ITEMS = 4;

let state: CompareState = { items: [], open: false };
const subs = new Set<() => void>();

function notify() {
  for (const cb of [...subs]) {
    try {
      cb();
    } catch (_e) {
      /* ignore */
    }
  }
}

export function open(items: CompareItem[] | null | undefined) {
  if (!items || items.length < MIN_ITEMS) return;
  state = { items: items.slice(0, MAX_ITEMS), open: true };
  notify();
}

export function close() {
  if (!state.open) return;
  state = { items: [], open: false };
  notify();
}

export function isOpen(): boolean {
  return state.open;
}

export function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

export function getSnapshot(): CompareState {
  return state;
}
