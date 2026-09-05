import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function buildFlagForPlatform(platform) {
  if (platform === 'win32') return '--win';
  throw new Error(`Hologram packages are only built for Windows (got ${platform})`);
}

function main() {
  const command = 'electron-builder.cmd';
  const result = spawnSync(command, [buildFlagForPlatform(process.platform)], { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entry === import.meta.url) main();
