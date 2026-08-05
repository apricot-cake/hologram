'use strict';

// #50 acceptance: the tag model, run end to end inside the real app.
//
// NOT named test-app-*.cts, for the same reason scripts/test-ml-runtime.cts is
// not: it needs the network the first time (378MB from huggingface.co) and
// would make the offline nightly suite depend on a third party. It belongs to
// the "needs network" group in docs/testing.md.
//
// The question it answers is "did the preprocessing survive the trip", and it
// answers it WITHOUT a committed fixture image, by asking the model about two
// pictures whose correct answer is known in advance: a field of solid red and a
// field of solid blue. The model has separate tags for those (`red theme` /
// `blue theme`), so a swapped channel order — the failure this whole design is
// arranged around, because it is invisible everywhere else — makes the two
// answers trade places. A greyscale fixture could not catch it, and a
// photograph would have to be committed and licensed.
//
//   node scripts/test-ai-tags-model.cts
//   node scripts/test-ai-tags-model.cts --exe app/dist/win-unpacked/Hologram.exe
//   node scripts/test-ai-tags-model.cts --image path/to/a/real/picture.jpg

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

// Pinned independently of app/src/main/lib-model-registry.ts, which this CJS
// harness cannot import — scripts/model-registry.test.ts is where the two are
// held together, exactly as test-ml-runtime.cts does it.
const MODEL_REPO = 'SmilingWolf/wd-vit-tagger-v3';
const MODEL_REV = '7f6b584d0bd3f55c4531f14ba3d4761b2bccdc0f';
const MODEL_FILES = ['model.onnx', 'selected_tags.csv'];
const MODEL_SUBPATH = path.join('SmilingWolf', `wd-vit-tagger-v3@${MODEL_REV}`);
// Outside the repo and outside ~/.hologram: 378MB should survive worktree churn
// and must never land in the real config dir.
const MODEL_CACHE = path.join(os.tmpdir(), 'hologram-ai-tags-models', MODEL_SUBPATH);

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
};
const packagedExe = arg('--exe') ? path.resolve(arg('--exe') as string) : null;
const userImage = arg('--image') ? path.resolve(arg('--image') as string) : null;

async function ensureModel() {
  let downloaded = 0;
  for (const rel of MODEL_FILES) {
    const dest = path.join(MODEL_CACHE, rel);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const url = `https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REV}/${rel}`;
    console.log(`fetching ${rel} (this one is large the first time)`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`could not fetch ${url}: HTTP ${res.status}`);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    downloaded++;
  }
  if (downloaded) console.log(`fetched ${downloaded} model file(s) into ${MODEL_CACHE}`);
}

// A minimal PNG writer. Generating the fixtures beats committing them: they are
// two flat colours, and nothing about them needs to be reviewed or licensed.
function crc32(buf: Buffer) {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function solidPng(file: string, size: number, r: number, g: number, b: number) {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([len, typed, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const i = row + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = 255;
    }
  }
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
  return file;
}

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) return;
  failed++;
  console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
}

function boot(configDir: string, images: string[]): Promise<string> {
  const env = { ...process.env, APPDATA: path.dirname(configDir), HOLOGRAM_CONFIG_DIR: configDir, HOLOGRAM_SMOKE: '1', HOLOGRAM_AI_TAGS_SMOKE_IMAGE: images.join(path.delimiter) };
  const child = packagedExe ? spawn(packagedExe, [], { env, stdio: 'pipe' }) : spawn(resolveElectron(), ['.'], { cwd: appDir, env, stdio: 'pipe' });
  let output = '';
  child.stdout.on('data', (c) => {
    output += c;
  });
  child.stderr.on('data', (c) => {
    output += c;
  });
  return new Promise((resolve, reject) => {
    child.on('close', (code: number) => (code === 0 ? resolve(output) : reject(new Error(`Electron exited ${code}\n${output}`))));
  });
}

(async () => {
  await ensureModel();

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-ai-tags-model-'));
  const configDir = path.join(tmp, 'Hologram');
  const saveFolder = path.join(tmp, 'saves');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(saveFolder, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', ai: { enabled: true } }));

  // runMlSession refuses a directory outside <configDir>/models, so the cached
  // copy is staged into this run's sandbox rather than read from the cache.
  const modelDir = path.join(configDir, 'models', MODEL_SUBPATH);
  fs.mkdirSync(modelDir, { recursive: true });
  for (const rel of MODEL_FILES) fs.copyFileSync(path.join(MODEL_CACHE, rel), path.join(modelDir, rel));

  const red = solidPng(path.join(tmp, 'red.png'), 512, 220, 20, 20);
  const blue = solidPng(path.join(tmp, 'blue.png'), 512, 20, 20, 220);
  const images = userImage ? [red, blue, userImage] : [red, blue];

  try {
    const output = await boot(configDir, images);
    const line = output.split(/\r?\n/).find((l) => l.startsWith('AI_TAGS_MODEL_RESULT'));
    if (!line) throw new Error(`no AI_TAGS_MODEL_RESULT in output\n${output}`);
    const reports = JSON.parse(line.slice('AI_TAGS_MODEL_RESULT'.length));
    const [redReport, blueReport] = reports;

    for (const r of reports) {
      const label = path.basename(r.image);
      // The label file and the graph agree — the check that catches a
      // mismatched revision, which would silently rename every tag.
      check(`${label}: the graph produces one score per label`, r.scoreCount === 10861, r.scoreCount);
      // The sigmoid is INSIDE the graph. Scores outside [0, 1] would mean we
      // are thresholding logits, i.e. the thresholds mean nothing.
      check(`${label}: scores are probabilities, not logits`, r.maxScore <= 1 && r.minScore >= 0, { min: r.minScore, max: r.maxScore });
      check(`${label}: every rating label is recorded`, r.ratings.length === 4, r.ratings);
      console.log(
        `  ${label}: ${r.tags.length} candidate(s) in ${r.ms}ms — ${r.tags
          .slice(0, 8)
          .map((t: any) => `${t.name} ${t.score.toFixed(2)}`)
          .join(', ')}`,
      );
    }

    // The channel-order check, stated as the model would state it.
    const names = (r: any) => r.tags.map((t: any) => t.name);
    check('a red field is tagged red, not blue', names(redReport).includes('red theme') && !names(redReport).includes('blue theme'), names(redReport));
    check('a blue field is tagged blue, not red', names(blueReport).includes('blue theme') && !names(blueReport).includes('red theme'), names(blueReport));
    // The session is built once and reused; a second build would cost seconds.
    check('the second inference reuses the loaded session', blueReport.ms < Math.max(1000, redReport.ms), { first: redReport.ms, second: blueReport.ms });

    if (failed) throw new Error(`${failed} check(s) failed`);
    console.log(`PASS ai-tags model: preprocessing and inference agree with the model's own colour vocabulary${packagedExe ? ' (packaged build)' : ''}`);
  } catch (error) {
    console.error((error as Error).stack || error);
    process.exitCode = 1;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
