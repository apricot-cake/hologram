// 一括タグダイアログのブリッジ――選択バーの「タグを追加」（P2⑦）向けの
// 命令形→宣言形のブリッジ。prompt.ts/confirm.ts と同じ形: レンダラー側が
// 設定を push し、React コンポーネント（BulkTagDialog）がそれを描く。
//
// これが置き換えた tag-pop と違い、このブリッジはステージング済みの
// タグ一覧を一切運ばない。ステージングはダイアログ自身の React 状態なので、
// 足並みを揃えるべきモジュールレベルの鏡も、追加・削除のたびの
// refresh() の往復も無い――引退した一括処理の経路がステージング用の
// モジュールと再計算＋push のヘルパーの両方を必要としていたのはそれが
// 理由。レンダラーが持ち続けるのは、自分にしかできないこと: タグの語彙
// （pickerData）、種別メニュー、そして onApply の中の永続化／undo／
// トースト通知（bulk-tag-builder.ts）。
let current: HologramBulkTagModel | null = null;
let seq = 0;
const subs = new Set<() => void>();
const notify = () => {
  for (const cb of [...subs]) {
    try {
      cb();
    } catch (_e) {
      /* ignore */
    }
  }
};

export function open(config: HologramBulkTagConfig) {
  current = Object.assign({ openId: ++seq }, config);
  notify();
}
export function close() {
  if (!current) return;
  current = null;
  notify();
}
export function get() {
  return current;
}
export function subscribe(cb: () => void) {
  subs.add(cb);
  return () => subs.delete(cb);
}
