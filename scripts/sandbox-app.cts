'use strict';

// Sandbox verify instance: a VISIBLE, PERSISTENT second app instance, fully
// isolated from the resident real app (:9222) — its own config dir, its own
// seeded library, its own CDP port. This is where interactive look/motion
// verification happens, so parallel worktrees never fight over the real app.
//
//   node scripts/sandbox-app.cts          start (idempotent — prints the port if already up)
//   node scripts/sandbox-app.cts stop     stop this tree's sandbox instance only
//
// Isolation model (see issue #283):
//   - HOLOGRAM_CONFIG_DIR → <tree>/.sandbox/config: userData is pinned to the
//     config dir, and Electron's single-instance lock is keyed on userData, so
//     this instance coexists with the real app.
//   - HOLOGRAM_SANDBOX=1 → main.mts skips native host registration (no HKCU
//     writes, no copy into the shared ~/.hologram).
//   - config.json is always written BEFORE first launch, pointing saveFolder at
//     the sandbox library — an unconfigured launch would fall back to the real
//     default library dir.
//   - CDP port is probed from 9333 (the real app owns :9222) and recorded in
//     .sandbox/instance.json. Connect with: CDP_PORT=<port> node scripts/cdp-verify.cts
//
// The sandbox lives in <tree>/.sandbox/ (gitignored): per-worktree, and the
// seeded fixture library survives restarts.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const zlib = require('node:zlib');

const repoRoot = path.join(__dirname, '..');
const appDir = path.join(repoRoot, 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const sandboxRoot = path.join(repoRoot, '.sandbox');
const configDir = path.join(sandboxRoot, 'config');
const saveFolder = path.join(sandboxRoot, 'library');
const appData = path.join(sandboxRoot, 'appdata'); // keep any %APPDATA% fallback reads/writes out of the real one (same practice as the test-app-* harnesses)
const instanceFile = path.join(sandboxRoot, 'instance.json');

// ---- fixture images: solid-color PNGs, no deps -----------------------------

let crcTable: number[] | null = null;
function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function makePng(w: number, h: number, rgb: [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  const row = Buffer.alloc(1 + w * 3); // filter byte 0 + RGB pixels
  for (let x = 0; x < w; x++) {
    // Subtle horizontal gradient so cards are visibly images, not flat swatches.
    const f = 0.75 + (0.25 * x) / w;
    row[1 + x * 3] = Math.round(rgb[0] * f);
    row[2 + x * 3] = Math.round(rgb[1] * f);
    row[3 + x * 3] = Math.round(rgb[2] * f);
  }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

// ---- fixture posts ---------------------------------------------------------

const PLATFORMS = ['x', 'bluesky', 'misskey', 'mastodon', 'pixiv'];
const SIZES: Array<[number, number]> = [
  [400, 300],
  [300, 400],
  [400, 400],
  [600, 240],
  [240, 600],
];
const COLORS: Array<[number, number, number]> = [
  [244, 154, 194],
  [255, 191, 134],
  [250, 231, 140],
  [168, 228, 160],
  [137, 207, 240],
  [177, 156, 217],
  [255, 160, 160],
  [140, 216, 199],
  [222, 184, 135],
  [176, 196, 222],
  [240, 180, 220],
  [190, 210, 150],
];
const TAGS = [['test'], ['test', '構図'], ['test', '配色'], ['test', '構図', 'ポーズ'], []];
const TEXTS = ['サンドボックス検証用のダミー投稿です。', '短文。', 'モーション・レイアウト検証のためのフィクスチャ投稿。カードの高さが揃わないよう、本文の長さは投稿ごとに変えてあります。グリッドの詰め方や省略記号の出方はこの投稿で確認できます。', '改行を含む投稿。\n二行目。\n三行目はすこし長めにしてあります。'];

function seedLibrary() {
  fs.mkdirSync(saveFolder, { recursive: true });
  if (fs.readdirSync(saveFolder).some((f) => f.endsWith('.json'))) return false;
  const base = Date.UTC(2026, 0, 15, 12, 0, 0);
  for (let i = 0; i < 12; i++) {
    const platform = PLATFORMS[i % PLATFORMS.length];
    const [w, h] = SIZES[i % SIZES.length];
    const captureId = `${base - i * 86400000}-sb${String(i).padStart(2, '0')}`;
    fs.writeFileSync(path.join(saveFolder, `${captureId}.png`), makePng(w, h, COLORS[i % COLORS.length]));
    const date = new Date(base - i * 86400000 - 7200000).toISOString();
    fs.writeFileSync(
      path.join(saveFolder, `${captureId}.json`),
      JSON.stringify(
        {
          captureId,
          image: `${captureId}.png`,
          url: `https://example.com/sandbox/${i}`,
          platform,
          text: `[${i + 1}/12] ${TEXTS[i % TEXTS.length]}`,
          displayName: `サンドボックス${i + 1}号`,
          screenName: `sandbox_${i + 1}`,
          likes: (i * 137) % 9000,
          reposts: (i * 41) % 800,
          replies: (i * 7) % 60,
          date,
          capturedAt: new Date(base - i * 86400000).toISOString(),
          tags: TAGS[i % TAGS.length],
        },
        null,
        2,
      ),
    );
  }
  return true;
}

// ---- instance management ---------------------------------------------------

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readInstance(): { pid: number; port: number } | null {
  try {
    const r = JSON.parse(fs.readFileSync(instanceFile, 'utf8'));
    return Number.isInteger(r.pid) && Number.isInteger(r.port) ? r : null;
  } catch {
    return null;
  }
}

function findFreePort(start: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (port: number) => {
      if (port > start + 100) return reject(new Error('no free port found'));
      const srv = net.createServer();
      srv.once('error', () => tryPort(port + 1));
      srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(port)));
    };
    tryPort(start);
  });
}

function cdpReady(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/json/version', timeout: 1000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function printConnectHint(port: number) {
  console.log(`sandbox instance up: CDP on 127.0.0.1:${port}`);
  console.log(`  connect: CDP_PORT=${port} node scripts/cdp-verify.cts`);
  console.log('  stop:    node scripts/sandbox-app.cts stop');
}

async function start() {
  const existing = readInstance();
  if (existing && isAlive(existing.pid)) {
    printConnectHint(existing.port);
    return;
  }

  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(appData, { recursive: true });
  const configPath = path.join(configDir, 'config.json');
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({ saveFolder, extensionId: 'testextensionidabcdefghijklmnop' }, null, 2));
  }
  const seeded = seedLibrary();

  const port = await findFreePort(9333);
  const env = Object.assign({}, process.env, {
    APPDATA: appData,
    HOLOGRAM_CONFIG_DIR: configDir,
    HOLOGRAM_SANDBOX: '1',
  });
  const child = spawn(electronPath, ['.', `--remote-debugging-port=${port}`], {
    cwd: appDir,
    env,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  for (let i = 0; i < 66; i++) {
    if (await cdpReady(port)) {
      fs.writeFileSync(instanceFile, JSON.stringify({ pid: child.pid, port }, null, 2));
      if (seeded) console.log(`seeded 12 fixture posts into ${saveFolder}`);
      printConnectHint(port);
      return;
    }
    if (child.pid && !isAlive(child.pid)) break;
    await sleep(300);
  }
  console.error('FAIL sandbox instance did not come up (CDP never answered)');
  process.exit(1);
}

async function stop() {
  const inst = readInstance();
  if (!inst || !isAlive(inst.pid)) {
    console.log('sandbox instance is not running');
    try {
      fs.unlinkSync(instanceFile);
    } catch {}
    return;
  }
  process.kill(inst.pid);
  for (let i = 0; i < 20 && isAlive(inst.pid); i++) await sleep(250);
  if (isAlive(inst.pid)) {
    console.error(`FAIL pid ${inst.pid} still alive after kill`);
    process.exit(1);
  }
  try {
    fs.unlinkSync(instanceFile);
  } catch {}
  console.log(`stopped sandbox instance (pid ${inst.pid}, port ${inst.port})`);
}

const cmd = process.argv[2] || 'start';
if (cmd === 'start') start();
else if (cmd === 'stop') stop();
else {
  console.error('usage: node scripts/sandbox-app.cts [start|stop]');
  process.exit(2);
}
