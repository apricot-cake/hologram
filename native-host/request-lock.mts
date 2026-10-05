import fs from 'node:fs';
import { createHash } from 'node:crypto';
import net from 'node:net';

export interface RequestLock {
  close(): Promise<void>;
}

// Windows の名前付きパイプと Linux の abstract socket は、所有プロセスが
// 終了すると OS が解放する。要求ごとの永続ファイルや、PID による失効判定は要らない。
// それ以外の OS は呼び出し側の待機なし SQLite ロックへ退避する。
export async function acquireExactRequestLock(folder: string, requestId: string): Promise<RequestLock | null> {
  if (process.platform !== 'win32' && process.platform !== 'linux') return null;
  const realFolder = fs.realpathSync(folder);
  const identity = process.platform === 'win32' ? [realFolder.toLowerCase(), requestId.toLowerCase()] : [realFolder, requestId];
  const key = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  const address = process.platform === 'win32' ? `\\\\.\\pipe\\hologram-request-${key}` : `\0hologram-request-${key}`;
  const server = net.createServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      reject(error.code === 'EADDRINUSE' ? Object.assign(new Error('Save request is still processing'), { code: 'request-in-progress' }) : error);
    });
    server.once('listening', resolve);
    // Node#65057: この変数がある Windows では、競合した listen の失敗処理が
    // プロセスを落とす。同期的な listen 呼び出しの間だけ既定値を使用する。
    const pendingInstances = process.env.NODE_PENDING_PIPE_INSTANCES;
    try {
      if (process.platform === 'win32') delete process.env.NODE_PENDING_PIPE_INSTANCES;
      server.listen({ path: address, exclusive: true });
    } finally {
      if (process.platform === 'win32' && pendingInstances !== undefined) process.env.NODE_PENDING_PIPE_INSTANCES = pendingInstances;
    }
  });
  let closing: Promise<void> | null = null;
  return {
    close() {
      closing ??= new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      return closing;
    },
  };
}
