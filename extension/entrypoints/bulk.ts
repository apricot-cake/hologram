import { logSaveEvent } from '../utils/capture-log.ts';
import { startBulkEntry } from '../utils/bulk-entry.ts';
import { reportCaughtException } from '../utils/uncaught-report.ts';

export default defineUnlistedScript(() => {
  void startBulkEntry().catch((error) => reportCaughtException(logSaveEvent, 'content', error, 'bulk-start'));
});
