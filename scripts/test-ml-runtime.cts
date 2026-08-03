'use strict';

// #831 acceptance: one local inference, end to end, in the real app.
//
// Boots the sandboxed Electron (HOLOGRAM_SMOKE + a mkdtemp config dir) three
// times and checks what each run is supposed to prove:
//   1. AI features off  -> the runtime refuses to start at all
//   2. AI features on   -> onnxruntime-node runs the model, the window keeps
//                          answering while it does
//   3. same, with HOLOGRAM_ML_FORCE_WASM=1 -> the WASM runtime produces the
//                          SAME embedding
//
// NOT named test-app-*.cts on purpose: it needs the network the first time (the
// smoke model comes from huggingface.co) and would make run-app-tests.cts —
// which is offline and runs nightly — depend on a third party. It belongs to
// the "needs network" group in docs/testing.md.
//
// To run against a PACKAGED build instead of the dev tree:
//   node scripts/test-ml-runtime.cts --exe app/dist/win-unpacked/Hologram.exe
//
//   node scripts/test-ml-runtime.cts

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

// The first registry entry of #832: small, permissively licensed, and the model
// #165 (tag matching by meaning) will use. Pinned to a commit, never "main".
const MODEL_REPO = 'Xenova/all-MiniLM-L6-v2';
const MODEL_REV = '751bff37182d3f1213fa05d7196b954e230abad9';
const MODEL_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'];
// Outside the repo and outside ~/.hologram: a download this slow should survive
// worktree churn, and it must never land in the real library or config dir.
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
    if (!res.ok) throw new Error(`could not fetch ${url}: HTTP ${res.status}`);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    downloaded++;
  }
  if (downloaded) console.log(`fetched ${downloaded} model file(s) into ${MODEL_CACHE}`);
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

  // runMlPipeline refuses a model outside <configDir>/models, so the smoke model
  // is copied into this run's sandbox rather than read from the shared cache.
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
  if (errLine) console.log(`    error: ${errLine[1]}`);
  if (!okLine && !errLine) console.log(out.trim().split(/\r?\n/).slice(-12).join('\n').replace(/^/gm, '    '));
  return { report: okLine ? JSON.parse(okLine[1]) : null, error: errLine ? errLine[1] : null };
}

(async () => {
  await ensureModel();

  const gated = runOnce('AI features off', { aiEnabled: false, forceWasm: false });
  const native = runOnce('native (onnxruntime-node)', { aiEnabled: true, forceWasm: false });
  const wasm = runOnce('forced WASM (onnxruntime-web)', { aiEnabled: true, forceWasm: true });

  const checks: Array<[string, boolean]> = [
    ['gate blocks inference while ai.enabled is unset', !gated.report && /not enabled/i.test(gated.error || '')],
    ['native backend ran the model', native.report?.backend === 'onnxruntime-node'],
    ['embedding has the expected shape', JSON.stringify(native.report?.dims) === '[1,384]'],
    ['wasm backend ran the model', wasm.report?.backend === 'onnxruntime-web-wasm'],
    ['both backends agree on the embedding', !!native.report && JSON.stringify(native.report.head) === JSON.stringify(wasm.report?.head)],
    // The whole reason inference is in a utilityProcess. 250ms is far above the
    // observed idle numbers and far below what a blocked main thread produces.
    ['main stayed responsive during native inference', (native.report?.maxLoopLagMs ?? 1e9) < 250],
    ['renderer IPC stayed responsive during native inference', (native.report?.maxIpcRoundTripMs ?? 1e9) < 250],
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
