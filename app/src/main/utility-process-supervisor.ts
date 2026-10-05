import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
export async function superviseProcess(pid: number, executable: string, maxBytes = 1024 * 1024 * 1024): Promise<ChildProcessWithoutNullStreams & { closed: Promise<void> }> {
  if (process.platform !== 'win32') throw new Error('Image process supervision unavailable');
  const supervisor = spawn(executable, ['--supervise', String(pid), String(maxBytes)], { windowsHide: true, stdio: 'pipe' });
  const closed = new Promise<void>((resolve) => supervisor.once('close', () => resolve()));
  supervisor.stdin.on('error', () => {});
  supervisor.stderr.on('data', () => {});
  await new Promise<void>((resolve, reject) => {
    let output = '';
    let ready = false;
    const timer = setTimeout(() => {
      supervisor.kill();
      reject(new Error('Image supervisor unavailable'));
    }, 5_000);
    supervisor.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (!ready && output === 'READY\n') {
        ready = true;
        clearTimeout(timer);
        resolve();
      } else if (output.length > 64) {
        clearTimeout(timer);
        supervisor.kill();
        reject(new Error('Invalid supervisor response'));
      }
    });
    supervisor.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    supervisor.once('close', () => {
      clearTimeout(timer);
      if (!ready) reject(new Error('Image supervisor exited'));
    });
  });
  return Object.assign(supervisor, { closed });
}
