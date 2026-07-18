// Resolve a runnable native ffmpeg, or null to fall back to ffmpeg.wasm.
// Remotion's bundled ffmpeg.exe is blocked by this machine's app-control
// policy (unsigned/low-reputation), but a widely-distributed build such as
// winget's Gyan.FFmpeg passes, so prefer that when present.
import { spawnSync } from 'node:child_process';
import { globSync } from 'node:fs';

const runnable = (cmd) => {
  try {
    return spawnSync(cmd, ['-version'], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
};

export const resolveFfmpeg = () => {
  const candidates = [process.env.FFMPEG_PATH, 'ffmpeg', ...globSync(`${process.env.LOCALAPPDATA}/Microsoft/WinGet/Packages/Gyan.FFmpeg_*/ffmpeg-*/bin/ffmpeg.exe`)].filter(Boolean);
  return candidates.find(runnable) ?? null;
};
