'use strict';

// The end-to-end check for #831, driven by scripts/test-ml-runtime.cts.
//
// It lives in the app rather than in the harness because two of the acceptance
// conditions are only true statements about the REAL app: that the packaged
// .exe can run inference at all, and that the window keeps answering while it
// does. Both need this process, not a standalone script that happens to load
// the same modules.
//
// Reachable only from the HOLOGRAM_SMOKE branch of index.ts (the hidden,
// self-quitting verification window), so nothing here runs in a user's session.

import type { BrowserWindow } from 'electron';

import { aiFeaturesEnabled, mlRuntimeStatus, runMlPipeline } from './lib-ml-runtime.ts';

export interface MlSmokeReport {
  gate: boolean;
  backend: string | null;
  nativeError: string | null;
  forcedWasm: boolean;
  /** First few components of the embedding — the value the two backends must agree on. */
  head: string[];
  dims: number[];
  ms: number;
  /** Worst main-process event-loop stall observed while the model was running, in ms. */
  maxLoopLagMs: number;
  /** Worst renderer -> main -> renderer IPC round trip observed at the same time, in ms. */
  maxIpcRoundTripMs: number | null;
}

/**
 * Sample how long the main process goes without servicing its event loop.
 * A synchronous burst on this thread — the thing utilityProcess exists to avoid
 * — shows up here as a stall far larger than the interval.
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

/** Keep a real IPC conversation going from the renderer for as long as `run` takes. */
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
      // Fixed precision, because the point of the comparison is that the two
      // runtimes agree — not that they agree to the last float bit.
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
