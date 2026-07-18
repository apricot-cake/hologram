// Decode one frame back out of a stitched mp4 to verify the file is a
// valid playable stream. Prefers native ffmpeg, falls back to ffmpeg.wasm
// (see stitch.mjs for why). Usage: node scripts/probe.mjs <in.mp4> <seconds> <out.png>
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolveFfmpeg } from './ffmpeg-path.mjs';

const [inFile, at, outFile] = process.argv.slice(2);

const native = resolveFfmpeg();
if (native) {
  const r = spawnSync(native, ['-hide_banner', '-loglevel', 'warning', '-ss', at, '-i', inFile, '-frames:v', '1', '-update', '1', '-y', outFile], { stdio: ['ignore', 'ignore', 'inherit'] });
  process.exit(r.status === 0 ? 0 : 1);
}

globalThis.fetch = undefined; // see stitch.mjs
const { createFFmpeg } = await import('@ffmpeg/ffmpeg');
const ffmpeg = createFFmpeg({ log: false });
await ffmpeg.load();
ffmpeg.FS('writeFile', 'in.mp4', await readFile(inFile));
await ffmpeg.run('-ss', at, '-i', 'in.mp4', '-frames:v', '1', 'probe.png');
await writeFile(outFile, Buffer.from(ffmpeg.FS('readFile', 'probe.png')));
console.log(`wrote ${outFile}`);
process.exit(0);
