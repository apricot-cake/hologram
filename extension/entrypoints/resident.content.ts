import { extensionOrigin, logSaveEvent } from '../utils/capture-log.ts';
import { startDrag } from '../utils/drag.ts';
import { getCaptureSite, RESIDENT_MATCHES } from '../utils/extractor/index.ts';
import type { BackgroundToContentMessage } from '../utils/messages.ts';
import { startOverlay } from '../utils/overlay.ts';
import { installUncaughtReporting } from '../utils/uncaught-report.ts';
import { refreshUiRootStyles } from '../utils/ui-root.ts';

export default defineContentScript({
  // The sites this script lives on, declared by the site modules themselves
  // (#212) rather than repeated here.
  matches: RESIDENT_MATCHES,
  runAt: 'document_idle',
  main() {
    // Outside the disposable runtime on purpose: reporting must outlive a
    // generation swap, and installUncaughtReporting is once-per-realm anyway (#727).
    installUncaughtReporting(window, logSaveEvent, { context: 'content', ownOrigin: extensionOrigin() });

    // A re-injection — the dev server reloading the extension, or the background
    // injecting a fresh copy into a tab the previous generation still holds —
    // runs this file again in a realm that may still carry the old listeners and
    // DOM. The owner symbol is how the incoming generation finds the outgoing one
    // and takes it down first (#727); without it the two draw the same UI twice.
    const OWNER = Symbol.for('hologram.resident-runtime');

    interface ResidentOwner {
      generation: number;
      dispose: () => void;
    }

    const scope = globalThis as typeof globalThis & { [OWNER]?: ResidentOwner };
    const generation = (scope[OWNER]?.generation ?? 0) + 1;
    scope[OWNER]?.dispose();

    let disposed = false;
    const cleanups: Array<() => void> = [];
    const owner: ResidentOwner = {
      generation,
      dispose() {
        if (disposed) return;
        disposed = true;
        for (const cleanup of cleanups.splice(0).reverse()) cleanup();
        if (scope[OWNER] === owner) delete scope[OWNER];
      },
    };
    scope[OWNER] = owner;

    // #793: the toolbar popup's "この一覧を取り込む" item asks THIS (resident,
    // already-injected) script rather than being injected itself — no activeTab
    // round trip needed, just the extractor's own answer. Registered outside the
    // async block below: the popup can open, and ask, before startOverlay's
    // await settles.
    const onBulkCapturePageCheck = (message: BackgroundToContentMessage, _sender: chrome.runtime.MessageSender, sendResponse: (response: { supported: boolean }) => void) => {
      if (message?.type !== 'checkBulkCapturePage') return false;
      Promise.resolve(getCaptureSite()?.isBulkCapturePage?.() ?? false)
        .then((supported) => sendResponse({ supported }))
        .catch(() => sendResponse({ supported: false }));
      return true; // async response
    };
    chrome.runtime.onMessage.addListener(onBulkCapturePageCheck);
    cleanups.push(() => chrome.runtime.onMessage.removeListener(onBulkCapturePageCheck));

    void (async () => {
      refreshUiRootStyles();
      const overlayCleanup = await startOverlay();
      if (disposed) overlayCleanup();
      else cleanups.push(overlayCleanup);

      const dragCleanup = await startDrag();
      if (disposed) dragCleanup();
      else cleanups.push(dragCleanup);
    })().catch(() => owner.dispose());
  },
});
