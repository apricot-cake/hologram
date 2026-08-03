'use strict';

// The contract between main (lib-ml-runtime.ts) and the inference child
// (ml-worker.ts), plus the decisions that can be made without touching a native
// module. Everything here is pure so it is unit-testable without spawning a
// process or loading ONNX Runtime — the parts that cannot be (session creation,
// the native load itself) live in the worker.
//
// Design context: #831 (parent #98). The runtime deliberately exposes ONE
// generic "run a transformers.js pipeline" call rather than a method per
// feature: the four ML features (#48/#49/#50/#51) differ in task name and model,
// not in how a session is driven.

/** Which ONNX Runtime actually ended up behind transformers.js. */
export type MlBackend = 'onnxruntime-node' | 'onnxruntime-web-wasm';

export interface MlBackendChoice {
  backend: MlBackend;
  /** Why the native runtime was not used (null when it was). */
  nativeError: string | null;
  /** True when WASM was asked for rather than fallen back to. */
  forced: boolean;
}

/**
 * Pick the runtime from the outcome of probing onnxruntime-node.
 *
 * `forceWasm` exists for the acceptance check in #831 ("make the native load
 * fail on purpose and get the same numbers"): there is no supported way to
 * break a working native addon from the outside, so the switch is on our side.
 */
export function chooseMlBackend(opts: { forceWasm: boolean; nativeError: string | null }): MlBackendChoice {
  if (opts.forceWasm) return { backend: 'onnxruntime-web-wasm', nativeError: opts.nativeError, forced: true };
  if (opts.nativeError) return { backend: 'onnxruntime-web-wasm', nativeError: opts.nativeError, forced: false };
  return { backend: 'onnxruntime-node', nativeError: null, forced: false };
}

/**
 * Rewrite a path that resolved INSIDE app.asar to its unpacked twin.
 *
 * Needed for anything that is opened as a file rather than require()d: the
 * ONNX Runtime WASM binary is fetched by URL, and a file:// URL pointing into
 * the archive does not exist for the OS. Unpacked in a dev tree (no asar in the
 * path) this is the identity function.
 */
export function asarUnpackedPath(p: string): string {
  return p.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
}

/** A tensor as it crosses the process boundary (structured clone of a typed array is fine, but dims are not carried by it). */
export interface MlTensorValue {
  __mlTensor: true;
  type: string;
  dims: number[];
  data: number[];
}

function isTensorLike(v: any): boolean {
  return !!v && typeof v === 'object' && Array.isArray(v.dims) && typeof v.type === 'string' && ArrayBuffer.isView(v.data);
}

/**
 * Make a pipeline result structured-cloneable.
 *
 * transformers.js returns its own Tensor class for the embedding-shaped tasks
 * and plain objects/arrays for the rest. Class instances survive structured
 * clone as bare objects with their prototype stripped, which silently loses
 * `dims` accessors, so tensors are converted explicitly and everything else is
 * passed through.
 */
export function serializeMlResult(value: any): any {
  if (isTensorLike(value)) {
    return { __mlTensor: true, type: value.type, dims: Array.from(value.dims), data: Array.from(value.data as ArrayLike<number>) } satisfies MlTensorValue;
  }
  if (Array.isArray(value)) return value.map(serializeMlResult);
  if (ArrayBuffer.isView(value)) return Array.from(value as unknown as ArrayLike<number>);
  if (value && typeof value === 'object') {
    // Copy own enumerable props so nothing on the far side depends on a
    // prototype that structured clone would have dropped anyway.
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) out[k] = serializeMlResult(v);
    return out;
  }
  return value;
}

// --- Messages ---

export interface MlRunRequest {
  id: number;
  kind: 'run';
  /** transformers.js task name, e.g. 'feature-extraction'. */
  task: string;
  /** ABSOLUTE directory holding the model files. See lib-ml-runtime.ts for why it is not a repo id. */
  modelDir: string;
  /** Options handed to pipeline() (dtype, device overrides). */
  pipelineOptions?: Record<string, any>;
  input: any;
  /** Options handed to the pipeline call itself (pooling, normalize, ...). */
  callOptions?: Record<string, any>;
}

export interface MlPingRequest {
  id: number;
  kind: 'ping';
}

export type MlRequest = MlRunRequest | MlPingRequest;

export interface MlReadyMessage {
  kind: 'ready';
  choice: MlBackendChoice;
}

export interface MlLogMessage {
  kind: 'log';
  level: 'info' | 'warn' | 'error';
  message: string;
  data?: Record<string, any>;
}

export interface MlReplyMessage {
  kind: 'reply';
  id: number;
  ok: boolean;
  result?: any;
  error?: string;
  /** Wall-clock ms the worker spent on this request. */
  ms?: number;
}

export type MlChildMessage = MlReadyMessage | MlLogMessage | MlReplyMessage;
