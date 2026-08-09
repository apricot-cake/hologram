'use strict';

// `npm run ext:dev:browser` ―― 開発用のChromeプロファイル（#732）を開く。
//
// 専用プロファイルにすること自体が目的だ＝日常使いのブラウザは検証済みのリリースビルド
// だけを持ち、それ以外は何も持たない。だから拡張機能の開発に関するすべて――開発サーバーの
// バンドル、保存するたびのタブ再読み込み、実ライブラリに届いてはいけないキャプチャ――は
// こちら側で起きる。
//
// これは自分専用の`--user-data-dir`を持つので、日常使いのChromeとは別の、自分自身の
// セッションを持つ第2のプロセスとして並走する。5つのサイトへのサインインは人間が
// 一度だけ行う手作業で、プロファイルがそのログインを保持する。
//
// --load-extensionは使わない。Chrome 137以降はこれを無視するので（#657、Chrome 151で実測）、
// そもそも不要だ＝chrome://extensionsから一度読み込んだunpackedな拡張機能はプロファイルに
// 記憶される。その最初の読み込みだけが、人間がしなければならない唯一の部分だ。
//
// プロファイルが既に起動していれば、これは止まってそう伝える（#857）。このウィンドウは
// 長生きする――サインイン、読み込み済みのunpacked拡張機能、開いているタイムラインは何であれ
// すべてそこに宿る――ので「既に起動中」は例外ではなく普通に起きるケースだ。ブラウザを
// 開くことは、マシンを使っている人から画面とキーボードを奪う。既にそこにあるウィンドウに
// 辿り着くためだけにそれを払うのは、純粋なコストにしかならない。
//
//   node scripts/open-dev-profile.cts

const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const { homedir } = require('node:os');
const path = require('node:path');
const { DEV_SERVER_PORT, devServerAlive } = require('./lib-dev-server.cts');

const PROFILE = process.env.HOLOGRAM_EXTENSION_DEV_PROFILE || path.join(homedir(), '.hologram-ext-profile');
const OUTPUT = process.env.HOLOGRAM_EXTENSION_DEV_OUTPUT || path.join(homedir(), '.hologram-dev', 'chrome-mv3-dev');

// ポートと生死判定は scripts/lib-dev-server.cts が持つ（dev-extension.cts と共有）。
// dev ビルドは自己完結していない（#861）＝popup.html 等はスクリプトと CSS を
// http://localhost:51731 から直接読む。サーバーが落ちていても拡張は壊れた顔を
// しない＝ポップアップは開くが、素の HTML が縦一列に潰れて出る（CSS/レイアウトの
// バグに見えるが原因はサーバー未起動）。窓を開く前にここを確かめておく。

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
  const devServerUp = await devServerAlive();

  // `--print`はすべてを解決するが何も開かない。ブラウザウィンドウを開くことは、
  // マシンを使っている人から画面とキーボードを奪う。だからパスが正しいかを確かめる
  // だけのことに、それを払わせてはいけない――確かめる側がエージェントであるときも
  // 同じだ（このフラグができた経緯そのものがそれで、このスクリプトの最初の実行は、
  // ウィンドウなど何も要らない確認のためにフォーカスを奪ってしまった）。
  if (process.argv.includes('--print')) {
    const pid = runningPid(PROFILE);
    console.log(`chrome:  ${chrome}`);
    console.log(`プロファイル: ${PROFILE}`);
    console.log(`起動中:  ${pid === null ? 'いいえ' : `はい（pid ${pid}）`}`);
    console.log(`開発サーバー (localhost:${DEV_SERVER_PORT}): ${devServerUp ? '起動中' : '停止中――"npm run dev:ext" が動くまでpopup/options/diagは素のスタイルなしHTMLで描画される'}`);
    console.log(`ビルド:  ${OUTPUT}${fs.existsSync(path.join(OUTPUT, 'manifest.json')) ? '' : '（まだビルドされていない）'}`);
    process.exit(0);
  }

  if (!devServerUp) {
    console.log(`[hologram] 警告: 開発サーバー (localhost:${DEV_SERVER_PORT}) が応答していない。`);
    console.log('[hologram] 開発ビルドは自己完結していない――popup.html等はスクリプトとCSSをそこから直接読む。');
    console.log('[hologram] サーバーが無くてもポップアップは開くが、素のスタイルなしHTMLが1列に潰れて出る（レイアウトのバグに見えるが違う）。');
    console.log('[hologram] "npm run dev:ext" を実行し、確認する間は動かしたままにしておくこと。');
  }

  const alreadyOpen = runningPid(PROFILE);
  if (alreadyOpen !== null) {
    console.log(`[hologram] 開発用Chromeプロファイルは既に起動している（pid ${alreadyOpen}）: ${PROFILE}`);
    console.log('[hologram] 何もすることはない――そのウィンドウに切り替えること。パスを見たいときは--printを渡す。');
    process.exit(0);
  }

  fs.mkdirSync(PROFILE, { recursive: true });

  // 素直にspawnする。以前はここを1回限りのスケジュールタスク経由にしていた。理由は、
  // パッケージ版デスクトップアプリが子プロセスを入れるMSIXコンテナの外でChromeを
  // 起動するため――そこではファイルシステムへの書き込みがパッケージごとのコピーに
  // 落ちるので、再利用したいはずのプロファイルが分岐してしまいかねなかった。その理由は
  // 2026-08-06（#1003）に無くなった＝ファイルシステムは実物であり、PROFILEはいずれにせよ
  // ホームディレクトリの下にある。
  //
  // タスクの`cmd /c start`アクションが買っていたのは、ブラウザがランチャーより長生き
  // することであり、それは廃止後も生き残らせなければならない――だからdetachedかつ
  // stdioなしにする。Chromeは自分専用のプロセスグループを持ち、継承されたハンドルも
  // 無いので、このプロセスが終了した後も起動したままになる（2026-08-07実測、#1006：
  // nodeは1秒未満で戻り、ウィンドウはまだそこにある）。
  const child = spawn(chrome, [`--user-data-dir=${PROFILE}`], { detached: true, stdio: 'ignore' });
  if (child.pid === undefined) {
    throw new Error(`Chromeが起動しなかった: ${chrome}。ブラウザは開かれていない。`);
  }
  // Windowsだけが検知できるspawnの失敗（存在はするが実行できないパス）は、この関数が
  // 既に戻った後にイベントとして届く。下の成功メッセージを最後の言葉にしたままにせず、
  // ここで伝える。
  child.on('error', (err: Error) => {
    console.error(`[hologram] Chromeの起動に失敗した: ${err.message}`);
    process.exitCode = 1;
  });
  child.unref();

  console.log(`[hologram] 開発用Chromeプロファイルを開いた: ${PROFILE}`);
  if (fs.existsSync(path.join(OUTPUT, 'manifest.json'))) {
    console.log(`[hologram] 読み込む開発ビルド: ${OUTPUT}`);
  } else {
    console.log(`[hologram] 開発ビルドがまだ無い――先に"npm run dev:ext"を実行すること（${OUTPUT}に書き出される）`);
  }
  console.log('[hologram] 初回だけ: chrome://extensions → デベロッパーモード → パッケージ化されていない拡張機能を読み込む → 上記フォルダ。');
  console.log('[hologram] 日常使いのプロファイルには読み込まないこと＝両方のビルドが同じ拡張機能IDを持っている。');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
