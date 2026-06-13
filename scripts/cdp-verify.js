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
const WebSocket = require('ws');

const PORT = process.env.CDP_PORT || 9223;

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
    const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: arg2 ? Number(arg2) : 80, captureBeyondViewport: false });
    const out = arg || 'scripts/_shot.jpg';
    fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
    console.log('wrote', out, Buffer.from(r.data, 'base64').length, 'bytes');
  }
  ws.close();
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
