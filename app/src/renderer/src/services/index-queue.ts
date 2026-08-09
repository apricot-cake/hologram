// 背面での索引付けの進捗、レンダラー側（#834、親は #98）＝ツールバーの表示が購読するストア。
//
// コンポーネントごとの状態ではなくストアにしてあるのは、この形が押し込みで駆動されるから。
// main は自分の状態の変化をまとめて配るので、こちらから問い合わせる作りにすると、走行の
// 終わりを取り逃すか、動いていない値を尋ねることになる。この上に useSyncExternalStore を
// 載せるのは、トリアージの件数（services/triage-builder.ts）と同じ組み立て。
import { hologramIpc } from './ipc.ts';
import type { IndexQueueStatus } from '../../../main/ipc-payloads.ts';

const IDLE: IndexQueueStatus = { active: false, paused: false, scanning: false, done: 0, total: 0, currentKind: null };

let status: IndexQueueStatus = IDLE;
const listeners = new Set<() => void>();
let attached = false;

function set(next: IndexQueueStatus) {
  status = next || IDLE;
  for (const cb of listeners) cb();
}

/**
 * 購読する。最初の購読側の時は、main の押し込みへつなぎ、今の値を1回だけ取る。この取得が
 * 効くのは、走行の途中で読み込み直した場合＝押し込みは変化した時にしか発火しないので、
 * 直前の1回を取り逃したウィンドウは、次の仕事が終わるまで何も出せなくなる。
 */
export function subscribeIndexQueue(cb: () => void): () => void {
  listeners.add(cb);
  if (!attached) {
    attached = true;
    hologramIpc.onIndexQueueProgress((s) => set(s));
    Promise.resolve(hologramIpc.getIndexQueueStatus())
      .then((s) => s && set(s))
      .catch(() => {
        /* main が答えない＝壊れた表示を出すより、止まったままでいる */
      });
  }
  return () => listeners.delete(cb);
}

export function indexQueueStatus(): IndexQueueStatus {
  return status;
}

export function pauseIndexQueue() {
  return Promise.resolve(hologramIpc.pauseIndexQueue())
    .then((s) => s && set(s))
    .catch(() => {});
}

export function resumeIndexQueue() {
  return Promise.resolve(hologramIpc.resumeIndexQueue())
    .then((s) => s && set(s))
    .catch(() => {});
}
