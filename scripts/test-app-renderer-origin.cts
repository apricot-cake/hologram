'use strict';

// レンダラー自身のオリジン（#7）を、実際の Electron に対して検証するハーネス。
//
//   node scripts/test-app-renderer-origin.cts
//
// file:// から app://bundle への移行は、Chromium が実際に設計の想定どおり
// この新しいスキームを扱ってこそ意味がある。その想定はどれも「静かに」、
// それぞれ違う方向へ失敗し得る:
//
//   - module script は MIME がチェックされる。間違えるとレンダラーはコンソール
//     に1行だけ出す空白のウィンドウになる
//   - CSP は今や応答ヘッダーに乗る。ヘッダーが一度も届かなければ、ページには
//     ポリシーが「一切無い」状態になる — 置き換えた <meta> よりも厳密に悪く、
//     しかも画面上には何もそれを示すものが無い
//   - frame-ancestors はこの移行全体が実現しようとしている唯一のディレクティブ
//     なので、文字列を読むのではなくレンダラーを実際にフレームに入れて計測する
//   - asset:// はレンダラーから到達不能なままでなければならない（ADR 0012）。
//     以前はそれが成り立っていたのは file:// のページがそれを fetch できな
//     かったから。今は、オリジンが異なり asset:// に corsEnabled が無いから
//     成り立たなければならない
//
// また、この Issue が新たに確立しなければならなかった #640 のツリー識別も
// 再計測する: CDP のページ URL は今やどのツリーでも同じ文字列になるので、
// サンドボックスの番人は代わりにそのポートを listen している pid を比較
// する。これは OS レベルの事実であってコードの経路ではないので、実際に
// spawn した Electron に対してここで検証する。
//
// 画面を占有しない: HOLOGRAM_SMOKE=1 はすべてのウィンドウを隠して作る。

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

// レンダラーの内側で実行される。プローブの後のすべては保持: ハーネスが
// ナビゲーションの番人を越えて CDP を駆動している間、アプリを生かしておく
// 必要がある。
const evalJs = evalSource(
  async ({ sleep, neverHappens }, args) => {
    const out: Record<string, any> = {};
    // 単独の画像ウィンドウ。「最初に」開くのは、CDP のパスがこの文書ではない、
    // 自分たちのものを何か駆動対象として持てるようにするため: このスクリプトの
    // 下でレンダラーを他へナビゲートすると、その JS コンテキスト（と、この
    // 結果）を道連れにしてしまう。
    out.viewerOpened = (await (window as any).hologram.openImageWindow(args.png)) === true;
    out.href = location.href;
    out.origin = location.origin;

    // 実際に通信路上にあるポリシー（main の中の定数ではなく）。
    const doc = await fetch(location.pathname);
    out.csp = doc.headers.get('content-security-policy') || '';
    out.nosniff = doc.headers.get('x-content-type-options') || '';

    // レンダラー自身の module script。ページ自身がそれを名指す通りに。
    const mod = document.querySelector<HTMLScriptElement>('script[type="module"]');
    out.moduleLoaded = !!((window as any).hologram && document.body.children.length > 0);
    out.moduleType = mod ? (await fetch(mod.src)).headers.get('content-type') : 'no module script';
    out.styled = document.styleSheets.length > 0;

    // 脱出と未知の型。どちらにしても答えはステータスコード — 起きてはならない
    // のは out/renderer の「外」のバイト列が返ってくること。
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

    // ADR 0012: ライブラリのバイト列は IPC の裏に留まる。
    try {
      const a = await fetch(`asset://img/${args.png}`);
      out.assetFetch = 'READ status ' + a.status;
    } catch {
      out.assetFetch = 'blocked';
    }
    // …一方で、画像は今もサブリソースとして「読み込まれる」。それが asset://
    // の存在意義そのものであり、より厳しい img-src では簡単に壊れ得る点。
    out.assetImg = await new Promise((r) => {
      const i = new Image();
      i.onload = () => r(i.naturalWidth > 0);
      i.onerror = () => r(false);
      i.src = `asset://img/${args.png}`;
    });

    // ナビゲーションの番人を、ページの内側から。
    const before = location.href;
    try {
      location.href = 'app://bundle/other.html';
    } catch {}
    // 主張は、この遷移が「決してコミットしない」こと。だからこの観測窓
    // 自体が検証であり、neverHappens はあえてそれを全部使い切り、もし
    // コミットしたらそのケースを名指しする（コミットしてしまうと main 側の
    // eval も拒否されるはず — #917 を参照）。
    out.navBlocked = await neverHappens('a navigation to app://bundle/other.html', () => location.href !== before, 800);

    // frame-ancestors 'none' — 計測する理由は、<meta> ならこれを無視して
    // いたはずだから。
    const f = document.createElement('iframe');
    f.src = location.href;
    document.body.appendChild(f);
    // 主張は、このフレームが「決して」自分たちの文書を得ないこと。だから
    // この観測窓自体が検証 — 遅れて読み込まれたフレームは、そうでなければ
    // 遮断されたと誤読される。クロスオリジン（opaque）なフレームはアクセス時に
    // 例外を投げるが、それも同じく「自分たちのものではない」。
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

    // 固定時間、意図的なもの: ハーネスがナビゲーションの番人を越えて CDP を
    // 駆動している間、アプリは生きていなければならない。この eval ではなく
    // ハーネスの方が実行を終わらせる。
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

  // --- CDP: ページ自身には自分に問えない2つのこと。
  let portPid: number | null = null;
  let foreignHost = '';
  let cdpNote = '';
  try {
    let page: any = null;
    await waitFor(
      'ビューアウィンドウがデバッグポート上に asset:// の対象として現れること',
      async () => {
        try {
          // 画像ウィンドウの方。レンダラーではない — eval の最初の行を参照。
          page = (await cdpList(cdpPort)).find((t) => t.type === 'page' && String(t.url).startsWith('asset://'));
        } catch {
          /* devtools のエンドポイントがまだ上がっていない */
        }
        return !!page;
      },
      { timeoutMs: 30_000, pollMs: 500 },
    );
    // #640 が置き換えた識別を、実際に spawn したプロセスに対して計測する。
    portPid = listeningPid(cdpPort);
    // このスキーム上の2つ目のホストは、誰も設計していない2つ目のオリジンに
    // なってしまう。ナビゲーションの番人がそれを拒むので、デバッガでその
    // 番人を越え、ハンドラに直接問い合わせる — test-app-asset-csp.cts が
    // やっているのと同じ理由。
    const { ws, send } = await cdpConnect(page.webSocketDebuggerUrl);
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: 'app://elsewhere/index.html' });
    // 固定時間: 次の行が計測するのは「このホストがそもそも文書になったか」
    // 自体なので、どちらの結果も必ず来ると保証された事後条件ではない。
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
    /* 空のまま残す — 下の主張がすべて失敗する。これが正しい答え */
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
