import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function buildFlagForPlatform(platform) {
  if (platform === 'win32') return '--win';
  if (platform === 'darwin') return '--mac';
  throw new Error(`Hologram packages are only built for Windows and macOS (got ${platform})`);
}

function main() {
  const command = process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder';
  const result = spawnSync(command, [buildFlagForPlatform(process.platform)], { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entry === import.meta.url) main();
