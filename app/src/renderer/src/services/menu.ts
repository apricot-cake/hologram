// 右クリックメニューのコントローラ――右クリックメニュー向けの命令形→
// 宣言形のブリッジ。viewer.ts は open({ items, x, y }, onPick) を呼んで
// ガラスのメニューを表示する。右クリックメニューの React コンポーネントが
// それを購読して描画する。メニューは onPick というコールバック（関数）を
// 運ぶので、シリアライズ可能なリアクティブストアには属さないという理由で
// hologramStore とは別に持っている。実体は本物の ES モジュール
// （named exports）で、利用側（viewer.ts / query-chips.ts /
// ContextMenu.tsx）から直接 import される。
//
// item の形: { label, act, danger?, checked?, sep?, manage?, ...extra }。
// onPick(item) は viewer 側のアクションを実行する。新しい items 配列を
// 「返せば」メニューは開いたまま再描画され（トグル行――例: フォルダへの
// 割り当て）、そうでなければメニューは閉じる。
let current: HologramContextMenuModel | null = null; // { items, x, y, onPick } | null
const subs = new Set<() => void>();
const notify = () => {
  for (const cb of [...subs]) {
    try {
      cb();
    } catch (_e) {
      /* 握りつぶす */
    }
  }
};

// メニューはカーソル（{x, y}）かボタン（{ anchorEl }）のどちらかにぶら下がる
// ――HologramMenuAnchor 参照。ここでは位置を一切計算しない: 要素の
// アンカーはそのまま ui kit へ渡され、それが呼び出し場所での旧来の矩形計算
// を引退させた。
// biome-ignore lint/suspicious/noConfusingVoidType: void は「メニューを閉じる」を意味する意図した戻り値（globals.d.ts の HologramContextMenu と同じ）
export function open(model: ({ items?: HologramMenuItem[] } & HologramMenuAnchor) | null, onPick?: (item: HologramMenuItem) => HologramMenuItem[] | void) {
  current = {
    items: (model && model.items) || [],
    x: (model && model.x) || 0,
    y: (model && model.y) || 0,
    anchorEl: (model && model.anchorEl) || null,
    side: model?.side,
    align: model?.align,
    onPick: onPick || null,
  };
  notify();
}
export function close() {
  if (current) {
    current = null;
    notify();
  }
}
export function pick(item: HologramMenuItem) {
  if (!current || !current.onPick) {
    close();
    return;
  }
  const ref = current;
  const next = current.onPick(item);
  if (current !== ref) return; // onPick が別のメニュー（カード→フォルダ）を開いた、またはこれを閉じた――そのままにしておく
  if (Array.isArray(next)) {
    current = { ...current, items: next };
    notify();
  } // 開いたまま再描画する（トグル行）
  else close();
}
export function get() {
  return current;
} // 変化の間は安定した参照（useSyncExternalStore）
export function subscribe(cb: () => void) {
  subs.add(cb);
  return () => subs.delete(cb);
}
