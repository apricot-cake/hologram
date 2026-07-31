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
import { PROTOCOL_VERSION, hostProtocolVersion, protocolSkewOf } from '../../native-host/protocol.mts';
import type { HostRequest } from '../../native-host/protocol.mts';

export function startDiagnostics(): void {
  const DIAG_PREFIX = 'diaglog_';

  function testNative(): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      let settled = false;
      const done = (v: Record<string, unknown>) => {
        if (!settled) {
          settled = true;
          resolve(v);
        }
      };
      let port: chrome.runtime.Port;
      try {
        port = chrome.runtime.connectNative('com.hologram.host');
      } catch (e: any) {
        done({ ok: false, where: 'connect-threw', error: String((e && e.message) || e) });
        return;
      }
      const timer = setTimeout(() => {
        try {
          port.disconnect();
        } catch {
          /* */
        }
        done({ ok: false, where: 'timeout' });
      }, 5000);
      port.onMessage.addListener((m: unknown) => {
        clearTimeout(timer);
        try {
          port.disconnect();
        } catch {
          /* */
        }
        done({ ok: true, msg: m });
      });
      port.onDisconnect.addListener(() => {
        clearTimeout(timer);
        done({ ok: false, where: 'disconnect', error: (chrome.runtime.lastError && chrome.runtime.lastError.message) || null });
      });
      try {
        port.postMessage({ type: 'ping' } satisfies HostRequest);
      } catch (e: any) {
        clearTimeout(timer);
        done({ ok: false, where: 'post-threw', error: String((e && e.message) || e) });
      }
    });
  }

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

  // The two halves' contract versions side by side (#205). This is the page the
  // banner sends people to, and the only place either number can be READ — the
  // banner can say "update the app" but not what it saw, and a user comparing
  // two version numbers is exactly the sort of check a diagnostics page is for.
  //
  // `host` is null when the ping never got an answer (the host could not be
  // launched — nativeTest says which) AND when it answered without a stamp,
  // which is a host from before this handshake existed. Those two are not the
  // same thing, so `hostAnswered` keeps them apart rather than making the reader
  // infer it from nativeTest.
  function protocolReport(nativeTest: Record<string, unknown>) {
    const answered = nativeTest.ok === true;
    const host = answered ? hostProtocolVersion(nativeTest.msg) : null;
    return {
      extension: PROTOCOL_VERSION,
      host,
      hostAnswered: answered,
      // Only meaningful once the host has answered: an unreachable host has no
      // version to be behind or ahead of.
      skew: answered ? protocolSkewOf(host) : null,
    };
  }

  async function run() {
    const out: Record<string, unknown> = { id: chrome.runtime.id, ts: new Date().toISOString() };
    out.storedLogs = await readStoredLogs();
    out.nativeTest = await testNative(); // launches the host if Chrome can find it
    out.protocol = protocolReport(out.nativeTest as Record<string, unknown>);
    window.__hologramDiag = out; // readable via the page console
    const outEl = document.getElementById('out');
    if (outEl) outEl.textContent = JSON.stringify(out, null, 2);
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
  run();
}
