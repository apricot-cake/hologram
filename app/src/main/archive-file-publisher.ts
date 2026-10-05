import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
export function createArchiveFilePublisher(executable: string) {
  if (process.platform !== 'win32')
    return {
      publish: async (source: string, target: string) => {
        try {
          await fs.link(source, target);
          return true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
          throw error;
        }
      },
      close: async () => {},
    };
  const child = spawn(executable, ['--publish-server'], { windowsHide: true, stdio: 'pipe' });
  let pending: { resolve: (value: boolean) => void; reject: (error: Error) => void; timer: NodeJS.Timeout } | undefined;
  let bytes = Buffer.alloc(0);
  let failed: Error | undefined;
  const fail = (error: Error) => {
    failed = error;
    clearTimeout(pending?.timer);
    pending?.reject(error);
    pending = undefined;
  };
  child.stdin.on('error', fail);
  child.stderr.on('data', () => {});
  child.on('error', fail);
  const closed = new Promise<void>((resolve) =>
    child.once('close', () => {
      fail(new Error('archive-publisher-exited'));
      resolve();
    }),
  );
  child.stdout.on('data', (chunk: Buffer) => {
    if (!pending || bytes.length + chunk.length > 4) {
      fail(new Error('invalid-publish-response'));
      child.kill();
      return;
    }
    bytes = Buffer.concat([bytes, chunk]);
    if (bytes.length !== 4) return;
    const result = bytes.readUInt32LE();
    const job = pending;
    clearTimeout(job.timer);
    pending = undefined;
    bytes = Buffer.alloc(0);
    if (result === 0) job.resolve(true);
    else if (result === 80 || result === 183) job.resolve(false);
    else job.reject(new Error(`archive-publish-failed:${result}`));
  });
  return {
    publish(source: string, target: string): Promise<boolean> {
      if (failed) return Promise.reject(failed);
      if (pending) return Promise.reject(new Error('archive-publisher-busy'));
      const paths = [Buffer.from(source, 'utf8'), Buffer.from(target, 'utf8')];
      if (paths.some((p) => p.length < 1 || p.length > 131072 || p.includes(0))) return Promise.reject(new Error('invalid-publish-path'));
      const header = Buffer.alloc(8);
      header.writeUInt32LE(paths[0].length, 0);
      header.writeUInt32LE(paths[1].length, 4);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          fail(new Error('archive-publisher-timeout'));
          child.kill();
        }, 120000);
        pending = { resolve, reject, timer };
        child.stdin.write(Buffer.concat([header, ...paths]));
      });
    },
    async close() {
      child.stdin.end();
      let forced = false;
      const timer = setTimeout(() => {
        forced = true;
        child.kill();
      }, 5000);
      try {
        await closed;
      } finally {
        clearTimeout(timer);
      }
      if (forced) throw new Error('archive-publisher-close-timeout');
    },
  };
}
