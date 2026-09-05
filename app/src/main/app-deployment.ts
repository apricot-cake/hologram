import fs from 'node:fs';
import path from 'node:path';
import chokidar from 'chokidar';
import { appActivity } from './app-activity.ts';

export function readDeployment(file: string): string | null {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return typeof data.build === 'string' && data.build ? data.build : null;
  } catch {
    return null;
  }
}

// 配備完了のマーカーだけを見る。生成途中のファイルでは再起動しない。
export function watchAppDeployment(appPath: string, restart: () => void, onError: (error: unknown) => void) {
  const marker = path.join(appPath, '.deployed-build.json');
  const initial = readDeployment(marker);
  let requested = false;
  const check = () => {
    const next = readDeployment(marker);
    if (!next || next === initial || requested) return;
    requested = true;
    appActivity.whenIdle(restart);
  };
  const watcher = chokidar.watch(marker, { ignoreInitial: true });
  watcher.on('add', check).on('change', check).on('ready', check).on('error', onError);
  return () => {
    appActivity.cancel();
    void watcher.close().catch(onError);
  };
}
