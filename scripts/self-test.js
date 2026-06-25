'use strict';

// Capture-pipeline health check. Run it after a save breaks to localize the fault
// fast (instead of guessing across extension / host / registry):
//
//   node scripts/self-test.js
//
// Checks, in order:
//   1. bridge round-trip in a sandbox — proves the repo bridge code + the
//      native-messaging framing work (ping + save + sidecar written).
//   2. config.json parses (reports the resolved save folder).
//   3. the save folder (or its nearest existing ancestor) is writable.
//   4. (win32) the native host is registered for Chrome and its manifest +
//      launcher resolve and allow an extension origin.
//   5. the DEPLOYED bridge (configDir/bridge.js) matches the repo bridge —
//      install COPIES bridge.js into the ASCII config dir, so a bridge edit does
//      nothing until you re-run install. A stale copy is the #1 "my fix didn't
//      take" trap.
//
// PASS/FAIL are hard; INFO/WARN never fail the suite.

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { configDir, defaultLibraryDir } = require('../native-host/paths');
const install = require('../native-host/install');

const REPO_BRIDGE = path.join(__dirname, '..', 'native-host', 'bridge.js');

// Minimal valid 1x1 JPEG (shared with test-bridge.js).
const JPEG_B64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==';

function frame(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  return Buffer.concat([head, body]);
}

function parseFrames(buf) {
  const out = [];
  let off = 0;
  while (off + 4 <= buf.length) {
    const len = buf.readUInt32LE(off);
    if (off + 4 + len > buf.length) break;
    try { out.push(JSON.parse(buf.subarray(off + 4, off + 4 + len).toString('utf8'))); } catch { /* skip */ }
    off += 4 + len;
  }
  return out;
}

function resolveSaveFolder() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(configDir(), 'config.json'), 'utf8'));
    if (cfg && typeof cfg.saveFolder === 'string' && cfg.saveFolder.trim()) return cfg.saveFolder;
  } catch { /* fall through to default */ }
  return defaultLibraryDir();
}

// --- check 1: sandbox round-trip (ping + save) ---
function sandboxRoundTrip() {
  return new Promise((resolve) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-selftest-'));
    const saveFolder = path.join(tmp, 'saves');
    fs.mkdirSync(path.join(tmp, 'Corpus'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'Corpus', 'config.json'), JSON.stringify({ saveFolder }));
    const captureId = '1717500000000-beef';
    // Isolate configDir to the sandbox via CORPUS_CONFIG_DIR.
    const env = Object.assign({}, process.env, { APPDATA: tmp, CORPUS_CONFIG_DIR: path.join(tmp, 'Corpus') });
    const child = spawn(process.execPath, [REPO_BRIDGE], { env, stdio: ['pipe', 'pipe', 'ignore'] });
    let out = Buffer.alloc(0);
    child.stdout.on('data', (d) => { out = Buffer.concat([out, d]); });
    child.on('error', (e) => {
      fs.rmSync(tmp, { recursive: true, force: true });
      resolve({ name: 'bridge round-trip (sandbox)', ok: false, detail: `spawn failed: ${e.message}` });
    });
    child.on('close', () => {
      const frames = parseFrames(out);
      const pong = frames.some((f) => f && f.pong);
      const saved = frames.some((f) => f && f.ok && f.file);
      const jpgOk = fs.existsSync(path.join(saveFolder, `${captureId}.jpg`));
      const jsonOk = fs.existsSync(path.join(saveFolder, `${captureId}.json`));
      fs.rmSync(tmp, { recursive: true, force: true });
      const ok = pong && saved && jpgOk && jsonOk;
      resolve({
        name: 'bridge round-trip (sandbox)',
        ok,
        detail: ok ? 'ping+save+sidecar OK' : `pong=${pong} save=${saved} jpg=${jpgOk} json=${jsonOk}`
      });
    });
    child.stdin.write(frame({ type: 'ping' }));
    child.stdin.write(frame({ type: 'save', captureId, image: JPEG_B64, metadata: { url: 'https://x.com/u/status/1', platform: 'x' }, metaOk: true }));
    child.stdin.end();
  });
}

// --- check 2: config.json ---
function checkConfig() {
  const p = path.join(configDir(), 'config.json');
  if (!fs.existsSync(p)) return { name: 'config.json', ok: true, soft: true, detail: `none (${p}) — default save folder will be used` };
  try {
    const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
    const sf = (cfg && typeof cfg.saveFolder === 'string' && cfg.saveFolder.trim()) ? cfg.saveFolder : `${defaultLibraryDir()} (default)`;
    return { name: 'config.json', ok: true, detail: `parses; saveFolder=${sf}` };
  } catch (e) {
    return { name: 'config.json', ok: false, detail: `parse error: ${e.message} (${p})` };
  }
}

// --- check 3: save folder writable ---
function checkWritable() {
  const folder = resolveSaveFolder();
  let target = folder;
  while (target && !fs.existsSync(target)) target = path.dirname(target); // bridge mkdirs on save; check the nearest existing ancestor
  try {
    fs.accessSync(target, fs.constants.W_OK);
    return { name: 'save folder writable', ok: true, detail: `${folder}${target === folder ? '' : ` (ancestor ${target})`}` };
  } catch (e) {
    return { name: 'save folder writable', ok: false, detail: `${folder} not writable: ${e.code || e.message}` };
  }
}

// --- check 4: native host registration (win32) ---
function checkRegistration() {
  if (process.platform !== 'win32') return { name: 'host registration', ok: true, soft: true, detail: 'skipped (non-win32)' };
  const key = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${install.HOST_NAME}`;
  let regPath = null;
  try {
    const out = execFileSync('reg', ['query', key, '/ve'], { encoding: 'utf8' });
    const m = out.match(/REG_SZ\s+(.+?)\s*$/m);
    regPath = m ? m[1].trim() : null;
  } catch {
    return { name: 'host registration', ok: false, detail: `not registered for Chrome — run: node native-host/install.js` };
  }
  if (!regPath || !fs.existsSync(regPath)) {
    return { name: 'host registration', ok: false, detail: `registry points at a missing manifest: ${regPath}` };
  }
  try {
    const man = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    const launcherOk = !!man.path && fs.existsSync(man.path);
    const originsOk = Array.isArray(man.allowed_origins) && man.allowed_origins.length > 0;
    const ok = man.name === install.HOST_NAME && launcherOk && originsOk;
    let detail = `manifest=${regPath}; launcher ${launcherOk ? 'OK' : `MISSING (${man.path})`}`;
    if (!originsOk) detail += '; allowed_origins EMPTY — set the extension ID in the app, then re-register';
    return { name: 'host registration', ok, detail };
  } catch (e) {
    return { name: 'host registration', ok: false, detail: `manifest parse error: ${e.message}` };
  }
}

// --- check 5: deployed bridge freshness ---
function checkDeployedBridge() {
  const deployed = path.join(configDir(), 'bridge.js');
  if (!fs.existsSync(deployed)) {
    return { name: 'deployed bridge', ok: false, detail: `missing (${deployed}) — run: node native-host/install.js` };
  }
  const same = fs.readFileSync(deployed, 'utf8') === fs.readFileSync(REPO_BRIDGE, 'utf8');
  return same
    ? { name: 'deployed bridge', ok: true, detail: 'matches repo' }
    : { name: 'deployed bridge', ok: false, detail: 'STALE — differs from repo native-host/bridge.js. Re-run: node native-host/install.js' };
}

// --- check: the DEPLOYED bridge actually runs (not just matches by content) ---
// Spawns configDir/bridge.js exactly as Chrome's launcher would and pings it.
// Catches a deployed copy that crashes on startup — e.g. a local require()
// (./media-download) whose file wasn't deployed alongside bridge.js. A content
// match can't catch this; only running it can.
function deployedBridgePing() {
  return new Promise((resolve) => {
    const deployed = path.join(configDir(), 'bridge.js');
    if (!fs.existsSync(deployed)) {
      resolve({ name: 'deployed bridge runs', ok: false, detail: `missing (${deployed}) — run: node native-host/install.js` });
      return;
    }
    const child = spawn(process.execPath, [deployed], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = Buffer.alloc(0);
    let err = '';
    child.stdout.on('data', (d) => { out = Buffer.concat([out, d]); });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => resolve({ name: 'deployed bridge runs', ok: false, detail: `spawn failed: ${e.message}` }));
    child.on('close', () => {
      const pong = parseFrames(out).some((f) => f && f.pong);
      resolve(pong
        ? { name: 'deployed bridge runs', ok: true, detail: 'ping→pong from deployed copy' }
        : { name: 'deployed bridge runs', ok: false, detail: `no pong — deployed host crashed: ${(err.trim().split('\n')[0]) || 'no stderr'}` });
    });
    child.stdin.write(frame({ type: 'ping' }));
    child.stdin.end();
  });
}

// --- info: capture.log ---
function captureLogInfo() {
  const p = path.join(configDir(), 'capture.log');
  if (!fs.existsSync(p)) return { name: 'capture.log', ok: true, soft: true, detail: `none yet (${p})` };
  return { name: 'capture.log', ok: true, soft: true, detail: `${p} (${fs.statSync(p).size} bytes)` };
}

(async () => {
  const results = [
    await sandboxRoundTrip(),
    checkConfig(),
    checkWritable(),
    checkRegistration(),
    checkDeployedBridge(),
    await deployedBridgePing(),
    captureLogInfo()
  ];

  let hardFail = false;
  for (const r of results) {
    const tag = r.ok ? (r.soft ? 'INFO' : 'PASS') : (r.soft ? 'WARN' : 'FAIL');
    if (!r.ok && !r.soft) hardFail = true;
    console.log(`[${tag}] ${r.name}: ${r.detail}`);
  }
  console.log(hardFail ? 'SELFTEST_FAIL' : 'SELFTEST_PASS');
  process.exit(hardFail ? 1 : 0);
})();
