// 私用の固定版と通常版の起動。アプリの配布ファイルには含めない。
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const { z } = require('zod');
const { waitFor } = require('./lib-wait.cts');

const root = path.resolve(__dirname, '..');
const localRoot = path.join(root, '.local-app');
const manifestFile = path.join(localRoot, 'fixed.json');
const Manifest = z.object({ directory: z.string().regex(/^fixed-[0-9a-f-]{36}$/), electron: z.string(), schemaVersion: z.number().int().positive(), createdAt: z.iso.datetime() });

function personalEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('HOLOGRAM_') || key === 'ELECTRON_RUN_AS_NODE' || key === 'ELECTRON_RENDERER_URL' || key === 'ELECTRON_ENTRY' || key === 'NODE_OPTIONS') delete env[key];
  }
  return env;
}

function snapshotPath(directory: string) {
  if (!/^fixed-[0-9a-f-]{36}$/.test(directory)) throw new Error('固定版の保存先が不正です');
  return path.join(localRoot, directory);
}

function fixedManifest() {
  if (!fs.existsSync(manifestFile)) return null;
  return Manifest.parse(JSON.parse(fs.readFileSync(manifestFile, 'utf8')));
}

function fixedRuntime(manifest = fixedManifest()) {
  if (!manifest) throw new Error('固定版がありません。「固定版を作り直す」を実行してください。');
  const directory = snapshotPath(manifest.directory);
  const exe = path.resolve(directory, manifest.electron);
  if (!exe.startsWith(`${directory}${path.sep}`)) throw new Error('固定版の実行ファイルが保存先の外にあります');
  return { exe, app: path.join(directory, 'app'), schemaVersion: manifest.schemaVersion };
}

function developmentRuntime() {
  return { exe: require('./lib-electron-path.cts').electronPath(), app: path.join(root, 'app'), schemaVersion: require('../app/src/main/lib-db-schema.ts').SCHEMA_VERSION };
}

function fixedRunning() {
  const manifest = fixedManifest();
  if (!manifest) return false;
  const { exe } = fixedRuntime(manifest);
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process -Filter "Name=\'electron.exe\'" | Select-Object ExecutablePath,CommandLine | ConvertTo-Json -Compress'], { encoding: 'utf8', windowsHide: true });
  const records = JSON.parse(output.trim() || '[]');
  return (Array.isArray(records) ? records : [records]).some((p) => p.ExecutablePath?.toLowerCase() === exe.toLowerCase() && !String(p.CommandLine).includes('--type='));
}

function verificationTarget(fixedActive: boolean) {
  return fixedActive ? 'sandbox' : 'development';
}

function assertSchema(actual: number, expected: number) {
  if (actual !== expected) throw new Error(`ライブラリのDB形式が固定版と異なります（現在 ${actual}、固定版 ${expected}）。固定版を作り直してください。`);
}

function checkFixedLibrary(expected: number) {
  const { configDir, defaultLibraryDir } = require('../native-host/paths.mts');
  const config = JSON.parse(fs.readFileSync(path.join(configDir(), 'config.json'), 'utf8'));
  const file = path.join(config.saveFolder || defaultLibraryDir(), 'hologram.db');
  if (!fs.existsSync(file)) return;
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    assertSchema(Number(db.prepare('PRAGMA user_version').get().user_version), expected);
  } finally {
    db.close();
  }
}

async function stopPersonal(runtime: { exe: string; app: string }) {
  await waitFor(
    'アプリの処理完了と正常終了',
    () => {
      const r = spawnSync(runtime.exe, [runtime.app, '--hologram-quit'], { env: personalEnv(), windowsHide: true, stdio: 'ignore', timeout: 10_000 });
      if (r.status === 0) return true;
      if (r.status !== 3) throw new Error('アプリの正常終了を確認できませんでした');
      return false;
    },
    { timeoutMs: 120_000, pollMs: 500 },
  );
}

async function launch(runtime: { exe: string; app: string }, inactive = false) {
  if (!fs.existsSync(runtime.exe) || !fs.existsSync(path.join(runtime.app, 'out/main/index.js'))) throw new Error('起動に必要なファイルがありません');
  const env = personalEnv();
  if (inactive) env.HOLOGRAM_START_INACTIVE = '1';
  const child = spawn(runtime.exe, [runtime.app, '--remote-debugging-port=9222'], { env, detached: true, windowsHide: true, stdio: 'ignore' });
  let failure: Error | undefined;
  child.on('error', (error) => {
    failure = error;
  });
  child.unref();
  await waitFor(
    'アプリの起動',
    async () => {
      if (failure) throw failure;
      try {
        return (await fetch('http://127.0.0.1:9222/json/version', { signal: AbortSignal.timeout(1000) })).ok;
      } catch {
        return false;
      }
    },
    { timeoutMs: 30_000, pollMs: 250 },
  );
  return child.pid;
}

async function switchPersonal(target: 'fixed' | 'development') {
  const active = fixedRunning();
  const runtime = target === 'fixed' ? fixedRuntime() : developmentRuntime();
  if (target === 'fixed') checkFixedLibrary(runtime.schemaVersion);
  if ((target === 'fixed') !== active) await stopPersonal(active ? fixedRuntime() : developmentRuntime());
  // 終了処理で最後の書き込みが完了した後にも確認する。
  if (target === 'fixed') checkFixedLibrary(runtime.schemaVersion);
  await launch(runtime, true);
  console.log(`${target === 'fixed' ? '固定版' : '開発版'}を起動しました。CDP: http://127.0.0.1:9222`);
}

async function verify() {
  if (verificationTarget(fixedRunning()) === 'sandbox') {
    console.log('固定版を使用中のため、検証には別のテスト用ライブラリを使います。');
    const child = spawn(process.execPath, [path.join(__dirname, 'sandbox-app.cts'), 'start'], { cwd: root, env: personalEnv(), windowsHide: true, stdio: 'inherit' });
    await new Promise<void>((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`検証用アプリの起動に失敗しました: ${code}`))));
    });
  } else {
    await launch(developmentRuntime(), true);
    console.log('普段のライブラリを使う開発版です。CDP: http://127.0.0.1:9222');
  }
}

function freeze() {
  if (fixedRunning()) throw new Error('固定版を使用中です。固定版を終了してから作り直してください。');
  const directory = `fixed-${randomUUID()}`;
  const dest = snapshotPath(directory);
  const lock = fs.openSync(path.join(root, 'app', '.deploy-lock'), 'wx');
  try {
    fs.mkdirSync(dest, { recursive: true });
    const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    execFileSync(process.execPath, [npmCli, 'run', 'build', '--workspace', 'app', '--', '--mode', 'local-fixed'], {
      cwd: root,
      env: { ...personalEnv(), HOLOGRAM_APP_BUILD_OUT: path.join(dest, 'app/out') },
      windowsHide: true,
      stdio: 'inherit',
    });
    // 実行中に読むソースと依存もコピーする。開発ツリーへのリンクは作らない。
    for (const item of ['package.json', 'native-host', 'app/package.json', 'app/src', 'app/assets', 'node_modules', 'app/node_modules']) {
      const source = path.join(root, item);
      if (!fs.existsSync(source)) continue;
      fs.cpSync(source, path.join(dest, item), { recursive: true, dereference: true, filter: (p) => !['.cache', '.bin'].includes(path.basename(p)) && p !== path.join(root, 'node_modules/hologram-app') });
    }
    const electron = path.relative(root, developmentRuntime().exe);
    if (!fs.existsSync(path.join(dest, electron))) throw new Error('Electronのコピーがありません');
    const { SCHEMA_VERSION } = require('../app/src/main/lib-db-schema.ts');
    const manifest = Manifest.parse({ directory, electron, schemaVersion: SCHEMA_VERSION, createdAt: new Date().toISOString() });
    fs.writeFileSync(`${manifestFile}.tmp`, JSON.stringify(manifest, null, 2));
    fs.renameSync(`${manifestFile}.tmp`, manifestFile);
    console.log(`固定版を作成しました: ${dest}`);
  } catch (error) {
    if (fixedManifest()?.directory !== directory) fs.rmSync(snapshotPath(directory), { recursive: true, force: true });
    throw error;
  } finally {
    fs.closeSync(lock);
    fs.unlinkSync(path.join(root, 'app', '.deploy-lock'));
  }
}

function installBookmarks() {
  fs.mkdirSync(localRoot, { recursive: true });
  const programs = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); [Environment]::GetFolderPath("Programs")'], { encoding: 'utf8', windowsHide: true }).trim();
  if (!programs) throw new Error('スタートメニューの場所を取得できません');
  fs.mkdirSync(programs, { recursive: true });
  const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
  for (const [name, action] of [
    ['Hologram 固定版', 'fixed'],
    ['Hologram 開発版', 'development'],
    ['Hologram 固定版を作り直す', 'freeze'],
  ]) {
    const script = path.join(localRoot, `${name}.ps1`);
    const log = path.join(localRoot, `${action}.log`);
    fs.writeFileSync(
      script,
      `\ufeff[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)\n& ${quote(process.execPath)} ${quote(__filename)} ${quote(action)} *> ${quote(log)}\nif ($LASTEXITCODE -ne 0) { Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show((Get-Content -LiteralPath ${quote(log)} -Tail 12 | Out-String), 'Hologram') | Out-Null }\n`,
      'utf8',
    );
    const link = path.join(localRoot, `${name}.lnk`);
    const psExe = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const args = `-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${script}"`;
    execFileSync(psExe, ['-NoProfile', '-NonInteractive', '-Command', `$s=(New-Object -ComObject WScript.Shell).CreateShortcut(${quote(link)});$s.TargetPath=${quote(psExe)};$s.Arguments=${quote(args)};$s.WorkingDirectory=${quote(root)};$s.Save()`], { windowsHide: true });
    if (action !== 'freeze') {
      const startMenuLink = path.join(programs, `${name}.lnk`);
      fs.copyFileSync(link, startMenuLink);
      console.log(startMenuLink);
    } else {
      console.log(link);
    }
  }
}

async function main(action: string) {
  if (process.platform !== 'win32') throw new Error('この私用ランチャーはWindows用です');
  if (action === 'freeze') freeze();
  else if (action === 'fixed' || action === 'development') await switchPersonal(action);
  else if (action === 'verify') await verify();
  else if (action === 'bookmarks') installBookmarks();
  else if (action === 'status') console.log(JSON.stringify({ fixedActive: fixedRunning(), fixed: fixedManifest() }));
  else throw new Error('使い方: local-app.cts freeze | fixed | development | verify | bookmarks | status');
}

module.exports = { personalEnv, snapshotPath, verificationTarget, assertSchema };
if (require.main === module)
  main(process.argv[2]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
