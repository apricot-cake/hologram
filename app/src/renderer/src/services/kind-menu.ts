// 種別（タグの種別）のメニューのブリッジ＝作品／キャラ／一般の分類のメニュー（編集用
// ピッカー／インスペクタ／投稿者ピッカーでタグチップを右クリックすると出る）を、命令的な側から
// 宣言的な側へ渡す。行のモデル（今の種別、翻訳済みのラベル）を組み、選択と改名の操作を持つのは
// viewer.ts。kind-menu の React のコンポーネントが購読して、すりガラスのポップアップを描く。
// hologramStore と分けてある理由は menu.ts と同じで、onPick/onRename がコールバックを運ぶから。
// それは直列化できる反応的なストアに置くものではない。本物の ES モジュール（名前付きの
// export）で、使う側（viewer.ts / KindMenu.tsx）が直接 import する。
//
// モデルの形: { x, y, header, renameTitle, rows, onPick(kind), onRename(kind) }。
// 行の形: { kind, label, dot?, renameable?, checked? } | { sep: true }。
let current: HologramKindMenuModel | null = null; // モデル、または null
const subs = new Set<() => void>();
const notify = () => {
  for (const cb of [...subs]) {
    try {
      cb();
    } catch (_e) {
      /* 無視する */
    }
  }
};

export function open(model: HologramKindMenuModel) {
  current = model;
  notify();
}
export function close() {
  if (current) {
    current = null;
    notify();
  }
}
export function get() {
  return current;
} // 変化の間は同じ参照を保つ（useSyncExternalStore のため）
export function subscribe(cb: () => void) {
  subs.add(cb);
  return () => subs.delete(cb);
}
