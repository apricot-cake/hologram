const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { waitFor } = require('./lib-wait.cts');

const root = path.resolve(__dirname, '..');

function personalEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('HOLOGRAM_') || key === 'ELECTRON_RUN_AS_NODE' || key === 'ELECTRON_RENDERER_URL' || key === 'ELECTRON_ENTRY' || key === 'NODE_OPTIONS') delete env[key];
  }
  return env;
}

function developmentRuntime() {
  return { exe: require('./lib-electron-path.cts').electronPath(), app: path.join(root, 'app') };
}

function startRuntime(runtime, args) {
  const child = spawn(runtime.exe, [runtime.app, ...args], { env: personalEnv(), detached: true, windowsHide: true, stdio: 'ignore' });
  child.unref();
  return child;
}

async function isDevelopmentAppRunning() {
  try {
    return (await fetch('http://127.0.0.1:9222/json/version', { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    return false;
  }
}

async function launch({ background = false } = {}) {
  const runtime = developmentRuntime();
  if (!fs.existsSync(runtime.exe) || !fs.existsSync(path.join(runtime.app, 'out/main/index.js'))) throw new Error('起動に必要なファイルがありません');
  // 既に起動中ならもう一つ作らず、single-instance の保持者へ表示要求だけを送る。
  // Command Palette の起動は「新しいウィンドウ」ではなく「既存のアプリを開く」操作として扱う。
  if (await isDevelopmentAppRunning()) {
    if (!background) startRuntime(runtime, ['--hologram-activate-existing']);
    return;
  }
  const child = startRuntime(runtime, ['--remote-debugging-port=9222', ...(background ? ['--hologram-background'] : [])]);
  let failure: Error | undefined;
  child.on('error', (error) => {
    failure = error;
  });
  await waitFor(
    'アプリの起動',
    async () => {
      if (failure) throw failure;
      return isDevelopmentAppRunning();
    },
    { timeoutMs: 30_000, pollMs: 250 },
  );
}

async function verify() {
  await launch({ background: true });
  console.log('普段のライブラリを使う開発版です。CDP: http://127.0.0.1:9222');
}

async function main(action: string) {
  if (process.platform !== 'win32') throw new Error('この私用ランチャーはWindows用です');
  if (action === 'launch') await launch();
  else if (action === 'verify') await verify();
  else throw new Error('使い方: local-app.cts launch | verify');
}

module.exports = { personalEnv, developmentRuntime, main };
if (require.main === module)
  main(process.argv[2]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
