// インスペクタのブリッジ――常設の右カラムインスペクタ（post detail ＋
// poster detail、常に生きたインラインタグエディタを含む）に対する
// 命令形→宣言形のブリッジ。viewer.ts がすべてのビジネスルール（永続化、
// undo、同名異体検知、グルーピング、ポスターフォルダ）を持ち続け、シェルが
// パネルが画面に出ているかどうかを持ち（inspector-panel.ts）、React
// コンポーネントがその中身の描画を持つ。menu.ts/kind-menu.ts/
// filter-popover.ts/qf-pop.ts と同じ理由で hologramStore とは別に持って
// いる: このモデルはコールバックを運ぶ。実体は本物の ES モジュール
// （named exports）で、利用側（viewer.ts / Inspector.tsx）から直接
// import される。
//
// モデルの形（kind: 'post' | 'poster'）: 全フィールド一覧は viewer.ts の
// inspectorPostModel / inspectorPosterModel のビルダーを参照。openId は
// open() だけが進める内部の単調増加カウンタ（新しい post/poster、または
// 完全な作り直し）――refresh() は今の openId を保つので、マウント済みの
// コンポーネントはその場で再描画される（タグ入力のテキストやそのフィルタ
// クエリのようなローカル状態は生き残る）。これは、タグの変更では
// #ivTagChips/#ivTagPicker だけが触れられ、完全な showDetail()/
// showPosterDetail() の作り直し（例: ソースタグの取り込み）だけがそれらを
// リセットしていた以前の挙動と一致する。
let current: HologramInspectorModel | null = null;
let seq = 0;
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

export function open(model: Omit<HologramInspectorModel, 'openId'>) {
  // Omit<> は HologramInspectorModel の `[extra: string]: any` という
  // インデックスシグネチャに潰れてしまう（インデックス型への Pick/Omit は
  // 名前付きの必須プロパティを失う）ので、この cast は実行時に構造として
  // 真であることを復元しているだけ。
  current = { ...model, openId: ++seq } as HologramInspectorModel;
  notify();
}
export function refresh(partial: Record<string, unknown>) {
  if (!current) return;
  current = { ...current, ...partial };
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
} // 変化の間は安定した参照（useSyncExternalStore）
export function subscribe(cb: () => void) {
  subs.add(cb);
  return () => subs.delete(cb);
}
