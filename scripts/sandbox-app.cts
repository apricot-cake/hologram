'use strict';

// サンドボックス検証インスタンス: 常駐する実アプリ（:9222）から完全に隔離された、
// 目に見える永続的な2つ目のアプリインスタンス＝専用の config ディレクトリ、専用の
// シード済みライブラリ、専用の CDP ポート。対話的な見た目・モーションの検証はここで
// 行う。主作業ツリーから一つだけ起動する。
//
//   node scripts/sandbox-app.cts          start（何度実行しても同じ＝既に立っていればポートを表示）
//   node scripts/sandbox-app.cts stop     隔離検証アプリを止める
//
// シード（#286）。既定は下の生成されたフィクスチャライブラリ。--real を渡すと
// 代わりに実ライブラリからシードする＝その DB の backup-API スナップショットと、
// 生成した代役メディアの組み合わせで、フィクスチャでは再現できない2つのこと
// （実際の多様性/規模、そして特定の1投稿）に対応する。実ライブラリを持つ機体
// でのみ動き、そこへは一切書き込まず、シード済みのサンドボックスがまだ実パスを
// 知っている場合は起動を拒否する（scripts/lib-sandbox-real-seed.cts）:
//
//   node scripts/sandbox-app.cts start --real
//   node scripts/sandbox-app.cts start --real --capture 1784937641978-06cd   （その投稿の実ファイル）
//   node scripts/sandbox-app.cts start --real --reseed --max-dim 1024
//
// 実データのインスタンスは常設の画面上通知を表示する: そのウィンドウは個人データを
// 運んでいるので、そのスクリーンショットは公開物（PR/Issue）へ絶対に貼ってはならない。
//
// 隔離のモデル（issue #283 参照）:
//   - HOLOGRAM_CONFIG_DIR → <tree>/.sandbox/config: userData は config ディレクトリに
//     固定され、Electron のシングルインスタンスロックは userData をキーにするので、
//     このインスタンスは実アプリと共存できる。
//   - HOLOGRAM_SANDBOX=1 → app/src/main/index.ts は native host の登録をスキップする
//     （HKCU への書き込みも共有 config ディレクトリへのコピーも無し）。
//   - config.json は必ず最初の起動より前に書かれ、saveFolder をサンドボックスの
//     ライブラリへ向ける＝未設定のまま起動すると、代わりに実際の既定ライブラリ
//     ディレクトリを使ってしまう。
//   - CDP ポートは 9333 に固定し、接続・停止前に記録した PID と照合する。
//     接続: CDP_PORT=sandbox node scripts/cdp-verify.cts
//
// 設定とテスト用ライブラリは .sandbox/ に保持し、再起動後も再利用する。

const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const appDir = path.join(repoRoot, 'app');
const { assertSandboxSeedProvenance, makePng, seedRealSandbox, wipeSandboxSeed, DEFAULT_MAX_DIM } = require('./lib-sandbox-real-seed.cts');
const { seedLibrary } = require('./lib-seed-library.cts');
const { configDir: realConfigDir, defaultLibraryDir } = require('../native-host/paths.mts');
const { SANDBOX_PORT, assertMainWorkingTree, clearInstance, foreignSandboxAt, listeningPid, readInstance, writeInstance } = require('./lib-sandbox-instance.cts');

assertMainWorkingTree(repoRoot);

const sandboxRoot = path.join(repoRoot, '.sandbox');
const configDir = path.join(sandboxRoot, 'config');
const saveFolder = path.join(sandboxRoot, 'library');
const appData = path.join(sandboxRoot, 'appdata'); // %APPDATA% への退避読み書きが実物に触れないようにする（test-app-* ハーネスと同じ流儀）
// 現在のライブラリが何からシードされたか＝起動のたびに読む。単に再起動しただけの
// インスタンスにも実データ通知を再適用しなければならないため。
const seedFile = path.join(sandboxRoot, 'seed.json');
const realSeedReceiptFile = path.join(sandboxRoot, 'real-seed-publish.json');

// ---- fixture posts ---------------------------------------------------------
// 画像は実データシードが代役を生成するのと同じ単色グラデーション PNG
// （エンコーダーは1つを共有）。

const PLATFORMS = ['x', 'bluesky', 'pixiv'];
const SIZES: Array<[number, number]> = [
  [400, 300],
  [300, 400],
  [400, 400],
  [600, 240],
  [240, 600],
];
const COLORS: Array<[number, number, number]> = [
  [244, 154, 194],
  [255, 191, 134],
  [250, 231, 140],
  [168, 228, 160],
  [137, 207, 240],
  [177, 156, 217],
  [255, 160, 160],
  [140, 216, 199],
  [222, 184, 135],
  [176, 196, 222],
  [240, 180, 220],
  [190, 210, 150],
];
const TAGS = [['test'], ['test', '構図'], ['test', '配色'], ['test', '構図', 'ポーズ'], []];
const TEXTS = ['サンドボックス検証用のダミー投稿です。', '短文。', 'モーション・レイアウト検証のためのフィクスチャ投稿。カードの高さが揃わないよう、本文の長さは投稿ごとに変えてあります。グリッドの詰め方や省略記号の出方はこの投稿で確認できます。', '改行を含む投稿。\n二行目。\n三行目はすこし長めにしてあります。'];

// 連続するフィクスチャ投稿の間隔。意図的に1日より広く取り、12件が複数の暦月に
// またがるようにしている。これで月ごとの日付セクションと見出しを検証できる。
const FIXTURE_SPACING_MS = 12 * 86400000;

function seedFixtureLibrary() {
  fs.mkdirSync(saveFolder, { recursive: true });
  if (libraryIsSeeded()) return false;
  const base = Date.UTC(2026, 0, 15, 12, 0, 0);
  const records: any[] = [];
  for (let i = 0; i < 12; i++) {
    const platform = PLATFORMS[i % PLATFORMS.length];
    const [w, h] = SIZES[i % SIZES.length];
    const captureId = `${base - i * FIXTURE_SPACING_MS}-sb${String(i).padStart(2, '0')}`;
    fs.writeFileSync(path.join(saveFolder, `${captureId}.png`), makePng(w, h, COLORS[i % COLORS.length]));
    const date = new Date(base - i * FIXTURE_SPACING_MS - 7200000).toISOString();
    records.push({
      captureId,
      image: `${captureId}.png`,
      url: `https://example.com/sandbox/${i}`,
      platform,
      text: `[${i + 1}/12] ${TEXTS[i % TEXTS.length]}`,
      displayName: `サンドボックス${i + 1}号`,
      screenName: `sandbox_${i + 1}`,
      likes: (i * 137) % 9000,
      reposts: (i * 41) % 800,
      replies: (i * 7) % 60,
      date,
      capturedAt: new Date(base - i * FIXTURE_SPACING_MS).toISOString(),
      tags: TAGS[i % TAGS.length],
    });
  }
  seedLibrary(configDir, records);
  fs.writeFileSync(seedFile, JSON.stringify({ mode: 'fixture', seededAt: new Date().toISOString() }, null, 2));
  return true;
}

// ---- real-data seed (#286) --------------------------------------------------

function readSeed(): any | null {
  try {
    return JSON.parse(fs.readFileSync(seedFile, 'utf8'));
  } catch {
    return null;
  }
}

function libraryIsSeeded(): boolean {
  // #176: hologram.db は今は configDir ではなく保存フォルダの中にある。
  if (fs.existsSync(path.join(saveFolder, 'hologram.db'))) return true;
  try {
    return fs.readdirSync(saveFolder).length > 0;
  } catch {
    return false;
  }
}

// --reseed: サンドボックスは意図的に使い捨てなので、2つのシードをマージしようと
// せず、シード済みの状態（ライブラリ・データベース・config）をまるごと落とす。
// #176: hologram.db（+ -wal/-shm）は今は saveFolder の「中」にあるので、
// 下の再帰的な削除で既に取り除かれる＝個別の db 削除は不要。
function wipeSeed() {
  wipeSandboxSeed({ receiptPath: realSeedReceiptFile, library: saveFolder, config: path.join(configDir, 'config.json'), marker: seedFile });
}

// 実ライブラリは、そこへ capture している機体にしか存在しない。それ以外の場所
// （まっさらな clone、クラウドのランナー）では、ファイルが無いことによる
// スタックトレースではなく、理由を添えて失敗しなければならない＝#175 の
// 生成ダミーライブラリがそこでの代役になる。
function resolveRealLibrary(): { configDir: string; saveFolder: string } {
  if (process.env.HOLOGRAM_CONFIG_DIR) throw new Error('HOLOGRAM_CONFIG_DIR が設定されています＝既に隔離済みの config ディレクトリを実ライブラリとして扱うことを拒否します');
  const dir = realConfigDir();
  const configPath = path.join(dir, 'config.json');
  let folder = '';
  try {
    folder = JSON.parse(fs.readFileSync(configPath, 'utf8')).saveFolder || '';
  } catch {
    /* 既定値へフォールスルー */
  }
  if (!folder) folder = defaultLibraryDir();
  // #176: hologram.db は今は configDir ではなく保存フォルダの中にある。
  if (!fs.existsSync(path.join(folder, 'hologram.db'))) throw new Error(`この機体に実ライブラリがありません（${path.join(folder, 'hologram.db')} が見つかりません）。フィクスチャシードを使うか、scripts/gen-dummy-library.cts で生成してください`);
  return { configDir: dir, saveFolder: folder };
}

async function seedReal(opts: { captureIds: string[]; maxDim: number }) {
  const real = resolveRealLibrary();
  console.log(`実ライブラリからシード中: ${real.configDir}（メディア: ${real.saveFolder}）`);
  const report = await seedRealSandbox({
    realConfigDir: real.configDir,
    realSaveFolder: real.saveFolder,
    sandboxConfigDir: configDir,
    sandboxLibrary: saveFolder,
    captureIds: opts.captureIds,
    maxDim: opts.maxDim,
    successMarkerPath: seedFile,
    publishReceiptPath: realSeedReceiptFile,
    log: (msg: string) => console.log(`  ${msg}`),
  });
  return report;
}

// 実データのインスタンスが動いている間ずっと運ぶ画面上の通知。これがあれば、
// そのスクリーンショットがフィクスチャのスクリーンショットに見えることはない
// （#286: 実メディアは公開物に届いてはならず、実データベースの投稿本文も同じ理由で
// 個人情報にあたる）。
function noticeFor(seed: any | null): string | null {
  if (!seed || seed.mode !== 'real') return null;
  const ids = (seed.realMedia && seed.realMedia.captureIds) || [];
  if (ids.length) return `実データ検証インスタンス（実メディア入り: ${ids.join(', ')}）— このウィンドウのスクリーンショットを公開物へ貼らないこと`;
  return '実データ検証インスタンス（実DBスナップショット）— このウィンドウのスクリーンショットを公開物へ貼らないこと';
}

// ---- instance management ---------------------------------------------------

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// 使用中なら別ポートへ逃がさず、競合を報告する。
function assertPortAvailable(): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error('検証用 CDP ポート 9333 は使用中です。接続先を確認してください。')));
    server.listen(SANDBOX_PORT, '127.0.0.1', () => server.close(() => resolve()));
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

const { waitFor } = require('./lib-wait.cts');

function printConnectHint(port: number) {
  console.log(`サンドボックスインスタンス起動: CDP は 127.0.0.1:${port}`);
  console.log(`  接続: CDP_PORT=sandbox node scripts/cdp-verify.cts   （記録から :${port} を解決）`);
  console.log('  停止: node scripts/sandbox-app.cts stop');
}

async function start(opts: StartOptions) {
  const existing = readInstance(repoRoot);
  // 古い PID の記録だけで再利用せず、ポートの所有者と CDP の応答を確認する。
  const foreign = existing ? foreignSandboxAt(existing.port, repoRoot) : null;
  if (existing && isAlive(existing.pid) && !foreign && (await cdpReady(existing.port))) {
    if (existing.port !== SANDBOX_PORT) throw new Error('旧ポートの検証用アプリが動作中です。sandbox-app.cts stop で停止してから起動してください。');
    // シードはアプリの足元でデータベースを入れ替えるので、インスタンスがそれを
    // 開いたままでは起こり得ない。
    if (opts.reseed || (opts.real && (readSeed() || {}).mode !== 'real')) {
      console.error('FAIL サンドボックスインスタンスが動作中です。先に止めてください: node scripts/sandbox-app.cts stop');
      process.exit(1);
    }
    printConnectHint(existing.port);
    return;
  }
  if (foreign) console.warn(`⚠ .sandbox/instance.json は :${existing?.port} を主張していますが、そのポートは記録した pid ${existing?.pid} ではなく pid ${foreign} が保持しています＝古い記録を無視します（そのpidはこのスクリプトでは止めません）`);

  await assertPortAvailable();
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(appData, { recursive: true });
  if (opts.reseed) wipeSeed();
  assertSandboxSeedProvenance({ receiptPath: realSeedReceiptFile, markerPath: seedFile, library: saveFolder });
  let seeded = false;
  if (opts.real) {
    if (libraryIsSeeded() && (readSeed() || {}).mode !== 'real') {
      console.error('FAIL このサンドボックスは既にフィクスチャライブラリを持っています。明示的に再シードしてください: node scripts/sandbox-app.cts start --real --reseed');
      process.exit(1);
    }
    if (!libraryIsSeeded()) {
      await seedReal(opts);
      seeded = true;
    }
  } else {
    const configPath = path.join(configDir, 'config.json');
    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, JSON.stringify({ saveFolder, extensionId: 'testextensionidabcdefghijklmnop' }, null, 2));
    }
    seeded = seedFixtureLibrary();
  }
  const notice = noticeFor(readSeed());

  const port = SANDBOX_PORT;
  // HMRの生成物で普段使いの app/out を上書きしない。
  const sandboxOutput = path.join(sandboxRoot, 'out');
  fs.cpSync(path.join(appDir, 'assets'), path.join(sandboxRoot, 'assets'), { recursive: true });
  const env = Object.assign({}, process.env, {
    APPDATA: appData,
    HOLOGRAM_CONFIG_DIR: configDir,
    HOLOGRAM_SANDBOX: '1',
    HOLOGRAM_APP_BUILD_OUT: sandboxOutput,
    ELECTRON_ENTRY: path.join(sandboxOutput, 'main', 'index.js'),
    REMOTE_DEBUGGING_PORT: String(port),
    // 検証インスタンスはキーボードの前の人ではなくセッションが起動する: それが
    // その人の作業からフォアグラウンドを奪ってはいけない。手で操作したい稀な実行
    // には HOLOGRAM_START_INACTIVE=0 を設定する。
    HOLOGRAM_START_INACTIVE: process.env.HOLOGRAM_START_INACTIVE || '1',
    ...(notice ? { HOLOGRAM_SANDBOX_NOTICE: notice } : {}),
  });
  // `npm run app:dev` と同じ前処理を済ませてから electron-vite を起動する。Windows の
  // npm.cmd は Node の detached spawn では起動できないため、npm を子にせず、同じ
  // CLI を Node で実行する。electron-vite dev 自体が renderer HMR を提供する。
  // main/preload の watch は Electron を再生成して instance.json の browser pid を
  // 取り替えるため、この常駐インスタンスでは有効にしない。直接 electron を起動
  // すると、表示はできてもこのサンドボックスだけが古い renderer を読む。
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(npm, ['run', '_build:theme-boot', '--workspace=app'], { cwd: repoRoot, stdio: 'ignore', shell: process.platform === 'win32' });
  execFileSync(npm, ['run', '_build:native-host-bridge', '--workspace=app'], { cwd: repoRoot, stdio: 'ignore', shell: process.platform === 'win32' });
  const cli = path.join(path.dirname(require.resolve('electron-vite/package.json', { paths: [repoRoot, appDir] })), 'bin', 'electron-vite.js');
  const child = spawn(process.execPath, [cli, 'dev', `--remoteDebuggingPort=${port}`], {
    cwd: appDir,
    env,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  // ポートが応答することが事後条件。途中で終了したインスタンスは、死んだ
  // プロセスに時間予算を丸ごと使わせるのではなく待機を早めに止める。
  const up = await waitFor(
    `the sandbox instance to answer CDP on :${port}`,
    async () => {
      if (child.pid && !isAlive(child.pid)) throw new Error('CDP ポートが応答する前にインスタンスが終了しました');
      return cdpReady(port);
    },
    { timeoutMs: 20_000, pollMs: 300 },
  ).then(
    () => true,
    () => false,
  );
  if (up) {
    // electron-vite の親 pid ではなく、CDP を listen している Electron 自身を記録
    // する。foreignSandboxAt が誤接続を拒めるのはこの対応付けによる。
    const appPid = listeningPid(port);
    if (appPid === null) {
      console.error(`FAIL :${port} を listen している Electron の pid を取得できませんでした`);
      try {
        execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {
        /* 起動に失敗した子をできる範囲で片付ける */
      }
      process.exit(1);
    }
    writeInstance(repoRoot, { pid: appPid, launcherPid: child.pid as number, port });
    if (seeded && !opts.real) console.log(`${saveFolder} へフィクスチャ投稿12件をシードしました`);
    if (notice) console.log(`⚠ ${notice}`);
    printConnectHint(port);
    return;
  }
  console.error('FAIL サンドボックスインスタンスが起動しませんでした（CDP が一度も応答しませんでした）');
  process.exit(1);
}

async function stop() {
  const inst = readInstance(repoRoot);
  if (!inst || !isAlive(inst.pid)) {
    console.log('サンドボックスインスタンスは動作していません');
    clearInstance(repoRoot);
    return;
  }
  // 古い記録が別プロセスを指していれば停止しない。
  const foreign = foreignSandboxAt(inst.port, repoRoot);
  if (foreign) {
    console.error(`FAIL :${inst.port} は記録した pid ${inst.pid} ではなく pid ${foreign} が保持しています。別プロセスは停止しません。古い記録を破棄するので、ポートの使用状況を確認してください。`);
    clearInstance(repoRoot);
    process.exit(1);
  }
  const launcherPid = inst.launcherPid || inst.pid;
  try {
    // HMR サーバー、watcher、Electron を同じ起動木として止める。browser pid だけを
    // 止めると watcher が残り、次の起動が別の開発サーバーへ繋がる。
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(launcherPid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(launcherPid);
  } catch {
    /* 既に終了している場合は下の事後条件で扱う */
  }
  // 起動木と CDP の双方が消えることが事後条件。片方だけを見て watcher や Electron
  // の取り残しを見逃さない。
  await waitFor(`sandbox launcher ${launcherPid} and CDP :${inst.port} to exit`, () => !isAlive(launcherPid) && !cdpReady(inst.port), { timeoutMs: 5000, pollMs: 250 }).catch(() => {});
  if (isAlive(launcherPid) || (await cdpReady(inst.port))) {
    console.error(`FAIL サンドボックスの起動木 pid ${launcherPid} または CDP :${inst.port} が停止しませんでした`);
    process.exit(1);
  }
  clearInstance(repoRoot);
  console.log(`サンドボックスインスタンスを停止しました（pid ${inst.pid}、port ${inst.port}）`);
}

interface StartOptions {
  real: boolean;
  reseed: boolean;
  captureIds: string[];
  maxDim: number;
}

function parseStartOptions(argv: string[]): StartOptions {
  const opts: StartOptions = { real: false, reseed: false, captureIds: [], maxDim: DEFAULT_MAX_DIM };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--real') opts.real = true;
    else if (a === '--reseed') opts.reseed = true;
    else if (a === '--capture')
      opts.captureIds.push(
        ...String(argv[++i] || '')
          .split(',')
          .filter(Boolean),
      );
    else if (a === '--max-dim') opts.maxDim = Number(argv[++i]);
    else throw new Error(`不明なオプション: ${a}`);
  }
  if (!Number.isFinite(opts.maxDim) || opts.maxDim < 16) throw new Error('--max-dim は 16 以上でなければなりません');
  if (opts.captureIds.length && !opts.real) throw new Error('--capture は --real にのみ適用されます（フィクスチャシードには固定できる実投稿がありません）');
  return opts;
}

const cmd = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'start';
const rest = process.argv.slice(process.argv[2] === cmd ? 3 : 2);
if (cmd === 'start') {
  let opts: StartOptions;
  try {
    opts = parseStartOptions(rest);
  } catch (err) {
    console.error(`FAIL ${(err as Error).message}`);
    console.error('使い方: node scripts/sandbox-app.cts [start [--real [--capture <id>[,<id>]] [--max-dim N] [--reseed]] | stop]');
    process.exit(2);
  }
  start(opts).catch((err) => {
    console.error(`FAIL ${err.stack || err.message}`);
    process.exit(1);
  });
} else if (cmd === 'stop') stop();
else {
  console.error('使い方: node scripts/sandbox-app.cts [start [--real [--capture <id>[,<id>]] [--max-dim N] [--reseed]] | stop]');
  process.exit(2);
}
