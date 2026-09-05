import { extensionOrigin, logSaveEvent } from '../utils/capture-log.ts';
import { startBulkEntry } from '../utils/bulk-entry.ts';
import { installUncaughtReporting } from '../utils/uncaught-report.ts';

export default defineUnlistedScript(() => {
  installUncaughtReporting(window, logSaveEvent, { context: 'content', ownOrigin: extensionOrigin() });
  void startBulkEntry();
});
