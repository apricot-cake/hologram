// 稼働中のHologram Electronアプリインスタンス向けのCDP検証ハーネス。
// アプリは既にCDPのデバッグポートを開いて動作していなければならない。「どの」
// インスタンスをこれの対象にするか（実機／HMR開発サーバー／サンドボックス／
// テストハーネス）と、それぞれのポートがどう決まるかはdocs/build.md
// （「CDP で繋ぐ先の選び方」、#1010）にある＝それが決まる唯一の場所であり、
// 対象を選ぶ前にそちらを読むこと。このヘッダーが扱うのは、対象が既に動いている
// ときにこのハーネスをどう操作するかだけ:
//   node scripts/cdp-verify.cts eval "<js式。値かPromiseを返してよい>"
//   node scripts/cdp-verify.cts shot <out.jpg> [quality]
//
// shotは既定でフォーカスを奪わずに撮影する（fromSurfaceはコンポジタの画面を
// 直接読むので、背面のウィンドウでも問題なく撮れる＝bringToFrontは無い）。
// フレームが空白のとき（最小化＝描画されていない）だけウィンドウを前面へ
// 押し出す。CDP_FOCUS=1はその割り込む経路を強制する。
// shotはフルページのスクリーンショットを撮る（clipなし）。注意:
// Page.captureScreenshotに`clip`を渡すとビジュアルビューポートがリサイズされ、
// それが「そのまま固定される」（既知の罠で、再起動するまで内容が左上に描画され
// たままになる）。だからclipは絶対に使わない＝保存したjpgを後から手元の画像
// ツールで切り出す。
//
// ポートは$CDP_PORT経由（既定 9222＝実アプリ）。CDP_PORT=sandboxは
// .sandbox/instance.jsonから「この」treeのサンドボックスインスタンスを解決する
// ので、誰もポート番号をコピーして回る必要が無い。ページの対象＝index.htmlを
// 読み込んでいるもの。
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
      console.error(`ERR このtree用に記録されたサンドボックスインスタンスがありません（${instanceFile(repoRoot)}）＝起動してください: node scripts/sandbox-app.cts`);
      process.exit(1);
    }
    return inst.port;
  }
  return Number(raw);
}

const PORT = resolvePort();

// サンドボックスのポートはちょうど1つのtreeに属する。#640の失敗モードの全ては、
// 間違ったtreeのインスタンスと話すことが「成功してしまう」ことにある: evalは
// 値を返し、スクリーンショットは書き出され、その答えは誰か他の人のアプリに
// ついてのものになる。そのため、コマンドを1つでも送る前に身元を確認する:
// ポートを保持しているプロセスは、このtreeが自身のインスタンスを起動したときに
// 記録したpidでなければならない。:9222の実アプリはこの検査の対象外＝これは
// mainのtreeから起動する設計だから（docs/build.md）。
function assertOwnSandbox() {
  if (!isSandboxPort(PORT)) return;
  const inst = readInstance(repoRoot);
  if (!inst) throw new Error(`:${PORT} はサンドボックスのポートですが、このtreeにはインスタンスの記録がありません（${instanceFile(repoRoot)}）。'node scripts/sandbox-app.cts' で起動するか、:${PORT} を所有するtreeからcdp-verifyを実行してください。`);
  if (inst.port !== PORT) throw new Error(`このtreeのサンドボックスは :${inst.port} にあり、:${PORT} ではありません＝CDP_PORT=${inst.port}（または CDP_PORT=sandbox）を使ってください。`);
  const foreign = foreignSandboxAt(PORT, repoRoot);
  if (foreign !== null) throw new Error(`:${PORT} は記録したpid ${inst.pid} ではなくpid ${foreign} が保持しています＝別のtreeのサンドボックスがそこにあり、このtreeの記録は古くなっています。それは自分自身のtreeから操作してください。ここで 'node scripts/sandbox-app.cts' を実行すれば新しいポートを取ります。`);
  // foreign === null は「判定できない」ことも意味しうる（まだ誰も待ち受けて
  // いないか、pid照合の無いプラットフォーム＝lib-sandbox-instance.cts）。ここに
  // 来たということはポートが /json/list に応答しているので、前者は既に除外
  // されている。後者の場合、上で確認した記録がすべて。
}

// ElectronウィンドウのOSレベルの窓制御。このElectronビルドのCDPにはBrowser.*
// ドメインが無い（Browser.getWindowForTarget -> -32601）ので、最小化された
// ウィンドウ（描画が止まる→fromSurface:falseでも空白/黒の撮影になる）はCDP経由
// では復元できない。代わりにuser32へシェルアウトする。cmd: 9=SW_RESTORE、
// 6=SW_MINIMIZE。
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
    /* できる範囲で */
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
            if (!page) return reject(new Error('ページの対象がありません＝アプリは --remote-debugging-port 付きで動作していますか？'));
            assertOwnSandbox();
            resolve(page.webSocketDebuggerUrl);
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', (e) => reject(new Error(`:${PORT} のCDPに到達できません（${e.message}）`)));
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
    console.error('使い方: node scripts/cdp-verify.cts eval "<expr>"   |   shot <out.jpg> [quality]');
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
    if (r.exceptionDetails) console.error('例外:', JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails, null, 2));
    else console.log(typeof r.result.value === 'string' ? r.result.value : JSON.stringify(r.result.value, null, 2));
  } else {
    await send('Page.enable', {});
    await send('Runtime.enable', {});
    const out = arg || 'scripts/_shot.jpg';
    const quality = arg2 ? Number(arg2) : 80;
    // 背面優先（2026-07-05）: fromSurfaceはコンポジタの画面を直接読むので、他の
    // ウィンドウの「背後」にあるウィンドウでもフォーカスを奪わずに撮影できる。
    // 既定ではbringToFrontしない＝それはウィンドウを前へ引っ張り出し、撮影の
    // たびにアクティブウィンドウを奪ってしまう。
    // ⚠️ 重大: fromSurfaceは、完全に遮蔽された／スロットルされたウィンドウでは
    // 「永遠にハング」する（決して来ないコンポジタのフレームを待ち続ける）＝
    // ハングした撮影がGPUを詰まらせ、一度アプリをクラッシュさせたことがある。
    // だからサーフェス撮影はタイムアウトと競争させる。タイムアウトまたは空白の
    // 場合は割り込む経路にフォールバックする: OSでの復元（最小化されていれば）
    // + bringToFront（描画を強制する）+ ハングし得ない素の非サーフェス撮影、
    // その後見つけたときの状態へ戻すため再び最小化する。CDP_FOCUS=1はこの
    // フォールバックへ直行する。
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
        data = null; // タイムアウト（遮蔽/スロットル）またはエラー→フォールバック
      }
    }
    if (blank(data)) {
      let wasMin = false;
      try {
        const r = await send('Runtime.evaluate', { expression: 'window.screenX <= -30000', returnByValue: true });
        wasMin = !!(r && r.result && r.result.value);
      } catch (_e) {
        /* 無視 */
      }
      if (wasMin) {
        osShowWindow(9); // SW_RESTORE
        // ウィンドウが最小化ウィンドウの居る画面外の位置から離れることが事後
        // 条件で、これは`wasMin`を決めたのと同じ読み取り。タイムアウトは飲み
        // 込む: bringToFrontと下の撮影はそれでも走り、そこでの空白の結果が
        // 正直な報告になる。
        await waitFor(
          'the restored window to leave its minimized position',
          async () => {
            const r = await send('Runtime.evaluate', { expression: 'window.screenX > -30000', returnByValue: true });
            return !!(r && r.result && r.result.value);
          },
          { timeoutMs: 3000, pollMs: 50 },
        ).catch(() => {});
        // ……そして復元位置での描画フレーム1つぶん。これが、以前ここにあった
        // 固定400msがカバーしていたもう半分。
        await send('Runtime.evaluate', { expression: 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))', awaitPromise: true }).catch(() => {});
      }
      try {
        await send('Page.bringToFront', {});
      } catch (_e) {
        /* 無視 */
      }
      // ウィンドウは今描画されている→素の（非サーフェス）撮影は安全でハングしない。
      data = (await send('Page.captureScreenshot', { format: 'jpeg', quality, captureBeyondViewport: false, fromSurface: false })).data;
      if (wasMin) osShowWindow(6); // SW_MINIMIZE — 見つけたときの状態のままにしておく
    }
    const buf = Buffer.from(data as string, 'base64');
    fs.writeFileSync(out, buf);
    console.log('書き出し完了', out, buf.length, 'bytes');
  }
  ws.close();
}
main().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
