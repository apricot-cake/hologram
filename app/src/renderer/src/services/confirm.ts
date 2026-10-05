// 確認ブリッジ――共有の確認モーダル（shadcn の AlertDialog）向けの命令形→
// 宣言形のブリッジ。呼び出し側は open(config) にメッセージ＋任意の
// スキップチェックボックスまたはキーワードによるゲート＋onOk/onCancel の
// コールバックを渡す。React コンポーネント（ConfirmHost）がダイアログを
// 描画し、キーワード／スキップのローカル状態を持ち、コールバックを呼ぶ。
// 破壊的なロジックは呼び出し側の onOk クロージャに残る――これが動かすのは
// 「いつ」それが走るかだけ。コールバックはシリアライズできないので、
// hologramStore ではなく専用のブリッジ（menu.ts / tag-group-menu.ts と同じ）。
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
  const openId = ++seq;
  current = Object.assign({ openId }, config);
  notify();
  return openId;
}
/** 開いている確認を閉じずに内容だけ更新する。ドロップ直後の待機表示に使う。 */
export function update(config: Partial<HologramConfirmConfig>, expectedOpenId?: number): boolean {
  if (!current || (expectedOpenId != null && current.openId !== expectedOpenId)) return false;
  current = Object.assign({}, current, config, { openId: current.openId });
  notify();
  return true;
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
