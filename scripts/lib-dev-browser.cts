'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { homedir } = require('node:os');
const { fork } = require('node:child_process');
const { runningChromePid } = require('./lib-chrome-command-line.cts');

function developmentOptions(env = process.env): any {
  const profile = path.join(homedir(), '.hologram-ext-profile');
  if (env.HOLOGRAM_EXTENSION_DEV_PROFILE && path.resolve(env.HOLOGRAM_EXTENSION_DEV_PROFILE).toLowerCase() !== path.resolve(profile).toLowerCase()) throw new Error('開発用 Chrome は既存の専用プロファイルだけを使用します');
  if (env.HOLOGRAM_EXTENSION_DEV_PROFILE_DIRECTORY && env.HOLOGRAM_EXTENSION_DEV_PROFILE_DIRECTORY !== 'Default') throw new Error('開発用 Chrome は既存の Default だけを使用します');
  const candidates = [env.HOLOGRAM_CHROME, path.join(env.PROGRAMFILES || 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'), path.join(env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google/Chrome/Application/chrome.exe'), path.join(env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe')];
  const executablePath = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!executablePath) throw new Error('Chrome が見つかりません。HOLOGRAM_CHROME にフルパスを設定してください');
  return { profile, executablePath, output: path.resolve(env.HOLOGRAM_EXTENSION_OUTPUT || path.join(__dirname, '../extension/.output/chrome-mv3')) };
}

function assertDevelopmentProfile(profile: string, files = fs): void {
  const dedicated = path.resolve(homedir(), '.hologram-ext-profile');
  if (path.resolve(profile).toLowerCase() !== dedicated.toLowerCase()) throw new Error('専用プロファイル以外の Chrome は操作できません');
  for (const directory of [dedicated, path.join(dedicated, 'Default')]) {
    if (!files.existsSync(directory)) continue;
    if (files.lstatSync(directory).isSymbolicLink() || files.realpathSync.native(directory).toLowerCase() !== path.resolve(directory).toLowerCase()) throw new Error('開発用プロファイルのリンクやジャンクションは使用できません');
  }
}

function persistentLaunchOptions(options: any): any {
  return {
    executablePath: options.executablePath,
    headless: true,
    chromiumSandbox: true,
    viewport: null,
    ignoreDefaultArgs: ['--disable-extensions', '--password-store=basic', '--use-mock-keychain', '--headless', '--hide-scrollbars'],
    args: ['--profile-directory=Default', '--headless=new', '--window-size=1280,720', '--restore-last-session', '--enable-unsafe-extension-debugging', '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  };
}

async function launchDevelopmentContext(options: any, dependencies: any = {}): Promise<any> {
  assertDevelopmentProfile(options.profile, dependencies.files || fs);
  const find = dependencies.runningPid || runningChromePid;
  const pid = find(options.profile);
  if (pid !== null) throw new Error(`専用プロファイルの Chrome が起動中です (pid ${pid})。実行中の開発用コマンドを通常終了してから再実行してください`);
  const chromium = dependencies.chromium || require('playwright').chromium;
  return chromium.launchPersistentContext(options.profile, persistentLaunchOptions(options));
}

// 通信は fork 時に継承した IPC 一本だけ。別 CLI は既存の所有者に接続しない。
function startDevelopmentBrowser(options = developmentOptions(), dependencies: any = {}): Promise<any> {
  const child = (dependencies.fork || fork)(path.join(__dirname, 'dev-browser-owner.cts'), [], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  let nextId = 0;
  const pending = new Map<number, any>();
  let released = false;
  const rejectPending = (error: Error) => {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    pending.clear();
  };
  child.on('error', rejectPending);
  child.on('exit', (code: number) => rejectPending(new Error(`開発用 Chrome の所有プロセスが終了しました (${code})`)));
  const send = (operation: string, args: any = {}): Promise<any> =>
    new Promise((resolve, reject) => {
      if (released || !child.connected) return reject(new Error('開発用 Chrome の所有プロセスへの接続は終了しています'));
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`開発用 Chrome の操作が時間内に完了しませんでした: ${operation}`));
      }, 120_000);
      pending.set(id, { resolve, reject, timer });
      child.send({ id, operation, args }, (error: Error | null) => {
        if (error) {
          clearTimeout(timer);
          pending.delete(id);
          reject(error);
        }
      });
    });
  child.on('message', (message: any) => {
    const item = pending.get(message?.id);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(message.id);
    if (message.error) item.reject(new Error(message.error));
    else item.resolve(message.result);
  });
  const disconnect = () => {
    if (released) return;
    released = true;
    rejectPending(new Error('開発用 Chrome の操作を終了しました'));
    if (child.connected) child.disconnect();
    child.unref();
  };
  const release = async () => {
    try {
      if (!released && child.connected) await send('close');
    } finally {
      disconnect();
    }
  };
  return send('start', options).then(
    () => ({
      configure: (output: string) => send('configure', { output }),
      reload: (output: string) => send('reload', { output }),
      verify: (url: string, host: string) => send('verify', { url, host }),
      marker: () => send('marker'),
      run: (modulePath: string, args: string[]) => send('run', { modulePath: path.resolve(modulePath), args }),
      release,
    }),
    (error: Error) => {
      disconnect();
      throw error;
    },
  );
}

function waitForInterrupt(): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      process.off('SIGINT', finish);
      process.off('SIGTERM', finish);
      resolve();
    };
    process.once('SIGINT', finish);
    process.once('SIGTERM', finish);
  });
}
module.exports = { developmentOptions, assertDevelopmentProfile, persistentLaunchOptions, launchDevelopmentContext, startDevelopmentBrowser, waitForInterrupt };
