'use strict';

// Harness for the renderer's own origin (#7), against real Electron.
//
//   node scripts/test-app-renderer-origin.cts
//
// The move from file:// to app://bundle is only worth anything if Chromium
// actually treats the new scheme the way the design assumed, and every one of
// those assumptions fails SILENTLY in a different direction:
//
//   - a module script is MIME-checked; get it wrong and the renderer is a blank
//     window with one console line
//   - the CSP now rides on a response header. A header that never arrives leaves
//     the page with NO policy at all — strictly worse than the <meta> it replaced,
//     and nothing on screen says so
//   - frame-ancestors is the one directive this whole move exists to enable, so
//     it is measured by framing the renderer rather than by reading the string
//   - asset:// must stay unreachable from the renderer (ADR 0012). Before, that
//     held because a file:// page could not fetch it; now it has to hold because
//     the origins differ and asset:// has no corsEnabled
//
// It also re-measures the #640 tree identity, which this Issue had to re-found:
// the CDP page URL is the same string in every tree now, so the sandbox guard
// compares the pid LISTENING on the port instead. That property is an OS fact,
// not a code path, so it is asserted here against a real spawned Electron.
//
// Doesn't take over the screen: HOLOGRAM_SMOKE=1 creates every window hidden.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');
const { makePng } = require('./lib-sandbox-real-seed.cts');
const { listeningPid } = require('./lib-sandbox-instance.cts');

const PNG = 'dummy-origin-0001.png';

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });

const { sleep, waitFor, evalSource } = require('./lib-wait.cts');

function cdpList(port: number): Promise<any[]> {
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}/json/list`, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

async function cdpConnect(wsUrl: string) {
  const ws = new WebSocket(wsUrl);
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
  const send = (method: string, params?: any) =>
    new Promise<any>((res, rej) => {
      const mid = ++id;
      pending.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  return { ws, send };
}

// Runs inside the renderer. Everything after the probes is a hold: the harness
// needs the app alive while it drives CDP past the navigation guard.
const evalJs = evalSource(
  async ({ sleep, neverHappens }, args) => {
    const out: Record<string, any> = {};
    // The standalone image window, opened FIRST so the CDP pass has something of
    // ours to drive that is not this document: navigating the renderer out from
    // under this script would take its JS context (and this result) with it.
    out.viewerOpened = (await (window as any).hologram.openImageWindow(args.png)) === true;
    out.href = location.href;
    out.origin = location.origin;

    // The policy that is actually on the wire (not the constant in main).
    const doc = await fetch(location.pathname);
    out.csp = doc.headers.get('content-security-policy') || '';
    out.nosniff = doc.headers.get('x-content-type-options') || '';

    // The renderer's own module script, as the page itself names it.
    const mod = document.querySelector<HTMLScriptElement>('script[type="module"]');
    out.moduleLoaded = !!((window as any).hologram && document.body.children.length > 0);
    out.moduleType = mod ? (await fetch(mod.src)).headers.get('content-type') : 'no module script';
    out.styled = document.styleSheets.length > 0;

    // Escapes and unknown types. A status is the answer either way — what must not
    // happen is bytes from OUTSIDE out/renderer coming back.
    const codes: Record<string, string> = {};
    for (const u of ['app://bundle/%2e%2e/%2e%2e/package.json', 'app://bundle/../package.json', 'app://bundle/nope.html', 'app://bundle/hologram.db']) {
      try {
        const r = await fetch(u);
        codes[u] = r.status + (r.status === 200 ? ' ' + (await r.text()).slice(0, 40) : '');
      } catch {
        codes[u] = 'threw';
      }
    }
    out.codes = codes;

    // ADR 0012: library bytes stay behind IPC.
    try {
      const a = await fetch(`asset://img/${args.png}`);
      out.assetFetch = 'READ status ' + a.status;
    } catch {
      out.assetFetch = 'blocked';
    }
    // ...while the picture still LOADS as a subresource, which is the whole point
    // of asset:// and would be an easy thing to break with a stricter img-src.
    out.assetImg = await new Promise((r) => {
      const i = new Image();
      i.onload = () => r(i.naturalWidth > 0);
      i.onerror = () => r(false);
      i.src = `asset://img/${args.png}`;
    });

    // The navigation guard, from inside the page.
    const before = location.href;
    try {
      location.href = 'app://bundle/other.html';
    } catch {}
    // The assertion is that this navigation NEVER commits, so the window IS the
    // check — neverHappens spends all of it on purpose and names the case if it
    // ever does. (A commit would also reject the eval from main — see #917.)
    out.navBlocked = await neverHappens('a navigation to app://bundle/other.html', () => location.href !== before, 800);

    // frame-ancestors 'none' — measured, because <meta> would have ignored it.
    const f = document.createElement('iframe');
    f.src = location.href;
    document.body.appendChild(f);
    // The assertion is that this frame NEVER gets a document of ours, so the window
    // IS the check — a frame that loaded late would otherwise read as blocked.
    // A cross-origin (opaque) frame throws on access, which is also "not ours".
    const framed = await neverHappens(
      'the renderer to appear inside its own iframe',
      () => {
        try {
          return !!(f.contentDocument && f.contentDocument.body && f.contentDocument.body.children.length);
        } catch {
          return false;
        }
      },
      1200,
    );
    out.iframe = framed ? 'blocked' : 'LOADED';
    f.remove();

    // Fixed and deliberate: the app has to stay alive while the harness drives CDP
    // past the navigation guard. The harness ends the run, not this eval.
    // biome-ignore lint/plugin: a hold, sized to outlast the harness's CDP pass
    await sleep(9000);
    return out;
  },
  { png: PNG },
);

async function main() {
  const cdpPort = await freePort();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-origin-'));
  const configDir = path.join(tmp, 'Hologram');
  const saveFolder = path.join(tmp, 'saves');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(saveFolder, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));
  fs.writeFileSync(path.join(saveFolder, PNG), makePng(64, 64, [0x3a, 0xa0, 0xdd]));

  const env = Object.assign({}, process.env, {
    APPDATA: tmp,
    HOLOGRAM_CONFIG_DIR: configDir,
    HOLOGRAM_SMOKE: '1',
    HOLOGRAM_SMOKE_EVAL: evalJs,
  });

  const child = spawn(resolveElectron(), ['.', `--remote-debugging-port=${cdpPort}`], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
  let out = '';
  child.stdout.on('data', (d) => {
    out += d.toString();
    process.stdout.write(d);
  });
  const exited = new Promise<void>((r) => child.on('close', () => r()));

  // --- CDP: the two things the page cannot ask itself.
  let portPid: number | null = null;
  let foreignHost = '';
  let cdpNote = '';
  try {
    let page: any = null;
    await waitFor(
      'the viewer window to appear as an asset:// target on the debugging port',
      async () => {
        try {
          // The image window, not the renderer — see the eval's first line.
          page = (await cdpList(cdpPort)).find((t) => t.type === 'page' && String(t.url).startsWith('asset://'));
        } catch {
          /* devtools endpoint not up yet */
        }
        return !!page;
      },
      { timeoutMs: 30_000, pollMs: 500 },
    );
    // #640's replacement identity, measured against the process we spawned.
    portPid = listeningPid(cdpPort);
    // A second host on the scheme would be a second origin nobody designed. The
    // navigation guard refuses it, so the debugger is used to get past the guard
    // and ask the handler directly — the same reason test-app-asset-csp.cts does.
    const { ws, send } = await cdpConnect(page.webSocketDebuggerUrl);
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: 'app://elsewhere/index.html' });
    // Fixed: what the next line measures is whether this host became a document
    // at all, so neither outcome is a post-condition that is sure to arrive.
    // biome-ignore lint/plugin: whether this host becomes a document is what is measured
    await sleep(2000);
    const r = await send('Runtime.evaluate', { expression: '[location.href, document.body ? document.body.innerText.slice(0, 40) : ""].join(" | ")', returnByValue: true });
    foreignHost = String(r?.result?.value || '');
    ws.close();
  } catch (e) {
    cdpNote = (e as Error).message;
  }

  await exited;
  fs.rmSync(tmp, { recursive: true, force: true });

  const m = out.match(/EVAL_RESULT (\{[\s\S]*\})/);
  let r: Record<string, any> = {};
  try {
    r = JSON.parse((m && m[1]) as string);
  } catch {
    /* leave empty — every assertion below then fails, which is the right answer */
  }

  let ok = true;
  const check = (label: string, cond: boolean) => {
    console.log((cond ? 'PASS' : 'FAIL') + '  ' + label);
    if (!cond) ok = false;
  };
  const codeOf = (u: string) => String((r.codes || {})[u] || '');

  console.log('\n--- レンダラを app:// で配る (#7) ---\n');
  check('レンダラが app://bundle/index.html から起動する', String(r.href || '').startsWith('app://bundle/index.html'));
  check('退行なし: 単独の画像ウィンドウが開く（asset:// の入口は据え置き）', r.viewerOpened === true);
  check('オリジンが app://bundle（file:// の opaque ではない）', r.origin === 'app://bundle');
  check('module script が JavaScript の型で配られ、実際に走っている', r.moduleType === 'text/javascript' && r.moduleLoaded === true);
  check('CSS が読めている（フォント・トークンごと同じスキームから）', r.styled === true);
  check('CSP が応答ヘッダで届いている', String(r.csp || '').includes("default-src 'self'"));
  check("CSP に frame-ancestors 'none' が入っている（<meta> では無視される1本）", String(r.csp || '').includes("frame-ancestors 'none'"));
  check('nosniff が付いている', r.nosniff === 'nosniff');
  check('自分自身を iframe に入れられない＝frame-ancestors が効いている', r.iframe === 'blocked');
  check('out/renderer の外は返らない（%2e%2e / .. とも）', !codeOf('app://bundle/%2e%2e/%2e%2e/package.json').startsWith('200') && !codeOf('app://bundle/../package.json').startsWith('200'));
  check('未知の拡張子は配らない（415）', codeOf('app://bundle/hologram.db').startsWith('415'));
  check('存在しないパスは 404', codeOf('app://bundle/nope.html').startsWith('404'));
  check(`bundle 以外の host は文書にならない（${foreignHost || cdpNote || '観測できず'}）`, /Not found/.test(foreignHost));
  check('レンダラ入口以外への遷移が拒まれる（app://bundle/other.html）', r.navBlocked === true);
  check('ADR 0012: レンダラから asset:// を fetch できない', r.assetFetch === 'blocked');
  check('退行なし: asset:// の画像は <img> で表示できる', r.assetImg === true);
  check(`#640: CDP ポートを listen しているのが起動した Electron 自身（listen=${portPid} / spawn=${child.pid}）`, portPid !== null && portPid === child.pid);

  console.log('\n' + (ok ? 'RENDERER_ORIGIN_TEST_PASS' : 'RENDERER_ORIGIN_TEST_FAIL'));
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
