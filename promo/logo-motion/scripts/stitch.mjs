// Stitch a Remotion PNG sequence into an mp4 using ffmpeg.wasm.
// This machine's app-control policy (Smart App Control) blocks Remotion's
// bundled unsigned ffmpeg.exe, so encoding runs in WASM instead of a
// spawned binary. Usage: node scripts/stitch.mjs <seq-dir> <out.mp4>
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ffmpeg.wasm 0.11's emscripten loader mistakes Node >=18 for a browser
// because global fetch exists, then fails fetching a file path. Remove it
// so the loader falls back to fs.readFileSync.
globalThis.fetch = undefined;
const { createFFmpeg } = await import("@ffmpeg/ffmpeg");

const [seqDir, outFile] = process.argv.slice(2);
if (!seqDir || !outFile) {
  console.error("usage: node scripts/stitch.mjs <seq-dir> <out.mp4>");
  process.exit(1);
}

const ffmpeg = createFFmpeg({ log: false });
await ffmpeg.load();

const frames = (await readdir(seqDir)).filter((f) => f.endsWith(".png")).sort();
console.log(`${frames.length} frames from ${seqDir}`);
for (const f of frames) {
  ffmpeg.FS("writeFile", f, await readFile(join(seqDir, f)));
}

await ffmpeg.run(
  "-framerate", "30",
  "-i", "element-%03d.png",
  "-c:v", "libx264",
  "-pix_fmt", "yuv420p",
  "-crf", "18",
  "out.mp4",
);

await writeFile(outFile, Buffer.from(ffmpeg.FS("readFile", "out.mp4")));
console.log(`wrote ${outFile}`);
process.exit(0);
