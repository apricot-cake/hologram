// トリアージモードの純粋な状態（#46）＝タグもフォルダも無い投稿の全画面のキューを、キー
// 1つの操作で1件ずつ片付ける。lightbox.ts や settings.ts と同じ形＝モジュールスコープの状態を
// 持つ本物の ES モジュールで、DOM には触れず、IPC もピン留めしたタグの設定以外には使わない
// （読み込みと永続化を自己完結で持ち、orchestrator.ts の起動の手順を経由せず、panels.ts が
// 自分の設定を戻すのと同じ形にしてある）。
//
// キューは、トリアージを開いた時点で取ったスナップショット（services/triage-builder.ts の
// openTriage）であって、生きたクエリではない。posts-data が変わるたびに「まだどの投稿が
// 条件に合うか」を導き直すと、セッションの最中に利用者のカーソルの下で一覧が並び替わって
// しまう（インスペクタが、生きて結び付いた群ではなくスナップショットを持つのと同じ理由＝
// inspector-builder.ts への #633 の doc コメント）。末尾を越えて進んだ状態（idx >=
// queue.length）が、コンポーネントが描く「終わった」の状態で、別のフラグは持たない。
import { hologramIpc } from './ipc.ts';

/** 直前のトリアージの操作が何をしたか。Backspace 1回で、ちょうどそれだけを取り消せるように
 * するためのもの。`undo` は、データを変える操作（タグ／フォルダ）に対して
 * undo-builder.ts の pushUndo が返す閉包で、データに触れない skip では無い。
 * `previousIndex` は必ず入る＝3つのどの種類でも、そこへ戻ることが「取り消す」の意味。 */
export interface TriageLastAction {
  kind: 'tag' | 'folder' | 'skip';
  label: string;
  previousIndex: number;
  undo?: () => void;
}

export interface TriageState {
  open: boolean;
  queue: HologramPostGroup[];
  idx: number;
  lastAction: TriageLastAction | null;
  /** 1〜9 のクイックタグのキー用に手でピン留めしたタグ、最大9個。枠の順（添字 0 がキー '1'）。 */
  pinnedTags: string[];
}

let state: TriageState = { open: false, queue: [], idx: 0, lastAction: null, pinnedTags: [] };
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

export function get(): TriageState {
  return state;
}

export function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

export function isOpen(): boolean {
  return state.open;
}

/** 画面に出ている項目。キューを使い切ったか（idx が末尾を越えた）、空なら null。 */
export function current(): HologramPostGroup | null {
  return state.queue[state.idx] || null;
}

export function openWith(queue: HologramPostGroup[]): void {
  state = { ...state, open: true, queue, idx: 0, lastAction: null };
  notify();
}

export function close(): void {
  if (!state.open) return;
  state = { ...state, open: false, queue: [], idx: 0, lastAction: null };
  notify();
}

export function setIdx(idx: number): void {
  state = { ...state, idx };
  notify();
}

export function setLastAction(action: TriageLastAction | null): void {
  state = { ...state, lastAction: action };
  notify();
}

// --- ピン留めしたタグ（1〜9 のクイックタグのキー）＝自己完結した設定で、panels.ts 自身の
// load() と config.json の往復と同じ作法（orchestrator.ts の bootApp が手を伸ばすのではなく、
// 末端のモジュールが自分の設定を持つ）。config.json との突き合わせは、トリアージのホストが
// 載る時の effect から1回だけ行う。持続する写しは config.json なので、アプリの外での編集
// （またはこのセッションが始まる前に設定された値）が勝つ。
export async function loadPinnedTags(): Promise<void> {
  try {
    const prefs = hologramIpc.getPrefs ? await hologramIpc.getPrefs() : null;
    const saved = prefs && Array.isArray(prefs.triagePinnedTags) ? prefs.triagePinnedTags.filter((t): t is string => typeof t === 'string').slice(0, 9) : [];
    state = { ...state, pinnedTags: saved };
    notify();
  } catch {
    /* 無視する＝ピン留めしたタグは空のまま。ピンのバーは空の枠を出すだけ */
  }
}

/** 番号の付いた枠1つを、ピン留めする（tag が真）か、消す（tag が null か空）。0〜8 がキー 1〜9。 */
export function setPinnedTag(slot: number, tag: string | null): void {
  if (slot < 0 || slot > 8) return;
  const next = state.pinnedTags.slice();
  while (next.length <= slot) next.push('');
  next[slot] = (tag || '').trim();
  // 末尾の空の枠は落とす。そうしないと、永続化する配列が穴を抱えたまま伸び続ける。ただし
  // 途中の穴は残す（前の枠を消しても、その後ろの枠はずらさない＝番号そのものがキーなので、
  // 枠の同一性が意味を持つ）。
  while (next.length && !next[next.length - 1]) next.pop();
  state = { ...state, pinnedTags: next };
  notify();
  hologramIpc.setPref('triagePinnedTags', next).catch(() => {
    /* できる範囲で。このアプリの他の設定の書き込みと同じ */
  });
}
