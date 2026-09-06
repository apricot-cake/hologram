export interface CompareItem {
  src: string;
  alt: string;
  video: boolean;
}
export interface CompareState {
  items: CompareItem[];
  open: boolean;
}

// v1 のグリッドレイアウトは2〜4ペイン（#82 の採用済み設計: 2＝横並び、
// 3〜4＝2×2 のグリッドで、3件のときは4つ目のセルを空けておく）。2未満は
// 比較するものが無い。4を超えると、そもそもトリガー（orchestrator.ts）が
// メニュー行を提示すらしないが、この上限もここに持たせることで、このモジュール
// が持つレイアウトが表示できる以上のものを渡されることは決して無いように
// している。
const MIN_ITEMS = 2;
const MAX_ITEMS = 4;

let state: CompareState = { items: [], open: false };
const subs = new Set<() => void>();

function notify() {
  for (const cb of [...subs]) {
    try {
      cb();
    } catch (_e) {
      /* 握りつぶす */
    }
  }
}

export function open(items: CompareItem[] | null | undefined) {
  if (!items || items.length < MIN_ITEMS) return;
  state = { items: items.slice(0, MAX_ITEMS), open: true };
  notify();
}

export function close() {
  if (!state.open) return;
  state = { items: [], open: false };
  notify();
}

export function isOpen(): boolean {
  return state.open;
}

export function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

export function getSnapshot(): CompareState {
  return state;
}
