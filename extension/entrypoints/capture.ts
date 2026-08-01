import { extensionOrigin, logSaveEvent } from '../utils/capture-log.ts';
import { startCapture } from '../utils/capture.ts';
import { installUncaughtReporting } from '../utils/uncaught-report.ts';

// This module is emitted as a standalone IIFE. CRXJS's `?script` import resolves
// to that generated file, so injection executes the capture entry immediately.
if (typeof location !== 'undefined' && typeof document !== 'undefined') {
  // Alt+S works on pages the resident script never loads on, so this entry
  // carries its own reporting; on shared pages the realm guard keeps it single (#727).
  installUncaughtReporting(window, logSaveEvent, { context: 'content', ownOrigin: extensionOrigin() });
  void startCapture();
}
