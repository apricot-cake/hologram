// CDP verify harness for the running Hologram Electron app.
// The app must already be running with a CDP debug port. Two ways to get one:
//   - the real instance: Start-ScheduledTask -TaskName 'HologramLaunch' — its action
//     carries --remote-debugging-port=9222 (see docs/build.md). Use this when the
//     check involves capture or native-host registration.
//   - HMR: REMOTE_DEBUGGING_PORT=9222 npm run dev --workspace=app — electron-vite
//     forwards that env var to Electron, so this harness connects the same way (#1003).
// The old warning here ("never direct-launch, the MSIX container virtualizes HKCU/FS")
// expired on 2026-08-06: Claude Code now runs outside the package and all four paths
// (FS/HKCU read and write) were measured as real. What the task still buys is a fixed
// debug port and a single launch path — see docs/build.md. Then:
//   node scripts/cdp-verify.cts eval "<js expr; may return a value or a Promise>"
//   node scripts/cdp-verify.cts shot <out.jpg> [quality]
//
// shot captures WITHOUT stealing focus by default (fromSurface reads the
// compositor surface, so a backgrounded window shoots fine — no bringToFront).
// It only pops the window forward if the frame is blank (minimized = not
// painting); CDP_FOCUS=1 forces that intrusive path.
// shot takes a FULL-PAGE screenshot (no clip). NOTE: passing a `clip` to
// Page.captureScreenshot resizes the visual viewport and it STICKS (a known trap
// that left content rendered into the top-left until restart). So we never clip —
// crop the saved jpg afterward with whatever image tool is at hand.
//
// Port via $CDP_PORT (default 9222 = the real app). CDP_PORT=sandbox resolves
// THIS tree's sandbox instance from .sandbox/instance.json, so nobody has to
// copy a port number around. Page target = the one loading index.html.
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const WebSocket = require('ws');
const { foreignSandboxAt, instanceFile, isSandboxPort, readInstance } = require('./lib-sandbox-instance.cts');
const { waitFor } = require('./lib-wait.cts');

const repoRoot = path.join(__dirname, '..');

function resolvePort(): number {
  const raw = process.env.CDP_PORT;
  if (!raw) return 9222;
  if (raw === 'sandbox') {
    const inst = readInstance(repoRoot);
    if (!inst) {
      console.error(`ERR no sandbox instance recorded for this tree (${instanceFile(repoRoot)}) — start one: node scripts/sandbox-app.cts`);
      process.exit(1);
    }
    return inst.port;
  }
  return Number(raw);
}

const PORT = resolvePort();

// A sandbox port belongs to exactly ONE tree, and the whole failure mode of #640
// is that talking to the wrong tree's instance SUCCEEDS: the eval returns, the
// screenshot is written, and the answer is about someone else's app. So the
// identity is checked before a single command goes out: the process holding the
// port has to be the pid this tree recorded when it started its instance. The
// real app on :9222 is outside this check — it is launched from the main tree by
// design (docs/build.md).
function assertOwnSandbox() {
  if (!isSandboxPort(PORT)) return;
  const inst = readInstance(repoRoot);
  if (!inst) throw new Error(`:${PORT} is a sandbox port, but this tree records no instance (${instanceFile(repoRoot)}). Start one with 'node scripts/sandbox-app.cts', or run cdp-verify from the tree that owns :${PORT}.`);
  if (inst.port !== PORT) throw new Error(`this tree's sandbox is on :${inst.port}, not :${PORT} — use CDP_PORT=${inst.port} (or CDP_PORT=sandbox).`);
  const foreign = foreignSandboxAt(PORT, repoRoot);
  if (foreign !== null) throw new Error(`:${PORT} is held by pid ${foreign}, not this tree's recorded pid ${inst.pid} — ANOTHER tree's sandbox is on it and this tree's record is stale. Drive it from its own tree; 'node scripts/sandbox-app.cts' here will take a fresh port.`);
  // foreign === null can also mean "cannot tell" (nothing listening yet, or a
  // platform without the pid lookup — lib-sandbox-instance.cts). The port did
  // answer /json/list to get here, so the first case is already excluded; on the
  // second, the record checked above is all there is.
}

// OS-level window control for the Electron window. This Electron build's CDP has
// NO Browser.* domain (Browser.getWindowForTarget -> -32601), so a minimized window
// (which stops painting -> blank/black capture even with fromSurface:false) can't be
// restored over CDP. Shell out to user32 instead. cmd: 9=SW_RESTORE, 6=SW_MINIMIZE.
function osShowWindow(cmd) {
  const ps1 = `Add-Type @"
using System;using System.Runtime.InteropServices;
public class W{[DllImport("user32.dll")]public static extern bool ShowWindowAsync(IntPtr h,int n);[DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);}
"@
$p=Get-Process electron -ErrorAction SilentlyContinue|Where-Object{$_.MainWindowHandle -ne 0}|Select-Object -First 1
if($p){[void][W]::ShowWindowAsync($p.MainWindowHandle, ${cmd}); if(${cmd} -eq 9){[void][W]::SetForegroundWindow($p.MainWindowHandle)}}
`;
  const f = path.join(os.tmpdir(), 'hologram-cdp-win.ps1');
  fs.writeFileSync(f, ps1, 'utf8');
  try {
    cp.execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', f], { stdio: 'ignore' });
  } catch (_e) {
    /* best-effort */
  }
}

function getTarget() {
  return new Promise((resolve, reject) => {
    http
      .get(`http://localhost:${PORT}/json/list`, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            const list = JSON.parse(body);
            const page = list.find((t) => t.type === 'page' && t.url.includes('index.html')) || list.find((t) => t.type === 'page');
            if (!page) return reject(new Error('no page target — is the app running with --remote-debugging-port?'));
            assertOwnSandbox();
            resolve(page.webSocketDebuggerUrl);
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', (e) => reject(new Error(`cannot reach CDP on :${PORT} (${e.message})`)));
  });
}

async function connect() {
  const ws = new WebSocket(await getTarget(), { maxPayload: 256 * 1024 * 1024 });
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
  const send = (method, params) =>
    new Promise<any>((res, rej) => {
      const mid = ++id;
      pending.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  return { ws, send };
}

async function main() {
  const [cmd, arg, arg2] = process.argv.slice(2);
  if (!cmd || !['eval', 'shot'].includes(cmd)) {
    console.error('usage: node scripts/cdp-verify.cts eval "<expr>"   |   shot <out.jpg> [quality]');
    process.exit(1);
  }
  const { ws, send } = await connect();
  if (cmd === 'eval') {
    await send('Runtime.enable', {});
    const r = await send('Runtime.evaluate', {
      expression: `(async () => { return (${arg}); })()`,
      awaitPromise: true,
      returnByValue: true,
      timeout: 60000,
    });
    if (r.exceptionDetails) console.error('EXCEPTION:', JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails, null, 2));
    else console.log(typeof r.result.value === 'string' ? r.result.value : JSON.stringify(r.result.value, null, 2));
  } else {
    await send('Page.enable', {});
    await send('Runtime.enable', {});
    const out = arg || 'scripts/_shot.jpg';
    const quality = arg2 ? Number(arg2) : 80;
    // Background-first (2026-07-05): fromSurface reads the compositor surface
    // directly, so a window sitting BEHIND other windows captures WITHOUT stealing
    // focus. We do NOT bringToFront by default — it yanks the window forward and
    // steals the active window every shot.
    // ⚠️ CRITICAL: fromSurface HANGS FOREVER on a fully-occluded / throttled window
    // (it waits for a compositor frame that never arrives) — a hung capture wedged
    // the GPU and crashed the app once. So the surface capture is RACED against a
    // timeout; on timeout/blank we fall back to the intrusive path: OS-restore (if
    // minimized) + bringToFront (forces a paint) + a plain non-surface capture that
    // can't hang, then re-minimize to leave the window as found. CDP_FOCUS=1 skips
    // straight to the fallback.
    const capSurface = () => send('Page.captureScreenshot', { format: 'jpeg', quality, captureBeyondViewport: false, fromSurface: true });
    const withTimeout = (p, ms) => {
      let t: any;
      return Promise.race([
        p.finally(() => clearTimeout(t)),
        new Promise((_, rej) => {
          t = setTimeout(() => rej(new Error('cap-timeout')), ms);
        }),
      ]);
    };
    const blank = (d) => !d || Buffer.from(d, 'base64').length < 6000;
    let data: string | null = null;
    if (process.env.CDP_FOCUS !== '1') {
      try {
        data = (await withTimeout(capSurface(), 1500)).data;
      } catch (_e) {
        data = null; // timed out (occluded/throttled) or errored → fall back
      }
    }
    if (blank(data)) {
      let wasMin = false;
      try {
        const r = await send('Runtime.evaluate', { expression: 'window.screenX <= -30000', returnByValue: true });
        wasMin = !!(r && r.result && r.result.value);
      } catch (_e) {
        /* ignore */
      }
      if (wasMin) {
        osShowWindow(9); // SW_RESTORE
        // The window leaving the off-screen position a minimized window sits at
        // is the post-condition, and it is the same reading that decided `wasMin`.
        // A timeout is swallowed: bringToFront and the capture below still run,
        // and a blank result there is the honest report.
        await waitFor(
          'the restored window to leave its minimized position',
          async () => {
            const r = await send('Runtime.evaluate', { expression: 'window.screenX > -30000', returnByValue: true });
            return !!(r && r.result && r.result.value);
          },
          { timeoutMs: 3000, pollMs: 50 },
        ).catch(() => {});
        // …and one painted frame at the restored position, which is the other
        // half of what the fixed 400ms here used to cover.
        await send('Runtime.evaluate', { expression: 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))', awaitPromise: true }).catch(() => {});
      }
      try {
        await send('Page.bringToFront', {});
      } catch (_e) {
        /* ignore */
      }
      // Window is painting now → a plain (non-surface) capture is safe and won't hang.
      data = (await send('Page.captureScreenshot', { format: 'jpeg', quality, captureBeyondViewport: false, fromSurface: false })).data;
      if (wasMin) osShowWindow(6); // SW_MINIMIZE — leave the window as we found it
    }
    const buf = Buffer.from(data as string, 'base64');
    fs.writeFileSync(out, buf);
    console.log('wrote', out, buf.length, 'bytes');
  }
  ws.close();
}
main().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
