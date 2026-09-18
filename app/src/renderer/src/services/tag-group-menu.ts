// タグの移動先メニューを描画側へ渡す。グループ作成も同じメニューから行う。
let current: HologramTagGroupMenuModel | null = null; // モデル、または null
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

export function open(model: HologramTagGroupMenuModel) {
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
