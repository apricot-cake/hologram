'use strict';

// Reload-accumulation probe (#66): does repeated renderer reloading grow the GPU
// process, and is that growth specific to the dev server?
//
// Both arms run the SAME app against the SAME seeded fixture library in an
// isolated HOLOGRAM_CONFIG_DIR, on a port outside both :9222 (real app) and the
// sandbox range (scripts/lib-sandbox-instance.cts), so a probe run never touches
// the resident app, the real library, or another tree's sandbox instance.
//
//   node scripts/probe-gpu-reload.cts --mode=prod --reloads=20
//   node scripts/probe-gpu-reload.cts --mode=dev  --reloads=20
//   node scripts/probe-gpu-reload.cts --mode=dev  --reloads=20 --empty   (no posts = no image decode)
//
//   --mode=prod   electron . against app/out (what a packaged build loads)
//   --mode=dev    electron-vite dev (renderer over http, HMR client attached)
//   --mode=hmr    electron-vite dev, but each step edits a mounted renderer
//                 component and waits for the hot update instead of reloading.
//                 This is what "reloading the screen during development" ACTUALLY
//                 does most of the time - editing a renderer file never reaches
//                 Page.reload - so a probe that only reloads cannot answer #66.
//   --empty       skip the fixture seed, so the grid has nothing to decode
//   --keep        leave the instance running after the report (for poking at it)
//
// Measurement. The axes are the ones #66 names: GPU-process private bytes, and
// idle frame rate. Private bytes come from Win32_Process over the DESCENDANTS of
// the pid we spawned (not from a command-line match) - Electron pins userData at
// runtime via app.setPath, so a config dir never appears in a child's argv and
// matching on it would silently select nothing. Renderer-side DOM counters and JS
// heap ride along, because a leak that shows up there is a different bug from one
// that only shows up in the GPU process.
//
// The window is started inactive (HOLOGRAM_START_INACTIVE=1) so a probe cannot
// pull focus away from whoever is at the keyboard. That backgrounds the renderer,
// which would throttle rAF to nothing and make the FPS axis meaningless, so the
// throttling flags below are passed in BOTH arms - they are part of the
// measurement setup, not a difference between the arms.

const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const WebSocket = require('ws');

const repoRoot = path.join(__dirname, '..');
const appDir = path.join(repoRoot, 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');
const { makePng } = require('./lib-sandbox-real-seed.cts');
const { seedLibrary } = require('./lib-seed-library.cts');

// Outside :9222 and outside the sandbox range (9333-9432), so a probe run cannot
// be mistaken for - or collide with - either.
const PORT_MIN = 9500;
const PORT_SPAN = 40;

const NO_THROTTLE = ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion'];

const { sleep, waitFor } = require('./lib-wait.cts');

// ---- options ---------------------------------------------------------------

interface Options {
  mode: 'prod' | 'dev' | 'hmr';
  reloads: number;
  empty: boolean;
  keep: boolean;
  label: string;
}

function parseOptions(argv: string[]): Options {
  const opts: Options = { mode: 'prod', reloads: 20, empty: false, keep: false, label: '' };
  for (const a of argv) {
    if (a.startsWith('--mode=')) opts.mode = a.slice(7) as Options['mode'];
    else if (a.startsWith('--reloads=')) opts.reloads = Number(a.slice(10));
    else if (a === '--empty') opts.empty = true;
    else if (a === '--keep') opts.keep = true;
    else if (a.startsWith('--label=')) opts.label = a.slice(8);
    else throw new Error(`unknown option: ${a}`);
  }
  if (!['prod', 'dev', 'hmr'].includes(opts.mode)) throw new Error('--mode must be prod, dev or hmr');
  if (!Number.isInteger(opts.reloads) || opts.reloads < 1) throw new Error('--reloads must be a positive integer');
  if (!opts.label) opts.label = `${opts.mode}${opts.empty ? '-empty' : ''}`;
  return opts;
}

// ---- fixture library -------------------------------------------------------

const COLORS: Array<[number, number, number]> = [
  [244, 154, 194],
  [255, 191, 134],
  [250, 231, 140],
  [168, 228, 160],
  [137, 207, 240],
  [177, 156, 217],
];

// Bigger than the sandbox fixtures on purpose: this probe is looking for decode
// residue, and a 400x300 png decodes to too little to see over 20 reloads.
function seedFixtures(configDir: string, saveFolder: string, count: number) {
  fs.mkdirSync(saveFolder, { recursive: true });
  const base = Date.UTC(2026, 0, 15, 12, 0, 0);
  const records: any[] = [];
  for (let i = 0; i < count; i++) {
    const captureId = `${base - i * 3600000}-p66${String(i).padStart(2, '0')}`;
    fs.writeFileSync(path.join(saveFolder, `${captureId}.png`), makePng(1600, 1200, COLORS[i % COLORS.length]));
    records.push({
      captureId,
      image: `${captureId}.png`,
      url: `https://example.com/probe66/${i}`,
      platform: 'x',
      text: `[${i + 1}/${count}] #66 reload probe fixture`,
      displayName: `probe66-${i + 1}`,
      screenName: `probe66_${i + 1}`,
      likes: i * 13,
      reposts: i * 3,
      replies: i,
      date: new Date(base - i * 3600000 - 7200000).toISOString(),
      capturedAt: new Date(base - i * 3600000).toISOString(),
      tags: ['probe66'],
    });
  }
  seedLibrary(configDir, records);
}

// ---- process sampling ------------------------------------------------------

interface Proc {
  pid: number;
  ppid: number;
  name: string;
  priv: number;
  ws: number;
  type: string; // 'browser' | 'gpu-process' | 'renderer' | 'utility' | ...
}

// One CIM query per sample. CommandLine is only used to CLASSIFY a process we
// already selected by descent, never to select one.
function snapshotProcs(): Proc[] {
  const ps = `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Select-Object ProcessId,ParentProcessId,Name,PrivatePageCount,WorkingSetSize,CommandLine | ConvertTo-Json -Compress -Depth 2`;
  let out = '';
  try {
    out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch {
    return [];
  }
  let rows: any[] = [];
  try {
    const parsed = JSON.parse(out || '[]');
    rows = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
  return rows.filter(Boolean).map((r) => {
    const cmd = String(r.CommandLine || '');
    const m = cmd.match(/--type=([\w-]+)/);
    return {
      pid: Number(r.ProcessId),
      ppid: Number(r.ParentProcessId),
      name: String(r.Name),
      priv: Number(r.PrivatePageCount || 0),
      ws: Number(r.WorkingSetSize || 0),
      type: m ? m[1] : 'browser',
    } as Proc;
  });
}

// Descendants of `root` within the snapshot, plus root itself if it is an
// electron.exe. In dev the root we spawned is node (electron-vite), which is not
// in the snapshot at all - its electron child still resolves because the parent
// chain is walked against the FULL process table, not just the electron rows.
//
// Re-read on EVERY sample, never cached. A reload can replace the renderer
// process, and a pid that did not exist when the map was built resolves to no
// parent at all - so a cached map silently reports "0 renderer processes, 0 MB"
// instead of failing, which is the exact shape of a false negative in a leak
// probe. The first run of this script did report renderer=0 for that reason.
function fullParentMap(): Map<number, number> {
  const ps = `Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress`;
  const map = new Map<number, number>();
  try {
    const parsed = JSON.parse(execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }) || '[]');
    for (const r of Array.isArray(parsed) ? parsed : [parsed]) map.set(Number(r.ProcessId), Number(r.ParentProcessId));
  } catch {
    /* empty map = caller reports "cannot tell" rather than a wrong number */
  }
  return map;
}

function descendsFrom(pid: number, root: number, parents: Map<number, number>): boolean {
  let cur = pid;
  for (let hops = 0; hops < 12; hops++) {
    if (cur === root) return true;
    const next = parents.get(cur);
    if (!next || next === cur || next === 0) return false;
    cur = next;
  }
  return false;
}

interface Sample {
  n: number;
  gpuPriv: number;
  gpuWs: number;
  mainPriv: number;
  rendererPriv: number;
  rendererCount: number;
  procCount: number;
  fps: number;
  jsHeap: number;
  nodes: number;
  listeners: number;
  documents: number;
}

// ---- CDP -------------------------------------------------------------------

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

function pageTarget(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}/json/list`, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            const list = JSON.parse(body);
            const page = list.find((t: any) => t.type === 'page' && /index\.html|app:\/\//.test(t.url)) || list.find((t: any) => t.type === 'page');
            if (!page) return reject(new Error('no page target'));
            resolve(page.webSocketDebuggerUrl);
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', (e) => reject(new Error(`cannot reach CDP on :${port} (${e.message})`)));
  });
}

async function connect(port: number) {
  const ws = new WebSocket(await pageTarget(port), { maxPayload: 64 * 1024 * 1024 });
  let id = 0;
  const pending = new Map<number, { res: (v: any) => void; rej: (e: any) => void }>();
  const events = new Map<string, Array<() => void>>();
  // How many times the Vite client has reported applying a hot update. The HMR
  // arm advances on this counter rather than on a fixed sleep, so a step that
  // silently did NOT hot-update (a full page reload, or an HMR error) shows up as
  // a timeout instead of quietly becoming a "no accumulation" data point.
  const hot = { count: 0 };
  ws.on('message', (d: any) => {
    const m = JSON.parse(d);
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = (m.params?.args || []).map((a: any) => String(a?.value ?? '')).join(' ');
      if (/\[vite\].*(hot updated|hmr update)/i.test(text)) hot.count++;
    }
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id) as any;
      pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    } else if (m.method && events.has(m.method)) {
      const waiters = events.get(m.method) as Array<() => void>;
      events.set(m.method, []);
      for (const w of waiters) w();
    }
  });
  await new Promise((r) => ws.on('open', r));
  const send = (method: string, params?: any) =>
    new Promise<any>((res, rej) => {
      const mid = ++id;
      pending.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
    });
  const once = (method: string, ms: number) =>
    new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(false), ms);
      const list = events.get(method) || [];
      list.push(() => {
        clearTimeout(t);
        resolve(true);
      });
      events.set(method, list);
    });
  return { ws, send, once, hot };
}

const FPS_EXPR = `new Promise((r) => { let n = 0; const t0 = performance.now(); const tick = () => { n++; const dt = performance.now() - t0; if (dt < 1500) requestAnimationFrame(tick); else r(Math.round((n / dt) * 1000 * 10) / 10); }; requestAnimationFrame(tick); })`;

async function measure(cdp: any, n: number, root: number): Promise<Sample> {
  const parents = fullParentMap();
  const procs = snapshotProcs().filter((p) => descendsFrom(p.pid, root, parents));
  const sum = (t: string, k: 'priv' | 'ws') => procs.filter((p) => p.type === t).reduce((a, p) => a + p[k], 0);
  let fps = -1;
  try {
    const r = await cdp.send('Runtime.evaluate', { expression: FPS_EXPR, awaitPromise: true, returnByValue: true, timeout: 10000 });
    fps = Number(r?.result?.value ?? -1);
  } catch {
    /* -1 = could not read, reported as such */
  }
  let jsHeap = 0;
  try {
    jsHeap = Number((await cdp.send('Runtime.getHeapUsage'))?.usedSize || 0);
  } catch {
    /* optional */
  }
  let counters: Record<string, number> = {};
  try {
    const r = await cdp.send('Memory.getDOMCounters');
    counters = { nodes: r.nodes, listeners: r.jsEventListeners, documents: r.documents };
  } catch {
    /* optional */
  }
  return {
    n,
    gpuPriv: sum('gpu-process', 'priv'),
    gpuWs: sum('gpu-process', 'ws'),
    mainPriv: sum('browser', 'priv'),
    rendererPriv: sum('renderer', 'priv'),
    rendererCount: procs.filter((p) => p.type === 'renderer').length,
    procCount: procs.length,
    fps,
    jsHeap,
    nodes: counters.nodes || 0,
    listeners: counters.listeners || 0,
    documents: counters.documents || 0,
  };
}

// ---- launch ----------------------------------------------------------------

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryNth = (i: number) => {
      if (i >= PORT_SPAN) return reject(new Error('no free probe port'));
      const port = PORT_MIN + i;
      const srv = net.createServer();
      srv.once('error', () => tryNth(i + 1));
      srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(port)));
    };
    tryNth(0);
  });
}

// The file the HMR arm edits: a component that is mounted in the default view,
// so every hot update actually re-renders something rather than being dropped.
const HMR_TARGET = path.join(appDir, 'src', 'renderer', 'src', 'grid', 'Grid.tsx');
const HMR_MARK = '// #66 probe marker';

function touchHmrTarget(original: string, i: number) {
  const body = original.replace(new RegExp(`\\n${HMR_MARK}.*$`), '');
  fs.writeFileSync(HMR_TARGET, `${body}\n${HMR_MARK} ${i}\n`);
}

function launch(opts: Options, port: number, env: NodeJS.ProcessEnv) {
  if (opts.mode === 'prod') {
    return spawn(resolveElectron(), ['.', `--remote-debugging-port=${port}`, ...NO_THROTTLE], { cwd: appDir, env, detached: true, stdio: 'ignore' });
  }
  // The dev arm has to reproduce `npm run dev --workspace=app`, whose first two
  // steps are the theme-boot and native-host-bridge builds - electron-vite alone
  // does not produce them, and the app fails to boot without them.
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(npm, ['run', 'build:theme-boot', '--workspace=app'], { cwd: repoRoot, stdio: 'ignore', shell: process.platform === 'win32' });
  execFileSync(npm, ['run', 'build:native-host-bridge', '--workspace=app'], { cwd: repoRoot, stdio: 'ignore', shell: process.platform === 'win32' });
  // Resolved via the package's own package.json, not require.resolve on the bin
  // path: electron-vite declares `exports`, so a subpath that is not listed there
  // (bin/ is not) throws ERR_PACKAGE_PATH_NOT_EXPORTED even though the file exists.
  const cli = path.join(path.dirname(require.resolve('electron-vite/package.json', { paths: [repoRoot, appDir] })), 'bin', 'electron-vite.js');
  return spawn(process.execPath, [cli, 'dev', `--remoteDebuggingPort=${port}`, '--', ...NO_THROTTLE], { cwd: appDir, env, detached: true, stdio: 'ignore' });
}

// ---- report ----------------------------------------------------------------

const mb = (b: number) => (b / (1024 * 1024)).toFixed(1);

function report(opts: Options, samples: Sample[]) {
  console.log('');
  console.log(`== #66 reload probe: ${opts.label} (${opts.reloads} reloads) ==`);
  console.log('  n | gpu priv | gpu ws  | main priv | rend priv | rend# | fps  | js heap | nodes | listeners | docs');
  for (const s of samples) {
    console.log(
      `${String(s.n).padStart(3)} | ${mb(s.gpuPriv).padStart(8)} | ${mb(s.gpuWs).padStart(7)} | ${mb(s.mainPriv).padStart(9)} | ${mb(s.rendererPriv).padStart(9)} | ${String(s.rendererCount).padStart(5)} | ${String(s.fps).padStart(4)} | ${mb(s.jsHeap).padStart(7)} | ${String(s.nodes).padStart(5)} | ${String(s.listeners).padStart(9)} | ${String(s.documents).padStart(4)}`,
    );
  }
  const first = samples[0];
  const last = samples[samples.length - 1];
  const delta = (k: keyof Sample) => Number(last[k]) - Number(first[k]);
  console.log('');
  console.log(`  delta over ${samples.length - 1} reloads: gpu priv ${mb(delta('gpuPriv'))} MB, gpu ws ${mb(delta('gpuWs'))} MB, main priv ${mb(delta('mainPriv'))} MB, renderer priv ${mb(delta('rendererPriv'))} MB`);
  console.log(`  fps ${first.fps} -> ${last.fps} | documents ${first.documents} -> ${last.documents} | listeners ${first.listeners} -> ${last.listeners} | nodes ${first.nodes} -> ${last.nodes}`);
  console.log(`  per-reload gpu priv: ${(delta('gpuPriv') / 1024 / (samples.length - 1)).toFixed(0)} KB`);
}

// ---- main ------------------------------------------------------------------

async function main() {
  const opts = parseOptions(process.argv.slice(2));
  const probeRoot = path.join(repoRoot, '.probe66', opts.label);
  const configDir = path.join(probeRoot, 'config');
  const saveFolder = path.join(probeRoot, 'library');
  const appData = path.join(probeRoot, 'appdata');
  fs.rmSync(probeRoot, { recursive: true, force: true });
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(appData, { recursive: true });
  fs.mkdirSync(saveFolder, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'testextensionidabcdefghijklmnop' }, null, 2));
  if (!opts.empty) seedFixtures(configDir, saveFolder, 24);

  const port = await findFreePort();
  const env = Object.assign({}, process.env, {
    APPDATA: appData,
    HOLOGRAM_CONFIG_DIR: configDir,
    HOLOGRAM_SANDBOX: '1',
    HOLOGRAM_START_INACTIVE: '1',
  });
  console.log(`launching ${opts.mode} arm on :${port} (config ${configDir}, ${opts.empty ? 'empty library' : '24 posts'})`);
  const child = launch(opts, port, env);
  child.unref();

  const up = await waitFor(`the ${opts.mode} arm to answer CDP on :${port}`, () => cdpReady(port), { timeoutMs: 60_000, pollMs: 300 }).then(
    () => true,
    () => false,
  );
  if (!up) {
    console.error('FAIL app did not come up (CDP never answered)');
    try {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      /* best effort */
    }
    process.exit(1);
  }

  const root = child.pid as number;
  const cdp = await connect(port);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  // Fixed on purpose: this is a MEASUREMENT settle, not a test wait. Let first
  // paint, the initial query and the thumbnail decodes finish before the
  // baseline - otherwise reload #1 absorbs all of startup and looks like a leak.
  // Ending it the moment some condition holds would move the baseline from run
  // to run, which is the one thing this probe cannot have.
  // biome-ignore lint/plugin: measurement settle — every run must start the same distance in
  await sleep(6000);

  const samples: Sample[] = [];
  samples.push(await measure(cdp, 0, root));
  const original = opts.mode === 'hmr' ? fs.readFileSync(HMR_TARGET, 'utf8') : '';
  let hotMissed = 0;
  try {
    for (let i = 1; i <= opts.reloads; i++) {
      if (opts.mode === 'hmr') {
        const before = cdp.hot.count;
        touchHmrTarget(original, i);
        const applied = await waitFor(`step ${i}'s hot update to be applied`, () => cdp.hot.count > before, { timeoutMs: 15_000, pollMs: 250 }).then(
          () => true,
          () => false,
        );
        if (!applied) hotMissed++;
      } else {
        const loaded = cdp.once('Page.loadEventFired', 20000);
        await cdp.send('Page.reload', { ignoreCache: false });
        await loaded;
      }
      // Fixed for the same reason as the baseline settle above: every sample has
      // to be taken the same distance past its reload, or the series compares
      // nothing. (query + thumbnail decode after load / re-render after a hot update)
      // biome-ignore lint/plugin: measurement settle — every sample must sit the same distance past its reload
      await sleep(2500);
      samples.push(await measure(cdp, i, root));
    }
  } finally {
    if (opts.mode === 'hmr') fs.writeFileSync(HMR_TARGET, original);
  }
  if (hotMissed) console.log(`  ⚠ ${hotMissed}/${opts.reloads} steps never reported a hot update — those rows measure something other than an applied HMR update`);

  report(opts, samples);
  fs.writeFileSync(path.join(probeRoot, 'samples.json'), JSON.stringify({ label: opts.label, mode: opts.mode, empty: opts.empty, samples }, null, 2));
  console.log(`  raw: ${path.join(probeRoot, 'samples.json')}`);

  cdp.ws.close();
  if (!opts.keep) {
    try {
      execFileSync('taskkill', ['/PID', String(root), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      /* already gone */
    }
  } else {
    console.log(`  instance left running (pid ${root}, :${port}) - stop it with: taskkill /PID ${root} /T /F`);
  }
}

main().catch((e) => {
  console.error(`FAIL ${e.stack || e.message}`);
  process.exit(1);
});
