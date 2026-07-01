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

const DIAG_PREFIX = 'diaglog_';

function testNative() {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    let port;
    try {
      port = chrome.runtime.connectNative('com.corpus.host');
    } catch (e) {
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
    port.onMessage.addListener((m) => {
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
      port.postMessage({ type: 'ping' });
    } catch (e) {
      clearTimeout(timer);
      done({ ok: false, where: 'post-threw', error: String((e && e.message) || e) });
    }
  });
}

function readStoredLogs() {
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

async function run() {
  const out = { id: chrome.runtime.id, ts: new Date().toISOString() };
  out.storedLogs = await readStoredLogs();
  out.nativeTest = await testNative(); // launches the host if Chrome can find it
  window.__corpusDiag = out; // readable via the page console
  document.getElementById('out').textContent = JSON.stringify(out, null, 2);
  return out;
}

document.getElementById('rerun').addEventListener('click', run);
document.getElementById('clear').addEventListener('click', () => {
  chrome.storage.local.get(null, (all) => {
    const keys = Object.keys(all).filter((k) => k.startsWith(DIAG_PREFIX));
    chrome.storage.local.remove(keys, run);
  });
});
run();
