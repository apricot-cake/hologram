'use strict';

// Verifies pixiv ugoira playback (#119 St3) in the real renderer.
//
// An ugoira enters the library as the zip pixiv distributes it in (a bundle of frame
// images), and there's no single-file format that can play it directly — the app side
// opens the zip and draws the frames to a canvas. What's covered here is that path itself,
// the part unit tests never touch:
//
//   - main opens the archive, matches it against the frame table, and returns one frame's
//     worth of bytes over IPC (ugoira-frames-present / ugoira-frame, #506)
//   - the renderer builds a Blob from the bytes it received and can draw it to a canvas
//   - the canvas advances at the rate given by the frame table's delay (the pixels actually change)
//   - pausing stops the frames, and playing resumes them
//
// Assembles a 3-frame zip from PNGs, giving each frame a different color so "which frame is
// this" can be told apart from a single pixel. Double-click to enter the image tab follows
// the same shape as test-app-click-model.
//
//   node scripts/test-app-ugoira.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');
const { readEvalResult } = require('./lib-eval-result.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('./lib-seed-library.cts');
const { rendererWaits } = require('./lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-ugoira-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');

// --- Assemble a 1x1 PNG on the fly (frames are told apart by color, so one ready-made image isn't enough) ---
function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png1x1(r: number, g: number, b: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.from([0, r, g, b]))), chunk('IEND', Buffer.alloc(0))]);
}

// --- Minimal ZIP writer, STORE (uncompressed) only (enough to produce one real zip) ---
function zipOf(entries: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'latin1');
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 8); // method: store
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(e.data.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, e.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(e.data.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + e.data.length;
  }
  const centralBytes = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}

const ID = 'dummy-ugo1';
// Red -> green -> blue. A single canvas pixel tells you which frame it is
const FRAME_COLORS = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
];
const FRAMES = FRAME_COLORS.map((_, i) => ({ file: `00000${i}.png`, delay: 60 }));
fs.writeFileSync(path.join(saveFolder, `${ID}-media-0.zip`), zipOf(FRAMES.map((f, i) => ({ name: f.file, data: png1x1(FRAME_COLORS[i][0], FRAME_COLORS[i][1], FRAME_COLORS[i][2]) }))));
fs.writeFileSync(path.join(saveFolder, `${ID}-poster.jpg`), jpeg);
fs.writeFileSync(path.join(saveFolder, `${ID}.jpg`), jpeg);
seedLibrary(configDir, [
  {
    captureId: ID,
    image: `${ID}.jpg`,
    url: 'https://www.pixiv.net/artworks/147661146',
    platform: 'pixiv',
    title: 'うごイラ',
    mediaType: 'gif',
    media: [{ url: 'https://i.pximg.net/u.zip', alt: null, width: 1, height: 1, file: `${ID}-media-0.zip`, type: 'ugoira', posterFile: `${ID}-poster.jpg`, frames: FRAMES }],
    capturedAt: '2026-01-01T00:00:00.000Z',
    date: '2026-01-01T00:00:00.000Z',
  },
]);

const evalJs = `(async () => {
  ${rendererWaits()}
  const out = {};

  const cardEl = () => document.querySelector('[data-slot="post-grid"] [data-slot="post-card"]');
  await waitFor('the seeded ugoira post to appear as a card', () => !!cardEl());
  const card = cardEl();
  out.cardFound = !!card;
  if (!card) return JSON.stringify(out);
  // Play badge: the "won't move until clicked" indicator shows up just like it does for video
  out.playBadge = !!document.querySelector('[data-slot="post-card-play"]');

  card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  out.imageTabActive = await waitFor('the image tab to open on double click', () => !!document.querySelector('[data-slot="image-tab-view"]'));

  const canvasEl = () => document.querySelector('[data-slot="ugoira-stage"] canvas');
  await waitFor('the ugoira stage to put up its canvas', () => !!canvasEl());
  const canvas = canvasEl();
  out.canvasFound = !!canvas;
  if (!canvas) return JSON.stringify(out);

  // Wait until the first frame is drawn (IPC -> Blob -> createImageBitmap)
  const px = () => {
    try {
      const d = canvas.getContext('2d').getImageData(0, 0, 1, 1).data;
      return d[0] + ',' + d[1] + ',' + d[2];
    } catch (e) { return 'ERR:' + e.message; }
  };
  const drawn = await waitFor('the first ugoira frame to be drawn onto the canvas', () => { const p = px(); return p !== '0,0,0' && !p.startsWith('ERR'); });
  out.firstPixel = drawn ? px() : null;

  // The frames actually advance = the color changes on each delay tick.
  // Sampled until a second color shows up rather than over a fixed window: every
  // step from here to a drawn frame 2 is IPC (main reads the frame out of the
  // zip) plus createImageBitmap, and on a loaded CI runner that first hop alone
  // outran the old 1s budget — the nightly went red with ["255,0,0"] while the
  // same build advanced through all three colors locally. What is being asserted
  // is that the animation moves, not how fast the runner gets there.
  const seen = new Set();
  await waitFor('the ugoira to advance far enough to show a second frame colour', () => { seen.add(px()); return seen.size >= 2; }, 10000);
  out.colorsSeen = [...seen].sort();

  // Stops when paused
  const toggle = document.querySelector('[data-slot="ugoira-toggle"]');
  out.toggleFound = !!toggle;
  if (toggle) {
    toggle.click();
    // Kept as a fixed delay: a frame already in flight when the click landed still
    // gets drawn afterwards, and that draw is not the animation running. 300ms is
    // five frame delays (60ms), so the in-flight one has landed by then.
    await sleep(300);
    const held = px();
    // "Nothing happens" has no post-condition to poll for — the assertion IS the
    // absence — so this one spends its whole window on purpose; keep it short.
    out.pausedHeld = await neverHappens('the paused canvas to change frames', () => px() !== held, 500);
    toggle.click();
    const resumeFrom = px();
    out.resumed = await waitFor('the frames to start advancing again after resuming', () => px() !== resumeFrom, 3000);
  }
  return JSON.stringify(out);
})()`;

const env = Object.assign({}, process.env, {
  APPDATA: tmp,
  HOLOGRAM_CONFIG_DIR: configDir,
  HOLOGRAM_SMOKE: '1',
  HOLOGRAM_SMOKE_EVAL: evalJs,
});

const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => {
  out += d.toString();
  process.stdout.write(d);
});

child.on('close', () => {
  const r = readEvalResult(out) || {};
  fs.rmSync(tmp, { recursive: true, force: true });

  let ok = true;
  const check = (label, cond) => {
    console.log((cond ? 'PASS' : 'FAIL') + '  ' + label);
    if (!cond) ok = false;
  };

  console.log('\n--- うごイラ再生（#119 St3） ---\n');
  check('① カードが出る', r.cardFound === true);
  check('② ▶ バッジが付く', r.playBadge === true);
  check('③ ダブルクリックで画像タブへ', r.imageTabActive === true);
  check('④ canvas が立つ', r.canvasFound === true);
  check(`⑤ main がコマを返し 1コマ目を描画 (${r.firstPixel})`, !!r.firstPixel && !String(r.firstPixel).startsWith('ERR'));
  check(`⑥ コマが進む（2色以上を観測: ${JSON.stringify(r.colorsSeen)}）`, Array.isArray(r.colorsSeen) && r.colorsSeen.length >= 2);
  check('⑦ 一時停止ボタンがある', r.toggleFound === true);
  check('⑦ 一時停止でコマが止まる', r.pausedHeld === true);
  check('⑧ 再生で再び進む', r.resumed === true);

  console.log('\n' + (ok ? 'PASS すべて緑' : 'FAIL 赤あり'));
  process.exit(ok ? 0 : 1);
});
