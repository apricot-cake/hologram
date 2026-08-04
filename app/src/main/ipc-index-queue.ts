'use strict';

// Index queue IPC (#834, parent #98) — the transparency half of the Issue: while
// the app is analysing the library, that has to be visible and stoppable (#98's
// "使っている間" principle).
//
// Read + two commands, and nothing else. There is no "start indexing" call: the
// queue decides what needs doing from the derived store, so an explicit start
// would be a second, contradictory idea of what is outstanding. Pause is the only
// control a user needs, because the alternative to running is running later.
//
// The static "how much of the library is indexed" figures belong to #100's health
// dashboard, not here — this is live progress, which is why it is pushed rather
// than polled and why the renderer hides it entirely when nothing is running.
import { ipcMain } from 'electron';
import type { IndexQueueStatus } from './ipc-payloads.ts';
import { indexQueueStatus, pauseIndexQueue, resumeIndexQueue } from './lib-index-queue.ts';

// No `ctx` parameter, unlike the other ipc-*.ts modules: the queue is a
// module-level singleton (like lib-ml-runtime.ts's child process) rather than
// something the assembly hands around, and the PUSH direction is wired where the
// queue is started, not here.
function register() {
  ipcMain.handle('get-index-queue-status', (): IndexQueueStatus => indexQueueStatus());
  // Both return the new status rather than void so the toolbar's own optimistic
  // flip is confirmed by the same value every other window is about to receive.
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
