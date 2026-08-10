'use strict';

// main（lib-ml-runtime.ts）と推論の子プロセス（ml-worker.ts）の間の取り決めと、ネイティブの
// モジュールに触れずに下せる判断。ここのものは全部純粋なので、プロセスを起こしたり ONNX Runtime
// を読み込んだりせずに単体テストできる＝そうできない部分（セッションの生成、ネイティブの読み込み
// そのもの）はワーカーにある。
//
// 設計の背景は #831（親は #98）。ランタイムは機能ごとのメソッドではなく、意図して汎用の
//「transformers.js のパイプラインを走らせる」呼び出しを1つだけ公開する。4つの ML の機能
// （#48/#49/#50/#51）が違うのはタスク名とモデルであって、セッションの動かし方ではない。

/** transformers.js の裏に実際に収まった ONNX Runtime。 */
export type MlBackend = 'onnxruntime-node' | 'onnxruntime-web-wasm';

export interface MlBackendChoice {
  backend: MlBackend;
  /** ネイティブのランタイムを使わなかった理由（使ったときは null）。 */
  nativeError: string | null;
  /** 代わりに使ったのではなく、WASM を求められた場合に true。 */
  forced: boolean;
}

/**
 * onnxruntime-node へ問い合わせた結果からランタイムを選ぶ。
 *
 * `forceWasm` は #831 の受け入れ確認（「ネイティブの読み込みをわざと失敗させて同じ数値を得る」）
 * のために在る。外から、動いているネイティブのアドオンを壊す正規の手段は無いので、切り替えは
 * こちら側に置く。
 */
export function chooseMlBackend(opts: { forceWasm: boolean; nativeError: string | null }): MlBackendChoice {
  if (opts.forceWasm) return { backend: 'onnxruntime-web-wasm', nativeError: opts.nativeError, forced: true };
  if (opts.nativeError) return { backend: 'onnxruntime-web-wasm', nativeError: opts.nativeError, forced: false };
  return { backend: 'onnxruntime-node', nativeError: null, forced: false };
}

/**
 * app.asar の中に解決したパスを、展開済みの双子の方へ書き換える。
 *
 * require() ではなくファイルとして開かれるものに必要。ONNX Runtime の WASM のバイナリは URL で
 * 取得され、書庫の中を指す file:// の URL は OS にとって存在しない。開発ツリー（パスに asar が
 * 無い）では恒等関数になる。
 */
export function asarUnpackedPath(p: string): string {
  return p.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
}

/** プロセスの境界を越えるときのテンソル（型付き配列の構造化複製は問題ないが、dims はそれに乗らない）。 */
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
 * パイプラインの結果を構造化複製できる形にする。
 *
 * transformers.js は埋め込みの形をしたタスクには自前の Tensor クラスを返し、それ以外には素の
 * オブジェクトや配列を返す。クラスの実体は構造化複製を、プロトタイプを剥がされた裸のオブジェクト
 * として通り抜けるので、`dims` のアクセサが黙って失われる。だからテンソルは明示的に変換し、
 * それ以外はそのまま通す。
 */
export function serializeMlResult(value: any): any {
  if (isTensorLike(value)) {
    return { __mlTensor: true, type: value.type, dims: Array.from(value.dims), data: Array.from(value.data as ArrayLike<number>) } satisfies MlTensorValue;
  }
  if (Array.isArray(value)) return value.map(serializeMlResult);
  if (ArrayBuffer.isView(value)) return Array.from(value as unknown as ArrayLike<number>);
  if (value && typeof value === 'object') {
    // 自分自身の列挙可能なプロパティをコピーする。向こう側の何かが、どのみち構造化複製に
    // 落とされるプロトタイプに依存しないように。
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) out[k] = serializeMlResult(v);
    return out;
  }
  return value;
}

// --- メッセージ ---

export interface MlRunRequest {
  id: number;
  kind: 'run';
  /** transformers.js のタスク名。'feature-extraction' など。 */
  task: string;
  /** モデルのファイルを収めた絶対パスのディレクトリ。repo id ではない理由は lib-ml-runtime.ts を参照。 */
  modelDir: string;
  /** pipeline() へ渡すオプション（dtype、device の上書き）。 */
  pipelineOptions?: Record<string, any>;
  input: any;
  /** パイプラインの呼び出し自体へ渡すオプション（pooling、normalize、…）。 */
  callOptions?: Record<string, any>;
}

/** ワーカーへ向かう入力のテンソル1つ。構造化複製は型付き配列をそのまま運ぶ。 */
export interface MlSessionFeed {
  type: 'float32';
  dims: number[];
  data: Float32Array;
}

/**
 * 素の ONNX のグラフを走らせる＝transformers.js のパイプラインも、トークナイザも、画像の処理器も
 * 使わない。テンソルを形作るのも生の出力を読むのも呼び出し元。
 *
 * ADR 0026 の決定1が今抱えている例外（#50）。transformers.js が動かせるのは、自分が Hugging Face
 * のものとして認識できるモデルだけで、SmilingWolf/wd-vit-tagger-v3 のような timm / JAX からの
 * 書き出しはそうではない。`model_type` を持たないし、そのパイプラインは多ラベルのスコアへ
 * ソフトマックスを強いるし、その前処理（白のレターボックス、BGR、正規化なし）はありものの画像の
 * 処理器では表せない。そういうモデルについても、それ以外のことは全部この線の transformers.js 側に
 * 留まる＝モデルの置き場も同じ、取得と検証（#832）も同じ、プロセス（#831）も同じ、バックエンドの
 * 選択も同じ。
 */
export interface MlSessionRequest {
  id: number;
  kind: 'session';
  /** モデルのファイルを収めた絶対パスのディレクトリ。MlRunRequest と同じ。 */
  modelDir: string;
  /** modelDir の中のグラフのファイル。'model.onnx' など。 */
  modelFile: string;
  /** グラフの入力名で引く入力のテンソル。 */
  feeds: Record<string, MlSessionFeed>;
}

export interface MlPingRequest {
  id: number;
  kind: 'ping';
}

export type MlRequest = MlRunRequest | MlSessionRequest | MlPingRequest;

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
  /** ワーカーがこのリクエストに費やした実時間のミリ秒。 */
  ms?: number;
}

export type MlChildMessage = MlReadyMessage | MlLogMessage | MlReplyMessage;
