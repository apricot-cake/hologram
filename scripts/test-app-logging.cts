'use strict';

// 使い捨てのElectronインスタンスを起動し、メインプロセスの起動診断と
// キャッチされないレンダラーのエラーの両方が、configディレクトリのログに
// 着地することを証明する。

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

const electronPath = resolveElectron();
const { evalSource } = require('./lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-logging-'));
const configDir = path.join(tmp, 'Hologram');
const logPath = path.join(configDir, 'logs', 'main.log');

// throwはインラインで発生させるのではなくスケジュールする: 検証対象は
// 「キャッチされない」レンダラーのエラーがログへ届くことで、インラインの
// throwだとevalのPromiseの連鎖自体に捕まってしまう。
const evalJs = evalSource(
  () =>
    new Promise((resolve) => {
      setTimeout(() => {
        throw new Error('renderer-log-smoke');
      }, 50);
      setTimeout(() => resolve('scheduled'), 200);
    }),
);

const env = {
  ...process.env,
  APPDATA: tmp,
  HOLOGRAM_CONFIG_DIR: configDir,
  HOLOGRAM_SMOKE: '1',
  HOLOGRAM_SMOKE_EVAL: evalJs,
};

const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: 'pipe' });
let output = '';
child.stdout.on('data', (chunk) => {
  output += chunk;
});
child.stderr.on('data', (chunk) => {
  output += chunk;
});

child.on('close', (code) => {
  try {
    const log = fs.readFileSync(logPath, 'utf8');
    if (code !== 0) throw new Error(`Electronが終了しました ${code}\n${output}`);
    if (!log.includes('Starting Hologram')) throw new Error(`mainの起動ログがありません\n${log}`);
    if (!log.includes('renderer-log-smoke')) throw new Error(`レンダラーのエラーログがありません\n${log}`);
    // #1004: このspawnは（迷ったスタートメニューのショートカット起動と
    // 同じく）--remote-debugging-portを持たないので、startup-debug-port.tsの
    // 開発専用警告がここに出るはず＝実際の、パッケージ化されていないインスタンス
    // でその検査が発火することの証拠。
    if (!log.includes('Launched without --remote-debugging-port')) throw new Error(`missing-markerの警告がありません（#1004）\n${log}`);
    console.log(`PASS app logging: ${logPath}`);
  } catch (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
