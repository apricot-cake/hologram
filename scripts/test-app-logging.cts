'use strict';

// Boots a disposable Electron instance and proves that both main-process startup
// diagnostics and an uncaught renderer error land in the config-directory log.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

const electronPath = resolveElectron();
const { evalSource } = require('./lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-logging-'));
const configDir = path.join(tmp, 'Hologram');
const logPath = path.join(configDir, 'logs', 'main.log');

// The throw is scheduled rather than raised inline: what is under test is that an
// UNCAUGHT renderer error reaches the log, and an inline throw would be caught by
// the eval's own promise chain instead.
const evalJs = evalSource(
  () =>
    new Promise((resolve) => {
      setTimeout(() => {
        throw new Error('renderer-log-smoke');
      }, 50);
      setTimeout(() => resolve('scheduled'), 200);
    }),
);

const env = {
  ...process.env,
  APPDATA: tmp,
  HOLOGRAM_CONFIG_DIR: configDir,
  HOLOGRAM_SMOKE: '1',
  HOLOGRAM_SMOKE_EVAL: evalJs,
};

const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: 'pipe' });
let output = '';
child.stdout.on('data', (chunk) => {
  output += chunk;
});
child.stderr.on('data', (chunk) => {
  output += chunk;
});

child.on('close', (code) => {
  try {
    const log = fs.readFileSync(logPath, 'utf8');
    if (code !== 0) throw new Error(`Electron exited ${code}\n${output}`);
    if (!log.includes('Starting Hologram')) throw new Error(`main startup log missing\n${log}`);
    if (!log.includes('renderer-log-smoke')) throw new Error(`renderer error log missing\n${log}`);
    // #1004: this spawn (like a stray Start Menu shortcut launch) carries no
    // --remote-debugging-port, so the dev-only warn from startup-debug-port.ts
    // should show up here — proof the check fires on a real, non-packaged instance.
    if (!log.includes('Launched without --remote-debugging-port')) throw new Error(`missing-marker warning missing (#1004)\n${log}`);
    console.log(`PASS app logging: ${logPath}`);
  } catch (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
