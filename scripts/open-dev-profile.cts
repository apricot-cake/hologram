'use strict';

// `npm run ext:dev:browser` / `npm run ext:dev:marker` ―― 開発用のChromeプロファイルを開き、
// 日常用と同じ共有リリースビルドを CDP で読み込む。
//
// 専用プロファイルにする目的は、ログイン状態と保存先を日常利用から隔離することだ。
// バンドルは分けない。scripts/lib-extension-profile.cts が storage.local に開発用 Native Host
// を設定してから同じ unpacked 拡張機能を再読み込みするため、このプロファイルからの保存は
// ~/.hologram-dev にだけ届く。
//
// これは自分専用の`--user-data-dir`を持つので、日常使いのChromeとは別の、自分自身の
// セッションを持つ第2のプロセスとして並走する。5つのサイトへのサインインは人間が
// 一度だけ行う手作業で、プロファイルがそのログインを保持する。
//
// --load-extensionは使わない。Chrome 137以降はこれを無視するので（#657、Chrome 151で実測）、
// ブラウザレベルの CDP Extensions.loadUnpacked を使う。
//
// プロファイルが既に起動していれば新しいウィンドウを開かず、CDP経由で同じ共有ビルドを
// 読み込み直す。このウィンドウはサインイン状態と開いているタイムラインを保持したまま
// 長生きするので、「既に起動中」は普通のケースである。
//
//   node scripts/open-dev-profile.cts

const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const { homedir } = require('node:os');
const path = require('node:path');
const { DEFAULT_CDP_URL, cdpReady, configureDevelopmentExtension } = require('./lib-extension-profile.cts');
const { waitFor } = require('./lib-wait.cts');

const ROOT = path.join(__dirname, '..');
const PROFILE = process.env.HOLOGRAM_EXTENSION_DEV_PROFILE || path.join(homedir(), '.hologram-ext-profile');
const OUTPUT = process.env.HOLOGRAM_EXTENSION_OUTPUT || path.join(ROOT, 'extension', '.output', 'chrome-mv3');
const CDP_ADDRESS = '127.0.0.1';
const CDP_PORT = 9223;
const CDP_URL = DEFAULT_CDP_URL;
const marker = process.argv.includes('--marker') ? `data:text/html;charset=utf-8,${encodeURIComponent('<title>Hologram 開発プロファイル</title><main>Hologram 開発プロファイル</main>')}` : null;

// Chromeが実際にどこにあるかは、推測せずWindowsに尋ねる＝32bit版のインストールパスは
// 多くのマシンに存在し、64bit決め打ちのパスだとそこで見当違いのメッセージとともに失敗する。
function chromePath(): string {
  const candidates = [
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  try {
    // 最後の手段: シェル自身が持つhttpの関連付けを使う。
    const found = execFileSync('where.exe', ['chrome'], { encoding: 'utf8' }).split(/\r?\n/).find(Boolean);
    if (found && fs.existsSync(found)) return found;
  } catch {
    /* PATH上にも無い */
  }
  throw new Error('Chromeが見つからなかった。HOLOGRAM_CHROMEにフルパスを設定すること。');
}

const chrome = process.env.HOLOGRAM_CHROME || chromePath();

// 与えられた--user-data-dirのウィンドウを所有しているプロセスがもしあれば、それを返す。
// Chromeのヘルパープロセス（--type=rendererなど）も同じ--user-data-dirを名乗るので、
// それらは除外する――そうしないと、ウィンドウは閉じたのにcrashpadハンドラだけが
// 居残っているプロファイルが「起動中」と読めてしまう。
function runningPid(profile: string): number | null {
  let processes: { ProcessId: number; CommandLine: string | null }[];
  try {
    const json = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process -Filter "Name=\'chrome.exe\'" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress'], { encoding: 'utf8' }).trim();
    if (!json) return null;
    const parsed = JSON.parse(json);
    processes = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // プロセス一覧が取れないことは「何も起動していない」ではなく「答えが無い」ことだ。
    // nullを返してそう伝え、呼び出し元には（不要かもしれない）ウィンドウを開かせる方を選ぶ。
    // 本当は必要だった起動を黙ってスキップするよりましだからだ。
    return null;
  }
  const want = path.resolve(profile).toLowerCase();
  for (const proc of processes) {
    const cmd = proc.CommandLine || '';
    if (cmd.includes('--type=')) continue;
    const match = /--user-data-dir=(?:"([^"]*)"|(\S+))/.exec(cmd);
    const dir = match?.[1] ?? match?.[2];
    if (dir && path.resolve(dir).toLowerCase() === want) return proc.ProcessId;
  }
  return null;
}

async function main() {
  // `--print`はすべてを解決するが何も開かない。ブラウザウィンドウを開くことは、
  // マシンを使っている人から画面とキーボードを奪う。だからパスが正しいかを確かめる
  // だけのことに、それを払わせてはいけない――確かめる側がエージェントであるときも
  // 同じだ（このフラグができた経緯そのものがそれで、このスクリプトの最初の実行は、
  // ウィンドウなど何も要らない確認のためにフォーカスを奪ってしまった）。
  if (process.argv.includes('--print')) {
    const pid = runningPid(PROFILE);
    const cdp = await cdpReady(CDP_URL);
    console.log(`chrome:  ${chrome}`);
    console.log(`プロファイル: ${PROFILE}`);
    console.log(`起動中:  ${pid === null ? 'いいえ' : `はい（pid ${pid}）`}`);
    console.log(`CDP:     http://${CDP_ADDRESS}:${CDP_PORT} (${cdp ? '接続可能' : '未接続'})`);
    console.log(`共有リリースビルド: ${OUTPUT}${fs.existsSync(path.join(OUTPUT, 'manifest.json')) ? '' : '（まだ配備されていない）'}`);
    process.exit(0);
  }

  const alreadyOpen = runningPid(PROFILE);
  if (alreadyOpen !== null) {
    console.log(`[hologram] 開発用Chromeプロファイルは既に起動している（pid ${alreadyOpen}）: ${PROFILE}`);
    if (!(await cdpReady(CDP_URL))) {
      console.error(`[hologram] CDP が ${CDP_ADDRESS}:${CDP_PORT} で応答していない。このプロファイルのウィンドウをすべて閉じてから、もう一度実行すること。`);
      process.exit(1);
    }
  } else if (await cdpReady(CDP_URL)) {
    throw new Error(`CDP ポート ${CDP_ADDRESS}:${CDP_PORT} は別のChromeが使用している。競合するプロセスを止めてから再実行すること。`);
  }

  if (alreadyOpen === null || marker) {
    if (alreadyOpen === null) fs.mkdirSync(PROFILE, { recursive: true });

    // detachedかつstdioなしで起動し、このスクリプトの終了後も開発用Chromeを残す。
    const child = spawn(chrome, [`--user-data-dir=${PROFILE}`, `--remote-debugging-address=${CDP_ADDRESS}`, `--remote-debugging-port=${CDP_PORT}`, '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', ...(marker ? [marker] : [])], {
      detached: true,
      stdio: 'ignore',
    });
    if (child.pid === undefined) {
      throw new Error(`Chromeが起動しなかった: ${chrome}。ブラウザは開かれていない。`);
    }
    // Windowsだけが検知できるspawnの失敗は、この関数が戻った後に届く。
    child.on('error', (err: Error) => {
      console.error(`[hologram] Chromeの起動に失敗した: ${err.message}`);
      process.exitCode = 1;
    });
    child.unref();

    if (alreadyOpen === null) {
      try {
        await waitFor(`開発用Chromeの CDP が ${CDP_ADDRESS}:${CDP_PORT} で応答すること`, () => cdpReady(CDP_URL), { timeoutMs: 20_000, pollMs: 100 });
      } catch {
        throw new Error(`開発用Chromeは起動したが、CDP が ${CDP_ADDRESS}:${CDP_PORT} で20秒以内に応答しなかった。Chromeをすべて閉じてから再実行すること。`);
      }
    }
  }

  console.log(alreadyOpen !== null ? `[hologram] 開発用Chromeプロファイルは起動済み: ${PROFILE}` : marker ? `[hologram] 開発用プロファイルに識別ページを開いた: ${PROFILE}` : `[hologram] 開発用Chromeプロファイルを開いた: ${PROFILE}`);
  console.log(`[hologram] CDP 接続先: http://${CDP_ADDRESS}:${CDP_PORT}`);
  if (fs.existsSync(path.join(OUTPUT, 'manifest.json'))) {
    const configured = await configureDevelopmentExtension(OUTPUT, CDP_URL);
    console.log(`[hologram] 共有リリースビルドを読み込み直した: ${configured.path}`);
    console.log('[hologram] このプロファイルの Native Host: com.hologram.host.dev');
  } else {
    console.log(`[hologram] 共有リリースビルドがまだ無い――先に "npm run deploy:ext" を実行すること（${OUTPUT} に書き出される）`);
  }
  console.log('[hologram] 開発用と日常用は同じリリースビルドを読み、プロファイルごとの Native Host 設定だけが異なる。');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
