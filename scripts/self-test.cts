'use strict';

// Capture-pipeline health check. Run it after a save breaks to localize the fault
// fast (instead of guessing across extension / host / registry):
//
//   node scripts/self-test.cts
//
// Checks, in order:
//   1. bridge round-trip in a sandbox — proves the repo bridge code + the
//      native-messaging framing work (ping + save + sidecar written).
//   2. config.json parses (reports the resolved save folder).
//   3. the save folder (or its nearest existing ancestor) is writable.
//   4. (win32) the native-host MANIFEST under ~/.hologram resolves (launcher exists,
//      allows an extension origin). The HKCU pointer is reported as INFO only — an
//      in-container `reg query` reads the virtual hive and can't be trusted.
//   5. the DEPLOYED bridge (configDir/bridge.cts) matches the repo bridge —
//      install COPIES bridge.cts into the ASCII config dir, so a bridge edit does
//      nothing until you re-run install. A stale copy is the #1 "my fix didn't
//      take" trap.
//
// PASS/FAIL are hard; INFO/WARN never fail the suite.

const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { configDir, defaultLibraryDir } = require('../native-host/paths.cts');
const install = require('../native-host/install.cts');

const REPO_BRIDGE = path.join(__dirname, '..', 'native-host', 'bridge.cts');

// Minimal valid 1x1 JPEG (shared with test-bridge.cts).
const JPEG_B64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' + 'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' + 'AAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==';

function frame(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  return Buffer.concat([head, body]);
}

function parseFrames(buf) {
  const out: any[] = [];
  let off = 0;
  while (off + 4 <= buf.length) {
    const len = buf.readUInt32LE(off);
    if (off + 4 + len > buf.length) break;
    try {
      out.push(JSON.parse(buf.subarray(off + 4, off + 4 + len).toString('utf8')));
    } catch {
      /* skip */
    }
    off += 4 + len;
  }
  return out;
}

function resolveSaveFolder() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(configDir(), 'config.json'), 'utf8'));
    if (cfg && typeof cfg.saveFolder === 'string' && cfg.saveFolder.trim()) return cfg.saveFolder;
  } catch {
    /* fall through to default */
  }
  return defaultLibraryDir();
}

// --- check 1: sandbox round-trip (ping + save) ---
function sandboxRoundTrip() {
  return new Promise<any>((resolve) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-selftest-'));
    const saveFolder = path.join(tmp, 'saves');
    fs.mkdirSync(path.join(tmp, 'Hologram'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'Hologram', 'config.json'), JSON.stringify({ saveFolder }));
    const captureId = '1717500000000-beef';
    // Isolate configDir to the sandbox via HOLOGRAM_CONFIG_DIR.
    const env = Object.assign({}, process.env, { APPDATA: tmp, HOLOGRAM_CONFIG_DIR: path.join(tmp, 'Hologram') });
    const child = spawn(process.execPath, [REPO_BRIDGE], { env, stdio: ['pipe', 'pipe', 'ignore'] });
    let out = Buffer.alloc(0);
    child.stdout.on('data', (d) => {
      out = Buffer.concat([out, d]);
    });
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
        detail: ok ? 'ping+save+sidecar OK' : `pong=${pong} save=${saved} jpg=${jpgOk} json=${jsonOk}`,
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
    const sf = cfg && typeof cfg.saveFolder === 'string' && cfg.saveFolder.trim() ? cfg.saveFolder : `${defaultLibraryDir()} (default)`;
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
// Hard-check the MANIFEST FILE under configDir() (~/.hologram), which is NON-virtualized.
// We deliberately do NOT hard-fail on the HKCU pointer: a process running inside the MSIX
// Claude container reads the VIRTUAL hive (see CLAUDE.md), so a `reg query` verdict here is
// unreliable — the real Chrome consults the real hive. The HKCU value is reported separately
// as a soft INFO line (checkRegistryPointer). The authoritative signals for "is capture
// working" are a real-Chrome capture + ~/.hologram/bridge.log / capture.log.
function checkRegistration() {
  if (process.platform !== 'win32') return { name: 'host registration', ok: true, soft: true, detail: 'skipped (non-win32)' };
  const manifestPath = path.join(configDir(), `${install.HOST_NAME}.json`);
  if (!fs.existsSync(manifestPath)) {
    return { name: 'host registration', ok: false, detail: `manifest missing (${manifestPath}) — run: node native-host/install.cts` };
  }
  try {
    const man = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const launcherOk = !!man.path && fs.existsSync(man.path);
    const originsOk = Array.isArray(man.allowed_origins) && man.allowed_origins.length > 0;
    const ok = man.name === install.HOST_NAME && launcherOk && originsOk;
    let detail = `manifest=${manifestPath}; launcher ${launcherOk ? 'OK' : `MISSING (${man.path})`}`;
    if (!originsOk) detail += '; allowed_origins EMPTY — set the extension ID in the app, then re-register';
    return { name: 'host registration', ok, detail };
  } catch (e) {
    return { name: 'host registration', ok: false, detail: `manifest parse error: ${e.message}` };
  }
}

// --- info: HKCU pointer (win32) — SOFT, because in-container reads see the VIRTUAL hive ---
function checkRegistryPointer() {
  if (process.platform !== 'win32') return { name: 'HKCU pointer (info)', ok: true, soft: true, detail: 'skipped (non-win32)' };
  const key = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${install.HOST_NAME}`;
  const caveat = 'inside the MSIX Claude container this reads the VIRTUAL hive — NOT proof of the real Chrome state; confirm via a real capture + ~/.hologram/bridge.log';
  try {
    const out = execFileSync('reg', ['query', key, '/ve'], { encoding: 'utf8' });
    const m = out.match(/REG_SZ\s+(.+?)\s*$/m);
    const regPath = m ? m[1].trim() : '(no default value)';
    return { name: 'HKCU pointer (info)', ok: true, soft: true, detail: `${regPath} — ${caveat}` };
  } catch {
    return { name: 'HKCU pointer (info)', ok: true, soft: true, detail: `no value visible to this process — ${caveat}` };
  }
}

// --- check 5: deployed bridge freshness ---
function checkDeployedBridge() {
  const deployed = path.join(configDir(), 'bridge.cts');
  if (!fs.existsSync(deployed)) {
    return { name: 'deployed bridge', ok: false, detail: `missing (${deployed}) — run: node native-host/install.cts` };
  }
  const same = fs.readFileSync(deployed, 'utf8') === fs.readFileSync(REPO_BRIDGE, 'utf8');
  return same ? { name: 'deployed bridge', ok: true, detail: 'matches repo' } : { name: 'deployed bridge', ok: false, detail: 'STALE — differs from repo native-host/bridge.cts. Re-run: node native-host/install.cts' };
}

// --- check: the DEPLOYED bridge actually runs (not just matches by content) ---
// Spawns configDir/bridge.cts exactly as Chrome's launcher would and pings it.
// Catches a deployed copy that crashes on startup — e.g. a local require()
// (./media-download.cts) whose file wasn't deployed alongside bridge.cts. A
// content match can't catch this; only running it can.
function deployedBridgePing() {
  return new Promise<any>((resolve) => {
    const deployed = path.join(configDir(), 'bridge.cts');
    if (!fs.existsSync(deployed)) {
      resolve({ name: 'deployed bridge runs', ok: false, detail: `missing (${deployed}) — run: node native-host/install.cts` });
      return;
    }
    const child = spawn(process.execPath, [deployed], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = Buffer.alloc(0);
    let err = '';
    child.stdout.on('data', (d) => {
      out = Buffer.concat([out, d]);
    });
    child.stderr.on('data', (d) => {
      err += d;
    });
    child.on('error', (e) => resolve({ name: 'deployed bridge runs', ok: false, detail: `spawn failed: ${e.message}` }));
    child.on('close', () => {
      const pong = parseFrames(out).some((f) => f && f.pong);
      resolve(pong ? { name: 'deployed bridge runs', ok: true, detail: 'ping→pong from deployed copy' } : { name: 'deployed bridge runs', ok: false, detail: `no pong — deployed host crashed: ${err.trim().split('\n')[0] || 'no stderr'}` });
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
  const results = [await sandboxRoundTrip(), checkConfig(), checkWritable(), checkRegistration(), checkRegistryPointer(), checkDeployedBridge(), await deployedBridgePing(), captureLogInfo()];

  let hardFail = false;
  for (const r of results) {
    const tag = r.ok ? (r.soft ? 'INFO' : 'PASS') : r.soft ? 'WARN' : 'FAIL';
    if (!r.ok && !r.soft) hardFail = true;
    console.log(`[${tag}] ${r.name}: ${r.detail}`);
  }
  console.log(hardFail ? 'SELFTEST_FAIL' : 'SELFTEST_PASS');
  process.exit(hardFail ? 1 : 0);
})();
