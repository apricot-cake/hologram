'use strict';

// Reproduction of #726 = **restart the dev server for real and see whether the
// extension finds its way back to HMR**.
//
// CRXJS substitutes `__LIVE_RELOAD__` into the worker client with a string
// pattern, so only the first of its two occurrences is rewritten. The survivor
// sits in the socket close handler, which is the one path a server restart
// takes: the worker waits for the server to answer again and then throws
// `ReferenceError: __LIVE_RELOAD__ is not defined` instead of calling
// `chrome.runtime.reload()`. Nothing reopens the socket after that, so every
// later edit lands in the fixed output and silently never reaches an open tab.
// `scripts/patch-crxjs-runtime-reload.cts` rewrites both occurrences; this test
// measures the consequence rather than the patched text.
//
// The measurement is server side: Vite knows how many HMR clients hold a socket,
// and the service worker is the only client that holds one of its own (content
// scripts talk to it over a chrome.runtime port). `/@hologram/dev-status` is
// what `npm run ext:status` reads for the same reason.
//
// ⚠️**The last step of the recovery cannot be measured here, and that is a
// property of the browser this test drives, not of the fix.** An extension that
// Chromium was given on the command line (`--load-extension`, which is the only
// way Playwright can install one) is *unloaded for good* by
// `chrome.runtime.reload()`: afterwards even its own options page answers
// ERR_BLOCKED_BY_CLIENT, and no worker ever starts again (measured 2026-08-02).
// So this test asserts the extension reaches CRXJS's recovery call instead of
// dying before it, and the socket coming back on the other side of that call is
// checked on a real Chrome with `npm run ext:status`.
//
//   node scripts/e2e-extension-hmr-reconnect.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { launchExtensionBrowser } = require('./lib-extension-e2e.cts');
const { fixtureHtml } = require('./lib-overlay-e2e.cts');

const ROOT = path.join(__dirname, '..');
const FIXTURE_URL = 'https://x.com/home';

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`);
  if (!ok) failures.push(what);
};
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function hmrClients(port: number): Promise<number | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/@hologram/dev-status`, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return null;
    const body = await response.json();
    return Number.isInteger(body?.hmrClients) ? body.hmrClients : null;
  } catch {
    return null;
  }
}

async function waitForClients(port: number, target: number, timeoutMs: number): Promise<number | null> {
  const deadline = Date.now() + timeoutMs;
  let last: number | null = null;
  for (;;) {
    last = await hmrClients(port);
    if (typeof last === 'number' && last >= target) return last;
    if (Date.now() > deadline) return last;
    await wait(500);
  }
}

// The supervisor starts the server the same way, so a restart here exercises the
// same process tree the daily loop restarts.
function startServer(port: number, output: string): any {
  const server = spawn('npm run dev:ext:server', [], {
    cwd: ROOT,
    env: { ...process.env, HOLOGRAM_EXTENSION_DEV_OUTPUT: output, HOLOGRAM_EXTENSION_DEV_PORT: String(port) },
    shell: true,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', () => {});
  return server;
}

function stopServer(server: any): Promise<void> {
  return new Promise((resolve) => {
    if (!server || server.exitCode !== null) return resolve();
    server.once('exit', () => resolve());
    if (process.platform === 'win32') spawn('taskkill.exe', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else server.kill('SIGKILL');
  });
}

async function waitForServer(port: number, output: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (typeof (await hmrClients(port)) === 'number' && fs.existsSync(path.join(output, 'manifest.json'))) return true;
    await wait(500);
  }
  return false;
}

// A live content script keeps the worker awake, which is the state the daily
// loop is in and the state the bug survives in: a worker that never idles out
// never gets the fresh client that would have reconnected on its own.
async function openFeed(context: any): Promise<any> {
  const page = await context.newPage();
  await page.route('**/*', async (route: any) => {
    const request = route.request();
    if (request.isNavigationRequest() && request.url() === FIXTURE_URL) await route.fulfill({ status: 200, contentType: 'text/html', body: fixtureHtml('x') });
    else await route.abort();
  });
  await page.goto(FIXTURE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="tweetPhoto"]');
  return page;
}

(async () => {
  const port = await freePort();
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-hmr-reconnect-'));
  let server = startServer(port, output);
  let browser: any = null;
  const workerLogs: string[] = [];
  try {
    if (!(await waitForServer(port, output, 120_000))) throw new Error(`the dev server never became reachable on port ${port}`);

    browser = await launchExtensionBrowser({ extensionDir: output, headless: true, viewport: { width: 1280, height: 960 }, locale: 'ja-JP' });
    // Console only: a worker's uncaught exceptions are not delivered to
    // Playwright (`pageerror` never fires on a Worker — measured 2026-08-02), so
    // the ReferenceError itself is invisible here and only its consequence —
    // never reaching the reload below — can be measured.
    const watchWorker = (worker: any) => worker.on('console', (message: any) => workerLogs.push(`${message.type()}: ${message.text()}`));
    watchWorker(browser.serviceWorker);
    browser.context.on('serviceworker', watchWorker);
    await openFeed(browser.context);

    check((await waitForClients(port, 1, 30_000)) === 1, 'baseline: the service worker holds an HMR socket while the server it booted against is up');

    // --- restart the dev server for real ------------------------------------
    await stopServer(server);
    check((await waitForClients(port, 1, 3000)) !== 1, 'the socket is gone while the server is down');
    server = startServer(port, output);
    if (!(await waitForServer(port, output, 120_000))) throw new Error('the restarted dev server never became reachable');

    // The worker notices the server is back by polling it, so give the poll a
    // few rounds. Nothing here touches the extension.
    await wait(15_000);

    check(
      workerLogs.some((line) => line.includes('[vite] server connection lost')),
      `the worker saw the restart at all — without this the checks below prove nothing (${JSON.stringify(workerLogs)})`,
    );
    check(
      workerLogs.some((line) => line.includes('[crx] runtime reload')),
      "the worker reached CRXJS's own recovery call instead of dying before it",
    );
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stopServer(server);
    fs.rmSync(output, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(`\nFAIL e2e-extension-hmr-reconnect: ${failures.length} check(s) failed — a restarted dev server leaves the extension off HMR (#726)`);
    console.error(workerLogs.map((line) => `  [sw] ${line}`).join('\n'));
    process.exit(1);
  }
  console.log('\nPASS e2e-extension-hmr-reconnect: a restarted dev server drives the worker into its own reload instead of an unsubstituted placeholder');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
