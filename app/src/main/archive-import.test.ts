import { EventEmitter } from 'node:events';
import { afterEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({ events: [] as string[], failApply: false, failCleanup: false, earlySupervisorClose: false, prepareGate: undefined as (() => void) | undefined }));
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/test/app' },
  utilityProcess: {
    fork: () => {
      const child = new EventEmitter() as EventEmitter & { pid: number; kill: () => void; postMessage: (request: any) => void };
      child.pid = 123;
      child.kill = () => {
        state.events.push('worker-stop');
        queueMicrotask(() => child.emit('exit', 0));
      };
      child.postMessage = (request) => {
        state.events.push(request.phase);
        const reply = () => queueMicrotask(() => child.emit('message', { id: request.id, phase: request.phase === 'prepare' ? 'prepared' : 'done', ok: true, imported: 1, skipped: 0 }));
        if (request.phase === 'prepare' && state.prepareGate) state.prepareGate = reply;
        else if ((request.phase === 'apply' && state.failApply) || (request.phase === 'cleanup' && state.failCleanup)) queueMicrotask(() => child.emit('exit', 1));
        else reply();
      };
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
  },
}));
vi.mock('./utility-process-supervisor', () => ({
  superviseProcess: async () => {
    const supervisor = new EventEmitter() as EventEmitter & { stdin: { destroy: () => void }; closed: Promise<void> };
    supervisor.closed = new Promise((resolve) => supervisor.once('close', () => resolve()));
    if (state.earlySupervisorClose) queueMicrotask(() => supervisor.emit('close'));
    supervisor.stdin = {
      destroy: () => {
        state.events.push('job-stop');
        queueMicrotask(() => {
          state.events.push('job-closed');
          supervisor.emit('close');
        });
      },
    };
    return supervisor;
  },
}));
import { runCompleteArchiveImport } from './archive-import';

afterEach(() => {
  state.events.length = 0;
  state.failApply = false;
  state.failCleanup = false;
  state.earlySupervisorClose = false;
  state.prepareGate = undefined;
});
function boundary() {
  return {
    getSaveFolder: () => '/library',
    getLibraryIdentity: () => 'library-one',
    pause: async () => 7,
    closeDb: () => {
      state.events.push('db-close');
    },
    finish: async () => {
      state.events.push('db-reopen');
    },
  };
}

test('worker と Job Object の終了、私有 tmp 清掃の後に DB を再開する', async () => {
  expect((await runCompleteArchiveImport('/input.zip', '/library', boundary())).ok).toBe(true);
  expect(state.events.indexOf('db-close')).toBeLessThan(state.events.indexOf('apply'));
  expect(state.events.indexOf('job-closed')).toBeLessThan(state.events.indexOf('cleanup'));
  expect(state.events.lastIndexOf('job-closed')).toBeLessThan(state.events.indexOf('db-reopen'));
});

test('READY 復帰の直前に supervisor が終了しても待機を取り残さない', async () => {
  state.earlySupervisorClose = true;
  expect((await runCompleteArchiveImport('/input.zip', '/library', boundary())).ok).toBe(false);
  expect(state.events).not.toContain('db-close');
  expect(state.events).not.toContain('db-reopen');
});

test('apply 中断でも journal 清掃を完了してから DB を再開する', async () => {
  state.failApply = true;
  expect((await runCompleteArchiveImport('/input.zip', '/library', boundary())).ok).toBe(false);
  expect(state.events).toContain('cleanup');
  expect(state.events.lastIndexOf('job-closed')).toBeLessThan(state.events.indexOf('db-reopen'));
});

test('清掃を確認できない場合は DB を再開せず所有権を保持する', async () => {
  state.failCleanup = true;
  expect((await runCompleteArchiveImport('/input.zip', '/library', boundary())).ok).toBe(false);
  expect(state.events).not.toContain('db-reopen');
});

test('prepare 後に library identity が変われば共有 DB を開け渡さない', async () => {
  const b = boundary();
  b.getLibraryIdentity = vi.fn().mockReturnValueOnce('library-one').mockReturnValue('library-two');
  expect(await runCompleteArchiveImport('/input.zip', '/library', b)).toMatchObject({ ok: false, error: 'library-changed' });
  expect(state.events).not.toContain('db-close');
  expect(state.events).not.toContain('apply');
  expect(state.events).toContain('db-reopen');
});

test('準備中の二重取り込みを拒否する', async () => {
  state.prepareGate = () => {};
  const first = runCompleteArchiveImport('/input.zip', '/library', boundary());
  await vi.waitFor(() => expect(state.events).toContain('prepare'));
  expect(await runCompleteArchiveImport('/other.zip', '/library', boundary())).toMatchObject({ ok: false, error: 'import-busy' });
  const reply = state.prepareGate!;
  state.prepareGate = undefined;
  reply();
  expect((await first).ok).toBe(true);
});
