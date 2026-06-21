// CDP verify harness for the running Corpus Electron app.
// Launch the app with the debug port first, e.g.:
//   Start-Process electron.exe -ArgumentList ".", "--remote-debugging-port=9223" -WorkingDirectory app
// then:
//   node scripts/cdp-verify.js eval "<js expr; may return a value or a Promise>"
//   node scripts/cdp-verify.js shot <out.jpg> [quality]
//
// shot takes a FULL-PAGE screenshot (no clip). NOTE: passing a `clip` to
// Page.captureScreenshot resizes the visual viewport and it STICKS (a known trap
// that left content rendered into the top-left until restart). So we never clip —
// crop the saved jpg afterward, e.g. with Python PIL:
//   python -c "from PIL import Image; Image.open('out.jpg').crop((x,y,x2,y2)).save('crop.jpg')"
//
// Port via $CDP_PORT (default 9223). Page target = the one loading index.html.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const WebSocket = require('ws');

const PORT = process.env.CDP_PORT || 9223;

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
  const f = path.join(os.tmpdir(), 'corpus-cdp-win.ps1');
  fs.writeFileSync(f, ps1, 'utf8');
  try { cp.execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', f], { stdio: 'ignore' }); } catch (e) { /* best-effort */ }
}

function getTarget() {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${PORT}/json/list`, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          const list = JSON.parse(body);
          const page = list.find((t) => t.type === 'page' && t.url.includes('index.html')) || list.find((t) => t.type === 'page');
          if (!page) return reject(new Error('no page target — is the app running with --remote-debugging-port?'));
          resolve(page.webSocketDebuggerUrl);
        } catch (e) { reject(e); }
      });
    }).on('error', (e) => reject(new Error(`cannot reach CDP on :${PORT} (${e.message})`)));
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
  const send = (method, params) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  return { ws, send };
}

async function main() {
  const [cmd, arg, arg2] = process.argv.slice(2);
  if (!cmd || !['eval', 'shot'].includes(cmd)) {
    console.error('usage: node scripts/cdp-verify.js eval "<expr>"   |   shot <out.jpg> [quality]');
    process.exit(1);
  }
  const { ws, send } = await connect();
  if (cmd === 'eval') {
    await send('Runtime.enable', {});
    const r = await send('Runtime.evaluate', {
      expression: `(async () => { return (${arg}); })()`,
      awaitPromise: true, returnByValue: true, timeout: 60000,
    });
    if (r.exceptionDetails) console.error('EXCEPTION:', JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails, null, 2));
    else console.log(typeof r.result.value === 'string' ? r.result.value : JSON.stringify(r.result.value, null, 2));
  } else {
    await send('Page.enable', {});
    await send('Runtime.enable', {});
    // A minimized window stops painting → blank/black frames (even fromSurface:false).
    // Detect it (Windows minimized → screenX == -32000), restore at the OS level, then
    // re-minimize afterward so the window is left exactly as found (the user keeps it
    // minimized to stay out of the way — don't pop it up for good).
    let wasMin = false;
    try { const r = await send('Runtime.evaluate', { expression: 'window.screenX <= -30000', returnByValue: true }); wasMin = !!(r && r.result && r.result.value); } catch (e) { /* ignore */ }
    if (wasMin) { osShowWindow(9); await new Promise((r) => setTimeout(r, 400)); }   // SW_RESTORE + repaint
    try { await send('Page.bringToFront', {}); } catch (e) { /* ignore */ }
    const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: arg2 ? Number(arg2) : 80, captureBeyondViewport: false, fromSurface: process.env.CDP_SURFACE === '1' });
    const out = arg || 'scripts/_shot.jpg';
    fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
    console.log('wrote', out, Buffer.from(r.data, 'base64').length, 'bytes');
    if (wasMin) osShowWindow(6);   // SW_MINIMIZE — leave the window as we found it
  }
  ws.close();
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
