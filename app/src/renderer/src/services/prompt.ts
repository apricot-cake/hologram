// 命名プロンプトのブリッジ――共有の命名ダイアログ（shadcn の Dialog ＋
// Input）向けの命令形→宣言形のブリッジ。呼び出し側は open(config) に
// ラベル＋初期値＋onOk(value) を渡す。React コンポーネント（PromptHost）が
// ダイアログを描画し、入力の状態を持ち、トリム済みの値でコールバックを
// 呼ぶ。
//
// これが存在するのは window.prompt() がここでは動かないから: Electron の
// レンダラーは `prompt() is not supported.` と答えて throw するので、
// それに手を伸ばしたどの命名フローも、利用者の意図の最初の一打鍵で黙って
// 死んでいた。
//
// confirm.ts と同じ形（コールバックはシリアライズできないので、
// hologramStore ではなく専用のブリッジ）。ModalChrome（App.tsx）は、
// confirm に対してとまったく同じように、モーダル表示中の body クラス＋
// タイトルバーの色付けのために get()/subscribe() を読む。
//
// config: { title, value?, okLabel?, cancelLabel?, placeholder?, onOk(value:string) }
let current: HologramPromptModel | null = null;
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
export function open(config: HologramPromptConfig) {
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
