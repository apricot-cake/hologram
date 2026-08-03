'use strict';

// Main-side owner of the inference child (#831, parent #98). Starts it lazily,
// keeps one of them, turns its messages into promises and log lines.
//
// What this module deliberately does NOT do, because another stage of #98 owns it:
//   - fetching or verifying model files (#832). Callers hand over an ABSOLUTE
//     directory; this module only refuses to look outside modelsRoot().
//   - storing results (#833), scheduling work (#834), any renderer surface or
//     settings UI (#830).
//
// Models are addressed by directory rather than by Hugging Face repo id on
// purpose: transformers.js only joins env.localModelPath for ids that match its
// repo-id shape, and the `<modelId>@<rev>` layout #98 chose for
// ~/.hologram/models does not (the '@' fails the check), so an id would be
// resolved against the CWD instead. An absolute path skips that rule entirely
// and leaves the naming scheme to #832.

import { utilityProcess, type UtilityProcess } from 'electron';
import log from 'electron-log/main';
import path from 'node:path';

import { configDir } from './native-host.ts';
import { readConfig } from './lib-config.ts';
import type { MlBackendChoice, MlChildMessage, MlRequest } from './lib-ml-protocol.ts';

/** Where the model manager (#832) puts models. Machine-local, never inside the save folder. */
export function modelsRoot(): string {
  return path.join(configDir(), 'models');
}

/**
 * The AI opt-in gate.
 *
 * #830 owns the setting and the UI; this reads the flag it writes so that no
 * model can be loaded before the user has said yes. Absent config = off, so the
 * gate is already closed for every build that predates #830.
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
  /** Why the native runtime was not used (null when it was, or when nothing has started). */
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

// Loading a session reads (and for the WASM backend decompresses) tens of MB, so
// the first call is allowed to be slow; a wedged child still has to end.
const REQUEST_TIMEOUT_MS = Number(process.env.HOLOGRAM_ML_TIMEOUT_MS || 120000);
const START_TIMEOUT_MS = 30000;

export function mlRuntimeStatus(): MlRuntimeStatus {
  return { ...status };
}

function workerPath(): string {
  // __dirname is out/main in both the dev build and the packaged app, because
  // electron-vite emits this entry beside index.js (electron.vite.config.ts).
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
      // The whole point of the fallback is that it is not silent (#831).
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
 * Start the child if it is not already up. Rejects when the AI features are off
 * — the gate is here rather than at every call site so that no future caller can
 * forget it.
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
      // stdout/stderr are ONNX Runtime's own diagnostics; routing them into the
      // app log is the only way a native load problem is visible after the fact.
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
  /** Absolute directory under modelsRoot(). */
  modelDir: string;
  input: any;
  pipelineOptions?: Record<string, any>;
  callOptions?: Record<string, any>;
  /** Test/verification only: run without the #830 opt-in check. */
  skipGate?: boolean;
}

/** Run one transformers.js pipeline call in the child, starting it if needed. */
export async function runMlPipeline(opts: RunMlPipelineOptions): Promise<any> {
  await startMlRuntime({ skipGate: opts.skipGate });
  const dir = path.resolve(opts.modelDir);
  const root = path.resolve(modelsRoot());
  if (!opts.skipGate && dir !== root && !dir.startsWith(root + path.sep)) {
    throw new Error(`model directory is outside ${root}`);
  }
  return send({ id: nextId++, kind: 'run', task: opts.task, modelDir: dir, input: opts.input, pipelineOptions: opts.pipelineOptions, callOptions: opts.callOptions });
}

/** Round trip to the child without touching a model — used to show it is answering while a session runs. */
export async function pingMlRuntime(): Promise<any> {
  return send({ id: nextId++, kind: 'ping' });
}
