// 稼働中のHologram Electronアプリインスタンス向けのCDP検証ハーネス。
// アプリは既にCDPのデバッグポートを開いて動作していなければならない。「どの」
// インスタンスをこれの対象にするか（実機／HMR開発サーバー／サンドボックス／
// テストハーネス）と、それぞれのポートがどう決まるかはdocs/開発ガイド.md
// （「CDP で繋ぐ先の選び方」、#1010）にある＝それが決まる唯一の場所であり、
// 対象を選ぶ前にそちらを読むこと。このヘッダーが扱うのは、対象が既に動いている
// ときにこのハーネスをどう操作するかだけ:
//   node scripts/cdp-verify.cts eval "<js式。値かPromiseを返してよい>"
//   node scripts/cdp-verify.cts shot [out.jpg] [quality]
//   出力先を省略すると %LOCALAPPDATA%\\Hologram\\verification に保存する。
//   実ライブラリを表示した画像を誤って公開しないため、リポジトリ内は指定できない。
//
// shot は背面のまま撮影する。失敗時も表示状態やフォーカスを変えず、エラーを返す。
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
const path = require('node:path');
const WebSocket = require('ws');
const { assertMainWorkingTree, foreignSandboxAt, instanceFile, isSandboxPort, readInstance } = require('./lib-sandbox-instance.cts');
const { resolveVerificationOutput } = require('./lib-verification-output.cts');

const repoRoot = path.join(__dirname, '..');
assertMainWorkingTree(repoRoot);

function resolvePort(): number {
  const raw = process.env.CDP_PORT;
  if (!raw) return 9222;
  if (raw === 'sandbox') {
    const inst = readInstance(repoRoot);
    if (!inst) {
      console.error(`ERR 記録されたサンドボックスインスタンスがありません（${instanceFile(repoRoot)}）＝起動してください: node scripts/sandbox-app.cts`);
      process.exit(1);
    }
    if (!isSandboxPort(inst.port)) throw new Error('旧ポートの検証用アプリを停止し、sandbox-app.cts で起動し直してください。');
    return inst.port;
  }
  const port = Number(raw);
  if (port !== 9222 && !isSandboxPort(port)) throw new Error('CDP_PORT は 9222、9333、sandbox のいずれかを指定してください。');
  return port;
}

const PORT = resolvePort();

// 固定ポートでも古い記録や別プロセスへの誤接続を防ぐため、操作前に PID を照合する。
function assertOwnSandbox() {
  if (!isSandboxPort(PORT)) return;
  const inst = readInstance(repoRoot);
  if (!inst) throw new Error(`:${PORT} はサンドボックスのポートですが、インスタンスの記録がありません（${instanceFile(repoRoot)}）。'node scripts/sandbox-app.cts' で起動してください。`);
  if (inst.port !== PORT) throw new Error(`検証用アプリは :${inst.port} にあり、:${PORT} ではありません＝CDP_PORT=${inst.port}（または CDP_PORT=sandbox）を使ってください。`);
  const foreign = foreignSandboxAt(PORT, repoRoot);
  if (foreign !== null) throw new Error(`:${PORT} は記録したpid ${inst.pid} ではなくpid ${foreign} が保持しています。記録が古くなっています。ポートの使用状況を確認してから起動し直してください。`);
  // foreign === null は「判定できない」ことも意味しうる（まだ誰も待ち受けて
  // いないか、pid照合の無いプラットフォーム＝lib-sandbox-instance.cts）。ここに
  // 来たということはポートが /json/list に応答しているので、前者は既に除外
  // されている。後者の場合、上で確認した記録がすべて。
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
    const out = resolveVerificationOutput(arg, `cdp-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`);
    const quality = arg2 ? Number(arg2) : 80;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let data: string;
    try {
      const result = await Promise.race([
        send('Page.captureScreenshot', { format: 'jpeg', quality, captureBeyondViewport: false, fromSurface: true }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('背面での撮影がタイムアウトしました。')), 1500);
        }),
      ]);
      data = result.data;
      if (!data || Buffer.from(data, 'base64').length < 6000) throw new Error('背面での撮影結果が空白のため、保存しませんでした。');
    } finally {
      clearTimeout(timer);
      ws.close();
    }
    const buf = Buffer.from(data as string, 'base64');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, buf);
    console.log('書き出し完了', out, buf.length, 'bytes');
  }
  ws.close();
}
main().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
