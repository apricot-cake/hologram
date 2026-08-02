import { extensionOrigin, logSaveEvent } from '../utils/capture-log.ts';
import { startCapture } from '../utils/capture.ts';
import { installUncaughtReporting } from '../utils/uncaught-report.ts';

// Not declared in the manifest: the background injects it by file name through
// chrome.scripting.executeScript, which is why it is an UNLISTED script — WXT
// emits it as a standalone bundle at the output root as `capture.js`, the exact
// name background.ts names (scripts/ext-consistency.test.ts guards that pair).
export default defineUnlistedScript(() => {
  // Alt+S works on pages the resident script never loads on, so this entry
  // carries its own reporting; on shared pages the realm guard keeps it single (#727).
  installUncaughtReporting(window, logSaveEvent, { context: 'content', ownOrigin: extensionOrigin() });
  void startCapture();
});
