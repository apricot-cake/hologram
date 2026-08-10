// 確認ブリッジ――共有の確認モーダル（shadcn の AlertDialog）向けの命令形→
// 宣言形のブリッジ。呼び出し側は open(config) にメッセージ＋任意の
// スキップチェックボックスまたはキーワードによるゲート＋onOk/onCancel の
// コールバックを渡す。React コンポーネント（ConfirmHost）がダイアログを
// 描画し、キーワード／スキップのローカル状態を持ち、コールバックを呼ぶ。
// 破壊的なロジックは呼び出し側の onOk クロージャに残る――これが動かすのは
// 「いつ」それが走るかだけ。コールバックはシリアライズできないので、
// hologramStore ではなく専用のブリッジ（menu.ts / kind-menu.ts と同じ）。
// 実体は本物の ES モジュール（named exports）で、利用側
// （post-grid-builder.ts / selection-builder.ts / Confirm.tsx）から直接
// import される。ModalChrome（App.tsx）は、モーダル表示中の body クラス＋
// タイトルバーの色付けのために get()/subscribe() を読む。
//
// config: { message, description?, okLabel, cancelLabel, skipLabel?, keywordPlaceholder?,
//           keywordRequired?, onOk(result:{skip}), onCancel? }
let current: HologramConfirmModel | null = null;
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
export function open(config: HologramConfirmConfig) {
  current = Object.assign({ openId: ++seq }, config);
  notify();
}
export function close() {
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
