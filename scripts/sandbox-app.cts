'use strict';

// Sandbox verify instance: a VISIBLE, PERSISTENT second app instance, fully
// isolated from the resident real app (:9222) — its own config dir, its own
// seeded library, its own CDP port. This is where interactive look/motion
// verification happens, so parallel worktrees never fight over the real app.
//
//   node scripts/sandbox-app.cts          start (idempotent — prints the port if already up)
//   node scripts/sandbox-app.cts stop     stop this tree's sandbox instance only
//
// Seeding (#286). The default is the generated fixture library below. Pass --real
// to seed from the REAL library instead — a backup-API snapshot of its database
// plus generated stand-in media, for the two things fixtures cannot reproduce
// (real diversity/scale, and one specific post). It only runs on a machine that
// holds a real library, never writes to it, and refuses to launch if the seeded
// sandbox still knows a real path (scripts/lib-sandbox-real-seed.cts):
//
//   node scripts/sandbox-app.cts start --real
//   node scripts/sandbox-app.cts start --real --capture 1784937641978-06cd   (real files for that post)
//   node scripts/sandbox-app.cts start --real --reseed --max-dim 1024
//
// A real-data instance shows a permanent on-screen notice: its window carries
// personal data, so its screenshots must not go into anything public (PR/Issue).
//
// Isolation model (see issue #283):
//   - HOLOGRAM_CONFIG_DIR → <tree>/.sandbox/config: userData is pinned to the
//     config dir, and Electron's single-instance lock is keyed on userData, so
//     this instance coexists with the real app.
//   - HOLOGRAM_SANDBOX=1 → app/src/main/index.ts skips native host registration (no HKCU
//     writes, no copy into the shared ~/.hologram).
//   - config.json is always written BEFORE first launch, pointing saveFolder at
//     the sandbox library — an unconfigured launch would fall back to the real
//     default library dir.
//   - CDP port is derived from THIS tree's path (the real app owns :9222) and
//     recorded in .sandbox/instance.json together with the tree it belongs to,
//     so parallel worktrees cannot end up driving each other's instance without
//     noticing (#640 — scripts/lib-sandbox-instance.cts has the why).
//     Connect with: CDP_PORT=sandbox node scripts/cdp-verify.cts
//
// The sandbox lives in <tree>/.sandbox/ (gitignored): per-worktree, and the
// seeded fixture library survives restarts.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const appDir = path.join(repoRoot, 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');
const { makePng, seedRealSandbox, DEFAULT_MAX_DIM } = require('./lib-sandbox-real-seed.cts');
const { seedLibrary } = require('./lib-seed-library.cts');
const { configDir: realConfigDir, defaultLibraryDir } = require('../native-host/paths.cts');
const { PORT_MIN, PORT_SPAN, clearInstance, foreignSandboxAt, readInstance, sandboxPortBase, writeInstance } = require('./lib-sandbox-instance.cts');

const electronPath = resolveElectron();

const sandboxRoot = path.join(repoRoot, '.sandbox');
const configDir = path.join(sandboxRoot, 'config');
const saveFolder = path.join(sandboxRoot, 'library');
const appData = path.join(sandboxRoot, 'appdata'); // keep any %APPDATA% fallback reads/writes out of the real one (same practice as the test-app-* harnesses)
// What the current library was seeded from — read on every start, because the
// real-data notice has to be re-applied to an instance that is merely restarted.
const seedFile = path.join(sandboxRoot, 'seed.json');

// ---- fixture posts ---------------------------------------------------------
// Images are the same solid-color gradient PNGs the real-data seed generates its
// stand-ins with (one encoder, shared).

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

function seedFixtureLibrary() {
  fs.mkdirSync(saveFolder, { recursive: true });
  if (libraryIsSeeded()) return false;
  const base = Date.UTC(2026, 0, 15, 12, 0, 0);
  const records: any[] = [];
  for (let i = 0; i < 12; i++) {
    const platform = PLATFORMS[i % PLATFORMS.length];
    const [w, h] = SIZES[i % SIZES.length];
    const captureId = `${base - i * 86400000}-sb${String(i).padStart(2, '0')}`;
    fs.writeFileSync(path.join(saveFolder, `${captureId}.png`), makePng(w, h, COLORS[i % COLORS.length]));
    const date = new Date(base - i * 86400000 - 7200000).toISOString();
    records.push({
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
    });
  }
  seedLibrary(configDir, records);
  return true;
}

// ---- real-data seed (#286) --------------------------------------------------

function readSeed(): any | null {
  try {
    return JSON.parse(fs.readFileSync(seedFile, 'utf8'));
  } catch {
    return null;
  }
}

function libraryIsSeeded(): boolean {
  if (fs.existsSync(path.join(configDir, 'hologram.db'))) return true;
  try {
    return fs.readdirSync(saveFolder).length > 0;
  } catch {
    return false;
  }
}

// --reseed: the sandbox is disposable by design, so this drops the whole seeded
// state (library, database, config) rather than trying to merge two seeds.
function wipeSeed() {
  fs.rmSync(saveFolder, { recursive: true, force: true });
  fs.rmSync(seedFile, { force: true });
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(path.join(configDir, 'hologram.db') + suffix, { force: true });
  fs.rmSync(path.join(configDir, 'config.json'), { force: true });
}

// The real library only exists on the machine that captures into it. Everywhere
// else (a fresh clone, a cloud runner) this has to fail with the reason, not with
// a stack trace from a missing file — #175's generated dummy library is the
// substitute there.
function resolveRealLibrary(): { configDir: string; saveFolder: string } {
  if (process.env.HOLOGRAM_CONFIG_DIR) throw new Error('HOLOGRAM_CONFIG_DIR is set — refusing to treat an already-isolated config dir as the real library');
  const dir = realConfigDir();
  const configPath = path.join(dir, 'config.json');
  if (!fs.existsSync(path.join(dir, 'hologram.db'))) throw new Error(`no real library on this machine (${path.join(dir, 'hologram.db')} not found). Use the fixture seed, or generate one with scripts/gen-dummy-library.cts`);
  let folder = '';
  try {
    folder = JSON.parse(fs.readFileSync(configPath, 'utf8')).saveFolder || '';
  } catch {
    /* fall through to the default */
  }
  if (!folder) folder = defaultLibraryDir();
  return { configDir: dir, saveFolder: folder };
}

async function seedReal(opts: { captureIds: string[]; maxDim: number }) {
  const real = resolveRealLibrary();
  console.log(`seeding from the real library: ${real.configDir} (media: ${real.saveFolder})`);
  const report = await seedRealSandbox({
    realConfigDir: real.configDir,
    realSaveFolder: real.saveFolder,
    sandboxConfigDir: configDir,
    sandboxLibrary: saveFolder,
    captureIds: opts.captureIds,
    maxDim: opts.maxDim,
    log: (msg: string) => console.log(`  ${msg}`),
  });
  fs.writeFileSync(seedFile, JSON.stringify(report, null, 2));
  return report;
}

// The on-screen notice a real-data instance carries for as long as it runs, so a
// screenshot of it can never look like a fixture screenshot (#286: real media
// must not reach anything public; the real database's post text is personal for
// the same reason).
function noticeFor(seed: any | null): string | null {
  if (!seed || seed.mode !== 'real') return null;
  const ids = (seed.realMedia && seed.realMedia.captureIds) || [];
  if (ids.length) return `実データ検証インスタンス（実メディア入り: ${ids.join(', ')}）— このウィンドウのスクリーンショットを公開物へ貼らないこと`;
  return '実データ検証インスタンス（実DBスナップショット）— このウィンドウのスクリーンショットを公開物へ貼らないこと';
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

// From this tree's own base port, then walking WITHIN the sandbox range so a
// hash collision or a leftover listener still yields an instance. A walked port
// is only safe because instance.json records the tree and cdp-verify checks the
// live target against it (#640).
function findFreePort(base: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryNth = (n: number) => {
      if (n >= PORT_SPAN) return reject(new Error(`no free port in the sandbox range ${PORT_MIN}-${PORT_MIN + PORT_SPAN - 1}`));
      const port = PORT_MIN + ((base - PORT_MIN + n) % PORT_SPAN);
      const srv = net.createServer();
      srv.once('error', () => tryNth(n + 1));
      srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(port)));
    };
    tryNth(0);
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
  console.log(`  connect: CDP_PORT=sandbox node scripts/cdp-verify.cts   (resolves :${port} from this tree's record)`);
  console.log('  stop:    node scripts/sandbox-app.cts stop');
}

async function start(opts: StartOptions) {
  const existing = readInstance(repoRoot);
  // A live pid is not proof the recorded port is still ours: pids get reused,
  // and an instance killed from outside leaves this file behind while another
  // tree takes the port. Never kill anything on that suspicion — just stop
  // believing the file and start our own instance on a fresh port (#640).
  const foreign = existing ? await foreignSandboxAt(existing.port, repoRoot) : null;
  if (existing && isAlive(existing.pid) && !foreign) {
    // Seeding swaps the database out from under the app, so it cannot happen
    // while the instance holds it open.
    if (opts.reseed || (opts.real && (readSeed() || {}).mode !== 'real')) {
      console.error('FAIL sandbox instance is running — stop it first: node scripts/sandbox-app.cts stop');
      process.exit(1);
    }
    printConnectHint(existing.port);
    return;
  }
  if (foreign) console.warn(`⚠ .sandbox/instance.json claims :${existing?.port}, but that port is serving ${foreign} — ignoring the stale record (pid ${existing?.pid} is not stopped by this script)`);

  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(appData, { recursive: true });
  if (opts.reseed) wipeSeed();
  let seeded = false;
  if (opts.real) {
    if (libraryIsSeeded() && (readSeed() || {}).mode !== 'real') {
      console.error('FAIL this sandbox already holds a fixture library — re-seed explicitly: node scripts/sandbox-app.cts start --real --reseed');
      process.exit(1);
    }
    if (!libraryIsSeeded()) {
      await seedReal(opts);
      seeded = true;
    }
  } else {
    const configPath = path.join(configDir, 'config.json');
    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, JSON.stringify({ saveFolder, extensionId: 'testextensionidabcdefghijklmnop' }, null, 2));
    }
    seeded = seedFixtureLibrary();
  }
  const notice = noticeFor(readSeed());

  const port = await findFreePort(sandboxPortBase(repoRoot));
  const env = Object.assign({}, process.env, {
    APPDATA: appData,
    HOLOGRAM_CONFIG_DIR: configDir,
    HOLOGRAM_SANDBOX: '1',
    // A verify instance is started by a session, not by the person at the keyboard:
    // it must not pull the foreground away from what they are doing. Set
    // HOLOGRAM_START_INACTIVE=0 for the rare run you want to drive by hand.
    HOLOGRAM_START_INACTIVE: process.env.HOLOGRAM_START_INACTIVE || '1',
    ...(notice ? { HOLOGRAM_SANDBOX_NOTICE: notice } : {}),
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
      writeInstance(repoRoot, { pid: child.pid as number, port });
      if (seeded && !opts.real) console.log(`seeded 12 fixture posts into ${saveFolder}`);
      if (notice) console.log(`⚠ ${notice}`);
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
  const inst = readInstance(repoRoot);
  if (!inst || !isAlive(inst.pid)) {
    console.log('sandbox instance is not running');
    clearInstance(repoRoot);
    return;
  }
  // "stop this tree's instance only" has to survive a stale record: if the port
  // is answering for another tree, this pid is a reused number and killing it
  // would take down someone else's session (#640).
  const foreign = await foreignSandboxAt(inst.port, repoRoot);
  if (foreign) {
    console.error(`FAIL :${inst.port} is serving another tree's sandbox (${foreign}) — refusing to kill pid ${inst.pid}. Dropping the stale record; stop that instance from its own tree.`);
    clearInstance(repoRoot);
    process.exit(1);
  }
  process.kill(inst.pid);
  for (let i = 0; i < 20 && isAlive(inst.pid); i++) await sleep(250);
  if (isAlive(inst.pid)) {
    console.error(`FAIL pid ${inst.pid} still alive after kill`);
    process.exit(1);
  }
  clearInstance(repoRoot);
  console.log(`stopped sandbox instance (pid ${inst.pid}, port ${inst.port})`);
}

interface StartOptions {
  real: boolean;
  reseed: boolean;
  captureIds: string[];
  maxDim: number;
}

function parseStartOptions(argv: string[]): StartOptions {
  const opts: StartOptions = { real: false, reseed: false, captureIds: [], maxDim: DEFAULT_MAX_DIM };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--real') opts.real = true;
    else if (a === '--reseed') opts.reseed = true;
    else if (a === '--capture')
      opts.captureIds.push(
        ...String(argv[++i] || '')
          .split(',')
          .filter(Boolean),
      );
    else if (a === '--max-dim') opts.maxDim = Number(argv[++i]);
    else throw new Error(`unknown option: ${a}`);
  }
  if (!Number.isFinite(opts.maxDim) || opts.maxDim < 16) throw new Error('--max-dim must be >= 16');
  if (opts.captureIds.length && !opts.real) throw new Error('--capture only applies to --real (the fixture seed has no real posts to pin)');
  return opts;
}

const cmd = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'start';
const rest = process.argv.slice(process.argv[2] === cmd ? 3 : 2);
if (cmd === 'start') {
  let opts: StartOptions;
  try {
    opts = parseStartOptions(rest);
  } catch (err) {
    console.error(`FAIL ${(err as Error).message}`);
    console.error('usage: node scripts/sandbox-app.cts [start [--real [--capture <id>[,<id>]] [--max-dim N] [--reseed]] | stop]');
    process.exit(2);
  }
  start(opts).catch((err) => {
    console.error(`FAIL ${err.stack || err.message}`);
    process.exit(1);
  });
} else if (cmd === 'stop') stop();
else {
  console.error('usage: node scripts/sandbox-app.cts [start [--real [--capture <id>[,<id>]] [--max-dim N] [--reseed]] | stop]');
  process.exit(2);
}
