// 「同一人物にする」（#23 St1）のための投稿者ピッカーのブリッジ＝共有の別名統合のダイアログ
// （posters/AliasPicker.tsx）を、命令的な側から宣言的な側へ渡す。prompt.ts/confirm.ts と同じ
// 形で、呼び出し側は候補の一覧と onPick のコールバックを持たせて open(config) を呼び、React の
// コンポーネントがダイアログを描いて、打ち込まれたクエリを持つ。このモジュールが動かすのは、
// それがいつ走るかだけ（実際の統合と、その確認のゲートは poster-grid-builder.ts の onPick の
// 閉包に残る）。
//
// 本物の ES モジュール（名前付きの export）で、唯一の使い手（poster-grid-builder.ts）と
// ホストのコンポーネントが直接 import する。

export interface HologramAliasPickerCandidate {
  key: string;
  label: string;
  sub: string; // 名前の横に出す、ハンドルやプラットフォームの印の文字
}

export interface HologramAliasPickerConfig {
  title: string;
  placeholder: string;
  emptyLabel: string;
  candidates: HologramAliasPickerCandidate[];
  onPick(key: string): void;
  onCancel?(): void;
}

export interface HologramAliasPickerModel extends HologramAliasPickerConfig {
  openId: number;
}

let current: HologramAliasPickerModel | null = null;
let seq = 0;
const subs = new Set<() => void>();
function notify() {
  for (const cb of [...subs]) {
    try {
      cb();
    } catch {
      /* 無視する */
    }
  }
}
export function open(config: HologramAliasPickerConfig) {
  current = { ...config, openId: ++seq };
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
