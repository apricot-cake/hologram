'use strict';

const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const preview = require('./extension-preview-control.cts');

const ROOT = path.join(__dirname, '..');
const MAIN_ROOT = preview.worktreeContext(ROOT).mainRoot;
const EXTENSION = path.join(MAIN_ROOT, 'extension');
const OUTPUT = path.join(EXTENSION, '.output', 'chrome-mv3');
const RELEASE = path.join(EXTENSION, '.output', 'chrome-mv3-release');
const CONFIG = path.join(os.homedir(), '.hologram');
const STATUS = path.join(CONFIG, 'extension-dev-server.json');
const LOG = path.join(CONFIG, 'extension-dev-server.log');
const LOCK = path.join(CONFIG, 'extension-dev-server.lock');
const CONTROL = path.join(CONFIG, 'extension-dev-control.json');
const TASK_NAME = 'HologramExtensionDev';
const PORT = 51731;
const RESOURCES = ['/manifest.json', '/@vite/client', '/entrypoints/background.ts', '/entrypoints/resident.content.ts'];
const MAX_BACKOFF_MS = 60_000;

fs.mkdirSync(CONFIG, { recursive: true });

function alive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // A process started by an S4U scheduled task lives in session 0. The same
    // user can see it, but Windows denies the signal probe with EPERM. EPERM
    // also survives briefly for a stopped session-zero PID, so confirm that
    // the PID is still present instead of treating the error alone as proof.
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EPERM' || process.platform !== 'win32') return false;
    try {
      const tasks = execFileSync('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return tasks.includes(`"${pid}"`);
    } catch {
      return false;
    }
  }
}

function readStatus() {
  try {
    return JSON.parse(fs.readFileSync(STATUS, 'utf8'));
  } catch {
    return null;
  }
}

function writeStatus(state, values = {}) {
  const previous = readStatus() || {};
  const next = {
    ...previous,
    state,
    port: PORT,
    previewProtocol: 1,
    supervisorPid: process.pid,
    updatedAt: new Date().toISOString(),
    ...values,
  };
  const temp = `${STATUS}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, STATUS);
  return next;
}

function append(line) {
  fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${line}\n`, 'utf8');
}

function readControl() {
  try {
    return JSON.parse(fs.readFileSync(CONTROL, 'utf8'));
  } catch {
    return null;
  }
}

function writeControl(value) {
  const temp = `${CONTROL}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, CONTROL);
}

function listenerPid() {
  try {
    const output = execFileSync('netstat.exe', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true });
    for (const line of output.split(/\r?\n/)) {
      const match = line.match(/^\s*TCP\s+127\.0\.0\.1:51731\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
      if (match) return Number(match[1]);
    }
  } catch {
    /* status will report an ordinary readiness failure */
  }
  return null;
}

function parentPid(pid) {
  if (process.platform !== 'win32') return null;
  try {
    const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').ParentProcessId`], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const value = Number(output.trim());
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function isDescendant(pid, ancestorPid) {
  let current = pid;
  for (let depth = 0; depth < 16 && current; depth += 1) {
    if (current === ancestorPid) return true;
    current = parentPid(current);
  }
  return false;
}

async function ready() {
  try {
    let manifest: Record<string, any> | null = null;
    for (const resource of RESOURCES) {
      const response = await fetch(`http://127.0.0.1:${PORT}${resource}`, { signal: AbortSignal.timeout(1500) });
      if (!response.ok) return false;
      const body = await response.text();
      if (!body.length) return false;
      if (resource === '/manifest.json') manifest = JSON.parse(body);
    }
    return Boolean(manifest?.background?.service_worker && manifest?.content_scripts?.[0]?.js?.length);
  } catch {
    return false;
  }
}

function acquire() {
  try {
    const fd = fs.openSync(LOCK, 'wx');
    fs.writeFileSync(fd, String(process.pid));
    return fd;
  } catch {
    let owner = 0;
    try {
      owner = Number(fs.readFileSync(LOCK, 'utf8'));
    } catch {}
    if (alive(owner)) throw new Error(`extension dev supervisor is already running (PID ${owner})`);
    fs.rmSync(LOCK, { force: true });
    const fd = fs.openSync(LOCK, 'wx');
    fs.writeFileSync(fd, String(process.pid));
    return fd;
  }
}

function notifyOnce(message, status) {
  if (status.notified) return;
  writeStatus(status.state, { ...status, notified: true });
  try {
    execFileSync('msg.exe', ['*', `/time:60`, `Hologram extension dev server: ${message}`], { windowsHide: true, stdio: 'ignore' });
  } catch {
    append(`visible notification unavailable: ${message}`);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  const lockFd = acquire();
  let child: import('node:child_process').ChildProcess | null = null;
  let stopping = false;
  let failures = 0;
  let generation = Number(readStatus()?.generation || 0);
  let handledControlToken = readControl()?.token || null;

  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    if (child && alive(child.pid)) {
      try {
        execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      } catch {}
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('exit', () => {
    try {
      fs.closeSync(lockFd);
    } catch {}
    try {
      fs.rmSync(LOCK, { force: true });
    } catch {}
  });

  while (!stopping) {
    const selection = preview.readSelection(MAIN_ROOT);
    const sourceRoot = selection.sourceRoot;
    const collision = listenerPid();
    if (collision) {
      const control = readControl();
      const orphanAncestorPid = Number(control?.orphanAncestorPid);
      if (Number.isInteger(orphanAncestorPid) && orphanAncestorPid > 0 && isDescendant(collision, orphanAncestorPid)) {
        execFileSync('taskkill.exe', ['/PID', String(collision), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        writeControl({ ...control, orphanAncestorPid: null, orphanCleanedAt: new Date().toISOString() });
        append(`stopped orphaned listener PID ${collision} descended from previous server PID ${orphanAncestorPid}`);
        await delay(250);
        continue;
      }
      failures += 1;
      const status = writeStatus('failed', {
        serverPid: null,
        collisionPid: collision,
        failures,
        mainRoot: MAIN_ROOT,
        sourceRoot,
        ownerId: selection.ownerId,
        lastError: `port ${PORT} is already owned by PID ${collision}`,
      });
      append(status.lastError);
      notifyOnce(status.lastError, status);
      await delay(Math.min(1000 * 2 ** Math.min(failures - 1, 6), MAX_BACKOFF_MS));
      continue;
    }

    writeStatus(failures ? 'restarting' : 'starting', {
      serverPid: null,
      collisionPid: null,
      failures,
      mainRoot: MAIN_ROOT,
      sourceRoot,
      ownerId: selection.ownerId,
      lastError: null,
    });
    const log = fs.openSync(LOG, 'a');
    const running = spawn('npm run dev:ext:server', [], {
      cwd: sourceRoot,
      env: { ...process.env, HOLOGRAM_EXTENSION_DEV_OUTPUT: OUTPUT },
      shell: true,
      windowsHide: true,
      stdio: ['ignore', log, log],
    });
    child = running;
    writeStatus(failures ? 'restarting' : 'starting', {
      serverPid: running.pid,
      collisionPid: null,
      failures,
      mainRoot: MAIN_ROOT,
      sourceRoot,
      ownerId: selection.ownerId,
      lastError: null,
    });
    append(`server started from ${sourceRoot} (PID ${running.pid})`);

    let becameReady = false;
    let switching = false;
    let switchReason = '';
    for (let attempt = 0; attempt < 60 && !stopping && running.exitCode === null; attempt += 1) {
      const control = readControl();
      if (control?.token && control.token !== handledControlToken) {
        handledControlToken = control.token;
        switching = true;
        switchReason = 'explicit restart requested';
        break;
      }
      const desired = preview.readSelection(MAIN_ROOT);
      if (preview.normalize(desired.sourceRoot) !== preview.normalize(sourceRoot)) {
        switching = true;
        switchReason = `preview source changed from ${sourceRoot}`;
        break;
      }
      if (await ready()) {
        becameReady = true;
        generation += 1;
        failures = 0;
        writeStatus('ready', {
          serverPid: running.pid,
          collisionPid: null,
          failures,
          generation,
          mainRoot: MAIN_ROOT,
          sourceRoot,
          ownerId: selection.ownerId,
          readyAt: new Date().toISOString(),
          lastError: null,
          notified: false,
        });
        append(`ready from ${sourceRoot} (generation ${generation})`);
        break;
      }
      await delay(500);
    }

    while (becameReady && !stopping && running.exitCode === null) {
      const control = readControl();
      if (control?.token && control.token !== handledControlToken) {
        handledControlToken = control.token;
        switching = true;
        switchReason = 'explicit restart requested';
        break;
      }
      const desired = preview.readSelection(MAIN_ROOT);
      if (preview.normalize(desired.sourceRoot) !== preview.normalize(sourceRoot)) {
        switching = true;
        switchReason = `preview source changed from ${sourceRoot}`;
        break;
      }
      await delay(500);
    }

    if ((!becameReady || switching) && !stopping && running.exitCode === null) {
      try {
        execFileSync('taskkill.exe', ['/PID', String(running.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      } catch {}
    }

    const exit = await new Promise((resolve) => {
      if (running.exitCode !== null) resolve({ code: running.exitCode, signal: running.signalCode });
      else running.once('exit', (code, signal) => resolve({ code, signal }));
    });
    fs.closeSync(log);
    child = null;
    if (stopping) break;
    if (switching) {
      failures = 0;
      append(`${switchReason}; restarting immediately`);
      continue;
    }
    failures += 1;
    const waitMs = Math.min(1000 * 2 ** Math.min(failures - 1, 6), MAX_BACKOFF_MS);
    const error = becameReady ? `server exited (${JSON.stringify(exit)})` : `server failed readiness (${JSON.stringify(exit)})`;
    const state = failures >= 5 ? 'failed' : 'restarting';
    const status = writeStatus(state, { serverPid: null, failures, lastError: error, retryAt: new Date(Date.now() + waitMs).toISOString() });
    append(`${error}; retrying in ${waitMs}ms`);
    if (state === 'failed') notifyOnce(error, status);
    await delay(waitMs);
  }
}

function stopSupervisor() {
  const status = readStatus();
  const pid = Number(status?.supervisorPid);
  if (!alive(pid)) return 'stopped';
  try {
    execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    return 'direct';
  } catch (error) {
    if (process.platform !== 'win32') throw error;
    // S4U tasks run in session 0. The same user can inspect their process but
    // taskkill from an interactive session may be denied; Task Scheduler owns
    // that process tree and can stop it without elevating.
    const orphanAncestorPid = Number(status?.serverPid);
    if (Number.isInteger(orphanAncestorPid) && orphanAncestorPid > 0) {
      writeControl({
        token: `s4u-restart-${Date.now()}-${process.pid}`,
        requestedAt: new Date().toISOString(),
        requestedByPid: process.pid,
        orphanAncestorPid,
      });
    }
    execFileSync('schtasks.exe', ['/End', '/TN', TASK_NAME], { windowsHide: true, stdio: 'ignore' });
    return 'scheduler';
  }
}

function startDetached() {
  const child = spawn(process.execPath, [__filename, 'run'], { cwd: MAIN_ROOT, detached: true, windowsHide: true, stdio: 'ignore' });
  child.unref();
  return child.pid;
}

function restart() {
  const before = readStatus();
  if (before?.previewProtocol === 1 && alive(Number(before.supervisorPid))) {
    const token = `${Date.now()}-${process.pid}`;
    writeControl({ token, requestedAt: new Date().toISOString(), requestedByPid: process.pid });
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const current = readStatus();
      if (current?.state === 'ready' && Number(current.generation) > Number(before.generation || 0)) {
        console.log(`Hologram extension dev server restarted (generation ${current.generation}, PID ${current.serverPid}).`);
        return;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
    throw new Error('extension dev server did not become ready after restart request');
  }
  const stoppedBy = stopSupervisor();
  if (stoppedBy === 'scheduler') {
    execFileSync('schtasks.exe', ['/Run', '/TN', TASK_NAME], { windowsHide: true, stdio: 'ignore' });
    console.log('Hologram extension dev supervisor restart requested through Task Scheduler.');
    return;
  }
  const pid = startDetached();
  console.log(`Hologram extension dev supervisor restarted (PID ${pid}).`);
}

function status() {
  const value = readStatus();
  if (!value) {
    console.log(JSON.stringify({ state: 'stopped', port: PORT }, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({ ...value, supervisorAlive: alive(Number(value.supervisorPid)), serverAlive: alive(Number(value.serverPid)), log: LOG }, null, 2));
  if (value.state !== 'ready') process.exitCode = 1;
}

function recover() {
  stopSupervisor();
  preview.releasePreview('static-recovery', MAIN_ROOT, true);
  execFileSync('npm run build:ext', { cwd: MAIN_ROOT, shell: true, stdio: 'inherit' });
  const temp = `${OUTPUT}-recover-${process.pid}`;
  fs.rmSync(temp, { recursive: true, force: true });
  fs.cpSync(RELEASE, temp, { recursive: true });
  fs.rmSync(OUTPUT, { recursive: true, force: true });
  fs.renameSync(temp, OUTPUT);
  writeStatus('failed', { serverPid: null, collisionPid: null, lastError: 'static recovery output deployed; run npm run ext:restart to resume HMR' });
  console.log(`Verified static extension deployed to ${OUTPUT}.`);
}

function requestOrphanCleanup() {
  const orphanAncestorPid = Number(process.argv[3]);
  if (!Number.isInteger(orphanAncestorPid) || orphanAncestorPid < 1) throw new Error('a positive orphan ancestor PID is required');
  writeControl({
    token: `orphan-cleanup-${Date.now()}-${process.pid}`,
    requestedAt: new Date().toISOString(),
    requestedByPid: process.pid,
    orphanAncestorPid,
  });
  console.log(`Orphan cleanup requested for descendants of previous server PID ${orphanAncestorPid}.`);
}

const command = process.argv[2] || 'status';
if (command === 'run')
  run().catch((error) => {
    append(error?.stack || String(error));
    writeStatus('failed', { serverPid: null, lastError: error?.message || String(error) });
    process.exitCode = 1;
  });
else if (command === 'restart') restart();
else if (command === 'recover') recover();
else if (command === 'cleanup-orphan') requestOrphanCleanup();
else if (command === 'status') status();
else throw new Error(`unknown command: ${command}`);
