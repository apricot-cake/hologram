'use strict';

// 推論の子プロセスを main 側で所有するもの（#831、親 #98）。遅延起動し、
// 1つだけ保持し、そのメッセージを Promise とログ行に変える。
//
// このモジュールが意図してやらないこと。#98 の別の段階が所有するため:
//   - モデルファイルの取得や検証（#832）。呼び出し元は「絶対」ディレクトリを
//     渡す。このモジュールは modelsRoot() の外を見ることを拒むだけ。
//   - 結果の保存（#833）、仕事のスケジューリング（#834）、レンダラーの画面や
//     設定 UI（#830）。
//
// モデルは Hugging Face のリポジトリ id ではなくディレクトリで指定する。
// これは意図的: transformers.js は、自身のリポジトリ id の形に一致する id に
// 対してだけ env.localModelPath を結合し、#98 が config ディレクトリの
// models/ 用に選んだ `<modelId>@<rev>` というレイアウトはそれに一致しない
// （'@' がそのチェックに落ちる）ので、id は代わりに CWD に対して解決されて
// しまう。絶対パスならそのルールを丸ごと回避でき、命名の方式は #832 に
// 任せられる。

import { utilityProcess, type UtilityProcess } from 'electron';
import log from 'electron-log/main';
import path from 'node:path';

import { configDir } from './native-host.ts';
import { readConfig } from './lib-config.ts';
import type { MlBackendChoice, MlChildMessage, MlRequest, MlSessionFeed, MlTensorValue } from './lib-ml-protocol.ts';

/** モデルマネージャ（#832）がモデルを置く場所。マシンローカルで、保存フォルダの内側には決して置かない。 */
export function modelsRoot(): string {
  return path.join(configDir(), 'models');
}

/**
 * AI オプトインのゲート。
 *
 * 設定と UI は #830 が所有する。ここはそれが書くフラグを読み、利用者が
 * 「はい」と言う前にどんなモデルも読み込まれないようにする。設定が無ければ
 * 無効なので、#830 より前のすべてのビルドでは、このゲートは既に閉じている。
 */
export function aiFeaturesEnabled(): boolean {
  try {
    return readConfig().ai?.enabled === true;
  } catch {
    return false;
  }
}

export type MlRuntimeState = 'stopped' | 'starting' | 'ready' | 'failed';

export interface MlRuntimeStatus {
  state: MlRuntimeState;
  backend: MlBackendChoice['backend'] | null;
  /** ネイティブランタイムが使われなかった理由（使われた時、または何も起動していない時は null）。 */
  nativeError: string | null;
  forcedWasm: boolean;
}

interface Pending {
  resolve(v: any): void;
  reject(e: Error): void;
  timer: NodeJS.Timeout;
}

let child: UtilityProcess | null = null;
let startPromise: Promise<MlRuntimeStatus> | null = null;
let status: MlRuntimeStatus = { state: 'stopped', backend: null, nativeError: null, forcedWasm: false };
let nextId = 1;
const pending = new Map<number, Pending>();

// セッションの読み込みは数十 MB を読む（WASM バックエンドではさらに展開する）
// ので、最初の呼び出しは遅くてよい。ただし固まった子プロセスはそれでも
// 終わらせなければならない。
const REQUEST_TIMEOUT_MS = Number(process.env.HOLOGRAM_ML_TIMEOUT_MS || 120000);
const START_TIMEOUT_MS = 30000;

export function mlRuntimeStatus(): MlRuntimeStatus {
  return { ...status };
}

function workerPath(): string {
  // __dirname は開発ビルドでもパッケージ済みアプリでも out/main。
  // electron-vite がこのエントリを index.js の隣に出力するため
  // （electron.vite.config.ts）。
  return path.join(__dirname, 'ml-worker.js');
}

function failAllPending(reason: string) {
  for (const [, p] of pending) {
    clearTimeout(p.timer);
    p.reject(new Error(reason));
  }
  pending.clear();
}

function onChildMessage(msg: MlChildMessage, settle: (s: MlRuntimeStatus) => void) {
  if (msg.kind === 'log') {
    log[msg.level]?.(`[ml] ${msg.message}`, msg.data ?? {});
    return;
  }
  if (msg.kind === 'ready') {
    status = { state: 'ready', backend: msg.choice.backend, nativeError: msg.choice.nativeError, forcedWasm: msg.choice.forced };
    if (msg.choice.nativeError) {
      // このフォールバックの要点は、それが黙って起きないこと（#831）。
      log.warn('[ml] onnxruntime-node did not load; falling back to the WASM runtime', { error: msg.choice.nativeError });
    } else if (msg.choice.forced) {
      log.info('[ml] WASM runtime forced by HOLOGRAM_ML_FORCE_WASM');
    }
    log.info('[ml] runtime ready', { backend: msg.choice.backend });
    settle(mlRuntimeStatus());
    return;
  }
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  clearTimeout(p.timer);
  if (msg.ok) p.resolve(msg.result);
  else p.reject(new Error(msg.error || 'inference failed'));
}

/**
 * まだ起動していなければ子プロセスを起動する。AI 機能が無効な時は reject
 * する——このゲートを呼び出し箇所ごとにではなくここに置くのは、将来のどの
 * 呼び出し元もこれを忘れられないようにするため。
 */
export function startMlRuntime(opts: { skipGate?: boolean } = {}): Promise<MlRuntimeStatus> {
  if (!opts.skipGate && !aiFeaturesEnabled()) return Promise.reject(new Error('AI features are not enabled'));
  if (startPromise) return startPromise;
  status = { state: 'starting', backend: null, nativeError: null, forcedWasm: false };
  startPromise = new Promise<MlRuntimeStatus>((resolve, reject) => {
    let settled = false;
    const settle = (s: MlRuntimeStatus) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(s);
    };
    const die = (err: Error) => {
      status = { state: 'failed', backend: null, nativeError: err.message, forcedWasm: false };
      failAllPending(err.message);
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      startPromise = null;
      reject(err);
    };
    const timer = setTimeout(() => die(new Error('the inference process did not report ready')), START_TIMEOUT_MS);

    const proc = utilityProcess.fork(workerPath(), [], {
      serviceName: 'hologram-ml',
      // stdout/stderr は ONNX Runtime 自身の診断情報。これをアプリのログへ
      // 流すことが、ネイティブの読み込み問題を事後に見える唯一の手段。
      stdio: 'pipe',
      env: { ...process.env, HOLOGRAM_ML_MODELS_ROOT: modelsRoot() },
    });
    child = proc;
    proc.stdout?.on('data', (d) => log.info(`[ml:out] ${String(d).trimEnd()}`));
    proc.stderr?.on('data', (d) => log.warn(`[ml:err] ${String(d).trimEnd()}`));
    proc.on('message', (msg: MlChildMessage) => onChildMessage(msg, settle));
    proc.on('exit', (code) => {
      child = null;
      startPromise = null;
      failAllPending(`the inference process exited (code ${code})`);
      if (status.state !== 'failed') status = { state: 'stopped', backend: null, nativeError: null, forcedWasm: false };
      log.info('[ml] runtime exited', { code });
      if (!settled) die(new Error(`the inference process exited before it was ready (code ${code})`));
    });
  });
  return startPromise;
}

export function stopMlRuntime(): void {
  const proc = child;
  child = null;
  startPromise = null;
  failAllPending('the inference process was stopped');
  status = { state: 'stopped', backend: null, nativeError: null, forcedWasm: false };
  proc?.kill();
}

function send(req: MlRequest): Promise<any> {
  if (!child) return Promise.reject(new Error('the inference process is not running'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(req.id);
      reject(new Error(`inference timed out after ${REQUEST_TIMEOUT_MS}ms`));
    }, REQUEST_TIMEOUT_MS);
    pending.set(req.id, { resolve, reject, timer });
    child?.postMessage(req);
  });
}

export interface RunMlPipelineOptions {
  task: string;
  /** modelsRoot() の下の絶対ディレクトリ。 */
  modelDir: string;
  input: any;
  pipelineOptions?: Record<string, any>;
  callOptions?: Record<string, any>;
  /** テスト／検証専用: #830 のオプトインチェック無しで実行する。 */
  skipGate?: boolean;
}

/**
 * このモジュールが課す唯一の封じ込め規則: 呼び出し元は、モデルマネージャ
 * （#832）が所有するディレクトリしか指せない。両方の経路で共有することで、
 * 素のセッションの経路（#50）が、パイプラインの経路が届けない場所へ届く
 * ことはない。
 */
function checkedModelDir(modelDir: string, skipGate: boolean | undefined): string {
  const dir = path.resolve(modelDir);
  const root = path.resolve(modelsRoot());
  if (!skipGate && dir !== root && !dir.startsWith(root + path.sep)) {
    throw new Error(`model directory is outside ${root}`);
  }
  return dir;
}

/** 子プロセス内で transformers.js のパイプライン呼び出しを1回実行する。必要なら起動する。 */
export async function runMlPipeline(opts: RunMlPipelineOptions): Promise<any> {
  await startMlRuntime({ skipGate: opts.skipGate });
  const dir = checkedModelDir(opts.modelDir, opts.skipGate);
  return send({ id: nextId++, kind: 'run', task: opts.task, modelDir: dir, input: opts.input, pipelineOptions: opts.pipelineOptions, callOptions: opts.callOptions });
}

export interface RunMlSessionOptions {
  /** modelsRoot() の下の絶対ディレクトリ。 */
  modelDir: string;
  /** その中のグラフファイル。例: 'model.onnx'。 */
  modelFile: string;
  feeds: Record<string, MlSessionFeed>;
  /** テスト／検証専用: #830 のオプトインチェック無しで実行する。 */
  skipGate?: boolean;
}

/**
 * 子プロセス内で素の ONNX グラフを1回実行する。この経路がそもそもなぜ存在
 * するかは MlSessionRequest 参照——すべてが
 * transformers.js を通る」に対する例外であって、同じことをする2つ目の方法
 * ではない。
 */
export async function runMlSession(opts: RunMlSessionOptions): Promise<Record<string, MlTensorValue>> {
  await startMlRuntime({ skipGate: opts.skipGate });
  const dir = checkedModelDir(opts.modelDir, opts.skipGate);
  return send({ id: nextId++, kind: 'session', modelDir: dir, modelFile: opts.modelFile, feeds: opts.feeds });
}

/** モデルに触れずに子プロセスと1往復する——セッションの実行中も応答していることを示すのに使う。 */
export async function pingMlRuntime(): Promise<any> {
  return send({ id: nextId++, kind: 'ping' });
}
