import path from 'node:path';
import { ArchiveImportRequest } from './archive-import-contract';
import { prepareArchiveImport, applyArchiveImport, cleanupArchiveImport } from './lib-archive-import';
import { openDatabase } from './lib-db';
type Port = { on(event: 'message', callback: (event: { data: unknown }) => void): void; postMessage(value: unknown): void };
const port = (process as NodeJS.Process & { parentPort?: Port }).parentPort;
const send = (value: unknown) => (port ? port.postMessage(value) : process.send?.(value));
let job: { id: string; stage: string; prepared: boolean; executable: string } | null = null;
let busy = false;
let lastProgress = 0;
async function receive(value: unknown) {
  const parsed = ArchiveImportRequest.safeParse(value);
  if (!parsed.success || busy) return;
  const request = parsed.data;
  if (request.phase === 'cleanup' ? job !== null : request.phase === 'prepare' ? job !== null : !job?.prepared || job.id !== request.id) return;
  busy = true;
  const progress = () => {
    if (Date.now() - lastProgress < 1000) return;
    lastProgress = Date.now();
    send({ id: request.id, phase: 'progress', ok: true });
  };
  const heartbeat = setInterval(progress, 1000);
  try {
    if (request.phase === 'prepare') {
      job = { id: request.id, stage: request.stage, prepared: false, executable: request.executable };
      const result = await prepareArchiveImport(request.zipPath, request.stage);
      job.prepared = result.ok;
      send({ id: request.id, phase: 'prepared', ...result });
    } else if (request.phase === 'cleanup') {
      await cleanupArchiveImport(request.stage, request.destination);
      send({ id: request.id, phase: 'done', ok: true });
    } else {
      const preparedJob = job;
      if (!preparedJob) throw new Error('missing-archive-import-job');
      const db = openDatabase(path.join(request.destination, 'hologram.db')).sqlite;
      let result: Awaited<ReturnType<typeof applyArchiveImport>>;
      try {
        result = await applyArchiveImport(db, preparedJob.stage, request.destination, progress, preparedJob.executable);
      } finally {
        db.close();
      }
      send({ id: request.id, phase: 'done', ...result });
    }
  } catch (error) {
    send({ id: request.id, phase: 'error', ok: false, error: error instanceof Error ? error.message.slice(0, 256) : 'archive-import-failed' });
  } finally {
    clearInterval(heartbeat);
    busy = false;
  }
}
if (port) port.on('message', (event) => void receive(event.data));
else if (process.send) process.on('message', (value) => void receive(value));
