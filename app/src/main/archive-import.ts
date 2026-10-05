import { app, utilityProcess } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCHIVE_IMPORT_IDLE_MS, ARCHIVE_IMPORT_MEMORY_BYTES, ArchiveImportReply } from './archive-import-contract';
import type { CompleteImportResult } from './ipc-payloads';
import { superviseProcess } from './utility-process-supervisor';

let active = false;
interface Boundary {
  getSaveFolder(): string;
  getLibraryIdentity(owner?: number): string;
  pause(): Promise<number | null>;
  closeDb(owner: number): void;
  finish(owner: number): Promise<void>;
}

async function startWorker(executable: string) {
  const child = utilityProcess.fork(path.join(path.dirname(fileURLToPath(import.meta.url)), 'archive-import-worker.js'), [], { serviceName: 'Hologram archive import', stdio: 'ignore' });
  let exited = false;
  const exitPromise = new Promise<void>((resolve) =>
    child.once('exit', () => {
      exited = true;
      resolve();
    }),
  );
  let supervisor: Awaited<ReturnType<typeof superviseProcess>> | undefined;
  let supervisorClosed = Promise.resolve();
  const stop = async () => {
    if (!exited) child.kill();
    supervisor?.stdin.destroy();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        Promise.all([exitPromise, supervisorClosed]),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('archive-worker-stop-unconfirmed')), 10000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('archive-worker-start-timeout')), 5000);
      child.once('spawn', () => {
        clearTimeout(timer);
        resolve();
      });
      child.once('exit', () => {
        clearTimeout(timer);
        reject(new Error('archive-worker-exited'));
      });
    });
    supervisor = await superviseProcess(child.pid as number, executable, ARCHIVE_IMPORT_MEMORY_BYTES);
    supervisorClosed = supervisor.closed;
    void supervisorClosed.then(() => {
      if (!exited) child.kill();
    });
  } catch (error) {
    await stop();
    throw error;
  }
  return {
    stop,
    request(id: string, payload: unknown, phase: 'prepared' | 'done'): Promise<CompleteImportResult> {
      return new Promise((resolve, reject) => {
        let idle: NodeJS.Timeout;
        const absolute = setTimeout(() => finish(new Error('archive-worker-duration-limit')), 24 * 60 * 60 * 1000);
        const reset = () => {
          clearTimeout(idle);
          idle = setTimeout(() => finish(new Error('archive-worker-timeout')), ARCHIVE_IMPORT_IDLE_MS);
        };
        const finish = (error?: Error, result?: CompleteImportResult) => {
          clearTimeout(idle);
          clearTimeout(absolute);
          child.removeListener('message', message);
          child.removeListener('exit', exit);
          if (error) reject(error);
          else if (result) resolve(result);
          else reject(new Error('missing-archive-worker-result'));
        };
        const exit = () => finish(new Error('archive-worker-exited'));
        const message = (value: unknown) => {
          const parsed = ArchiveImportReply.safeParse(value);
          if (!parsed.success || parsed.data.id !== id) return;
          const result = parsed.data;
          if (result.phase === 'progress') {
            reset();
            return;
          }
          if (result.phase === 'error') {
            finish(new Error(result.error));
            return;
          }
          if (result.phase === phase) finish(undefined, result);
        };
        child.on('message', message);
        child.once('exit', exit);
        reset();
        if (exited) exit();
        else child.postMessage(payload);
      });
    },
  };
}

export async function runCompleteArchiveImport(zipPath: string, folder: string, boundary: Boundary): Promise<CompleteImportResult> {
  if (active) return { ok: false, error: 'import-busy' };
  active = true;
  let stage: string | undefined;
  let worker: Awaited<ReturnType<typeof startWorker>> | undefined;
  let owner: number | null = null;
  const id = randomUUID();
  const executable = app.isPackaged ? path.join(process.resourcesPath, 'avif', 'avif-validator.exe') : path.join(app.getAppPath(), 'vendor', 'avif', 'avif-validator.exe');
  let result: CompleteImportResult = { ok: false, error: 'archive-import-failed' };
  try {
    const identity = boundary.getLibraryIdentity();
    stage = await fs.mkdtemp(path.join(os.tmpdir(), 'hologram-archive-import-'));
    worker = await startWorker(executable);
    result = await worker.request(id, { id, phase: 'prepare', zipPath, stage, executable }, 'prepared');
    if (result.ok) {
      owner = await boundary.pause();
      if (owner === null) result = { ok: false, error: 'library-busy' };
      else if (path.resolve(boundary.getSaveFolder()) !== path.resolve(folder) || boundary.getLibraryIdentity(owner) !== identity) result = { ok: false, error: 'library-changed' };
      else {
        boundary.closeDb(owner);
        result = await worker.request(id, { id, phase: 'apply', destination: folder }, 'done');
      }
    }
  } catch (error) {
    result = { ok: false, error: error instanceof Error ? error.message : 'archive-import-failed' };
  }
  try {
    // Job Object が子プロセスを止め終わるまで、DB を再開しない。
    await worker?.stop();
    if (stage && owner !== null) {
      const cleanup = await startWorker(executable);
      try {
        await cleanup.request(id, { id, phase: 'cleanup', stage, destination: folder }, 'done');
      } finally {
        await cleanup.stop();
      }
    }
    if (owner !== null) await boundary.finish(owner);
    if (stage) await fs.rm(stage, { recursive: true, force: true });
  } catch (error) {
    // 終了・清掃を確認できなければ所有権と journal を保持する。
    result = { ok: false, error: error instanceof Error ? error.message : 'archive-cleanup-failed' };
  } finally {
    active = false;
  }
  return result;
}
