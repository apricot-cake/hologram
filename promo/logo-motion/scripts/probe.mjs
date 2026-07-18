// Decode one frame back out of a stitched mp4 to verify the file is a
// valid playable stream (SAC blocks native ffprobe, so this runs in WASM).
// Usage: node scripts/probe.mjs <in.mp4> <seconds> <out.png>
import { readFile, writeFile } from "node:fs/promises";

globalThis.fetch = undefined; // see stitch.mjs
const { createFFmpeg } = await import("@ffmpeg/ffmpeg");

const [inFile, at, outFile] = process.argv.slice(2);
const ffmpeg = createFFmpeg({ log: false });
await ffmpeg.load();
ffmpeg.FS("writeFile", "in.mp4", await readFile(inFile));
await ffmpeg.run("-ss", at, "-i", "in.mp4", "-frames:v", "1", "probe.png");
await writeFile(outFile, Buffer.from(ffmpeg.FS("readFile", "probe.png")));
console.log(`wrote ${outFile}`);
process.exit(0);
