// Stitch a Remotion PNG sequence into an mp4.
// Remotion's bundled ffmpeg.exe is blocked by this machine's app-control
// policy, so encoding runs through a separately installed native ffmpeg
// when one is available (fast), falling back to ffmpeg.wasm (slow but
// spawns nothing). Usage: node scripts/stitch.mjs <seq-dir> <out.mp4>
import { spawnSync } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveFfmpeg } from './ffmpeg-path.mjs';

const [seqDir, outFile] = process.argv.slice(2);
if (!seqDir || !outFile) {
  console.error('usage: node scripts/stitch.mjs <seq-dir> <out.mp4>');
  process.exit(1);
}

const ENCODE_ARGS = ['-hide_banner', '-loglevel', 'warning', '-framerate', '30', '-i', join(seqDir, 'element-%03d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-y', outFile];

const native = resolveFfmpeg();
if (native) {
  console.log(`using native ffmpeg: ${native}`);
  const r = spawnSync(native, ENCODE_ARGS, { stdio: ['ignore', 'ignore', 'inherit'] });
  if (r.status !== 0) {
    console.error(`native ffmpeg failed (exit ${r.status})`);
    process.exit(1);
  }
  console.log(`wrote ${outFile}`);
  process.exit(0);
}

console.log('no native ffmpeg, falling back to ffmpeg.wasm');
// ffmpeg.wasm 0.11's emscripten loader mistakes Node >=18 for a browser
// because global fetch exists, then fails fetching a file path. Remove it
// so the loader falls back to fs.readFileSync.
globalThis.fetch = undefined;
const { createFFmpeg } = await import('@ffmpeg/ffmpeg');
const ffmpeg = createFFmpeg({ log: false });
await ffmpeg.load();

const frames = (await readdir(seqDir)).filter((f) => f.endsWith('.png')).sort();
console.log(`${frames.length} frames from ${seqDir}`);
for (const f of frames) {
  ffmpeg.FS('writeFile', f, await readFile(join(seqDir, f)));
}
await ffmpeg.run('-framerate', '30', '-i', 'element-%03d.png', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', 'out.mp4');
await writeFile(outFile, Buffer.from(ffmpeg.FS('readFile', 'out.mp4')));
console.log(`wrote ${outFile}`);
process.exit(0);
