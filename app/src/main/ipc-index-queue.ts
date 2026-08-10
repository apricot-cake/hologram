'use strict';

// 取込キューの IPC（#834、親 #98）——この Issue のうち、透明性を担う半分:
// アプリがライブラリを分析している間、それは見えて止められなければならない
// （#98 の「使っている間」原則）。
//
// 読み取りと、コマンドが2つ。それ以外は無い。「インデックス作成を開始する」
// という呼び出しは存在しない: 何をすべきかは派生ストアからキューが決めるので、
// 明示的な開始は、何が未処理かについて矛盾する2つ目の考えになってしまう。
// 利用者に必要な操作は一時停止だけ。実行しないことの代わりは、後で実行する
// ことだから。
//
// 「ライブラリのどれだけがインデックス済みか」という静的な数字は、ここでは
// なく #100 の健全性ダッシュボードの担当。これはライブ進捗であり、だから
// ポーリングではなく push され、だから何も走っていない時レンダラーはこれを
// 丸ごと隠す。
import { ipcMain } from 'electron';
import type { IndexQueueStatus } from './ipc-payloads.ts';
import { indexQueueStatus, pauseIndexQueue, resumeIndexQueue } from './lib-index-queue.ts';

// 他の ipc-*.ts モジュールと違い `ctx` パラメータが無い: このキューは組み立て側が
// 受け渡すものではなく、モジュールレベルのシングルトン（lib-ml-runtime.ts の
// 子プロセスと同様）で、push 方向の配線はキューが起動される場所にあり、ここには
// 無い。
function register() {
  ipcMain.handle('get-index-queue-status', (): IndexQueueStatus => indexQueueStatus());
  // どちらも void ではなく新しい状態を返す。ツールバー自身の楽観的な切り替えが、
  // 他のすべてのウィンドウがこれから受け取るのと同じ値で裏付けられるように。
  ipcMain.handle('pause-index-queue', (): IndexQueueStatus => {
    pauseIndexQueue();
    return indexQueueStatus();
  });
  ipcMain.handle('resume-index-queue', (): IndexQueueStatus => {
    resumeIndexQueue();
    return indexQueueStatus();
  });
}

export { register };
