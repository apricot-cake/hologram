'use strict';

// 実ライブラリと配備通知を共有しない複製で、通常起動からの自己再起動を確認する。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const { waitFor } = require('../../../scripts/lib-wait.cts');
const { electronPath: resolveElectron } = require('../../../scripts/lib-electron-path.cts');
const root = path.resolve(__dirname, '../../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-deploy-test-'));
const appDir = path.join(tmp, 'app');
const config = path.join(tmp, 'config');
const electron = resolveElectron();
fs.mkdirSync(appDir);
fs.mkdirSync(config);
fs.cpSync(path.join(root, 'app', 'out'), path.join(appDir, 'out'), { recursive: true });
fs.copyFileSync(path.join(root, 'app', 'package.json'), path.join(appDir, 'package.json'));
fs.symlinkSync(path.join(root, 'node_modules'), path.join(tmp, 'node_modules'), 'junction');
fs.symlinkSync(path.join(root, 'native-host'), path.join(tmp, 'native-host'), 'junction');
const env: NodeJS.ProcessEnv = { ...process.env, HOLOGRAM_CONFIG_DIR: config, HOLOGRAM_SANDBOX: '1', HOLOGRAM_START_MINIMIZED: '1' };
delete env.HOLOGRAM_SMOKE;
delete env.ELECTRON_RENDERER_URL;
const launch = (args: string[]) => spawn(electron, [appDir, ...args], { env, windowsHide: true, stdio: ['ignore', 'ignore', 'inherit'] });
const signalQuit = () => new Promise((resolve) => launch(['--hologram-quit']).once('close', resolve));

(async () => {
  let started = false;
  let restartedProcesses: number[] = [];
  try {
    const port = await new Promise<number>((resolve) => {
      const server = net.createServer();
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        server.close(() => resolve(port));
      });
    });
    const endpoint = async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`);
        return ((await res.json()) as { webSocketDebuggerUrl: string }).webSocketDebuggerUrl;
      } catch {
        return '';
      }
    };
    let exited: number | null = null;
    launch([`--remote-debugging-port=${port}`]).once('close', (code: number) => {
      exited = code;
    });
    started = true;
    let first = '';
    await waitFor('initial app', async () => Boolean((first = await endpoint())), { timeoutMs: 30000 });
    // CDP は app.whenReady より先に応答する。監視を登録した後に作られる
    // アプリ画面の読み込みを待ち、通知が初期マーカーとして扱われる競合を避ける。
    const initialBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    try {
      const context = initialBrowser.contexts()[0];
      const page = context.pages()[0] || (await context.waitForEvent('page'));
      await page.waitForURL((url: URL) => url.protocol === 'app:' && url.hostname === 'bundle');
      await page.waitForLoadState('domcontentloaded');
    } finally {
      await initialBrowser.close();
    }
    const marker = path.join(appDir, '.deployed-build.json');
    fs.writeFileSync(`${marker}.tmp`, JSON.stringify({ build: 'test-update' }));
    fs.renameSync(`${marker}.tmp`, marker);
    await waitFor('old app to exit cleanly', () => exited === 0, { timeoutMs: 30000 });
    await waitFor(
      'new app to answer with a new process',
      async () => {
        const next = await endpoint();
        return Boolean(next && next !== first);
      },
      { timeoutMs: 30000 },
    );
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const cdp = await browser.newBrowserCDPSession();
    const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
    restartedProcesses = processInfo.map((info: { id: number }) => info.id);
    await cdp.detach();
    console.log('APP_DEPLOYMENT_TEST_PASS');
  } finally {
    if (started) {
      await signalQuit();
      await waitFor('test app to release its lock', async () => (await signalQuit()) === 0, { timeoutMs: 15000 });
      await waitFor(
        'restarted app processes to exit',
        () =>
          restartedProcesses.every((pid) => {
            try {
              process.kill(pid, 0);
              return false;
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
              throw error;
            }
          }),
        { timeoutMs: 15000 },
      );
    }
    // tmp はこの実行が作ったディレクトリ。junction は先に外し、参照先を残す。
    fs.unlinkSync(path.join(tmp, 'node_modules'));
    fs.unlinkSync(path.join(tmp, 'native-host'));
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
