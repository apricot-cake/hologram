'use strict';

// リロード累積プローブ（#66）: レンダラーのリロードを繰り返すと GPU プロセスが
// 大きくなっていくか、その増加は dev サーバー固有のものか。
//
// 両方の腕は、隔離された HOLOGRAM_CONFIG_DIR の中で「同じ」アプリを「同じ」
// シード済みフィクスチャライブラリに対して動かす。ポートは :9222（本物の
// アプリ）ともサンドボックスの範囲（scripts/lib-sandbox-instance.cts）とも
// 外れているので、プローブの実行が常駐アプリ・本物のライブラリ・別のツリーの
// サンドボックスインスタンスに触れることは無い。
//
//   node scripts/probe-gpu-reload.cts --mode=prod --reloads=20
//   node scripts/probe-gpu-reload.cts --mode=dev  --reloads=20
//   node scripts/probe-gpu-reload.cts --mode=dev  --reloads=20 --empty   (投稿ゼロ＝画像デコードなし)
//
//   --mode=prod   electron . を app/out に対して（パッケージ済みビルドが読むもの）
//   --mode=dev    electron-vite dev（レンダラーは http 経由、HMR クライアント接続）
//   --mode=hmr    electron-vite dev だが、各ステップはマウント済みのレンダラー
//                 コンポーネントを編集し、リロードではなくホットアップデートを
//                 待つ。これが「開発中に画面をリロードする」ことの実態が
//                 ほとんどの場合やっていること — レンダラーのファイルを編集
//                 しても Page.reload には届かない — なので、リロードしか
//                 しないプローブでは #66 に答えられない。
//   --empty       フィクスチャのシードを飛ばし、グリッドに何もデコードする
//                 ものが無い状態にする
//   --keep        レポートの後もインスタンスを起動したままにする（触って
//                 みるため）
//
// 計測。軸は #66 が名指ししているもの: GPU プロセスの private bytes と、
// アイドル時のフレームレート。private bytes は、起動した pid の「子孫」に
// 対する Win32_Process から取る（コマンドラインの一致からではない）—
// Electron は実行時に app.setPath 経由で userData を固定するので、設定
// ディレクトリが子プロセスの argv に現れることは無く、それで照合すると
// 静かに何も選ばれなくなる。レンダラー側の DOM カウンタと JS ヒープも
// 一緒に計測する。そこに現れるリークは、GPU プロセスにしか現れないリークとは
// 別のバグだから。
//
// ウィンドウは非アクティブ状態で起動する（HOLOGRAM_START_INACTIVE=1）ので、
// プローブがキーボードの前にいる人からフォーカスを奪うことは無い。それは
// レンダラーをバックグラウンド化し、rAF をゼロまでスロットルして FPS の軸を
// 無意味にしてしまうので、下のスロットル抑制フラグは「両方の」腕に渡す —
// これは計測のセットアップの一部であり、両腕の違いではない。

const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const WebSocket = require('ws');

const repoRoot = path.join(__dirname, '..');
const appDir = path.join(repoRoot, 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');
const { makePng } = require('./lib-sandbox-real-seed.cts');
const { seedLibrary } = require('./lib-seed-library.cts');

// Outside :9222 and outside the sandbox range (9333-9432), so a probe run cannot
// be mistaken for - or collide with - either.
const PORT_MIN = 9500;
const PORT_SPAN = 40;

const NO_THROTTLE = ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion'];

const { sleep, waitFor } = require('./lib-wait.cts');

// ---- options ---------------------------------------------------------------

interface Options {
  mode: 'prod' | 'dev' | 'hmr';
  reloads: number;
  empty: boolean;
  keep: boolean;
  label: string;
}

function parseOptions(argv: string[]): Options {
  const opts: Options = { mode: 'prod', reloads: 20, empty: false, keep: false, label: '' };
  for (const a of argv) {
    if (a.startsWith('--mode=')) opts.mode = a.slice(7) as Options['mode'];
    else if (a.startsWith('--reloads=')) opts.reloads = Number(a.slice(10));
    else if (a === '--empty') opts.empty = true;
    else if (a === '--keep') opts.keep = true;
    else if (a.startsWith('--label=')) opts.label = a.slice(8);
    else throw new Error(`未知のオプション: ${a}`);
  }
  if (!['prod', 'dev', 'hmr'].includes(opts.mode)) throw new Error('--mode は prod・dev・hmr のいずれかでなければならない');
  if (!Number.isInteger(opts.reloads) || opts.reloads < 1) throw new Error('--reloads は正の整数でなければならない');
  if (!opts.label) opts.label = `${opts.mode}${opts.empty ? '-empty' : ''}`;
  return opts;
}

// ---- fixture library -------------------------------------------------------

const COLORS: Array<[number, number, number]> = [
  [244, 154, 194],
  [255, 191, 134],
  [250, 231, 140],
  [168, 228, 160],
  [137, 207, 240],
  [177, 156, 217],
];

// あえてサンドボックスのフィクスチャより大きくしてある: このプローブが探して
// いるのはデコードの残留物で、400x300 の png では20回のリロードでは見える
// ほどデコードされない。
function seedFixtures(configDir: string, saveFolder: string, count: number) {
  fs.mkdirSync(saveFolder, { recursive: true });
  const base = Date.UTC(2026, 0, 15, 12, 0, 0);
  const records: any[] = [];
  for (let i = 0; i < count; i++) {
    const captureId = `${base - i * 3600000}-p66${String(i).padStart(2, '0')}`;
    fs.writeFileSync(path.join(saveFolder, `${captureId}.png`), makePng(1600, 1200, COLORS[i % COLORS.length]));
    records.push({
      captureId,
      image: `${captureId}.png`,
      url: `https://example.com/probe66/${i}`,
      platform: 'x',
      text: `[${i + 1}/${count}] #66 reload probe fixture`,
      displayName: `probe66-${i + 1}`,
      screenName: `probe66_${i + 1}`,
      likes: i * 13,
      reposts: i * 3,
      replies: i,
      date: new Date(base - i * 3600000 - 7200000).toISOString(),
      capturedAt: new Date(base - i * 3600000).toISOString(),
      tags: ['probe66'],
    });
  }
  seedLibrary(configDir, records);
}

// ---- プロセスのサンプリング ------------------------------------------------

interface Proc {
  pid: number;
  ppid: number;
  name: string;
  priv: number;
  ws: number;
  type: string; // 'browser' | 'gpu-process' | 'renderer' | 'utility' | ...
}

// サンプルごとに CIM クエリを1回。CommandLine は、系譜ですでに選択済みの
// プロセスを「分類」するためだけに使い、選択のためには決して使わない。
function snapshotProcs(): Proc[] {
  const ps = `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Select-Object ProcessId,ParentProcessId,Name,PrivatePageCount,WorkingSetSize,CommandLine | ConvertTo-Json -Compress -Depth 2`;
  let out = '';
  try {
    out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch {
    return [];
  }
  let rows: any[] = [];
  try {
    const parsed = JSON.parse(out || '[]');
    rows = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
  return rows.filter(Boolean).map((r) => {
    const cmd = String(r.CommandLine || '');
    const m = cmd.match(/--type=([\w-]+)/);
    return {
      pid: Number(r.ProcessId),
      ppid: Number(r.ParentProcessId),
      name: String(r.Name),
      priv: Number(r.PrivatePageCount || 0),
      ws: Number(r.WorkingSetSize || 0),
      type: m ? m[1] : 'browser',
    } as Proc;
  });
}

// スナップショットの中で `root` の子孫であるもの、それに root 自身が
// electron.exe ならそれも含む。dev では起動した root は node（electron-vite）
// で、スナップショットには一切現れないが、その electron の子は解決できる。
// 親のたどりは electron の行だけでなく「全」プロセステーブルに対して歩くため。
//
// サンプルの「たびに」読み直し、決してキャッシュしない。リロードはレンダラー
// プロセスを置き換え得るので、マップを組んだ時点で存在しなかった pid は
// 親が一切解決されない — キャッシュしたマップは失敗する代わりに静かに
// 「renderer プロセス0個、0MB」と報告してしまい、これはリークプローブに
// おける偽陰性そのものの形。このスクリプトの最初の実行は、まさにその理由で
// renderer=0 を報告した。
function fullParentMap(): Map<number, number> {
  const ps = `Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress`;
  const map = new Map<number, number>();
  try {
    const parsed = JSON.parse(execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }) || '[]');
    for (const r of Array.isArray(parsed) ? parsed : [parsed]) map.set(Number(r.ProcessId), Number(r.ParentProcessId));
  } catch {
    /* 空のマップ＝呼び出し元は間違った数値ではなく「分からない」を報告する */
  }
  return map;
}

function descendsFrom(pid: number, root: number, parents: Map<number, number>): boolean {
  let cur = pid;
  for (let hops = 0; hops < 12; hops++) {
    if (cur === root) return true;
    const next = parents.get(cur);
    if (!next || next === cur || next === 0) return false;
    cur = next;
  }
  return false;
}

interface Sample {
  n: number;
  gpuPriv: number;
  gpuWs: number;
  mainPriv: number;
  rendererPriv: number;
  rendererCount: number;
  procCount: number;
  fps: number;
  jsHeap: number;
  nodes: number;
  listeners: number;
  documents: number;
}

// ---- CDP ---------------------------------------------------------------------

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

function pageTarget(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}/json/list`, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            const list = JSON.parse(body);
            const page = list.find((t: any) => t.type === 'page' && /index\.html|app:\/\//.test(t.url)) || list.find((t: any) => t.type === 'page');
            if (!page) return reject(new Error('page target が無い'));
            resolve(page.webSocketDebuggerUrl);
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', (e) => reject(new Error(`:${port} の CDP に到達できない (${e.message})`)));
  });
}

async function connect(port: number) {
  const ws = new WebSocket(await pageTarget(port), { maxPayload: 64 * 1024 * 1024 });
  let id = 0;
  const pending = new Map<number, { res: (v: any) => void; rej: (e: any) => void }>();
  const events = new Map<string, Array<() => void>>();
  // Vite クライアントがホットアップデートを適用したと報告した回数。HMR の
  // 腕は固定 sleep ではなくこのカウンタで前進するので、静かにホット
  // アップデート「しなかった」ステップ（フルページリロード、または HMR
  // エラー）は、「累積なし」のデータ点にひっそりと化けるのではなく、
  // タイムアウトとして現れる。
  const hot = { count: 0 };
  ws.on('message', (d: any) => {
    const m = JSON.parse(d);
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = (m.params?.args || []).map((a: any) => String(a?.value ?? '')).join(' ');
      if (/\[vite\].*(hot updated|hmr update)/i.test(text)) hot.count++;
    }
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id) as any;
      pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    } else if (m.method && events.has(m.method)) {
      const waiters = events.get(m.method) as Array<() => void>;
      events.set(m.method, []);
      for (const w of waiters) w();
    }
  });
  await new Promise((r) => ws.on('open', r));
  const send = (method: string, params?: any) =>
    new Promise<any>((res, rej) => {
      const mid = ++id;
      pending.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
    });
  const once = (method: string, ms: number) =>
    new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(false), ms);
      const list = events.get(method) || [];
      list.push(() => {
        clearTimeout(t);
        resolve(true);
      });
      events.set(method, list);
    });
  return { ws, send, once, hot };
}

const FPS_EXPR = `new Promise((r) => { let n = 0; const t0 = performance.now(); const tick = () => { n++; const dt = performance.now() - t0; if (dt < 1500) requestAnimationFrame(tick); else r(Math.round((n / dt) * 1000 * 10) / 10); }; requestAnimationFrame(tick); })`;

async function measure(cdp: any, n: number, root: number): Promise<Sample> {
  const parents = fullParentMap();
  const procs = snapshotProcs().filter((p) => descendsFrom(p.pid, root, parents));
  const sum = (t: string, k: 'priv' | 'ws') => procs.filter((p) => p.type === t).reduce((a, p) => a + p[k], 0);
  let fps = -1;
  try {
    const r = await cdp.send('Runtime.evaluate', { expression: FPS_EXPR, awaitPromise: true, returnByValue: true, timeout: 10000 });
    fps = Number(r?.result?.value ?? -1);
  } catch {
    /* -1 = 読めなかった。そのまま報告する */
  }
  let jsHeap = 0;
  try {
    jsHeap = Number((await cdp.send('Runtime.getHeapUsage'))?.usedSize || 0);
  } catch {
    /* 任意 */
  }
  let counters: Record<string, number> = {};
  try {
    const r = await cdp.send('Memory.getDOMCounters');
    counters = { nodes: r.nodes, listeners: r.jsEventListeners, documents: r.documents };
  } catch {
    /* 任意 */
  }
  return {
    n,
    gpuPriv: sum('gpu-process', 'priv'),
    gpuWs: sum('gpu-process', 'ws'),
    mainPriv: sum('browser', 'priv'),
    rendererPriv: sum('renderer', 'priv'),
    rendererCount: procs.filter((p) => p.type === 'renderer').length,
    procCount: procs.length,
    fps,
    jsHeap,
    nodes: counters.nodes || 0,
    listeners: counters.listeners || 0,
    documents: counters.documents || 0,
  };
}

// ---- 起動 ----------------------------------------------------------------

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryNth = (i: number) => {
      if (i >= PORT_SPAN) return reject(new Error('no free probe port'));
      const port = PORT_MIN + i;
      const srv = net.createServer();
      srv.once('error', () => tryNth(i + 1));
      srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(port)));
    };
    tryNth(0);
  });
}

// HMR の腕が編集するファイル: デフォルトのビューにマウントされている
// コンポーネントなので、ホットアップデートは毎回捨てられずに実際に何かを
// 再描画する。
const HMR_TARGET = path.join(appDir, 'src', 'renderer', 'src', 'grid', 'Grid.tsx');
const HMR_MARK = '// #66 probe marker';

function touchHmrTarget(original: string, i: number) {
  const body = original.replace(new RegExp(`\\n${HMR_MARK}.*$`), '');
  fs.writeFileSync(HMR_TARGET, `${body}\n${HMR_MARK} ${i}\n`);
}

function launch(opts: Options, port: number, env: NodeJS.ProcessEnv) {
  if (opts.mode === 'prod') {
    return spawn(resolveElectron(), ['.', `--remote-debugging-port=${port}`, ...NO_THROTTLE], { cwd: appDir, env, detached: true, stdio: 'ignore' });
  }
  // dev の腕は `npm run app:dev` を再現しなければならない。その
  // 最初の2ステップは theme-boot と native-host-bridge のビルドで —
  // electron-vite だけではそれらを作らず、無いとアプリは起動に失敗する。
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(npm, ['run', '_build:theme-boot', '--workspace=app'], { cwd: repoRoot, stdio: 'ignore', shell: process.platform === 'win32' });
  execFileSync(npm, ['run', '_build:native-host-bridge', '--workspace=app'], { cwd: repoRoot, stdio: 'ignore', shell: process.platform === 'win32' });
  // bin パスへの require.resolve ではなく、パッケージ自身の package.json 経由で
  // 解決する: electron-vite は `exports` を宣言しているので、そこに列挙されて
  // いないサブパス（bin/ はそこに無い）は、ファイルが実在しても
  // ERR_PACKAGE_PATH_NOT_EXPORTED を投げる。
  const cli = path.join(path.dirname(require.resolve('electron-vite/package.json', { paths: [repoRoot, appDir] })), 'bin', 'electron-vite.js');
  return spawn(process.execPath, [cli, 'dev', `--remoteDebuggingPort=${port}`, '--', ...NO_THROTTLE], { cwd: appDir, env, detached: true, stdio: 'ignore' });
}

// ---- レポート ------------------------------------------------------------

const mb = (b: number) => (b / (1024 * 1024)).toFixed(1);

function report(opts: Options, samples: Sample[]) {
  console.log('');
  console.log(`== #66 reload probe: ${opts.label}（${opts.reloads}回リロード）==`);
  console.log('  n | gpu priv | gpu ws  | main priv | rend priv | rend# | fps  | js heap | nodes | listeners | docs');
  for (const s of samples) {
    console.log(
      `${String(s.n).padStart(3)} | ${mb(s.gpuPriv).padStart(8)} | ${mb(s.gpuWs).padStart(7)} | ${mb(s.mainPriv).padStart(9)} | ${mb(s.rendererPriv).padStart(9)} | ${String(s.rendererCount).padStart(5)} | ${String(s.fps).padStart(4)} | ${mb(s.jsHeap).padStart(7)} | ${String(s.nodes).padStart(5)} | ${String(s.listeners).padStart(9)} | ${String(s.documents).padStart(4)}`,
    );
  }
  const first = samples[0];
  const last = samples[samples.length - 1];
  const delta = (k: keyof Sample) => Number(last[k]) - Number(first[k]);
  console.log('');
  console.log(`  ${samples.length - 1}回のリロードでの差分: gpu priv ${mb(delta('gpuPriv'))} MB, gpu ws ${mb(delta('gpuWs'))} MB, main priv ${mb(delta('mainPriv'))} MB, renderer priv ${mb(delta('rendererPriv'))} MB`);
  console.log(`  fps ${first.fps} -> ${last.fps} | documents ${first.documents} -> ${last.documents} | listeners ${first.listeners} -> ${last.listeners} | nodes ${first.nodes} -> ${last.nodes}`);
  console.log(`  リロード1回あたりの gpu priv: ${(delta('gpuPriv') / 1024 / (samples.length - 1)).toFixed(0)} KB`);
}

// ---- main ------------------------------------------------------------------

async function main() {
  const opts = parseOptions(process.argv.slice(2));
  const probeRoot = path.join(repoRoot, '.probe66', opts.label);
  const configDir = path.join(probeRoot, 'config');
  const saveFolder = path.join(probeRoot, 'library');
  const appData = path.join(probeRoot, 'appdata');
  fs.rmSync(probeRoot, { recursive: true, force: true });
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(appData, { recursive: true });
  fs.mkdirSync(saveFolder, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'testextensionidabcdefghijklmnop' }, null, 2));
  if (!opts.empty) seedFixtures(configDir, saveFolder, 24);

  const port = await findFreePort();
  const env = Object.assign({}, process.env, {
    APPDATA: appData,
    HOLOGRAM_CONFIG_DIR: configDir,
    HOLOGRAM_SANDBOX: '1',
    HOLOGRAM_START_INACTIVE: '1',
  });
  console.log(`${opts.mode} の腕を :${port} で起動（config ${configDir}, ${opts.empty ? 'empty library' : '24 posts'}）`);
  const child = launch(opts, port, env);
  child.unref();

  const up = await waitFor(`${opts.mode} の腕が :${port} で CDP に応答すること`, () => cdpReady(port), { timeoutMs: 60_000, pollMs: 300 }).then(
    () => true,
    () => false,
  );
  if (!up) {
    console.error('FAIL アプリが起動しなかった（CDP が一度も応答しなかった）');
    try {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      /* できる範囲で */
    }
    process.exit(1);
  }

  const root = child.pid as number;
  const cdp = await connect(port);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  // あえて固定時間: これはテストの待ちではなく「計測」の落ち着き。ベース
  // ラインを取る前に、最初の描画・初回のクエリ・サムネイルのデコードを
  // 終わらせておく — そうしないとリロード#1が起動処理を丸ごと吸収し、
  // リークのように見えてしまう。何らかの条件が成立した瞬間に終わらせると、
  // ベースラインが実行のたびに動いてしまい、このプローブにとってそれだけは
  // あってはならない。
  // biome-ignore lint/plugin: measurement settle — every run must start the same distance in
  await sleep(6000);

  const samples: Sample[] = [];
  samples.push(await measure(cdp, 0, root));
  const original = opts.mode === 'hmr' ? fs.readFileSync(HMR_TARGET, 'utf8') : '';
  let hotMissed = 0;
  try {
    for (let i = 1; i <= opts.reloads; i++) {
      if (opts.mode === 'hmr') {
        const before = cdp.hot.count;
        touchHmrTarget(original, i);
        const applied = await waitFor(`ステップ${i}のホットアップデートが適用されること`, () => cdp.hot.count > before, { timeoutMs: 15_000, pollMs: 250 }).then(
          () => true,
          () => false,
        );
        if (!applied) hotMissed++;
      } else {
        const loaded = cdp.once('Page.loadEventFired', 20000);
        await cdp.send('Page.reload', { ignoreCache: false });
        await loaded;
      }
      // 上のベースラインの落ち着きと同じ理由であえて固定時間: どのサンプルも
      // リロードから同じ距離だけ経った時点で取らなければ、系列は何も比較
      // できない。（ロード後のクエリ＋サムネイルのデコード / ホット
      // アップデート後の再描画）
      // biome-ignore lint/plugin: measurement settle — every sample must sit the same distance past its reload
      await sleep(2500);
      samples.push(await measure(cdp, i, root));
    }
  } finally {
    if (opts.mode === 'hmr') fs.writeFileSync(HMR_TARGET, original);
  }
  if (hotMissed) console.log(`  ⚠ ${opts.reloads}ステップ中${hotMissed}件がホットアップデートを一度も報告しなかった — それらの行は適用済み HMR アップデート以外の何かを計測している`);

  report(opts, samples);
  fs.writeFileSync(path.join(probeRoot, 'samples.json'), JSON.stringify({ label: opts.label, mode: opts.mode, empty: opts.empty, samples }, null, 2));
  console.log(`  raw: ${path.join(probeRoot, 'samples.json')}`);

  cdp.ws.close();
  if (!opts.keep) {
    try {
      execFileSync('taskkill', ['/PID', String(root), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      /* すでに消えている */
    }
  } else {
    console.log(`  インスタンスは起動したまま残した（pid ${root}, :${port}）— 止めるには: taskkill /PID ${root} /T /F`);
  }
}

main().catch((e) => {
  console.error(`FAIL ${e.stack || e.message}`);
  process.exit(1);
});
