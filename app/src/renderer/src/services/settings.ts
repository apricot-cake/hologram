// 設定モーダルの開閉状態――settings/index.tsx から抽出（lightbox.ts と
// 並ぶ、もう一つの「本物のコンポーネント直結グローバル」）。これにより
// orchestrator.ts と *-builder.ts の各モジュールは、グローバルブリッジを
// 読むのではなくこれを直接 import できる。実体は本物の ES モジュール:
// React は useSyncExternalStore を通して正本であり続ける
// （settings/index.tsx が isOpen/subscribe を、設定側の App.tsx が期待する
// OpenStore へ配線する）。ブランドバーの歯車（orchestrator.ts）と各種
// Esc／ショートカットのガード（*-builder.ts、image-tab/index.tsx）は
// open()/close()/isOpen() を直接呼ぶ。

let open_ = false;
const subs = new Set<() => void>();

export function isOpen(): boolean {
  return open_;
}

function set(v: boolean) {
  const next = !!v;
  if (next === open_) return;
  open_ = next;
  for (const cb of [...subs]) cb();
}

export function open(): void {
  set(true);
}

export function close(): void {
  set(false);
}

export function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}
