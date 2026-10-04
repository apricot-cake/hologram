import fs from 'node:fs/promises';

// Windows の一時的な共有・ウイルス検査ロックだけを待つ。
// 再試行中に宛先が作られた場合も、上書きせず失敗にする。
export async function renameWithoutOverwrite(source: string, destination: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  const started = Date.now();
  let delay = 50;
  for (;;) {
    try {
      await fs.lstat(destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      try {
        await fs.rename(source, destination);
        return;
      } catch (renameError) {
        const elapsed = Date.now() - started;
        if (platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes((renameError as NodeJS.ErrnoException).code || '') || elapsed >= 3_000) throw renameError;
        await new Promise<void>((resolve) => setTimeout(resolve, Math.min(delay, 3_000 - elapsed)));
        delay = Math.min(delay + 50, 200);
        continue;
      }
    }
    throw new Error('Rename target already exists');
  }
}
