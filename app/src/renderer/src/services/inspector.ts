// インスペクタの表示モデルを保持する。表示対象は inspector-controller が
// 画面と選択状態から導出し、このキャッシュを更新する。
// 同じ対象の更新では openId を保持し、入力中のタグ欄などを再マウントしない。
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
