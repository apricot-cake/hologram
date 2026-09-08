'use strict';

// `scripts/restart-app.ps1`が使う停止の取り決め（app/src/main/restart-signal.ts）を、
// 実際のElectronに対してエンドツーエンドで検証する: --hologram-quitを持つ
// 使い捨ての起動がシングルインスタンスロックを失い、そのargvが保持者へ届き、
// 保持者が自ら終了する。
//
// なぜSMOKEのハーネスに相乗りせず専用のハーネスが要るか: SMOKEはロックを丸ごと
// スキップする（index.tsの`SMOKE || app.requestSingleInstanceLock()`）ので、
// SMOKEハーネスのどれ1つとして、このファイルが試す分岐に一度も到達しない。
// Playwright層はconfigディレクトリごとに単一インスタンスしか動かさないので、
// そちらもロックを失うことは無い。このファイルができるまで、取り決め全体は
// 手による計測でしかカバーされていなかった＝その一方で、これが置き換えたもの
// （外部からプロセスを突き合わせる）は再起動が依存していたもの。
//
// 他の全てのハーネスと同じく隔離されている: 専用のconfigディレクトリなので、
// ここで取るロックは実アプリのものではない。加えてHOLOGRAM_SANDBOX=1により
// ホスト登録（実際のChromeをこの使い捨てconfigへ向け直してしまうHKCUへの
// 書き込み）は一度も走らず、HOLOGRAM_START_MINIMIZED=1により検証実行が画面を
// 占有しない。
//
//   node e2e/harness/cases/test-app-restart-signal.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '../../../app');
const { electronPath: resolveElectron } = require('../../../scripts/lib-electron-path.cts');
const { waitFor } = require('../../../scripts/lib-wait.cts');

const electronPath = resolveElectron();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-restart-signal-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const env = Object.assign({}, process.env, {
  APPDATA: tmp,
  HOLOGRAM_CONFIG_DIR: configDir,
  HOLOGRAM_SANDBOX: '1',
  HOLOGRAM_START_MINIMIZED: '1',
});
// これを実行した誰からもSMOKEフラグを継承しない: SMOKEはロックをスキップして
// しまい、それこそがこのファイルが試すために存在するものそのもの。継承すると
// 間違った理由で通ってしまう。
delete env.HOLOGRAM_SMOKE;
delete env.HOLOGRAM_SMOKE_EVAL;

// app/src/main/restart-signal.tsが所有し、app/src/main/restart-signal.test.tsが固定
// している。ここで繰り返すのは、このファイルがrestart-app.ps1とまさに同じやり方で
// プロセス境界を越えてアプリと話すため。
const EXIT_NO_INSTANCE = 0;
const EXIT_SIGNALLED = 3;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
  });
}

function cdpReady(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/json/version', timeout: 1000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

// quitフラグを持つ1回の起動。その終了コードで解決する: インスタンスが
// ロックを保持していた（そして今終了を告げられた）ならEXIT_SIGNALLED、
// どれも保持していなければEXIT_NO_INSTANCE。
function sendQuitSignal(): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(electronPath, ['.', '--hologram-quit'], { cwd: appDir, env, stdio: ['ignore', 'ignore', 'inherit'] });
    child.on('close', (code: number | null) => resolve(code ?? -1));
  });
}

(async () => {
  // 素の`let`ではなく可変フィールドにする: closeコールバックから書かれ、
  // waitForのポーリングから読まれるので、オブジェクトにしておけば両側が同じ
  // 値を読む。
  const holder: { exit: number | null } = { exit: null };
  let ok = false;

  try {
    const port = await freePort();

    // 1. まだ何も動いていないので、この起動はロックを勝ち取る＝それでも
    //    アプリになってはいけない。「止めるものが無い」と報告することがその仕事の全て。
    const beforeAnything = await sendQuitSignal();

    // 2. テスト対象のインスタンス。CDPが応答することが「立ち上がった」の事後
    //    条件で、scripts/sandbox-app.ctsが待つのと同じ信号。
    const child = spawn(electronPath, ['.', `--remote-debugging-port=${port}`], { cwd: appDir, env, stdio: ['ignore', 'ignore', 'inherit'] });
    child.on('close', (code: number | null) => {
      holder.exit = code ?? -1;
    });
    await waitFor(`the instance to answer CDP on :${port}`, () => cdpReady(port), { timeoutMs: 30_000 });

    // 3. 取り決めそのもの。
    const withHolder = await sendQuitSignal();
    await waitFor('the instance to quit after the signal', () => holder.exit !== null, { timeoutMs: 20_000 });

    // 4. ロックが再び空いている＝restart-app.ps1が代替を起動する前にポーリング
    //    するもので、早すぎる再起動を安全にするもの。
    const afterQuit = await sendQuitSignal();

    if (holder.exit === null) child.kill();

    const nothingRunning = beforeAnything === EXIT_NO_INSTANCE;
    const signalled = withHolder === EXIT_SIGNALLED;
    // killではなく0＝保持者は強制終了されたのではなく自前のbefore-quitの後片付け
    // を実行した。これこそが古いCloseMainWindow()呼び出しが保とうとしていた部分。
    const quitCleanly = holder.exit === 0;
    const lockReleased = afterQuit === EXIT_NO_INSTANCE;

    console.log(`nothingRunning=${nothingRunning} signalled=${signalled} quitCleanly=${quitCleanly}(${holder.exit}) lockReleased=${lockReleased}`);
    ok = nothingRunning && signalled && quitCleanly && lockReleased;
  } catch (err) {
    console.error(`restart-signalハーネス: ${(err as Error).message}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(ok ? 'RESTART_SIGNAL_TEST_PASS' : 'RESTART_SIGNAL_TEST_FAIL');
  process.exit(ok ? 0 : 1);
})();
