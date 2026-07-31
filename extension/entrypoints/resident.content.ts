import { RESIDENT_MATCHES } from '../utils/extractor/index.ts';
import { startDrag } from '../utils/drag.ts';
import { EXT_BUILD_ID } from '../utils/dev-reload.ts';
import type { BackgroundToContentMessage, DevReloadPingResponse } from '../utils/messages.ts';
import { startOverlay } from '../utils/overlay.ts';

export default defineContentScript({
  // Every site whose extractor declares a resident surface (#212) — adding a
  // site does not touch this file.
  matches: RESIDENT_MATCHES,
  runAt: 'document_idle',
  async main() {
    // "This tab holds one of ours" (#650). Registered first and only in a bundle
    // that carries a local build id, so a store-installed extension never grows
    // the listener at all. Says nothing about state — the worker decides whether
    // a reload may happen; this only says the page exists to be put back.
    if (EXT_BUILD_ID) {
      chrome.runtime.onMessage.addListener((message: BackgroundToContentMessage, _sender, sendResponse: (response: DevReloadPingResponse) => void) => {
        if (message?.type !== 'devReloadPing') return false;
        sendResponse({ ok: true });
        return false;
      });
    }
    await startOverlay();
    await startDrag();
  },
});
