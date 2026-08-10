'use strict';

// #831 の端から端までの確認。scripts/test-ml-runtime.cts が動かす。
//
// ハーネスではなくアプリの中に在るのは、受け入れ条件のうち2つが、本物のアプリについてしか真に
// なり得ない主張だから。パッケージ済みの .exe がそもそも推論を走らせられること、そしてその間も
// ウィンドウが答え続けること。どちらも必要なのはこのプロセスであって、たまたま同じモジュールを
// 読み込む単体のスクリプトではない。
//
// 届くのは index.ts の HOLOGRAM_SMOKE の分岐（隠しの、自分で終了する検証用ウィンドウ）からだけ
// なので、ここのものが利用者のセッションで走ることはない。

import type { BrowserWindow } from 'electron';

import { aiFeaturesEnabled, mlRuntimeStatus, runMlPipeline } from './lib-ml-runtime.ts';

export interface MlSmokeReport {
  gate: boolean;
  backend: string | null;
  nativeError: string | null;
  forcedWasm: boolean;
  /** 埋め込みの先頭の数成分＝2つのバックエンドが一致しなければならない値。 */
  head: string[];
  dims: number[];
  ms: number;
  /** モデルが走っている間に観測した、メインプロセスのイベントループの最悪の停滞（ミリ秒）。 */
  maxLoopLagMs: number;
  /** 同じ間に観測した、レンダラー → main → レンダラーの IPC の最悪の往復（ミリ秒）。 */
  maxIpcRoundTripMs: number | null;
}

/**
 * メインプロセスが自分のイベントループを処理せずにいる時間を標本で測る。このスレッド上の同期の
 * 塊＝utilityProcess がそれを避けるために在るもの＝は、ここでは間隔よりはるかに大きな停滞として
 * 現れる。
 */
function watchLoopLag(intervalMs = 20) {
  let last = Date.now();
  let max = 0;
  const timer = setInterval(() => {
    const now = Date.now();
    max = Math.max(max, now - last - intervalMs);
    last = now;
  }, intervalMs);
  return {
    stop() {
      clearInterval(timer);
      return max;
    },
  };
}

/** `run` が掛かっている間ずっと、レンダラーから本物の IPC のやり取りを続けさせる。 */
function pollRendererIpc(win: BrowserWindow | null): Promise<number | null> {
  if (!win || win.isDestroyed()) return Promise.resolve(null);
  return win.webContents
    .executeJavaScript(
      `(async () => { let worst = 0; const until = Date.now() + 100000; globalThis.__hologramMlPolling = true;
         while (globalThis.__hologramMlPolling && Date.now() < until) {
           const t = Date.now(); await window.hologram.listPosts(); worst = Math.max(worst, Date.now() - t);
           await new Promise((r) => setTimeout(r, 20));
         }
         return worst; })()`,
    )
    .catch(() => null);
}

function stopRendererIpc(win: BrowserWindow | null) {
  if (!win || win.isDestroyed()) return;
  win.webContents.executeJavaScript('globalThis.__hologramMlPolling = false').catch(() => {});
}

export async function runMlSmoke(modelDir: string, win: BrowserWindow | null): Promise<MlSmokeReport> {
  const gate = aiFeaturesEnabled();
  const lag = watchLoopLag();
  const ipc = pollRendererIpc(win);
  const t0 = Date.now();
  try {
    const out = await runMlPipeline({
      task: 'feature-extraction',
      modelDir,
      input: 'hologram local inference smoke',
      pipelineOptions: { dtype: 'q8' },
      callOptions: { pooling: 'mean', normalize: true },
    });
    const ms = Date.now() - t0;
    stopRendererIpc(win);
    const status = mlRuntimeStatus();
    return {
      gate,
      backend: status.backend,
      nativeError: status.nativeError,
      forcedWasm: status.forcedWasm,
      dims: out.dims,
      // 桁を固定する。比較の要点は2つのランタイムが一致することであって、浮動小数の最後の
      // 1ビットまで一致することではないため。
      head: (out.data as number[]).slice(0, 8).map((v: number) => v.toFixed(6)),
      ms,
      maxLoopLagMs: lag.stop(),
      maxIpcRoundTripMs: await ipc,
    };
  } catch (err) {
    stopRendererIpc(win);
    lag.stop();
    await ipc;
    throw err;
  }
}
