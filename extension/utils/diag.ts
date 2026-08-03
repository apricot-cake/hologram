'use strict';

// Internal diagnostics page (not part of the capture flow). Two jobs:
//   1. Read back the chrome.storage fallback ring buffer — the events that
//      couldn't reach the host's capture.log (exactly what happens when the host
//      is unreachable). This is the window into failures that the service-worker
//      console would otherwise be the only home for.
//   2. Test the native-host connection FROM the extension's own origin, so the
//      allowed_origins check applies just like a real save, and surface the
//      precise chrome.runtime.lastError.
// Open at chrome-extension://<id>/diag.html.
//
// Wrapped in an IIFE so DIAG_PREFIX (also declared in background.ts) doesn't
// collide — this file and background.ts never share a JS realm at runtime
// (this is a regular page script, background.ts is the service worker), but
// tsc compiles every extension file as one program, so top-level names must
// stay unique across it. drag.ts/i18n.ts use the same IIFE convention.
import { pingNativeHost, protocolReportOf } from './host-probe.ts';
import type { QueueStatsResponse, ResendQueueResponse } from './messages.ts';
import type { SaveQueueStats } from './save-queue.ts';

export function startDiagnostics(): void {
  const DIAG_PREFIX = 'diaglog_';

  function readStoredLogs(): Promise<unknown[]> {
    return new Promise((r) =>
      chrome.storage.local.get(null, (all) => {
        r(
          Object.keys(all)
            .filter((k) => k.startsWith(DIAG_PREFIX))
            .sort()
            .map((k) => all[k]),
        );
      }),
    );
  }

  // #203: the retry queue's inventory. Read-only (the {type:'queueStats'}
  // handler never sweeps) so this page's own load never provokes a
  // connectNative attempt on top of testNative()'s ping — resendQueue below
  // is the one action that does.
  function readQueueStats(): Promise<SaveQueueStats | null> {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'queueStats' }, (res?: QueueStatsResponse) => {
          void chrome.runtime.lastError;
          resolve(res?.ok ? res.stats : null);
        });
      } catch {
        resolve(null);
      }
    });
  }

  // Re-render just the queue section without re-running the whole
  // diagnostics pass (testNative launches the host — no reason to do that
  // again just to show fresher queue numbers).
  let lastOut: Record<string, unknown> | null = null;
  function renderOut(out: Record<string, unknown>) {
    lastOut = out;
    window.__hologramDiag = out; // readable via the page console
    const outEl = document.getElementById('out');
    if (outEl) outEl.textContent = JSON.stringify(out, null, 2);
  }

  async function run() {
    const out: Record<string, unknown> = { id: chrome.runtime.id, ts: new Date().toISOString() };
    out.storedLogs = await readStoredLogs();
    // The connection test and the version comparison are utils/host-probe.ts —
    // the same two measurements the toolbar popup makes (#124), so the two
    // pages can never contradict each other about the same host.
    const ping = await pingNativeHost(); // launches the host if Chrome can find it
    out.nativeTest = ping;
    out.protocol = protocolReportOf(ping);
    out.saveQueue = await readQueueStats();
    renderOut(out);
    return out;
  }

  // Why the reader is here, when the toolbar alert sent them (#269 —
  // diag.html?issue=inject). Only the extension's own service worker builds
  // that URL, and the parameter selects a fixed block already in the page
  // rather than carrying any text of its own.
  if (new URLSearchParams(location.search).get('issue') === 'inject') {
    document.getElementById('issue-inject')?.removeAttribute('hidden');
  }

  document.getElementById('rerun')?.addEventListener('click', run);
  document.getElementById('clear')?.addEventListener('click', () => {
    chrome.storage.local.get(null, (all) => {
      const keys = Object.keys(all).filter((k) => k.startsWith(DIAG_PREFIX));
      chrome.storage.local.remove(keys, run);
    });
  });
  // #203: run one sweep of the retry queue now, then redraw with the numbers
  // it leaves behind — the whole diagnostics pass is not re-run, so this
  // does not also re-ping the host via testNative.
  document.getElementById('resend-queue')?.addEventListener('click', () => {
    try {
      chrome.runtime.sendMessage({ type: 'resendQueue' }, (res?: ResendQueueResponse) => {
        void chrome.runtime.lastError;
        const stats = res?.ok ? res.stats : null;
        renderOut({ ...(lastOut || {}), saveQueue: stats });
      });
    } catch {
      /* extension context gone under this page — nothing to recover here */
    }
  });
  run();
}
