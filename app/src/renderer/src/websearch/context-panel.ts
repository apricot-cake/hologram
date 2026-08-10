// ツールバーの外にある「ウェブで探す」の入口のための、命令型→宣言型のブリッジ
// （#207 自身の「投稿者・タグの文脈メニュー...パネル1個・入口複数」の設計）＝
// services/menu.ts や services/kind-menu.ts と同じ current/subs/notify の形なので、
// クリック点（x, y）と使い捨ての条件の木（たとえば 'user' や 'tag' の葉1つ）しか持たない
// 呼び出し側でも、自前の PopoverTrigger を持たずに、その点をアンカーにして同じ
// WebSearchPanel の中身を出せる。読むのは WebSearchPanel.tsx の WebSearchContextPanelHost
// だけ（subscribe/get）で、呼ぶのは poster-grid-builder.ts と kind-menu-builder.ts（open）。
export interface WebSearchContextModel {
  tree: HologramQueryGroup;
  x: number;
  y: number;
}
let current: WebSearchContextModel | null = null;
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

export function open(tree: HologramQueryGroup, x: number, y: number) {
  current = { tree, x, y };
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
} // 変化の合間は同じ参照を返す（useSyncExternalStore）
export function subscribe(cb: () => void) {
  subs.add(cb);
  return () => subs.delete(cb);
}
