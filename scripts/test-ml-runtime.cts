'use strict';

// #831の受け入れ条件: 実際のアプリの中で、1回のローカル推論をエンドツーエンドで確認する。
//
// サンドボックス化したElectron（HOLOGRAM_SMOKE＋mkdtempした設定ディレクトリ）を3回起動し、
// それぞれの実行が証明すべきことを確認する:
//   1. AI機能オフ  -> ランタイムはそもそも起動を拒否する
//   2. AI機能オン  -> onnxruntime-nodeがモデルを走らせ、その間もウィンドウは応答し続ける
//   3. 同上、HOLOGRAM_ML_FORCE_WASM=1付き -> WASMランタイムが同じ埋め込みを生成する
//
// 意図的にtest-app-*.ctsという名前にしていない＝初回はネットワークが要る（スモーク用の
// モデルはhuggingface.coから来る）ので、オフラインで毎晩走るrun-app-tests.ctsを
// サードパーティに依存させてしまうことになる。docs/testing.mdの「ネットワークが要る」
// グループに属する。
//
// 開発ツリーではなくPACKAGE済みビルドに対して走らせるには:
//   node scripts/test-ml-runtime.cts --exe app/dist/win-unpacked/Hologram.exe
//
//   node scripts/test-ml-runtime.cts

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

// #832の最初のレジストリエントリ: 小さく、寛容なライセンスで、#165（意味によるタグ
// マッチング）が使う予定のモデル。コミットに固定し、"main"には決して固定しない。
const MODEL_REPO = 'Xenova/all-MiniLM-L6-v2';
const MODEL_REV = '751bff37182d3f1213fa05d7196b954e230abad9';
const MODEL_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'];
// リポジトリの外、設定ディレクトリの外――これほど遅いダウンロードはworktreeの
// 入れ替わりを生き延びるべきであり、実際のライブラリや設定ディレクトリに着地しては
// 絶対にならない。
const MODEL_CACHE = path.join(os.tmpdir(), 'hologram-ml-smoke-models', ...MODEL_REPO.split('/').slice(0, -1), `${MODEL_REPO.split('/').pop()}@${MODEL_REV}`);

const exeArgIndex = process.argv.indexOf('--exe');
const packagedExe = exeArgIndex > -1 ? path.resolve(process.argv[exeArgIndex + 1]) : null;

async function ensureModel() {
  let downloaded = 0;
  for (const rel of MODEL_FILES) {
    const dest = path.join(MODEL_CACHE, rel);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const url = `https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REV}/${rel}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} を取得できませんでした: HTTP ${res.status}`);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    downloaded++;
  }
  if (downloaded) console.log(`${downloaded} 個のモデルファイルを ${MODEL_CACHE} へ取得しました`);
}

function runOnce(label: string, { aiEnabled, forceWasm }: { aiEnabled: boolean; forceWasm: boolean }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-ml-'));
  const configDir = path.join(tmp, 'Hologram');
  const saveFolder = path.join(tmp, 'saves');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(saveFolder, { recursive: true });
  const config: Record<string, any> = { saveFolder, extensionId: 'x' };
  if (aiEnabled) config.ai = { enabled: true };
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify(config));

  // runMlPipelineは<configDir>/models以外のモデルを拒否するので、スモーク用モデルは
  // 共有キャッシュから読むのではなく、この実行のサンドボックスへコピーする。
  const modelDir = path.join(configDir, 'models', ...MODEL_REPO.split('/').slice(0, -1), `${MODEL_REPO.split('/').pop()}@${MODEL_REV}`);
  fs.cpSync(MODEL_CACHE, modelDir, { recursive: true });

  const env: Record<string, any> = Object.assign({}, process.env, {
    APPDATA: tmp,
    HOLOGRAM_CONFIG_DIR: configDir,
    HOLOGRAM_SMOKE: '1',
    HOLOGRAM_ML_SMOKE_MODEL: modelDir,
  });
  if (forceWasm) env.HOLOGRAM_ML_FORCE_WASM = '1';
  else delete env.HOLOGRAM_ML_FORCE_WASM;

  const t0 = Date.now();
  const r = packagedExe ? spawnSync(packagedExe, [], { env, encoding: 'utf8', timeout: 180000 }) : spawnSync(resolveElectron(), ['.'], { cwd: appDir, env, encoding: 'utf8', timeout: 180000 });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  fs.rmSync(tmp, { recursive: true, force: true });

  const okLine = /^ML_SMOKE_RESULT (.*)$/m.exec(out);
  const errLine = /^ML_SMOKE_ERR (.*)$/m.exec(out);
  console.log(`--- ${label} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  if (okLine) console.log(`    ${okLine[1]}`);
  if (errLine) console.log(`    エラー: ${errLine[1]}`);
  if (!okLine && !errLine) console.log(out.trim().split(/\r?\n/).slice(-12).join('\n').replace(/^/gm, '    '));
  return { report: okLine ? JSON.parse(okLine[1]) : null, error: errLine ? errLine[1] : null };
}

(async () => {
  await ensureModel();

  const gated = runOnce('AI機能オフ', { aiEnabled: false, forceWasm: false });
  const native = runOnce('native (onnxruntime-node)', { aiEnabled: true, forceWasm: false });
  const wasm = runOnce('強制WASM (onnxruntime-web)', { aiEnabled: true, forceWasm: true });

  const checks: Array<[string, boolean]> = [
    ['ai.enabledが未設定の間、ゲートが推論をブロックする', !gated.report && /not enabled/i.test(gated.error || '')],
    ['nativeバックエンドがモデルを走らせた', native.report?.backend === 'onnxruntime-node'],
    ['埋め込みが期待どおりの形をしている', JSON.stringify(native.report?.dims) === '[1,384]'],
    ['wasmバックエンドがモデルを走らせた', wasm.report?.backend === 'onnxruntime-web-wasm'],
    ['両バックエンドの埋め込みが一致する', !!native.report && JSON.stringify(native.report.head) === JSON.stringify(wasm.report?.head)],
    // 推論をutilityProcessに置いている理由そのもの。250msは実測したアイドル時の数値を
    // はるかに上回り、mainスレッドがブロックされたときの数値をはるかに下回る。
    ['native推論中もmainが応答し続けた', (native.report?.maxLoopLagMs ?? 1e9) < 250],
    ['native推論中もレンダラーのIPCが応答し続けた', (native.report?.maxIpcRoundTripMs ?? 1e9) < 250],
  ];

  console.log('');
  for (const [name, ok] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
  const pass = checks.every(([, ok]) => ok);
  console.log(pass ? 'ML_RUNTIME_TEST_PASS' : 'ML_RUNTIME_TEST_FAIL');
  process.exit(pass ? 0 : 1);
})().catch((err) => {
  console.error('ML_RUNTIME_TEST_FAIL', err && err.stack ? err.stack : err);
  process.exit(1);
});
