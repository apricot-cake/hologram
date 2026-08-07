'use strict';

// The stop handshake `scripts/restart-app.ps1` uses (app/src/main/restart-signal.ts),
// end to end against a real Electron: a throwaway launch carrying --hologram-quit loses
// the single-instance lock, its argv reaches the holder, and the holder quits itself.
//
// Why this needs a harness of its own rather than riding along with the SMOKE ones:
// SMOKE skips the lock entirely (`SMOKE || app.requestSingleInstanceLock()` in
// index.ts), so not one of the SMOKE harnesses ever reaches the branch this file
// exercises, and the Playwright layer runs a single instance per config dir so it never
// loses the lock either. Until this file existed the whole handshake was covered by hand
// measurement only — while the thing it replaced (matching processes from outside) was
// what a restart depended on.
//
// Isolated like every other harness: its own config dir, so the lock taken here is NOT
// the real app's. Plus HOLOGRAM_SANDBOX=1 so host registration (an HKCU write that would
// repoint the real Chrome at this throwaway config) never runs, and
// HOLOGRAM_START_MINIMIZED=1 so a verify run does not take the screen.
//
//   node scripts/test-app-restart-signal.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');
const { waitFor } = require('./lib-wait.cts');

const electronPath = resolveElectron();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-restart-signal-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const env = Object.assign({}, process.env, {
  APPDATA: tmp,
  HOLOGRAM_CONFIG_DIR: configDir,
  HOLOGRAM_SANDBOX: '1',
  HOLOGRAM_START_MINIMIZED: '1',
});
// Never inherit a SMOKE flag from whoever ran this: SMOKE skips the lock, which is the
// one thing this file is here to exercise. It would pass for the wrong reason.
delete env.HOLOGRAM_SMOKE;
delete env.HOLOGRAM_SMOKE_EVAL;

// Owned by app/src/main/restart-signal.ts and pinned by scripts/restart-signal.test.ts;
// repeated here because this file talks to the app across a process boundary, exactly
// the way restart-app.ps1 does.
const EXIT_NO_INSTANCE = 0;
const EXIT_SIGNALLED = 3;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
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

// One launch carrying the quit flag, resolved with its exit code: EXIT_SIGNALLED when an
// instance held the lock (and has now been told to quit), EXIT_NO_INSTANCE when none did.
function sendQuitSignal(): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(electronPath, ['.', '--hologram-quit'], { cwd: appDir, env, stdio: ['ignore', 'ignore', 'inherit'] });
    child.on('close', (code: number | null) => resolve(code ?? -1));
  });
}

(async () => {
  // Mutable field rather than a bare `let`: it is written from the close callback and
  // read from a waitFor poll, and an object keeps both sides reading the same value.
  const holder: { exit: number | null } = { exit: null };
  let ok = false;

  try {
    const port = await freePort();

    // 1. Nothing is running yet, so this launch WINS the lock — and must still not
    //    become the app. Reporting "nothing to stop" is its whole job.
    const beforeAnything = await sendQuitSignal();

    // 2. The instance under test. CDP answering is the post-condition for "it is up",
    //    the same signal scripts/sandbox-app.cts waits on.
    const child = spawn(electronPath, ['.', `--remote-debugging-port=${port}`], { cwd: appDir, env, stdio: ['ignore', 'ignore', 'inherit'] });
    child.on('close', (code: number | null) => {
      holder.exit = code ?? -1;
    });
    await waitFor(`the instance to answer CDP on :${port}`, () => cdpReady(port), { timeoutMs: 30_000 });

    // 3. The handshake itself.
    const withHolder = await sendQuitSignal();
    await waitFor('the instance to quit after the signal', () => holder.exit !== null, { timeoutMs: 20_000 });

    // 4. The lock is free again — what restart-app.ps1 polls for before starting the
    //    replacement, and what makes an early relaunch safe.
    const afterQuit = await sendQuitSignal();

    if (holder.exit === null) child.kill();

    const nothingRunning = beforeAnything === EXIT_NO_INSTANCE;
    const signalled = withHolder === EXIT_SIGNALLED;
    // 0, not a kill: the holder ran its own before-quit teardown rather than being torn
    // down, which is the part the old CloseMainWindow() call existed to preserve.
    const quitCleanly = holder.exit === 0;
    const lockReleased = afterQuit === EXIT_NO_INSTANCE;

    console.log(`nothingRunning=${nothingRunning} signalled=${signalled} quitCleanly=${quitCleanly}(${holder.exit}) lockReleased=${lockReleased}`);
    ok = nothingRunning && signalled && quitCleanly && lockReleased;
  } catch (err) {
    console.error(`restart-signal harness: ${(err as Error).message}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(ok ? 'RESTART_SIGNAL_TEST_PASS' : 'RESTART_SIGNAL_TEST_FAIL');
  process.exit(ok ? 0 : 1);
})();
